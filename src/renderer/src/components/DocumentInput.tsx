import { ChangeEvent, useState, useEffect } from 'react'
import { Input } from './ui/input'
import { useDocumentStore } from '../stores/documentStore'
import { CheckCircle, FileIcon, ScanIcon, ExternalLinkIcon } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose
} from './ui/dialog'

const DocumentInput = () => {

  const { file, setFile, error, setError } = useDocumentStore()
  const [isScanning, setIsScanning] = useState(false)
  const [showScanPopup, setShowScanPopup] = useState(false)
  const [scanFilePath, setScanFilePath] = useState('')
  const [fileDataUrl, setFileDataUrl] = useState('')
  const [fileMimeType, setFileMimeType] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // File path helper
  const getFileName = (filePath: string) => {
    if (!filePath) return '';
    // Get the last part of the path (the filename)
    const parts = filePath.split(/[\/\\]/);
    return parts[parts.length - 1];
  };

  // Load file data URL when scan file path changes
  useEffect(() => {
    const loadFileDataUrl = async () => {
      if (scanFilePath) {
        try {
          const result = await window.electron.ipcRenderer.invoke('get-file-data-url', scanFilePath);
          if (result.success) {
            setFileDataUrl(result.dataUrl);
            setFileMimeType(result.mimeType);
          }
        } catch (error) {
          console.error('Error getting file data URL:', error);
        }
      }
    };
    
    loadFileDataUrl();
  }, [scanFilePath]);


  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files ? e.target.files[0] : null

    if(selectedFile == null) {
      setFile(null)
      return
    }

    if(selectedFile.size > 5 * 1024 * 1024) {
      setFile(null)
      setError("File can not be greater than 5MBs")
      return
    }

    setFile(selectedFile);
  }

  const handleScanFile = async () => {

    try {
      setIsScanning(true)
      setError(null)
      setFileDataUrl('') // Reset file data URL before scanning
      
      const result = await window.electron.ipcRenderer.invoke('scan-document');
      
      // If we have a file path, show it regardless of success status
      if (result.filePath) {
        setScanFilePath(result.filePath);
        
        // Only set the file if we have valid data
        if (result.success && result.data) {
          try {
            // Convert the scanned file data to a File object
            const fileName = getFileName(result.filePath);
            const fileType = 'application/pdf';
            
            // Create a blob from the binary data
            const blob = new Blob([result.data], { type: fileType });
            
            // Create a File object from the blob
            const scannedFile = new File([blob], fileName, { type: fileType });
            
            // Set the file in the store - this will make it ready for AI processing
            setFile(scannedFile);
            console.log("File set successfully from scan:", scannedFile);
            setSuccessMessage("Document added successfully!");
            
            // Show popup briefly to let user know scanning was successful
            setShowScanPopup(true);
            // Close popup after a delay to show the document is ready
            setTimeout(() => {
              setShowScanPopup(false);
            }, 2000);
          } catch (error) {
            console.error("Error creating File object:", error);
            setError("Scan succeeded but couldn't use the document automatically.");
            setShowScanPopup(true);
          }
        } else {
          // If no data but we have a path, try to get the file data
          setShowScanPopup(true);
          
          try {
            // Try to get the file data from the main process
            const fileResult = await window.electron.ipcRenderer.invoke('get-file-data', result.filePath);
            if (fileResult.success) {
              // Create a file object from the binary data
              const fileName = getFileName(result.filePath);
              const fileType = 'application/pdf';
              
              // Create a blob from the binary data
              const blob = new Blob([fileResult.data], { type: fileType });
              
              // Create a File object from the blob
              const scannedFile = new File([blob], fileName, { type: fileType });
              
              // Set the file in the store
              setFile(scannedFile);
              console.log("File set successfully from alternate method:", scannedFile);
              setSuccessMessage("Document added successfully!");
            } else if (result.error) {
              // Show the error but still display path
              setError(result.error);
            }
          } catch (alternateError) {
            console.error("Error using alternate method:", alternateError);
            if (result.error) {
              setError(result.error);
            }
          }
        }
      } else if (result.error) {
        // No file path returned
        setError(result.error || "Failed to scan document");
        
        // Try to get the last scan path
        const lastScanInfo = await window.electron.ipcRenderer.invoke('get-last-scan-path');
        if (lastScanInfo.path && lastScanInfo.exists) {
          setScanFilePath(lastScanInfo.path);
          setShowScanPopup(true);
        }
      } else {
        // Last resort - try to get path
        const lastScanInfo = await window.electron.ipcRenderer.invoke('get-last-scan-path');
        if (lastScanInfo.path && lastScanInfo.exists) {
          setScanFilePath(lastScanInfo.path);
          setShowScanPopup(true);
        } else {
          setError("No scanned document found");
        }
      }
    } catch (error) {
      console.error("Error scanning document:", error);
      setError("Failed to scan document");
      
      // Even on error, try to get the last scan path
      try {
        const lastScanInfo = await window.electron.ipcRenderer.invoke('get-last-scan-path');
        if (lastScanInfo.path && lastScanInfo.exists) {
          setScanFilePath(lastScanInfo.path);
          setShowScanPopup(true);
        }
      } catch (e) {
        console.error("Error getting last scan path:", e);
      }
    } finally {
      setIsScanning(false)
    }
  }

  const openScanFile = async () => {
    if (scanFilePath) {
      await window.electron.ipcRenderer.invoke('open-file', scanFilePath);
    }
  }

  const openPdfInPdfJs = async () => {
    if (scanFilePath) {
      await window.electron.ipcRenderer.invoke('serve-pdf-for-preview', scanFilePath);
    }
  }

  return (
    <>
    <Card className='w-80 h-96'>
      <CardContent className='w-full h-full'>
        {file ?
          <div className='flex flex-col items-center gap-2 w-full h-full bg'>
            <div className='flex items-center gap-2 pb-4'>
              <CheckCircle />
              <p>This section is done!</p>
            </div>
            <div className='flex flex-col items-center gap-2'>
              <FileIcon />
              <p>{file.name}</p>
            </div>
            <div className='flex-1'></div>
            <Button onClick={() => {
              setFile(null)
              setError(null)
            }}> Choose another file </Button>
          </div>
          :
            <div className='flex flex-col items-center gap-4 w-full h-full p-4'>
          <Input type='file' onChange={handleFileChange}/>
              <div className='flex-1'></div>
              <Button 
                className='w-full flex items-center gap-2' 
                onClick={handleScanFile}
                disabled={isScanning}
              >
                <ScanIcon size={18} />
                {isScanning ? 'Scanning...' : 'Scan File'}
              </Button>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              {successMessage && <p className="text-green-500 text-sm">{successMessage}</p>}
            </div>
        }
      </CardContent>
      </Card>
      
      {/* Scan Location Popup */}
      <Dialog open={showScanPopup} onOpenChange={setShowScanPopup}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Document Ready for Processing</DialogTitle>
            <DialogDescription>
              Your document has been scanned and automatically added to the "Choose File" section.
            </DialogDescription>
          </DialogHeader>
          
          {/* PDF/Image Viewer */}
          <div className="w-full h-[400px] overflow-hidden rounded-md border bg-muted flex items-center justify-center">
            {fileDataUrl ? (
              fileMimeType === 'application/pdf' ? (
                // PDF Viewer - simplified approach
                <div className="flex flex-col items-center justify-center gap-4">
                  <FileIcon className="h-20 w-20 text-muted-foreground" />
                  <p className="text-lg font-medium">PDF Document</p>
                  <p className="text-sm text-muted-foreground mb-2">
                    {getFileName(scanFilePath)}
                  </p>
                  <div className="flex flex-col gap-2 w-48">
                    <Button 
                      variant="default" 
                      onClick={async () => {
                        // Close this dialog
                        setShowScanPopup(false);
                        
                        // Set the file as the selected file
                        if (scanFilePath) {
                          try {
                            // Get file data directly from the main process
                            const fileResult = await window.electron.ipcRenderer.invoke('get-file-data', scanFilePath);
                            
                            if (fileResult.success) {
                              // Create a file object from the binary data
                              const fileName = getFileName(scanFilePath);
                              const fileType = 'application/pdf';
                              
                              // Create a blob from the binary data
                              const blob = new Blob([fileResult.data], { type: fileType });
                              
                              // Create a File object from the blob
                              const scannedFile = new File([blob], fileName, { type: fileType });
                              
                              // Set the file in the store
                              setFile(scannedFile);
                              console.log("File set successfully:", scannedFile);
                              setSuccessMessage("Document added successfully!");
                            } else {
                              console.error("Failed to get file data:", fileResult.error);
                              setError("Failed to use document. Please try again.");
                            }
                          } catch (error) {
                            console.error('Error creating File object:', error);
                            setError("Failed to use document. Please try again.");
                          }
                        }
                      }}
                      className="w-full"
                    >
                      Use This Document
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={openPdfInPdfJs}
                      className="w-full"
                    >
                      View PDF
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={openScanFile}
                      className="w-full"
                    >
                      Open in Default App
                    </Button>
                  </div>
                </div>
              ) : fileMimeType.startsWith('image/') ? (
                // Image Viewer
                <img
                  src={fileDataUrl}
                  alt="Scanned Document"
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                // Unsupported file type
                <div className="flex flex-col items-center justify-center">
                  <FileIcon className="h-16 w-16 text-muted-foreground mb-4" />
                  <p>Preview not available for this file type</p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-2"
                    onClick={openScanFile}
                  >
                    <ExternalLinkIcon className="mr-2 h-4 w-4" />
                    Open File
                  </Button>
                </div>
              )
            ) : (
              // Loading or no file
              <div className="flex items-center justify-center">
                <p>Loading document...</p>
              </div>
            )}
          </div>
          
          <DialogFooter className="sm:justify-end flex-row">
            <DialogClose asChild>
              <Button type="button" size="sm">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default DocumentInput