import React, { useEffect, useState } from 'react';
import { useDocumentStore } from '../stores/documentStore';
import { Button } from '../components/ui/button';
import { FileIcon, FolderOpenIcon, ExternalLinkIcon, ChevronLeftIcon, AlertCircleIcon, PrinterIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';

const ProcessedDocument = () => {
  const { resultBlob, setResultBlob, setFile } = useDocumentStore();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printResult, setPrintResult] = useState<{success: boolean; message?: string; error?: string} | null>(null);
  const navigate = useNavigate();
  
  useEffect(() => {
    if (!resultBlob) {
      // Redirect back to home if no result blob is available
      navigate('/');
      return;
    }
    
    const loadPdf = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Get the last processed file path
        const result = await window.electron.ipcRenderer.invoke('get-last-processed-path');
        if (result.success && result.exists) {
          setFilePath(result.path);
          
          // Use the IPC to get a data URL for the file
          const fileDataResult = await window.electron.ipcRenderer.invoke('get-file-data-url', result.path);
          if (fileDataResult.success) {
            setPdfUrl(fileDataResult.dataUrl);
          } else {
            throw new Error('Failed to load PDF data');
          }
        } else if (resultBlob) {
          // Fallback to the blob if no file path
          const url = URL.createObjectURL(resultBlob);
          setPdfUrl(url);
        } else {
          throw new Error('No PDF document available');
        }
      } catch (err) {
        console.error('Error loading PDF:', err);
        setError(err instanceof Error ? err.message : 'Failed to load PDF');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadPdf();
    
    // Clean up the URL when the component unmounts
    return () => {
      if (pdfUrl && pdfUrl.startsWith('blob:')) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [resultBlob, navigate]);
  
  const openInDefaultApp = async () => {
    if (filePath) {
      await window.electron.ipcRenderer.invoke('open-file', filePath);
    } else if (resultBlob) {
      // Download the file if we don't have the path but have the blob
      const link = document.createElement('a');
      const blobUrl = URL.createObjectURL(resultBlob);
      link.href = blobUrl;
      link.download = 'processed-document.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    }
  };
  
  const openContainingFolder = async () => {
    await window.electron.ipcRenderer.invoke('open-processed-folder');
  };
  
  const openInPdfViewer = async () => {
    if (filePath) {
      await window.electron.ipcRenderer.invoke('serve-pdf-for-preview', filePath);
    }
  };
  
  const goBack = () => {
    navigate('/');
  };
  
  const goBackAndRefresh = () => {
    // Clear document store state
    setResultBlob(null);
    setFile(null);
    
    // Force a complete page refresh to reset all state
    window.location.href = '/';
  };
  
  const printPdfFile = async () => {
    if (!filePath) {
      setError('No file available to print');
      return;
    }
    
    try {
      setIsPrinting(true);
      setPrintResult(null);
      
      const result = await window.electron.ipcRenderer.invoke('print-pdf-file', filePath);
      setPrintResult(result);
      
      if (result.success) {
        console.log('Document sent to printer');
      } else {
        console.error('Error printing document:', result.error);
        setError(`Failed to print: ${result.error}`);
      }
    } catch (err) {
      console.error('Error invoking print function:', err);
      setError('Failed to send print command');
    } finally {
      setIsPrinting(false);
    }
  };
  
  if (isLoading) {
    return (
      <div className="container mx-auto p-8 flex flex-col items-center justify-center h-screen">
        <Card className="w-full max-w-3xl">
          <CardContent className="p-8 flex flex-col items-center">
            <div className="animate-spin h-16 w-16 border-4 border-primary border-t-transparent rounded-full mb-4"></div>
            <p className="text-xl">Loading document...</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (error || !pdfUrl) {
    return (
      <div className="container mx-auto p-8 flex flex-col items-center justify-center h-screen">
        <Card className="w-full max-w-3xl">
          <CardContent className="p-8 flex flex-col items-center">
            <AlertCircleIcon className="h-16 w-16 text-red-500 mb-4" />
            <p className="text-xl font-bold">Error Loading Document</p>
            <p className="text-muted-foreground mb-4">{error || 'No document available'}</p>
            <Button className="mt-4" onClick={goBack}>
              <ChevronLeftIcon className="mr-2 h-4 w-4" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto p-4 flex flex-col h-[calc(100vh-100px)]">
      <div className="flex justify-between items-center mb-4">
        <Button variant="outline" onClick={goBack}>
          <ChevronLeftIcon className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-bold">Processed Document</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openInPdfViewer}>
            <ExternalLinkIcon className="mr-2 h-4 w-4" />
            Open in PDF Viewer
          </Button>
          <Button variant="outline" onClick={openInDefaultApp}>
            <ExternalLinkIcon className="mr-2 h-4 w-4" />
            Open in Default App
          </Button>
          <Button variant="outline" onClick={openContainingFolder}>
            <FolderOpenIcon className="mr-2 h-4 w-4" />
            Open Folder
          </Button>
        </div>
      </div>
      
      <div className="flex-1 border rounded-md overflow-hidden bg-white p-4 flex flex-col items-center justify-center">
        <Card className="w-full max-w-3xl">
          <CardContent className="p-8 flex flex-col items-center">
            <FileIcon className="h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-xl font-bold">Document Ready</p>
            <p className="text-center mb-6">
              Your document has been processed successfully and is ready to view.
            </p>
            <div className="flex gap-4 mb-4">
              <Button onClick={openInPdfViewer}>Open in PDF Viewer</Button>
              <Button variant="outline" onClick={openInDefaultApp}>Open in Default App</Button>
            </div>
            
            {/* Print Button */}
            <div className="mt-6 border-t pt-6 w-full flex flex-col items-center">
              <Button 
                className="w-64 flex items-center justify-center gap-2"
                onClick={printPdfFile}
                disabled={isPrinting || !filePath}
              >
                {isPrinting ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Printing...
                  </>
                ) : (
                  <>
                    <PrinterIcon className="h-5 w-5" />
                    Print the File
                  </>
                )}
              </Button>
              
              {printResult && printResult.success && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md w-full max-w-md">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 bg-green-100 rounded-full p-2">
                      <svg className="h-5 w-5 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-green-800">
                        Document sent to printer successfully
                      </p>
                      <p className="text-sm text-green-600 mt-1">
                        You can now start over with a new client and document
                      </p>
                    </div>
                  </div>
                  
                  {/* Go back to main menu button with more prominence */}
                  <Button 
                    className="w-full mt-4 flex items-center justify-center gap-2"
                    onClick={goBackAndRefresh}
                  >
                    <ChevronLeftIcon className="h-5 w-5" />
                    Go Back to Main Menu & Reset
                  </Button>
                </div>
              )}
              
              {printResult && !printResult.success && (
                <p className="mt-2 text-sm text-red-500">
                  {printResult.error}
                </p>
              )}
              
              {/* Only show this button if not yet printed or print failed */}
              {(!printResult || !printResult.success) && (
                <Button 
                  className="w-64 mt-6 flex items-center justify-center gap-2"
                  variant="outline"
                  onClick={goBackAndRefresh}
                >
                  <ChevronLeftIcon className="h-5 w-5" />
                  Go Back to Main Menu & Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProcessedDocument; 