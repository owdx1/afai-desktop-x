import win32com.client
import win32print
import win32con
import os
import time
import sys
from datetime import datetime
import pythoncom
import tempfile
from PIL import Image  # Requires pillow package
import google.generativeai as genai
import base64
from PIL import Image
import io
from dotenv import load_dotenv  # Add this import
import argparse

# Load environment variables from .env file
load_dotenv()

# Try to import reportlab for better PDF creation
try:
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter, A4
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False
    print("Note: ReportLab not found. Install with 'pip install reportlab' for better PDF quality.")

# Try to import win32ui properly
try:
    import win32ui
    import win32api
    SHELL_EXECUTE_AVAILABLE = True
except ImportError:
    win32ui = None
    win32api = None
    SHELL_EXECUTE_AVAILABLE = False
    print("Note: win32ui not available. Some printing functionality may be limited.")
    
# Add specific handling for pythoncom errors
def handle_com_exception(e):
    """Handle common COM exceptions with more informative messages"""
    error_msg = str(e)
    if "0x800706ba" in error_msg:
        return f"{error_msg} - RPC server unavailable. The scanner may be disconnected or in use by another application."
    elif "0x80010108" in error_msg:
        return f"{error_msg} - COM call was canceled. The operation might have timed out."
    elif "0x80004005" in error_msg:
        return f"{error_msg} - Unspecified COM error. The device might be disconnected or powered off."
    else:
        return error_msg

