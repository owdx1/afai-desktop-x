import { useDocumentStore } from "../stores/documentStore";
import DocumentInput from "../components/DocumentInput";
import QRInput from "../components/QRInput";
import { useClientStore } from "../stores/clientStore";
import { Button } from "../components/ui/button";
import { useState } from "react";
import { Buffer } from "buffer";
import { useNavigate } from "react-router-dom";

const Home = () => {
  const { file, setResultBlob, setError } = useDocumentStore();
  const { userData } = useClientStore();
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
          {isProcessing ? "Processing..." : "All Set, Send to OpenAI 🚀"}
        </Button>
      )}
    </div>
  );
};

export default Home;