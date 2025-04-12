import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import * as dotenv from "dotenv"
import { OpenAIService } from './services/OpenAIService'
import { exec } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import child_process from 'child_process'

// Store the last scanned file path
let lastScannedFilePath = '';

// Default scans directory
const defaultScansDir = path.join(app.getPath('home'), 'Downloads', 'afai-desktop-x', 'scans');

// Get the most recent file from a directory
function getMostRecentFile(directory: string): string | null {
  try {
    if (!fs.existsSync(directory)) {
      console.log(`Scans directory does not exist: ${directory}`);
      return null;
    }

    const files = fs.readdirSync(directory)
      .filter(file => fs.statSync(path.join(directory, file)).isFile())
      .map(file => ({
        name: file,
        path: path.join(directory, file),
        mtime: fs.statSync(path.join(directory, file)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    return files.length > 0 ? files[0].path : null;
  } catch (error) {
    console.error('Error getting most recent file:', error);
    return null;
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('scan-document', async () => {
    try {
      // Path to the advanced_scanner_printer.py script
      // First check in the extraResources folder (for production)
      let scriptPath = ''
      
      if (app.isPackaged) {
        scriptPath = path.join(process.resourcesPath, 'advanced_scanner_printer.py')
      } else {
        // For development, look in the project root
        scriptPath = path.join(app.getAppPath(), 'advanced_scanner_printer.py')
        
        // If not in root, check Downloads folder
        if (!fs.existsSync(scriptPath)) {
          const downloadsPath = path.join(app.getPath('home'), 'Downloads', 'advanced_scanner_printer.py')
          if (fs.existsSync(downloadsPath)) {
            scriptPath = downloadsPath
          } else {
            throw new Error('Scanner script not found. Please place advanced_scanner_printer.py in the app root or Downloads folder.')
          }
        }
      }
      
      console.log('Using scanner script at:', scriptPath)

      // Create a promise wrapper around the exec function
      const execPromise = (command: string): Promise<{ stdout: string; stderr: string }> => {
        return new Promise((resolve, reject) => {
          exec(command, { timeout: 60000 }, (error, stdout, stderr) => {
            if (error) {
              reject(error)
              return
            }
            resolve({ stdout, stderr })
          })
        })
      }

      try {
        // Execute the Python script with argument '1' to scan a single document
        const pythonCommand = `python "${scriptPath}" 1`
        const { stdout, stderr } = await execPromise(pythonCommand)
        
        if (stderr) {
          console.error('Scanner stderr:', stderr)
        }
        
        // Even if the script "fails", check for the most recent file in the scans directory
        let scannedFilePath = ''
        
        // Parse the output to find the scanned file path
        const outputLines = stdout.split('\n')
        
        for (const line of outputLines) {
          if (line.includes('Document successfully scanned to:')) {
            scannedFilePath = line.split('Document successfully scanned to:')[1].trim()
            break
          }
        }
        
        // If we couldn't find the path in the output, look for the most recent file
        if (!scannedFilePath || !fs.existsSync(scannedFilePath)) {
          // Get most recent file from the scans directory
          const recentFile = getMostRecentFile(defaultScansDir)
          
          if (!recentFile) {
            throw new Error('Failed to locate scanned document')
          }
          
          scannedFilePath = recentFile
        }
        
        // Store the scanned file path
        lastScannedFilePath = scannedFilePath
        
        // Read the scanned file
        const fileBuffer = fs.readFileSync(scannedFilePath)
        const filename = path.basename(scannedFilePath)
        
        return {
          success: true,
          data: fileBuffer,
          filename: filename,
          filePath: scannedFilePath
        }
      } catch (pythonError) {
        console.error('Python script error:', pythonError)
        
        // Check if we have a recent scan in the directory before trying fallback
        const recentScan = getMostRecentFile(defaultScansDir)
        if (recentScan) {
          console.log('Found recent scan file:', recentScan)
          lastScannedFilePath = recentScan
          
          // Read the scanned file
          const fileBuffer = fs.readFileSync(recentScan)
          const filename = path.basename(recentScan)
          
          return {
            success: true,
            data: fileBuffer,
            filename: filename,
            filePath: recentScan
          }
        }
        
        console.log('Trying fallback to Windows Scan app...')
        
        try {
          // Create a temp folder to save the scan
          const tempDir = path.join(app.getPath('temp'), 'app-scans')
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true })
          }
          
          const timestamp = new Date().toISOString().replace(/:/g, '-')
          const scanFilePath = path.join(tempDir, `scan_${timestamp}.pdf`)
          
          // Open the Windows Scan app
          // This won't work headlessly - user will need to interact with the Scan app
          await execPromise('start ms-screenclip:')
          
          // Show a notification dialog
          dialog.showMessageBoxSync({
            type: 'info',
            title: 'Scanner',
            message: 'Use the Windows Scan app to scan your document.',
            detail: 'When finished, save the document and select it in the application.',
            buttons: ['OK']
          })
          
          // Let the user select the scanned file
          const result = await dialog.showOpenDialog({
            title: 'Select Scanned Document',
            defaultPath: app.getPath('downloads'),
            filters: [
              { name: 'Documents', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }
            ],
            properties: ['openFile']
          })
          
          if (result.canceled || result.filePaths.length === 0) {
            throw new Error('Scan operation cancelled')
          }
          
          const selectedFile = result.filePaths[0]
          // Store the selected file path
          lastScannedFilePath = selectedFile
          
          const fileBuffer = fs.readFileSync(selectedFile)
          const filename = path.basename(selectedFile)
          
          return {
            success: true,
            data: fileBuffer,
            filename: filename,
            filePath: selectedFile
          }
        } catch (fallbackError) {
          console.error('Fallback scan error:', fallbackError)
          throw new Error('Both scan methods failed')
        }
      }
    } catch (error) {
      console.error('Error in scan-document handler:', error)
      
      // Even on error, try to get the last scanned file
      const lastScan = getMostRecentFile(defaultScansDir)
      if (lastScan) {
        lastScannedFilePath = lastScan
        
        // Return the last scan info
        return {
          success: true,
          message: "Using most recent scanned file",
          filePath: lastScan
        }
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to scan document'
      }
    }
  })

  // Add new handler to get the last scanned file path
  ipcMain.handle('get-last-scan-path', () => {
    // If we don't have a stored path or the file doesn't exist, try to get the most recent file
    if (!lastScannedFilePath || !fs.existsSync(lastScannedFilePath)) {
      const recentFile = getMostRecentFile(defaultScansDir);
      if (recentFile) {
        lastScannedFilePath = recentFile;
      }
    }
    
    return { 
      path: lastScannedFilePath,
      exists: lastScannedFilePath ? fs.existsSync(lastScannedFilePath) : false
    }
  })

  // Add handler to open the folder containing the scanned file
  ipcMain.handle('open-scan-folder', (_, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        const folderPath = path.dirname(filePath);
        shell.openPath(folderPath);
        return { success: true };
      } else {
        return { 
          success: false, 
          error: 'File does not exist' 
        };
      }
    } catch (error) {
      console.error('Error opening scan folder:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to open folder' 
      };
    }
  })

  // Add handler to open a file directly
  ipcMain.handle('open-file', (_, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        shell.openPath(filePath);
        return { success: true };
      } else {
        return { 
          success: false, 
          error: 'File does not exist' 
        };
      }
    } catch (error) {
      console.error('Error opening file:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to open file' 
      };
    }
  })
  
  // Add handler to get file as data URL
  ipcMain.handle('get-file-data-url', (_, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        const fileData = fs.readFileSync(filePath);
        const extension = path.extname(filePath).toLowerCase();
        let mimeType = 'application/octet-stream';
        
        // Set appropriate MIME type based on file extension
        if (extension === '.pdf') {
          mimeType = 'application/pdf';
        } else if (['.jpg', '.jpeg'].includes(extension)) {
          mimeType = 'image/jpeg';
        } else if (extension === '.png') {
          mimeType = 'image/png';
        } else if (extension === '.gif') {
          mimeType = 'image/gif';
        } else if (extension === '.tiff' || extension === '.tif') {
          mimeType = 'image/tiff';
        } else if (extension === '.bmp') {
          mimeType = 'image/bmp';
        }
        
        // Convert file data to Base64 data URL
        const base64Data = fileData.toString('base64');
        const dataUrl = `data:${mimeType};base64,${base64Data}`;
        
        return {
          success: true,
          dataUrl: dataUrl,
          mimeType: mimeType
        };
      } else {
        return { 
          success: false, 
          error: 'File does not exist' 
        };
      }
    } catch (error) {
      console.error('Error creating data URL:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to create data URL' 
      };
    }
  })

  // Add handler to get file as binary data
  ipcMain.handle('get-file-data', (_, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        // Read the file as a binary buffer
        const fileData = fs.readFileSync(filePath);
        
        return {
          success: true,
          data: fileData, // This will be sent as a binary buffer
          fileName: path.basename(filePath)
        };
      } else {
        return { 
          success: false, 
          error: 'File does not exist' 
        };
      }
    } catch (error) {
      console.error('Error reading file data:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to read file data' 
      };
    }
  })

  // Add handler to serve a file through a temporary http server for preview
  ipcMain.handle('serve-pdf-for-preview', (_, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        // For PDFs, use a simple approach
        // Create a temporary HTML file that embeds the PDF using PDF.js
        const tempDir = path.join(app.getPath('temp'), 'pdf-previews');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const htmlFilePath = path.join(tempDir, `preview-${Date.now()}.html`);
        const pdfJsPrefix = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.10.111';
        
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>PDF Preview</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    #viewer {
      width: 100%;
      height: 100%;
      border: none;
    }
  </style>
</head>
<body>
  <iframe 
    id="viewer" 
    src="${pdfJsPrefix}/web/viewer.html?file=file://${filePath.replace(/\\/g, '/')}"
    allowfullscreen 
    webkitallowfullscreen>
  </iframe>
</body>
</html>
        `;
        
        fs.writeFileSync(htmlFilePath, htmlContent);
        
        // Open the HTML file with PDF.js viewer
        shell.openPath(htmlFilePath);
        
        return {
          success: true,
          htmlPath: htmlFilePath
        };
      } else {
        return { 
          success: false, 
          error: 'File does not exist' 
        };
      }
    } catch (error) {
      console.error('Error serving PDF for preview:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to serve PDF' 
      };
    }
  })

  ipcMain.handle('process-file', async (_, args) => {
    try {
      const { fileData, userData } = args;
      
      const aiService = new OpenAIService("xai-nYAPY2BlNL4n3DkHvFLkU2WKq9gWBmHvg9vAtjKuIWVJ2ddVfqPxFh7cYns954cFdIH1K2ACQO5nS7lg");
      
      const processedBuffer = await aiService.processFileContent({
        name: fileData.name,
        type: fileData.type,
        buffer: fileData.buffer,
        userData
      });
      
      // Save the processed file to a specific folder
      const savedFilePath = await saveProcessedFile(processedBuffer, fileData.name);
      
      return {
        success: true,
        data: processedBuffer,
        savedFilePath
      };
    } catch (error) {
      console.error("Error in process-file handler:", error);
      return {
        success: false,
        error: "Failed to process document"
      };
    }
  });

  // Function to save the processed file to a specific folder
  async function saveProcessedFile(buffer: Buffer, originalFileName: string): Promise<string> {
    try {
      // Create the directory for processed files
      const processedDir = path.join(app.getPath('documents'), 'afai-desktop-x', 'processed');
      if (!fs.existsSync(processedDir)) {
        fs.mkdirSync(processedDir, { recursive: true });
      }
      
      // Create a filename with timestamp to avoid overwrites
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileExtension = path.extname(originalFileName) || '.pdf';
      const baseFileName = path.basename(originalFileName, fileExtension);
      const newFileName = `${baseFileName}_processed_${timestamp}${fileExtension}`;
      
      // Full path for the new file
      const filePath = path.join(processedDir, newFileName);
      
      // Write the buffer to the file
      fs.writeFileSync(filePath, buffer);
      
      console.log(`Processed file saved to: ${filePath}`);
      
      // Store the last processed file path
      lastProcessedFilePath = filePath;
      
      return filePath;
    } catch (error) {
      console.error('Error saving processed file:', error);
      throw error;
    }
  }

  // Add handler to open the folder containing processed files
  ipcMain.handle('open-processed-folder', () => {
    try {
      const processedDir = path.join(app.getPath('documents'), 'afai-desktop-x', 'processed');
      if (!fs.existsSync(processedDir)) {
        fs.mkdirSync(processedDir, { recursive: true });
      }
      
      shell.openPath(processedDir);
      return { success: true };
    } catch (error) {
      console.error('Error opening processed folder:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to open folder' 
      };
    }
  });

  // Add variable to store the last processed file path
  let lastProcessedFilePath = '';

  // Add handler to get the last processed file path
  ipcMain.handle('get-last-processed-path', () => {
    return { 
      success: lastProcessedFilePath ? true : false,
      path: lastProcessedFilePath,
      exists: lastProcessedFilePath ? fs.existsSync(lastProcessedFilePath) : false
    };
  });

  // Add handler to print PDF files using the advanced_scanner_printer.py script
  ipcMain.handle('print-pdf-file', async (_, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { 
          success: false, 
          error: 'File does not exist' 
        };
      }
      
      console.log(`Printing PDF file: ${filePath}`);
      
      // Find the Python script path
      let pythonScriptPath = '';
      
      if (app.isPackaged) {
        pythonScriptPath = path.join(process.resourcesPath, 'advanced_scanner_printer.py');
      } else {
        // For development, look in the project root
        pythonScriptPath = path.join(app.getAppPath(), 'advanced_scanner_printer.py');
        
        // If not in root, check Downloads folder
        if (!fs.existsSync(pythonScriptPath)) {
          const downloadsPath = path.join(app.getPath('home'), 'Downloads', 'advanced_scanner_printer.py');
          if (fs.existsSync(downloadsPath)) {
            pythonScriptPath = downloadsPath;
          } else {
            throw new Error('Scanner script not found. Please place advanced_scanner_printer.py in the app root or Downloads folder.');
          }
        }
      }
      
      if (!fs.existsSync(pythonScriptPath)) {
        return { 
          success: false, 
          error: `Python script not found at ${pythonScriptPath}` 
        };
      }
      
      // Execute the Python script with the print_with_sumatra command
      const command = `python "${pythonScriptPath}" print_with_sumatra "${filePath}"`;
      console.log(`Executing print command: ${command}`);
      
      const result = child_process.execSync(command, { encoding: 'utf8' });
      console.log('Print command result:', result);
      
      return {
        success: true,
        message: 'Document sent to printer'
      };
    } catch (error) {
      console.error('Error printing PDF file:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to print PDF file' 
      };
    }
  });

  dotenv.config()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