class AdvancedScannerPrinter:
    """Advanced scanner and printer control with batch processing capabilities"""
    
    def __init__(self):
        """Initialize the Advanced Scanner and Printer control class"""
        self.scan_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scans")
        if not os.path.exists(self.scan_dir):
            os.makedirs(self.scan_dir)
        # Track last scanned document path
        self.last_scanned_file = None
        # Initialize Gemini AI
        try:
            # Try to get API key from environment variable first
            api_key = os.getenv('GOOGLE_API_KEY')
            if not api_key:
                # Fallback to hardcoded key (replace with your actual API key)
                api_key = "your_api_key_here"  # Replace this with your actual API key
                print("Warning: Using hardcoded API key. For better security, set GOOGLE_API_KEY environment variable.")
            
            genai.configure(api_key=api_key)
            self.gemini_model = genai.GenerativeModel('gemini-1.5-flash')
            self.GEMINI_AVAILABLE = True
        except Exception as e:
            print(f"Note: Gemini AI not available. Text extraction feature will be disabled. Error: {e}")
            self.GEMINI_AVAILABLE = False
    
    def get_scanner_devices(self):
        """Get all available scanner devices on the system
        
        Returns:
            list: List of (index, name, device_id) tuples for available scanners
        """
        scanners = []
        try:
            device_manager = win32com.client.Dispatch("WIA.DeviceManager")
            for i in range(device_manager.DeviceInfos.Count):
                device_info = device_manager.DeviceInfos(i+1)
                if device_info.Type == 1:  # Scanner
                    try:
                        description = device_info.Description
                    except:
                        description = f"Scanner {i+1}"
                    
                    try:
                        device_id = device_info.DeviceID
                    except:
                        device_id = f"scanner_{i+1}"
                        
                    scanners.append((
                        i+1,
                        description,
                        device_id
                    ))
        except Exception as e:
            print(f"Error getting scanner devices: {e}")
        
        return scanners
    
    def get_scanner_properties(self, device_id):
        """Get all available properties for a scanner
        
        Args:
            device_id (str): Scanner device ID
            
        Returns:
            dict: Dictionary of property name -> current value
        """
        properties = {}
        try:
            device_manager = win32com.client.Dispatch("WIA.DeviceManager")
            for i in range(device_manager.DeviceInfos.Count):
                device_info = device_manager.DeviceInfos(i+1)
                if device_info.DeviceID == device_id:
                    device = device_info.Connect()
                    for j in range(device.Properties.Count):
                        prop = device.Properties(j+1)
                        properties[prop.Name] = prop.Value
                    
                    # Also get item properties (scanner settings)
                    if device.Items.Count > 0:
                        item = device.Items(1)
                        for j in range(item.Properties.Count):
                            prop = item.Properties(j+1)
                            properties[f"Item.{prop.Name}"] = prop.Value
                    
                    break
        except Exception as e:
            print(f"Error getting scanner properties: {e}")
        
        return properties
    
    def _safe_release_com_objects(self):
        """Safely release COM objects by forcing garbage collection"""
        try:
            # Force garbage collection to help release COM objects
            import gc
            gc.collect()
        except Exception as e:
            print(f"Note: Error during COM object cleanup: {e}")

    def scan_document_as_pdf(self, resolution=300, color_mode="Color", page_size="A4"):
        """
        Scan a document and save it as PDF
        
        Args:
            resolution (int): DPI resolution of the scan
            color_mode (str): Color mode of the scan (Color, Grayscale, or Black and White)
            page_size (str): Page size for the PDF (A4, Letter)
            
        Returns:
            str: Path to the PDF file or None on failure
        """
        try:
            if not PDF_SUPPORT:
                print("PDF creation requires PIL and reportlab libraries. Please install them with:")
                print("pip install pillow reportlab")
                return None
            
            # Set up options
            options = {
                "resolution": resolution,
                "color_mode": color_mode,
                "output_format": "pdf",
                "page_size": page_size
            }
            
            # Scan using our advanced method that supports PDF creation
            pdf_path = self.scan_document_with_options(None, options)
            
            if pdf_path and os.path.exists(pdf_path):
                print(f"Document scanned and saved as PDF: {pdf_path}")
                return pdf_path
            else:
                print("Failed to create PDF from scan.")
                return None
            
        except Exception as e:
            print(f"Error creating PDF from scan: {e}")
            # Clean up COM resources 
            self._safe_release_com_objects()
            return None
    
    def batch_scan(self, pages=1, device_id=None, options=None):
        """
        Scan multiple pages in sequence
        
        Args:
            pages (int): Number of pages to scan
            device_id (str): Optional scanner device ID
            options (dict): Scanning options
            
        Returns:
            list: List of paths to scanned files
        """
        try:
            scanned_files = []
            
            if options is None:
                options = {}
            
            # Check if PDF output was requested
            pdf_requested = options.get("output_format", "").lower() == "pdf"
            
            for i in range(pages):
                print(f"Scanning page {i+1} of {pages}...")
                
                # Create a unique filename for each page
                if "output_file" in options:
                    base, ext = os.path.splitext(options["output_file"])
                    options["output_file"] = f"{base}_page{i+1}{ext}"
                
                time.sleep(1)  # Give some time between scans
                
                # Scan using appropriate method based on output format
                scanned_file = self.scan_document_with_options(device_id, options)
                if scanned_file:
                    scanned_files.append(scanned_file)
                    
                    if i < pages - 1:
                        input(f"Press Enter when ready to scan page {i+2}...")
            
            # Return the list of scanned files
            return scanned_files
            
        except Exception as e:
            print(f"Error during batch scanning: {e}")
            return []
        finally:
            # Ensure COM objects are released
            self._safe_release_com_objects()
    
    def get_printer_details(self):
        """Get detailed information about all printers
        
        Returns:
            list: List of dictionaries with printer details
        """
        printers = []
        try:
            printer_list = win32print.EnumPrinters(
                win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
            )
            
            default_printer = win32print.GetDefaultPrinter()
            
            for i, printer in enumerate(printer_list):
                # Get more detailed information
                try:
                    h_printer = win32print.OpenPrinter(printer[2])
                    printer_info = win32print.GetPrinter(h_printer, 2)
                    win32print.ClosePrinter(h_printer)
                except:
                    printer_info = {}
                
                printers.append({
                    "index": i+1,
                    "name": printer[2],
                    "is_default": printer[2] == default_printer,
                    "port": printer_info.get("pPortName", ""),
                    "driver": printer_info.get("pDriverName", ""),
                    "attributes": printer_info.get("Attributes", 0),
                    "status": printer_info.get("Status", 0)
                })
        except Exception as e:
            print(f"Error getting printer details: {e}")
        
        return printers
    
    def print_direct_no_dialog(self, file_path, printer_name=None, recursion_depth=0):
        """
        Print a document directly to a printer without any dialog
        Tries multiple methods to print silently
        
        Args:
            file_path (str): Path to the file to print
            printer_name (str): Name of the printer to use (None for default)
            recursion_depth (int): Tracks recursion to prevent infinite loops
            
        Returns:
            bool: True if printing was successful, False otherwise
        """
        # Prevent infinite recursion
        if recursion_depth > 2:
            print(f"Warning: Maximum recursion depth reached. Stopping conversion attempts.")
            return False
            
        if not os.path.exists(file_path):
            print(f"File not found: {file_path}")
            return False
            
        # If no printer specified, use default
        if printer_name is None:
            printer_name = win32print.GetDefaultPrinter()
            
        print(f"Attempting direct printing of '{file_path}' to '{printer_name}' without dialog...")
        
        # Get file extension
        _, file_ext = os.path.splitext(file_path)
        file_ext = file_ext.lower()
        
        # For image files, try specialized image printing first
        if file_ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif']:
            try:
                # Use the specialized image printing function
                if self.print_image_direct(file_path, printer_name):
                    return True
            except Exception as e:
                print(f"Specialized image printing failed: {e}")
        
        # Method 1: Use GhostScript for PDF files (if available)
        if file_ext == '.pdf':
            try:
                import subprocess
                
                # Check if GhostScript is installed
                try:
                    # Look for gswin64c.exe or gswin32c.exe
                    gs_paths = [
                        r"C:\Program Files\gs\gs*\bin\gswin64c.exe",
                        r"C:\Program Files (x86)\gs\gs*\bin\gswin32c.exe",
                        r"C:\Program Files\gs\*\bin\gswin64c.exe",
                        r"C:\Program Files (x86)\gs\*\bin\gswin32c.exe"
                    ]
                    
                    gs_path = None
                    for path_pattern in gs_paths:
                        import glob
                        matches = glob.glob(path_pattern)
                        if matches:
                            gs_path = matches[-1]  # Take the latest version
                            break
                    
                    if gs_path:
                        # Use GhostScript to print directly
                        gs_cmd = [
                            gs_path,
                            "-dNOPAUSE", "-dBATCH", "-dQUIET",
                            f"-sDEVICE=mswinpr2",
                            f"-sOutputFile=%printer%{printer_name}",
                            file_path
                        ]
                        
                        subprocess.run(gs_cmd, check=True)
                        print(f"Document sent to printer using GhostScript")
                        return True
                except Exception as e:
                    print(f"GhostScript printing failed: {e}")
            except Exception as e:
                print(f"GhostScript method failed entirely: {e}")
        
        # Method 2: Use direct Windows API printing for text files
        if file_ext in ['.txt', '.log', '.ini']:
            try:
                h_printer = win32print.OpenPrinter(printer_name)
                try:
                    job_id = win32print.StartDocPrinter(h_printer, 1, (os.path.basename(file_path), None, "RAW"))
                    try:
                        win32print.StartPagePrinter(h_printer)
                        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                            text = f.read()
                            # Format text for printing
                            win32print.WritePrinter(h_printer, text.encode('utf-8'))
                        win32print.EndPagePrinter(h_printer)
                    finally:
                        win32print.EndDocPrinter(h_printer)
                finally:
                    win32print.ClosePrinter(h_printer)
                
                print(f"Text document sent directly to printer")
                return True
            except Exception as e:
                print(f"Error printing text document: {e}")
        
        # Method 3: Use SumatraPDF if installed (works for PDF, XPS, EPUB, MOBI, CBZ, CBR)
        if file_ext in ['.pdf', '.xps', '.epub', '.mobi', '.cbz', '.cbr']:
            try:
                import subprocess
                
                # Check for SumatraPDF in common locations
                sumatra_paths = [
                    # Custom/user locations first
                    os.path.join(os.path.dirname(os.path.abspath(__file__)), "SumatraPDF.exe"),
                    os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "SumatraPDF.exe"),
                    r"C:\Users\90539\AppData\Local\SumatraPDF\SumatraPDF.exe",
                    os.path.join(os.environ['USERPROFILE'], r"AppData\Local\SumatraPDF\SumatraPDF.exe"),
                    os.path.expanduser(r"~\AppData\Local\SumatraPDF\SumatraPDF.exe"),
                    r"D:\SumatraPDF\SumatraPDF.exe",
                    os.path.expanduser("~/Downloads/SumatraPDF.exe"),
                    # Then standard locations
                    r"C:\Program Files\SumatraPDF\SumatraPDF.exe",
                    r"C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe",
                    r"C:\Users\Public\SumatraPDF\SumatraPDF.exe"
                ]
                
                sumatra_path = None
                for path in sumatra_paths:
                    if os.path.exists(path):
                        sumatra_path = path
                        print(f"Found SumatraPDF at: {sumatra_path}")
                        break
                
                if sumatra_path:
                    # Use SumatraPDF for silent printing with additional options
                    print_cmd = [
                        sumatra_path,
                        "-print-to", printer_name,
                        "-print-settings", "duplexshort,color",  # Can be modified based on preferences
                        "-silent",
                        "-exit-when-done",
                        file_path
                    ]
                    
                    # Execute with timeout for safety
                    subprocess.run(print_cmd, check=True, timeout=60)
                    
                    print(f"Document sent to printer using SumatraPDF")
                    return True
                else:
                    print("SumatraPDF not found in any standard locations.")
                    
                    # Try using the direct path we know
                    direct_path = r"C:\Users\90539\AppData\Local\SumatraPDF\SumatraPDF.exe"
                    if os.path.exists(direct_path):
                        print(f"Found SumatraPDF at: {direct_path}")
                        # Use the direct path we found
                        print_cmd = [
                            direct_path,
                            "-print-to", printer_name,
                            "-print-settings", "duplexshort,color",
                            "-silent",
                            "-exit-when-done",
                            file_path
                        ]
                        
                        print(f"Printing using direct path to SumatraPDF...")
                        subprocess.run(print_cmd, check=True, timeout=30)
                        print(f"Document sent to printer successfully")
                        return True
                    
                    # If still not found, ask user if they want to download it
                    print("\nSumatraPDF is needed for better PDF printing.")
                    download_choice = input("Do you want to download SumatraPDF now? (y/n): ")
                    
                    if download_choice.lower() == 'y':
                        # Download SumatraPDF
                        download_path = self.download_sumatra_pdf()
                        
                        if download_path and os.path.exists(download_path):
                            print(f"Using downloaded SumatraPDF at: {download_path}")
                            
                            # Use the downloaded executable
                            print_cmd = [
                                download_path,
                                "-print-to", printer_name,
                                "-print-settings", "duplexshort,color",
                                "-silent",
                                "-exit-when-done",
                                file_path
                            ]
                            
                            print(f"Printing using downloaded SumatraPDF...")
                            subprocess.run(print_cmd, check=True, timeout=30)
                            print(f"Document sent to printer successfully")
                            return True
            except Exception as e:
                print(f"SumatraPDF printing failed: {e}")
                
            # If we reach here, SumatraPDF was not found or failed, let's try calling it directly
            try:
                # Try running directly using 'sumatrapdf' command
                import subprocess
                
                # Try using direct command
                print_cmd = [
                    "sumatrapdf",
                    "-print-to", printer_name,
                    "-print-settings", "duplexshort,color",
                    "-silent",
                    file_path
                ]
                
                subprocess.run(print_cmd, check=True, timeout=30)
                print(f"Document sent to printer using SumatraPDF command")
                return True
            except Exception as e:
                print(f"SumatraPDF direct command failed: {e}")
        
        # Method 4: For PDF files, try using Adobe Reader if installed
        if file_ext == '.pdf':
            try:
                import subprocess
                
                # Check for Adobe Reader/Acrobat in common locations
                adobe_paths = [
                    r"C:\Program Files (x86)\Adobe\Reader*\Reader\AcroRd32.exe",
                    r"C:\Program Files\Adobe\Reader*\Reader\AcroRd32.exe",
                    r"C:\Program Files (x86)\Adobe\Acrobat*\Acrobat\Acrobat.exe",
                    r"C:\Program Files\Adobe\Acrobat*\Acrobat\Acrobat.exe"
                ]
                
                adobe_path = None
                for path_pattern in adobe_paths:
                    import glob
                    matches = glob.glob(path_pattern)
                    if matches:
                        adobe_path = matches[-1]  # Take the latest version
                        break
                
                if adobe_path:
                    # Use Adobe Reader/Acrobat for printing
                    # /t prints silently to default printer
                    # /h makes it hidden
                    # We'll set the default printer temporarily
                    original_printer = win32print.GetDefaultPrinter()
                    if printer_name != original_printer:
                        win32print.SetDefaultPrinter(printer_name)
                    
                    print_cmd = [
                        adobe_path,
                        "/t", file_path,
                        printer_name,
                        "/h"
                    ]
                    
                    subprocess.run(print_cmd, check=True)
                    
                    # Restore original default printer
                    if printer_name != original_printer:
                        win32print.SetDefaultPrinter(original_printer)
                    
                    print(f"Document sent to printer using Adobe Reader/Acrobat")
                    return True
            except Exception as e:
                print(f"Adobe Reader/Acrobat printing failed: {e}")
        
        # Method 5: Use PowerShell to print PDF files
        if file_ext == '.pdf':
            try:
                import subprocess
                import tempfile
                
                # Create PowerShell script to print PDF
                ps_script = tempfile.NamedTemporaryFile(delete=False, suffix='.ps1')
                ps_script_path = ps_script.name
                
                # Replace backslashes
                safe_file_path = file_path.replace('\\', '\\\\')
                
                # PowerShell script content
                ps_content = f"""
                $printer = "{printer_name}"
                $filePath = "{safe_file_path}"
                
                # Method 1: Try using .NET printing
                try {{
                    Add-Type -AssemblyName System.Drawing
                    
                    # Create PDF document object
                    $doc = New-Object System.Drawing.Printing.PrintDocument
                    $doc.PrinterSettings.PrinterName = $printer
                    
                    # Start printing
                    $doc.Print()
                    
                    Write-Host "PDF sent to printer using .NET"
                    exit 0
                }} catch {{
                    Write-Host ".NET printing failed: $_"
                }}
                
                # Method 2: Try using SendToPrinter tool if it exists
                $sendToPrinterPath = "C:\\Windows\\System32\\sendToPrinter.exe"
                if (Test-Path $sendToPrinterPath) {{
                    Start-Process $sendToPrinterPath -ArgumentList "`"$filePath`" `"$printer`"" -Wait
                    Write-Host "PDF sent to printer using SendToPrinter tool"
                    exit 0
                }}
                
                # Method 3: Try using Out-Printer
                try {{
                    Get-Content -Path $filePath -Raw | Out-Printer -Name $printer
                    Write-Host "PDF sent to printer using Out-Printer"
                    exit 0
                }} catch {{
                    Write-Host "Out-Printer failed: $_"
                }}
                
                Write-Host "All PowerShell printing methods failed"
                exit 1
                """
                
                ps_script.write(ps_content.encode('utf-8'))
                ps_script.close()
                
                # Run PowerShell script
                ps_cmd = [
                    "powershell.exe",
                    "-ExecutionPolicy", "Bypass",
                    "-File", ps_script_path
                ]
                
                subprocess.run(ps_cmd, check=True)
                
                # Clean up
                try:
                    os.unlink(ps_script_path)
                except:
                    pass
                
                print(f"Document sent to printer using PowerShell")
                return True
            except Exception as e:
                print(f"PowerShell printing failed: {e}")
                
        # Method 6: For PDF files, try a direct method with the printer API
        if file_ext == '.pdf':
            try:
                # Set the printer as default temporarily
                original_printer = win32print.GetDefaultPrinter()
                if printer_name != original_printer:
                    win32print.SetDefaultPrinter(printer_name)
                
                # Try using win32api to print
                win32api.ShellExecute(0, "print", file_path, None, ".", 0)
                
                # Restore original default printer
                if printer_name != original_printer:
                    win32print.SetDefaultPrinter(original_printer)
                
                print(f"PDF sent to printer using win32api ShellExecute")
                return True
            except Exception as e:
                print(f"win32api printing failed: {e}")
            
        # Method 7: For image files, convert to PDF and try again
        if file_ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif'] and recursion_depth == 0:
            try:
                # Create temp PDF file
                temp_pdf = tempfile.NamedTemporaryFile(delete=False, suffix='.pdf')
                temp_pdf.close()
                
                # Convert image to PDF
                img = Image.open(file_path)
                if img.mode == 'RGBA':
                    img = img.convert('RGB')
                
                img.save(temp_pdf.name, 'PDF')
                print(f"Converted image to PDF for direct printing")
                
                # Try to print the PDF with increased recursion depth
                result = self.print_direct_no_dialog(temp_pdf.name, printer_name, recursion_depth + 1)
                
                # Clean up
                try:
                    os.unlink(temp_pdf.name)
                except:
                    pass
                    
                return result
            except Exception as e:
                print(f"Image conversion failed: {e}")
        
        # Method 8: Try direct printing for image files
        if file_ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif']:
            try:
                # Use PIL to get the raw data
                img = Image.open(file_path)
                
                # Open printer
                h_printer = win32print.OpenPrinter(printer_name)
                try:
                    # Start a raw print job
                    job_id = win32print.StartDocPrinter(h_printer, 1, ("Image Print", None, "RAW"))
                    try:
                        win32print.StartPagePrinter(h_printer)
                        
                        # Convert image to a simpler format
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                            
                        # Get raw image data
                        raw_data = img.tobytes()
                        
                        # Send it to printer
                        win32print.WritePrinter(h_printer, raw_data)
                        win32print.EndPagePrinter(h_printer)
                    finally:
                        win32print.EndDocPrinter(h_printer)
                finally:
                    win32print.ClosePrinter(h_printer)
                    
                print(f"Image sent directly to printer using RAW data")
                return True
            except Exception as e:
                print(f"Raw image printing failed: {e}")
                
        # Method 9: For PDF files, convert to temporary images and print them
        if file_ext == '.pdf' and recursion_depth == 0:
            try:
                print("Attempting to convert PDF to images and print...")
                
                # Try to import pdf2image
                try:
                    from pdf2image import convert_from_path
                    
                    # Convert PDF to images
                    images = convert_from_path(file_path, dpi=300)
                    
                    success = False
                    
                    # Create temp directory for images
                    temp_dir = tempfile.mkdtemp()
                    temp_images = []
                    
                    # Save images and print them
                    for i, img in enumerate(images):
                        temp_img_path = os.path.join(temp_dir, f"pdf_page_{i}.png")
                        img.save(temp_img_path, "PNG")
                        temp_images.append(temp_img_path)
                        
                        # Try to print each image
                        if self.print_direct_no_dialog(temp_img_path, printer_name, recursion_depth + 1):
                            success = True
                        
                        # Clean up
                        try:
                            os.unlink(temp_img_path)
                        except:
                            pass
                    
                    # Clean up temp directory
                    try:
                        os.rmdir(temp_dir)
                    except:
                        pass
                    
                    if success:
                        print(f"PDF printed by converting to images")
                        return True
                except ImportError:
                    print("pdf2image not installed, skipping conversion method")
            except Exception as e:
                print(f"PDF to image conversion failed: {e}")
                
        # Method 10: For PDF files, check if Chrome is installed and use it to print
        if file_ext == '.pdf':
            try:
                import subprocess
                
                # Check for Chrome in common locations
                chrome_paths = [
                    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
                ]
                
                chrome_path = None
                for path in chrome_paths:
                    if os.path.exists(path):
                        chrome_path = path
                        break
                
                if chrome_path:
                    # Set printer as default
                    original_printer = win32print.GetDefaultPrinter()
                    if printer_name != original_printer:
                        win32print.SetDefaultPrinter(printer_name)
                    
                    # Use Chrome for silent printing
                    chrome_cmd = [
                        chrome_path,
                        "--headless",
                        "--disable-gpu",
                        "--print-to-pdf-no-header",
                        f"--print-to-printer={printer_name}",
                        f"file:///{os.path.abspath(file_path)}"
                    ]
                    
                    subprocess.run(chrome_cmd, check=True, timeout=30)
                    
                    # Restore original default printer
                    if printer_name != original_printer:
                        win32print.SetDefaultPrinter(original_printer)
                    
                    print(f"Document sent to printer using Chrome")
                    return True
            except Exception as e:
                print(f"Chrome printing failed: {e}")
        
        # Method 11: Fallback - use VBScript to print PDF
        if file_ext == '.pdf':
            try:
                import tempfile
                
                # Create VBS script for printing
                vbs_script = tempfile.NamedTemporaryFile(delete=False, suffix='.vbs')
                
                # Replace backslashes in file path (for VBS)
                safe_file_path = file_path.replace('\\', '\\\\')
                safe_file_path = safe_file_path.replace('"', '\\"')
                
                vbs_content = f"""
                On Error Resume Next
                
                ' Try printing with default PDF handler
                Set WshShell = CreateObject("WScript.Shell")
                WshShell.Run "rundll32 shell32.dll,ShellExec_RunDLL print " & Chr(34) & "{safe_file_path}" & Chr(34), 0, True
                
                ' Check if we had success
                If Err.Number <> 0 Then
                    ' Try with direct ShellExecute
                    Set objShell = CreateObject("Shell.Application")
                    objShell.ShellExecute "{safe_file_path}", "/p", "", "print", 0
                    WScript.Sleep 1000
                    
                    ' Try setting printer as default and printing
                    Set objNetwork = CreateObject("WScript.Network")
                    On Error Resume Next
                    objNetwork.SetDefaultPrinter "{printer_name}"
                    
                    ' Final attempt with ShellExecute
                    Set objShell = CreateObject("Shell.Application")
                    objShell.ShellExecute "{safe_file_path}", "", "", "print", 0
                End If
                """
                
                vbs_script.write(vbs_content.encode('utf-8'))
                vbs_script.close()
                
                # Execute VBS script
                import subprocess
                subprocess.run(["cscript.exe", "//NoLogo", vbs_script.name], check=True)
                
                # Clean up
                try:
                    os.unlink(vbs_script.name)
                except:
                    pass
                
                print(f"PDF sent to printer using VBScript")
                return True
            except Exception as e:
                print(f"VBScript printing failed: {e}")
        
        # If we got here, none of the methods worked directly
        print("Cannot print PDF directly without conversion. Trying print_document_with_options instead...")
        
        # Method 12: For PDF files, fall back to print_document_with_options without ultra_silent
        if file_ext == '.pdf' and recursion_depth < 1:
            options = {"silent": True, "use_shell": True, "ultra_silent": False}
            return self.print_document_with_options(file_path, printer_name, options)
        
        print("All printing methods failed.")
        return False
    
    def print_document_with_options(self, file_path, printer_name=None, options=None):
        """
        Print a document with custom print options
        
        Args:
            file_path (str): Path to the file to print
            printer_name (str): Name of the printer to use
            options (dict): Dictionary of print options
                - copies (int): Number of copies
                - orientation (int): 1=Portrait, 2=Landscape
                - duplex (int): 1=Simplex, 2=Vertical, 3=Horizontal
                - paper_size (int): Paper size constant
                - quality (int): Print quality
                - use_shell (bool): Use ShellExecute to print (more reliable for some file types)
                - silent (bool): Print silently without showing print dialog
                - ultra_silent (bool): Try even harder to print with no dialog using direct methods
        
        Returns:
            bool: True if printing was successful, False otherwise
        """
        if options is None:
            options = {}
        
        # Set default options
        if "use_shell" not in options:
            options["use_shell"] = True  # Default to using ShellExecute for more reliable printing
        if "silent" not in options:
            options["silent"] = True  # Default to silent printing (no dialog)
        if "ultra_silent" not in options:
            options["ultra_silent"] = True  # Default to trying ultra-silent printing
            
        # Use direct printing method if ultra_silent is requested
        if options.get("ultra_silent"):
            try:
                return self.print_direct_no_dialog(file_path, printer_name)
            except Exception as e:
                print(f"Ultra-silent printing failed: {e}")
                # Continue with regular methods
                
        try:
            if not os.path.exists(file_path):
                print(f"File not found: {file_path}")
                return False
            
            # Use default printer if not specified
            if printer_name is None:
                printer_name = win32print.GetDefaultPrinter()
            
            # Method 1: Use silent printing with default printer
            if options.get("silent"):
                print(f"Silently printing '{file_path}' to '{printer_name}'...")
                
                # Set as default printer if needed
                original_printer = win32print.GetDefaultPrinter()
                if printer_name != original_printer:
                    win32print.SetDefaultPrinter(printer_name)
                
                # Try to use Windows Script Host for silent printing
                try:
                    import tempfile
                    
                    # Replace backslashes in file path (for VBS)
                    safe_file_path = file_path.replace('\\', '\\\\')
                    safe_file_path = safe_file_path.replace('"', '\\"')
                    
                    # Create VBS content without f-string to avoid backslash issues
                    vbs_lines = [
                        'Set objFSO = CreateObject("Scripting.FileSystemObject")',
                        f'If objFSO.FileExists("{safe_file_path}") Then',
                        '    Set objShell = CreateObject("WScript.Shell")',
                        f'    Set objPrinter = objShell.Exec("rundll32 printui.dll,PrintUIEntry /k /n ""{printer_name}""")',
                        '    Wscript.Sleep 500',
                        '',
                        '    \' Create Word application and print document silently',
                        '    Const wdDoNotSaveChanges = 0',
                        '    Set objWord = CreateObject("Word.Application")',
                        '    objWord.Visible = False',
                        '    objWord.DisplayAlerts = False',
                        f'    Set objDoc = objWord.Documents.Open("{safe_file_path}")',
                        '    objDoc.PrintOut',
                        '    objDoc.Close wdDoNotSaveChanges',
                        '    objWord.Quit',
                        '',
                        '    \' Wait for print job to complete',
                        '    Wscript.Sleep 2000',
                        'End If'
                    ]
                    
                    vbs_content = '\r\n'.join(vbs_lines)
                    
                    # Create temporary VBS file
                    temp_vbs = tempfile.NamedTemporaryFile(delete=False, suffix='.vbs')
                    temp_vbs.write(vbs_content.encode('utf-8'))
                    temp_vbs.close()
                    
                    # Execute VBS file silently
                    win32api.ShellExecute(0, 'open', 'wscript.exe', f'"{temp_vbs.name}" //nologo', '.', 0)
                    
                    # Wait a bit for the printing to start
                    time.sleep(2)
                    
                    # Clean up
                    try:
                        os.unlink(temp_vbs.name)
                    except:
                        pass
                        
                    # Restore original default printer
                    if printer_name != original_printer:
                        win32print.SetDefaultPrinter(original_printer)
                    
                    print(f"Silent print job sent to '{printer_name}'")
                    return True
                    
                except Exception as e:
                    print(f"Silent printing failed, trying alternative method: {e}")
                    # Fall back to regular Shell Execute if silent printing fails
                    pass
            
            # Method 2: Use ShellExecute to print (more reliable for many formats)
            if options.get("use_shell") and SHELL_EXECUTE_AVAILABLE:
                print(f"Printing '{file_path}' to '{printer_name}' using system print dialog...")
                
                # Set as default printer if needed
                original_printer = win32print.GetDefaultPrinter()
                if printer_name != original_printer:
                    win32print.SetDefaultPrinter(printer_name)
                
                # Print using ShellExecute
                win32api.ShellExecute(
                    0, 
                    "print", 
                    file_path,
                    None, 
                    ".", 
                    0
                )
                
                # Restore original default printer if changed
                if printer_name != original_printer:
                    win32print.SetDefaultPrinter(original_printer)
                
                print(f"Print job sent to '{printer_name}' using system print dialog")
                return True
            
            # Method 3: Use direct printing API (less reliable for many formats)
            print(f"Printing '{file_path}' to '{printer_name}' using direct print API...")
            
            # Detect file type
            _, file_ext = os.path.splitext(file_path)
            file_ext = file_ext.lower()
            
            # For image files, convert to more printer-friendly format if needed
            if file_ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif']:
                # Sometimes sending raw image files directly to a printer may not work
                # Convert to a PDF first which works better with many printers
                temp_pdf = None
                try:
                    # Create temp PDF file
                    temp_pdf = tempfile.NamedTemporaryFile(delete=False, suffix='.pdf')
                    temp_pdf.close()
                    
                    # Convert image to PDF
                    img = Image.open(file_path)
                    if img.mode == 'RGBA':
                        img = img.convert('RGB')
                    
                    img.save(temp_pdf.name, 'PDF')
                    print(f"Converted image to PDF for better printing compatibility")
                    
                    # Update file path to use the PDF
                    file_path = temp_pdf.name
                    file_ext = '.pdf'
                except Exception as e:
                    print(f"Failed to convert image to PDF: {e}")
                    if temp_pdf and os.path.exists(temp_pdf.name):
                        try:
                            os.unlink(temp_pdf.name)
                        except:
                            pass
            
            # Open the printer
            h_printer = win32print.OpenPrinter(printer_name)
            
            # Check if we can use win32ui for advanced features
            if win32ui is not None:
                # Get DEVMODE from the printer
                dev_mode = win32print.GetPrinter(h_printer, 2)["pDevMode"]
                
                # Set print options
                if "copies" in options:
                    dev_mode.Copies = options["copies"]
                if "orientation" in options:
                    dev_mode.Orientation = options["orientation"]
                if "duplex" in options:
                    dev_mode.Duplex = options["duplex"]
                if "paper_size" in options:
                    dev_mode.PaperSize = options["paper_size"]
                if "quality" in options:
                    dev_mode.PrintQuality = options["quality"]
                
                # Apply the settings
                win32print.SetPrinter(h_printer, 2, {"pDevMode": dev_mode}, 0)
            
            # Start a print job
            job_id = win32print.StartDocPrinter(h_printer, 1, (os.path.basename(file_path), None, "RAW"))
            
            # Send the file to the printer
            try:
                win32print.StartPagePrinter(h_printer)
                with open(file_path, "rb") as f:
                    data = f.read()
                    win32print.WritePrinter(h_printer, data)
                win32print.EndPagePrinter(h_printer)
            finally:
                win32print.EndDocPrinter(h_printer)
                win32print.ClosePrinter(h_printer)
                
                # Clean up temp PDF if created
                if file_ext == '.pdf' and file_path.startswith(tempfile.gettempdir()):
                    try:
                        os.unlink(file_path)
                    except:
                        pass
            
            print(f"Document '{os.path.basename(file_path)}' sent to printer '{printer_name}' using direct print API")
            return True
            
        except Exception as e:
            print(f"Error printing document: {e}")
            # Try alternative methods if first one failed
            if options.get("silent"):
                print("Silent printing failed. Trying with dialog...")
                options["silent"] = False
                return self.print_document_with_options(file_path, printer_name, options)
            elif options.get("use_shell") and not SHELL_EXECUTE_AVAILABLE:
                print("ShellExecute not available. Falling back to direct print API...")
                options["use_shell"] = False
                return self.print_document_with_options(file_path, printer_name, options)
            elif not options.get("use_shell") and SHELL_EXECUTE_AVAILABLE:
                print("Direct print API failed. Trying ShellExecute instead...")
                options["use_shell"] = True
                return self.print_document_with_options(file_path, printer_name, options)
            return False
    
    def combine_scans_to_pdf(self, file_paths, output_pdf):
        """
        Combine multiple scanned images into a single PDF
        
        Args:
            file_paths (list): List of image file paths
            output_pdf (str): Output PDF file path
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            images = []
            for file_path in file_paths:
                if os.path.exists(file_path):
                    img = Image.open(file_path)
                    # Convert to RGB if RGBA (PNG)
                    if img.mode == 'RGBA':
                        img = img.convert('RGB')
                    images.append(img)
                else:
                    print(f"File not found: {file_path}")
            
            if images:
                # Save the first image as PDF with the rest as additional pages
                images[0].save(
                    output_pdf,
                    "PDF",
                    resolution=100.0,
                    save_all=True,
                    append_images=images[1:] if len(images) > 1 else []
                )
                print(f"Created PDF: {output_pdf}")
                return True
            else:
                print("No valid images to combine")
                return False
                
        except Exception as e:
            print(f"Error combining scans to PDF: {e}")
            return False

    def print_image_direct(self, image_path, printer_name=None):
        """
        Print an image file directly to a printer without conversion
        
        Args:
            image_path (str): Path to the image file
            printer_name (str): Name of the printer to use (None for default)
            
        Returns:
            bool: True if printing was successful, False otherwise
        """
        if not os.path.exists(image_path):
            print(f"Image file not found: {image_path}")
            return False
            
        # Get file extension
        _, file_ext = os.path.splitext(image_path)
        file_ext = file_ext.lower()
        
        # Verify it's an image file
        if file_ext not in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif']:
            print(f"Not an image file: {image_path}")
            return False
            
        # If no printer specified, use default
        if printer_name is None:
            printer_name = win32print.GetDefaultPrinter()
            
        print(f"Printing image '{image_path}' directly to '{printer_name}'...")
        
        try:
            # Method 1: Use direct Windows Photo Viewer printing (works best)
            import subprocess
            photoviewer_path = r"C:\Windows\System32\rundll32.exe"
            
            # Command to print silently with Windows Photo Viewer
            if os.path.exists(photoviewer_path):
                try:
                    cmd = [
                        photoviewer_path,
                        "shimgvw.dll,ImageView_PrintTo",
                        "/pt", image_path,
                        printer_name
                    ]
                    
                    # Run silently
                    subprocess.run(cmd, check=True, timeout=10, 
                                  stdout=subprocess.DEVNULL, 
                                  stderr=subprocess.DEVNULL)
                    
                    print(f"Image sent to printer using Windows Photo Viewer")
                    return True
                except Exception as e:
                    print(f"Photo Viewer printing failed: {e}")
        except Exception as e:
            print(f"Photo Viewer method failed: {e}")
            
        # Method 2: Convert to EMF and print directly
        try:
            # Convert image to EMF
            import win32gui
            import win32ui
            import win32con
            
            # Open the image
            img = Image.open(image_path)
            
            # Get image dimensions
            img_width, img_height = img.size
            
            # Create a device context for the default printer
            hdc = win32gui.CreateDC("WINSPOOL", printer_name, None)
            
            # Create a memory DC compatible with the printer DC
            memdc = win32gui.CreateCompatibleDC(hdc)
            
            # Create a bitmap compatible with the printer DC
            bitmap = win32gui.CreateCompatibleBitmap(hdc, img_width, img_height)
            
            # Select the bitmap into the memory DC
            old_bitmap = win32gui.SelectObject(memdc, bitmap)
            
            # Create a PIL ImageDraw object for the memory DC
            draw = Image.new('RGB', (img_width, img_height), color='white')
            draw.paste(img, (0, 0))
            
            # Start the print job
            docinfo = ("Image Print", None, None)
            job_id = win32print.StartDocPrinter(printer_name, 1, docinfo)
            
            try:
                # Start a page
                win32print.StartPagePrinter(printer_name)
                
                # Blit the memory DC to the printer DC
                win32gui.BitBlt(hdc, 0, 0, img_width, img_height, memdc, 0, 0, win32con.SRCCOPY)
                
                # End the page
                win32print.EndPagePrinter(printer_name)
            finally:
                # End the document
                win32print.EndDocPrinter(printer_name)
                
                # Clean up resources
                win32gui.SelectObject(memdc, old_bitmap)
                win32gui.DeleteObject(bitmap)
                win32gui.DeleteDC(memdc)
                win32gui.DeleteDC(hdc)
                
            print(f"Image sent to printer using EMF method")
            return True
        except Exception as e:
            print(f"EMF printing failed: {e}")
            
        # Method 3: Try using direct printing with the printer's native API
        try:
            # Use PIL to get the raw data
            img = Image.open(image_path)
            
            # Open printer
            h_printer = win32print.OpenPrinter(printer_name)
            try:
                # Start a raw print job
                job_id = win32print.StartDocPrinter(h_printer, 1, ("Image Print", None, "RAW"))
                try:
                    win32print.StartPagePrinter(h_printer)
                    
                    # Convert image to a simpler format
                    if img.mode != 'RGB':
                        img = img.convert('RGB')
                        
                    # Get raw image data
                    raw_data = img.tobytes()
                    
                    # Send it to printer
                    win32print.WritePrinter(h_printer, raw_data)
                    win32print.EndPagePrinter(h_printer)
                finally:
                    win32print.EndDocPrinter(h_printer)
            finally:
                win32print.ClosePrinter(h_printer)
                
            print(f"Image sent directly to printer using RAW data")
            return True
        except Exception as e:
            print(f"Raw image printing failed: {e}")
            
        print("All direct image printing methods failed.")
        return False

    def print_with_sumatra(self, file_path, printer_name=None, print_settings=None):
        """Print a document using SumatraPDF with advanced options
        
        Args:
            file_path (str): Path to the document to print
            printer_name (str): Name of the printer to use (None for default)
            print_settings (str): Comma-separated settings for SumatraPDF (e.g. "duplexshort,color,paper=a4")
            
        Returns:
            bool: True if successful, False otherwise
        """
        if not os.path.exists(file_path):
            print(f"File not found: {file_path}")
            return False
            
        # Get file extension
        _, file_ext = os.path.splitext(file_path)
        file_ext = file_ext.lower()
        
        # Check if file type is supported by SumatraPDF
        if file_ext not in ['.pdf', '.xps', '.epub', '.mobi', '.cbz', '.cbr', '.djvu']:
            print(f"File type {file_ext} not supported by SumatraPDF")
            return False
        
        # Always try to use HP67F044 first if not explicitly specified
        if printer_name is None or printer_name != "HP67F044":
            # Get list of printers
            printers = self.get_printer_details()
            
            # Look for HP67F044
            hp_printer_found = False
            for printer in printers:
                if printer["name"] == "HP67F044":
                    printer_name = "HP67F044"
                    hp_printer_found = True
                    print(f"Using HP67F044 printer as preferred printer")
                    break
            
            # If HP67F044 not found and no printer was specified, use default
            if not hp_printer_found and printer_name is None:
                printer_name = win32print.GetDefaultPrinter()
                print(f"Using default printer: {printer_name}")
            
        # Default print settings if not specified
        if print_settings is None:
            print_settings = "color,duplexshort" 
            
        try:
            import subprocess
            
            # Look for SumatraPDF in various locations
            sumatra_paths = [
                # Custom/user locations first
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "SumatraPDF.exe"),
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "SumatraPDF.exe"),
                r"C:\Users\90539\AppData\Local\SumatraPDF\SumatraPDF.exe",
                os.path.join(os.environ['USERPROFILE'], r"AppData\Local\SumatraPDF\SumatraPDF.exe"),
                os.path.expanduser(r"~\AppData\Local\SumatraPDF\SumatraPDF.exe"),
                r"D:\SumatraPDF\SumatraPDF.exe",
                os.path.expanduser("~/Downloads/SumatraPDF.exe"),
                # Then standard locations
                r"C:\Program Files\SumatraPDF\SumatraPDF.exe",
                r"C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe",
                r"C:\Users\Public\SumatraPDF\SumatraPDF.exe"
            ]
            
            sumatra_path = None
            for path in sumatra_paths:
                if os.path.exists(path):
                    sumatra_path = path
                    print(f"Found SumatraPDF at: {sumatra_path}")
                    break
            
            if sumatra_path:
                # Construct command with all options
                print_cmd = [
                    sumatra_path,
                    "-print-to", printer_name,
                    "-print-settings", print_settings,
                    "-silent",
                    "-exit-when-done",
                    file_path
                ]
                
                print(f"Printing '{file_path}' to '{printer_name}' using SumatraPDF...")
                subprocess.run(print_cmd, check=True, timeout=60)
                print(f"Document sent to printer successfully using SumatraPDF")
                return True
            else:
                print("SumatraPDF not found in any of the standard locations.")
                
                # Try using the direct path we know
                direct_path = r"C:\Users\90539\AppData\Local\SumatraPDF\SumatraPDF.exe"
                if os.path.exists(direct_path):
                    print(f"Found SumatraPDF at: {direct_path}")
                    # Use the direct path we found
                    print_cmd = [
                        direct_path,
                        "-print-to", printer_name,
                        "-print-settings", print_settings,
                        "-silent",
                        "-exit-when-done",
                        file_path
                    ]
                    
                    print(f"Printing using direct path to SumatraPDF...")
                    subprocess.run(print_cmd, check=True, timeout=30)
                    print(f"Document sent to printer successfully")
                    return True
                
                # If still not found, ask user if they want to download it
                print("\nSumatraPDF is needed for better PDF printing.")
                download_choice = input("Do you want to download SumatraPDF now? (y/n): ")
                
                if download_choice.lower() == 'y':
                    # Download SumatraPDF
                    download_path = self.download_sumatra_pdf()
                    
                    if download_path and os.path.exists(download_path):
                        print(f"Using downloaded SumatraPDF at: {download_path}")
                        
                        # Use the downloaded executable
                        print_cmd = [
                            download_path,
                            "-print-to", printer_name,
                            "-print-settings", print_settings,
                            "-silent",
                            "-exit-when-done",
                            file_path
                        ]
                        
                        print(f"Printing using downloaded SumatraPDF...")
                        subprocess.run(print_cmd, check=True, timeout=30)
                        print(f"Document sent to printer successfully")
                        return True
        except Exception as e:
            print(f"Error printing with SumatraPDF: {e}")
            return False
            
    # Add this to main() function to include SumatraPDF direct printing option
    def print_pdf_with_sumatra(self):
        """Print a PDF file using SumatraPDF with advanced options"""
        file_path = input("Enter the path to the PDF file: ")
        
        if not os.path.exists(file_path):
            print(f"File not found: {file_path}")
            return
        
        # Show available printers
        printers = self.get_printer_details()
        if printers:
            print("\nAvailable printers:")
            for printer in printers:
                default_mark = " (Default)" if printer["is_default"] else ""
                print(f"{printer['index']}. {printer['name']}{default_mark}")
        
        printer_choice = input("Select printer (or press Enter for default): ")
        printer_name = None
        if printer_choice and printer_choice.isdigit():
            idx = int(printer_choice) - 1
            if 0 <= idx < len(printers):
                printer_name = printers[idx]["name"]
        
        # Advanced print settings for SumatraPDF
        print("\nPrint settings options:")
        print("- duplex, duplexshort, duplexlong: Double-sided printing")
        print("- color, monochrome: Color mode")
        print("- paper=<size>: A4, letter, etc.")
        print("- portrait, landscape: Orientation")
        print("- noscale, fitpage, fitwidth: Scaling")
        print("Example: color,duplexshort,paper=a4")
        
        settings = input("Enter print settings (or press Enter for defaults): ")
        
        if not settings:
            settings = "color,duplexshort"
        
        # Print the document
        if self.print_with_sumatra(file_path, printer_name, settings):
            print("Document printed successfully")
        else:
            print("Failed to print document with SumatraPDF")

    def download_sumatra_pdf(self, destination_path=None):
        """Downloads SumatraPDF to the specified path or to the application directory
        
        Args:
            destination_path (str): Path where to save SumatraPDF.exe (None for app directory)
            
        Returns:
            str: Path to the downloaded executable or None if download failed
        """
        import urllib.request
        import os
        import tempfile
        import shutil
        
        print("Attempting to download SumatraPDF...")
        
        # Set default destination path if not provided
        if destination_path is None:
            destination_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "SumatraPDF.exe")
        
        # SumatraPDF download URLs (64-bit and 32-bit)
        download_urls = [
            "https://www.sumatrapdfreader.org/dl/rel/3.4.6/SumatraPDF-3.4.6-64.exe",
            "https://www.sumatrapdfreader.org/dl/rel/3.4.6/SumatraPDF-3.4.6.exe"
        ]
        
        # Try to download the executable
        temp_file = None
        try:
            # Create a temporary file to download to
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.exe')
            temp_file.close()
            
            success = False
            error_msg = ""
            
            # Try each URL
            for url in download_urls:
                try:
                    print(f"Downloading from {url}...")
                    urllib.request.urlretrieve(url, temp_file.name)
                    success = True
                    break
                except Exception as e:
                    error_msg = str(e)
                    print(f"Download from {url} failed: {e}")
            
            if not success:
                print(f"All download attempts failed: {error_msg}")
                return None
            
            # Copy the downloaded file to the destination
            shutil.copy2(temp_file.name, destination_path)
            print(f"SumatraPDF downloaded successfully to {destination_path}")
            
            return destination_path
            
        except Exception as e:
            print(f"Error downloading SumatraPDF: {e}")
            return None
        finally:
            # Clean up the temporary file
            if temp_file and os.path.exists(temp_file.name):
                try:
                    os.unlink(temp_file.name)
                except:
                    pass

    def scan_document_with_options(self, device_id=None, options=None, output_format="jpg", page_size="A4"):
        """Scan a document with customizable options
        
        Args:
            device_id (str): Optional device ID for the scanner (None for default)
            options (dict): Dictionary of scanning options like resolution, color mode, etc.
            output_format (str): Format to save the scan as (jpg, pdf, png)
            page_size (str): Page size for PDF outputs (A4 or Letter)
            
        Returns:
            str: Path to the scanned file or None on failure
        """
        try:
            # Initialize COM for this thread
            pythoncom.CoInitialize()
            
            if options is None:
                options = {}
            
            # Default options if not specified
            resolution = options.get("resolution", 300)
            color_mode = options.get("color_mode", "Color")
            brightness = options.get("brightness", 0)
            contrast = options.get("contrast", 0)
            
            # Allow options dict to override default output_format and page_size parameters
            if "output_format" in options:
                output_format = options["output_format"]
            
            if "page_size" in options:
                page_size = options["page_size"]
                
            # Ensure output format is valid
            if output_format.lower() not in ["jpg", "jpeg", "png", "pdf", "tiff", "bmp"]:
                print(f"Invalid output format: {output_format}. Using jpg instead.")
                output_format = "jpg"
            
            # Generate output filename based on current timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            if "output_file" in options:
                output_file = options["output_file"]
            else:
                output_file = os.path.join(self.scan_dir, f"scan_{timestamp}.{output_format}")
            
            # Get device manager
            device_manager = win32com.client.Dispatch("WIA.DeviceManager")
            
            # Find scanner device
            scanner = None
            if device_id:
                # Use specified device
                for i in range(device_manager.DeviceInfos.Count):
                    device_info = device_manager.DeviceInfos(i+1)
                    if device_info.DeviceID == device_id:
                        scanner = device_info.Connect()
                        break
            else:
                # Use first available scanner
                for i in range(device_manager.DeviceInfos.Count):
                    device_info = device_manager.DeviceInfos(i+1)
                    if device_info.Type == 1:  # Scanner
                        scanner = device_info.Connect()
                        break
            
            if not scanner:
                print("No scanner found!")
                return None
            
            # Configure scanner settings
            scanner_item = scanner.Items(1)
            
            # Set properties
            for prop in scanner_item.Properties:
                if prop.Name == "Horizontal Resolution":
                    prop.Value = resolution
                elif prop.Name == "Vertical Resolution":
                    prop.Value = resolution
                elif prop.Name == "Brightness":
                    prop.Value = brightness
                elif prop.Name == "Contrast":
                    prop.Value = contrast
                elif prop.Name == "Current Intent":
                    # Set the color mode
                    if color_mode.lower() == "color":
                        prop.Value = 1  # WIA_INTENT_COLOR
                    elif color_mode.lower() == "grayscale":
                        prop.Value = 2  # WIA_INTENT_GRAYSCALE
                    elif color_mode.lower() in ["black and white", "blackandwhite", "black&white"]:
                        prop.Value = 4  # WIA_INTENT_NONE (Black & White)
                
            # Perform scan
            image = scanner_item.Transfer()
            
            # Save to JPG temporarily in all cases
            temp_file_path = os.path.join(tempfile.gettempdir(), f"scan_temp_{int(time.time())}.jpg")
            image.saveFile(temp_file_path)
            print(f"Temporary scan saved to {temp_file_path}")
            
            # Convert to PDF if requested
            if output_format.lower() == "pdf":
                # Try to use reportlab for better PDF quality (if available)
                try:
                    if PDF_SUPPORT:
                        # Open image with context manager to ensure it's properly closed
                        with Image.open(temp_file_path) as img:
                            img_width, img_height = img.size
                            
                            # Determine page size
                            if page_size.upper() == "A4":
                                pdf_page_size = A4
                            else:
                                pdf_page_size = letter
                            
                            # Calculate scale to fit on page (leaving small margins)
                            width, height = pdf_page_size
                            width_scale = (width - 40) / img_width
                            height_scale = (height - 40) / img_height
                            scale = min(width_scale, height_scale)
                            
                            # Create new PDF
                            c = canvas.Canvas(output_file, pagesize=pdf_page_size)
                            
                            # Add image to PDF, centered
                            c.drawImage(
                                temp_file_path, 
                                (width - img_width * scale) / 2, 
                                (height - img_height * scale) / 2,
                                width=img_width * scale,
                                height=img_height * scale
                            )
                            c.save()
                        print(f"Converted scan to PDF: {output_file}")
                    else:
                        # Fallback to PIL if reportlab is not available
                        with Image.open(temp_file_path) as img:
                            rgb_im = img.convert('RGB')
                            rgb_im.save(output_file, 'PDF')
                        print(f"Converted scan to PDF (basic quality): {output_file}")
                except Exception as e:
                    print(f"Error converting to PDF: {e}")
                    print("Saving as JPG instead.")
                    output_file = output_file.replace('.pdf', '.jpg')
                    os.replace(temp_file_path, output_file)
            else:
                # For other formats, save directly or convert as needed
                if output_format.lower() == "jpg":
                    # Just use the JPG we already created
                    try:
                        # Use shutil.copy2 instead of os.replace for cross-drive compatibility
                        import shutil
                        shutil.copy2(temp_file_path, output_file)
                        # Clean up temp file after successful copy
                        try:
                            os.unlink(temp_file_path)
                        except Exception as e:
                            print(f"Note: Could not remove temporary file {temp_file_path}: {e}")
                        print(f"Scan saved as JPG: {output_file}")
                    except Exception as e:
                        print(f"Error saving JPG file: {e}")
                        return None
                elif output_format.lower() == "png":
                    # Convert JPG to PNG
                    try:
                        img = Image.open(temp_file_path)
                        img.save(output_file, "PNG")
                        print(f"Scan converted to PNG: {output_file}")
                        # Clean up temp file after successful conversion
                        try:
                            os.unlink(temp_file_path)
                        except Exception as e:
                            print(f"Note: Could not remove temporary file {temp_file_path}: {e}")
                    except Exception as e:
                        print(f"Error converting to PNG: {e}")
                        # Fallback to JPG
                        output_file = output_file.replace('.png', '.jpg')
                        try:
                            import shutil
                            shutil.copy2(temp_file_path, output_file)
                            try:
                                os.unlink(temp_file_path)
                            except Exception as e:
                                print(f"Note: Could not remove temporary file {temp_file_path}: {e}")
                            print(f"Saved as JPG instead: {output_file}")
                        except Exception as e:
                            print(f"Error saving JPG file: {e}")
                            return None
                else:
                    # For any other format, just use JPG
                    try:
                        import shutil
                        shutil.copy2(temp_file_path, output_file)
                        try:
                            os.unlink(temp_file_path)
                        except Exception as e:
                            print(f"Note: Could not remove temporary file {temp_file_path}: {e}")
                        print(f"Scan saved as: {output_file}")
                    except Exception as e:
                        print(f"Error saving file: {e}")
                        return None
            
            # Clean up any remaining temp files
            try:
                if os.path.exists(temp_file_path) and not (output_format.lower() == "jpg" and temp_file_path == output_file):
                    # Try to give time for file handles to be released (common issue with PIL/ReportLab)
                    try:
                        # Force garbage collection to release any file handles
                        import gc
                        gc.collect()
                        
                        # Small delay to let file operations complete
                        time.sleep(0.5)
                        
                        # Now try to delete the file
                        os.unlink(temp_file_path)
                    except Exception as e:
                        print(f"Note: Could not remove temporary file {temp_file_path}: {e}")
                        print("This is not an error - the file will be removed later.")
            except Exception as e:
                print(f"Note: Could not remove temporary file {temp_file_path}: {e}")
            
            # After all operations are complete, safely release COM objects
            self._safe_release_com_objects()
            
            # Store the path to the last scanned file
            self.last_scanned_file = output_file
            
            return output_file
            
        except pythoncom.com_error as e:
            print(f"COM Error: {handle_com_exception(e)}")
            return None
        except Exception as e:
            print(f"Error scanning document: {e}")
            return None
        finally:
            # Always uninitialize COM in the finally block
            try:
                pythoncom.CoUninitialize()
            except:
                pass
            # Also run our general COM cleanup
            self._safe_release_com_objects()

    def get_last_scanned_file(self):
        """Get the path to the last scanned document
        
        Returns:
            str: Path to the last scanned file or None if no file has been scanned
        """
        return self.last_scanned_file

    def extract_text_from_image(self, image_path, get_modified_image=False):
        """Extract text from an image using Gemini AI and optionally get a modified image
        
        Args:
            image_path (str): Path to the image file
            get_modified_image (bool): Whether to also get a modified version of the image
            
        Returns:
            tuple: (extracted_text, modified_image_path) or (extracted_text, None) if get_modified_image is False
        """
        if not self.GEMINI_AVAILABLE:
            print("Gemini AI is not available. Please set GOOGLE_API_KEY environment variable.")
            return None, None
            
        try:
            # Open and prepare the image
            img = Image.open(image_path)
            
            # Generate prompt for text extraction and image modification
            prompt = """Please analyze this image and:
            1. Extract all text, maintaining its structure and layout
            2. If requested, provide a modified version of the image that:
               - Enhances text clarity and readability
               - Improves contrast and brightness
               - Removes any noise or artifacts
               - Maintains the original layout and content
            If there are multiple columns or sections, preserve their organization.
            Include any headers, footers, or page numbers if present.
            If you encounter any special characters or formatting, please note them.
            If the text is in a non-English language, please indicate the language."""
            
            # Generate response from Gemini
            response = self.gemini_model.generate_content([prompt, img])
            
            extracted_text = None
            modified_image_path = None
            
            if response and response.text:
                extracted_text = response.text
                
                # If we want a modified image and Gemini provided one
                if get_modified_image and hasattr(response, 'image'):
                    try:
                        # Create a new filename for the modified image
                        base_name, ext = os.path.splitext(image_path)
                        modified_image_path = f"{base_name}_modified{ext}"
                        
                        # Save the modified image
                        response.image.save(modified_image_path)
                        print(f"Modified image saved to: {modified_image_path}")
                    except Exception as e:
                        print(f"Error saving modified image: {e}")
            else:
                print("No text was extracted from the image.")
            
            return extracted_text, modified_image_path
                
        except Exception as e:
            print(f"Error processing image with Gemini AI: {e}")
            return None, None

def display_menu():
    """Display the main menu options."""
    print("\n" + "=" * 40)
    print("Advanced Scanner and Printer Control")
    print("=" * 40)
    print("1. Scan a single document (JPG, PDF, PNG)")
    print("2. List available scanners")
    print("3. List available printers")
    print("4. Batch scan multiple documents (PDF)")
    print("5. Combine scanned documents into PDF")
    print("6. Print a document")
    print("7. Advanced scan options")
    print("8. Advanced print options")
    print("9. Get scanner properties")
    print("10. Print PDF with SumatraPDF")
    print("11. Download SumatraPDF")
    print("12. Quick scan to PDF (A4/Letter)")
    print("13. Extract text from scanned document")
    print("0. Exit")
    print("=" * 40)
    return input("Enter your choice (0-13): ")

def main():
    """Main function to run the scanner and printer control application"""
    controller = AdvancedScannerPrinter()
    
    while True:
        try:
            choice = display_menu()
            
            if choice == "1":
                # Scan a single document
                print("\nScanning a single document:")
                scanners = controller.get_scanner_devices()
                if not scanners:
                    print("No scanners found!")
                    continue
                
                # Let user select scanner if multiple available
                device_id = None
                if len(scanners) > 1:
                    for idx, name, dev_id in scanners:
                        print(f"{idx}. {name}")
                    scanner_choice = input("Select scanner (or press Enter for default): ")
                    if scanner_choice and scanner_choice.isdigit():
                        scanner_idx = int(scanner_choice) - 1
                        if 0 <= scanner_idx < len(scanners):
                            _, _, device_id = scanners[scanner_idx]
                
                # Get scan options
                options = {}
                
                # Offer output format selection
                print("\nSelect output format:")
                print("1. PDF (default)")
                print("2. JPG")
                print("3. PNG")
                format_choice = input("Select format (1-3): ")
                
                if format_choice == "2":
                    options["output_format"] = "jpg"
                elif format_choice == "3":
                    options["output_format"] = "png"
                else:
                    options["output_format"] = "pdf"
                    
                    # For PDF, also ask for page size
                    print("\nSelect page size:")
                    print("1. A4 (default)")
                    print("2. Letter")
                    page_choice = input("Select page size (1-2): ")
                    
                    if page_choice == "2":
                        options["page_size"] = "Letter"
                    else:
                        options["page_size"] = "A4"
                
                # Ask for scan resolution
                resolution = input("\nResolution (DPI) [300]: ")
                if resolution and resolution.isdigit():
                    options["resolution"] = int(resolution)
                
                # Ask for color mode
                print("\nSelect color mode:")
                print("1. Color (default)")
                print("2. Grayscale") 
                print("3. Black and White")
                color_choice = input("Select color mode (1-3): ")
                
                if color_choice == "2":
                    options["color_mode"] = "Grayscale"
                elif color_choice == "3":
                    options["color_mode"] = "Black and White"
                else:
                    options["color_mode"] = "Color"
                
                # Perform scan
                print("\nStarting scan...")
                scanned_file = controller.scan_document_with_options(device_id, options)
                
                # Ask if user wants to print
                if scanned_file:
                    print(f"\nDocument successfully scanned to: {scanned_file}")
                    print_choice = input("Do you want to print this document? (y/n): ")
                    if print_choice.lower() == "y":
                        controller.print_document_with_options(scanned_file)
            
            elif choice == "2":
                # List scanners
                print("\nAvailable Scanners:")
                scanners = controller.get_scanner_devices()
                if scanners:
                    for idx, name, device_id in scanners:
                        print(f"{idx}. {name} (ID: {device_id})")
                else:
                    print("No scanners found!")
            
            elif choice == "3":
                # List printers
                print("\nAvailable Printers:")
                printers = controller.get_printer_details()
                if printers:
                    for printer in printers:
                        default_mark = " (Default)" if printer["is_default"] else ""
                        print(f"{printer['index']}. {printer['name']}{default_mark}")
                else:
                    print("No printers found!")
            
            elif choice == "4":
                # Batch scan
                print("\nBatch Scanning:")
                pages = input("How many pages do you want to scan? ")
                if pages.isdigit() and int(pages) > 0:
                    scanners = controller.get_scanner_devices()
                    if not scanners:
                        print("No scanners found!")
                        continue
                    
                    # Let user select scanner if multiple available
                    device_id = None
                    if len(scanners) > 1:
                        for idx, name, dev_id in scanners:
                            print(f"{idx}. {name}")
                        scanner_choice = input("Select scanner (or press Enter for default): ")
                        if scanner_choice and scanner_choice.isdigit():
                            scanner_idx = int(scanner_choice) - 1
                            if 0 <= scanner_idx < len(scanners):
                                _, _, device_id = scanners[scanner_idx]
                    
                    # Perform batch scan
                    scanned_files = controller.batch_scan(int(pages), device_id)
                    
                    # Ask if user wants to combine to PDF
                    if len(scanned_files) > 1:
                        combine_choice = input("Do you want to combine these scans into a PDF? (y/n): ")
                        if combine_choice.lower() == "y":
                            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                            pdf_path = os.path.join(controller.scan_dir, f"combined_{timestamp}.pdf")
                            controller.combine_scans_to_pdf(scanned_files, pdf_path)
            
            elif choice == "5":
                # Combine scans to PDF
                print("\nCombine Scans to PDF:")
                scan_dir = controller.scan_dir
                
                # List available scans
                print(f"\nAvailable scans in {scan_dir}:")
                scan_files = [f for f in os.listdir(scan_dir) if os.path.isfile(os.path.join(scan_dir, f)) 
                            and f.lower().endswith(('.jpg', '.jpeg', '.png', '.tiff', '.tif'))]
                
                if not scan_files:
                    print("No scan files found!")
                    continue
                
                # Display scan files
                for i, file in enumerate(scan_files):
                    print(f"{i+1}. {file}")
                
                # Get files to combine
                file_indices = input("Enter the file numbers to combine (comma-separated): ")
                indices = [int(idx.strip())-1 for idx in file_indices.split(",") if idx.strip().isdigit()]
                
                selected_files = []
                for idx in indices:
                    if 0 <= idx < len(scan_files):
                        selected_files.append(os.path.join(scan_dir, scan_files[idx]))
                
                if not selected_files:
                    print("No valid files selected!")
                    continue
                
                # Create output PDF
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                pdf_path = os.path.join(scan_dir, f"combined_{timestamp}.pdf")
                controller.combine_scans_to_pdf(selected_files, pdf_path)
            
            elif choice == "6":
                # Print a document
                print("\nPrint a Document:")
                
                # Get file path
                file_path = input("Enter the path to the file to print: ")
                if not os.path.exists(file_path):
                    print(f"File not found: {file_path}")
                    continue
                
                # Print directly to default printer without asking for selection
                controller.print_document_with_options(file_path)
            
            elif choice == "7":
                # Advanced scan options
                print("\nAdvanced Scan Options:")
                
                # Get scanner
                scanners = controller.get_scanner_devices()
                if not scanners:
                    print("No scanners found!")
                    continue
                
                # Let user select scanner if multiple available
                device_id = None
                if len(scanners) > 1:
                    for idx, name, dev_id in scanners:
                        print(f"{idx}. {name}")
                    scanner_choice = input("Select scanner (or press Enter for default): ")
                    if scanner_choice and scanner_choice.isdigit():
                        scanner_idx = int(scanner_choice) - 1
                        if 0 <= scanner_idx < len(scanners):
                            _, _, device_id = scanners[scanner_idx]
                else:
                    _, _, device_id = scanners[0]
                
                # Get scan options
                options = {}
                
                resolution = input("Resolution (DPI) [300]: ")
                if resolution and resolution.isdigit():
                    options["resolution"] = int(resolution)
                
                color_mode = input("Color mode (Color, Grayscale, BlackAndWhite) [Color]: ")
                if color_mode:
                    options["color_mode"] = color_mode
                
                brightness = input("Brightness (-1000 to 1000) [0]: ")
                if brightness and brightness.lstrip("-").isdigit():
                    options["brightness"] = int(brightness)
                
                contrast = input("Contrast (-1000 to 1000) [0]: ")
                if contrast and contrast.lstrip("-").isdigit():
                    options["contrast"] = int(contrast)
                
                output_format = input("Output format (jpg, png, pdf, tiff) [jpg]: ")
                if output_format:
                    options["output_format"] = output_format.lower()
                
                # Perform the scan
                scanned_file = controller.scan_document_with_options(device_id, options)
                
                # Ask if user wants to print
                if scanned_file:
                    print_choice = input("Do you want to print this document? (y/n): ")
                    if print_choice.lower() == "y":
                        controller.print_document_with_options(scanned_file)
            
            elif choice == "8":
                # Advanced print options
                print("\nAdvanced Print Options:")
                
                # Get file path
                file_path = input("Enter the path to the file to print: ")
                if not os.path.exists(file_path):
                    print(f"File not found: {file_path}")
                    continue
                
                # Get printer selection
                printers = controller.get_printer_details()
                if not printers:
                    print("No printers found!")
                    continue
                
                print("\nAvailable printers:")
                for printer in printers:
                    default_mark = " (Default)" if printer["is_default"] else ""
                    print(f"{printer['index']}. {printer['name']}{default_mark}")
                
                printer_choice = input("Select printer (or press Enter for default): ")
                
                printer_name = None
                if printer_choice and printer_choice.isdigit():
                    printer_idx = int(printer_choice) - 1
                    if 0 <= printer_idx < len(printers):
                        printer_name = printers[printer_idx]["name"]
                
                # Get print options
                options = {}
                
                copies = input("Number of copies [1]: ")
                if copies and copies.isdigit():
                    options["copies"] = int(copies)
                
                orientation = input("Orientation (1=Portrait, 2=Landscape) [1]: ")
                if orientation and orientation.isdigit():
                    options["orientation"] = int(orientation)
                
                duplex = input("Duplex mode (1=Simplex, 2=Vertical, 3=Horizontal) [1]: ")
                if duplex and duplex.isdigit():
                    options["duplex"] = int(duplex)
                
                # Print the document
                controller.print_document_with_options(file_path, printer_name, options)
            
            elif choice == "9":
                # Get scanner properties
                print("\nScanner Properties:")
                
                scanners = controller.get_scanner_devices()
                if not scanners:
                    print("No scanners found!")
                    continue
                
                # Let user select scanner if multiple available
                device_id = None
                if len(scanners) > 1:
                    for idx, name, dev_id in scanners:
                        print(f"{idx}. {name}")
                    scanner_choice = input("Select scanner (or press Enter for default): ")
                    if scanner_choice and scanner_choice.isdigit():
                        scanner_idx = int(scanner_choice) - 1
                        if 0 <= scanner_idx < len(scanners):
                            _, _, device_id = scanners[scanner_idx]
                else:
                    _, _, device_id = scanners[0]
                
                # Get scanner properties
                properties = controller.get_scanner_properties(device_id)
                
                print("\nScanner Properties:")
                for name, value in properties.items():
                    print(f"{name}: {value}")
                    
            elif choice == "10":
                # Print PDF with SumatraPDF
                print("\nPrint PDF with SumatraPDF:")
                controller.print_pdf_with_sumatra()
                
            elif choice == "11":
                # Download SumatraPDF
                print("\nDownloading SumatraPDF:")
                download_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "SumatraPDF.exe")
                result = controller.download_sumatra_pdf(download_path)
                if result:
                    print(f"SumatraPDF downloaded successfully to: {result}")
                    print("You can now use the 'Print PDF with SumatraPDF' option.")
                else:
                    print("Failed to download SumatraPDF.")
            
            elif choice == "12":
                # Quick scan to PDF
                print("\nQuick Scan to PDF:")
                resolution = input("Enter resolution (DPI) [300]: ")
                if not resolution or not resolution.isdigit():
                    resolution = "300"
                
                color_mode = input("Enter color mode (Color, Grayscale, BlackAndWhite) [Color]: ")
                if not color_mode:
                    color_mode = "Color"
                
                page_size = input("Enter page size (A4, Letter) [A4]: ")
                if not page_size:
                    page_size = "A4"
                
                # Perform scan
                print("\nStarting scan...")
                scanned_file = controller.scan_document_with_options(None, {"resolution": int(resolution), "color_mode": color_mode, "output_format": "pdf", "page_size": page_size})
                
                # Ask if user wants to print
                if scanned_file:
                    print(f"\nDocument successfully scanned to: {scanned_file}")
                    print_choice = input("Do you want to print this document? (y/n): ")
                    if print_choice.lower() == "y":
                        controller.print_document_with_options(scanned_file)
            
            elif choice == "13":
                # Extract text from scanned document
                print("\nExtract Text from Scanned Document:")
                
                # Get the last scanned file or ask for a file path
                last_file = controller.get_last_scanned_file()
                if last_file:
                    print(f"\nLast scanned file: {last_file}")
                    use_last = input("Do you want to extract text from this file? (y/n): ")
                    if use_last.lower() == 'y':
                        file_path = last_file
                    else:
                        file_path = input("Enter the path to the image file: ")
                else:
                    file_path = input("Enter the path to the image file: ")
                
                if not os.path.exists(file_path):
                    print(f"File not found: {file_path}")
                    continue
                
                # Check if file is an image
                try:
                    with Image.open(file_path) as img:
                        # File is a valid image
                        pass
                except:
                    print("Error: File is not a valid image.")
                    continue
                
                # Ask if user wants a modified image
                get_modified = input("\nDo you want to get a modified version of the image? (y/n): ").lower() == 'y'
                
                print("\nProcessing image with Gemini AI...")
                extracted_text, modified_image_path = controller.extract_text_from_image(file_path, get_modified)
                
                if extracted_text:
                    print("\nExtracted Text:")
                    print("=" * 40)
                    print(extracted_text)
                    print("=" * 40)
                    
                    # Ask if user wants to save the text
                    save_choice = input("\nDo you want to save the extracted text? (y/n): ")
                    if save_choice.lower() == 'y':
                        # Generate output filename
                        base_name = os.path.splitext(file_path)[0]
                        text_file = f"{base_name}_extracted_text.txt"
                        
                        try:
                            with open(text_file, 'w', encoding='utf-8') as f:
                                f.write(extracted_text)
                            print(f"\nText saved to: {text_file}")
                        except Exception as e:
                            print(f"Error saving text file: {e}")
                    
                    # If we got a modified image, ask if user wants to print it
                    if modified_image_path and os.path.exists(modified_image_path):
                        print_choice = input("\nDo you want to print the modified image? (y/n): ")
                        if print_choice.lower() == 'y':
                            controller.print_document_with_options(modified_image_path)
                else:
                    print("Failed to extract text from the image.")
            
            elif choice == "0":
                # Exit
                print("\nExiting program...")
                break
            
            else:
                print("\nInvalid choice. Please try again.")
            
            # At the end of each case, add:
            # Clean up any potential COM objects
            controller._safe_release_com_objects()
            
        except KeyboardInterrupt:
            print("\nProgram interrupted by user. Exiting...")
            break
        except Exception as e:
            print(f"An error occurred: {e}")
            
    # Final cleanup before exit
    controller._safe_release_com_objects()
    print("Thank you for using Advanced Scanner and Printer Control. Goodbye!")

def scan_single_document():
    """Function to automatically scan a single document with default settings"""
    controller = AdvancedScannerPrinter()
    
    try:
        # Get the first available scanner
        scanners = controller.get_scanner_devices()
        if not scanners:
            print("Error: No scanners found!")
            return None
        
        # Use the first scanner
        _, _, device_id = scanners[0]
        
        # Set default options for scanning
        options = {
            "output_format": "pdf",
            "page_size": "A4",
            "resolution": 300,
            "color_mode": "Color"
        }
        
        # Perform scan
        print("Starting scan...")
        scanned_file = controller.scan_document_with_options(device_id, options)
        
        if scanned_file:
            print(f"Document successfully scanned to: {scanned_file}")
            return scanned_file
        else:
            print("Error: Scanning failed")
            return None
            
    except Exception as e:
        print(f"Error during scanning: {e}")
        return None

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == '1':
            # If argument '1' is provided, run single document scan
            scan_single_document()
        elif sys.argv[1] == 'print_with_sumatra' and len(sys.argv) > 2:
            # If print_with_sumatra command is provided with a file path, print the file
            file_path = sys.argv[2]
            if os.path.exists(file_path):
                print(f"Printing file: {file_path}")
                controller = AdvancedScannerPrinter()
                success = controller.print_with_sumatra(file_path)
                if success:
                    print("Document sent to printer successfully.")
                    sys.exit(0)
                else:
                    print("Failed to print document.")
                    sys.exit(1)
            else:
                print(f"Error: File not found: {file_path}")
                sys.exit(1)
        else:
            # Otherwise run the interactive menu
            main()
    else:
        # No arguments, run the interactive menu
        main() 