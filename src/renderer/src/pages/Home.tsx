import { useDocumentStore } from "../stores/documentStore";
import DocumentInput from "../components/DocumentInput";
import QRInput from "../components/QRInput";
import { useClientStore } from "../stores/clientStore";
import { Button } from "../components/ui/button";
import { useState } from "react";
import { Buffer } from "buffer";
import { Link, useNavigate } from "react-router-dom";
import { OctagonAlertIcon } from "lucide-react";
import { cn } from "../lib/utils";

const Home = () => {
  const { file, setFile, setResultBlob, setError, resultBlob, restartDocument } = useDocumentStore();
  const { userData, restartClient } = useClientStore();
  const [isProcessing, setIsProcessing] = useState(false);
  const navigate = useNavigate();

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
        userData,
        useModel: "openai" // Add a parameter to specify which model to use
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      // Set the appropriate MIME type based on file type
      const outputMimeType = file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      const resultBlob = new Blob([result.data], { type: outputMimeType });

      setResultBlob(resultBlob);

      // Instead of downloading, navigate to the processed document page
      navigate('/processed-document');
    } catch (error) {
      console.error(error);
      setError(error instanceof Error ? error.message : 'Failed to process document');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-12 py-12">
      <div className={cn({
        "w-full h-full flex flex-col items-center justify-center gap-12": true,
        "disabled opacity-50 pointer-events-none": resultBlob !== null
      })}>
        <div className="flex items-center justify-center gap-12 w-full h-full">
          <QRInput />
          <DocumentInput />
        </div>

        {file && userData && (
        <Button
          className="w-1/2"
          onClick={sendAI}
          disabled={isProcessing}
        >
          {isProcessing ? "Processing..." : "All Set, Send to OpenAI 🚀"}
        </Button>
      )}
      </div>

      
      {resultBlob && 
        <>
          <Link to={"/processed-document"} className="cursor-pointer px-8 py-2 rounded flex items-center justify-center gap-4 bg-red-50">
            <OctagonAlertIcon color="red"/>
            <span>Validate - {file?.name}</span>
          </Link>

          <Button onClick={() => {
            restartDocument()
            restartClient()
          }}> Restart </Button>
        </>
      }

    </div>
  );
};

export default Home;