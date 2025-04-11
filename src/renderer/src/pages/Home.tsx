import { useDocumentStore } from "../stores/documentStore";
import DocumentInput from "../components/DocumentInput";
import QRInput from "../components/QRInput";
import { useClientStore } from "../stores/clientStore";
import { Button } from "../components/ui/button";
import { useState } from "react";
import { Buffer } from "buffer";


const Home = () => {
  const { file, setResultBlob, setError } = useDocumentStore();
  const { userData } = useClientStore();
  const [isProcessing, setIsProcessing] = useState(false);

  const sendAI = async () => {
    if (!file || !userData) {
      setError("Missing file or user data");
      return;
    }

    setIsProcessing(true);
    setError(null);
    
    try {

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      const fileData = {
        name: file.name,
        type: file.type,
        buffer: buffer
      };
      
      const result = await window.electron.ipcRenderer.invoke('process-file', {
        fileData,
        userData
      });
      
      if (!result.success) {
        throw new Error(result.error);
      }
      
      const resultBlob = new Blob([result.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      
      setResultBlob(resultBlob);
      
      const url = URL.createObjectURL(resultBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "processed-document.docx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      return resultBlob;
    } catch (error) {
      console.error("Error sending to AI:", error);
      setError("Failed to process document");
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-12 py-12">
      <div className="w-full h-full flex items-center justify-center gap-12">
        <QRInput />
        <DocumentInput />
      </div>
      
      {file && userData && (
        <Button 
          className="w-1/2"
          onClick={sendAI}
          disabled={isProcessing}
        >
          {isProcessing ? "Processing..." : "All Set, Send to AFAI 🚀"}
        </Button>
      )}
    </div>
  );
};

export default Home;