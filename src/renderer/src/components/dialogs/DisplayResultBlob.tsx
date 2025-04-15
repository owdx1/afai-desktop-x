import { useEffect, useState } from 'react'
import { Dialog, DialogContent } from '../ui/dialog'
import { useDocumentStore } from '../../stores/documentStore'
import mammoth from 'mammoth'

const DisplayResultBlobDialog = () => {
  const { resultBlob, file } = useDocumentStore()
  const [docxHtml, setDocxHtml] = useState<string | null>(null)

  const fileType = file?.type || ''
  const resultUrl = resultBlob ? URL.createObjectURL(resultBlob) : null

  useEffect(() => {
    const loadDocx = async () => {
      if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && resultBlob) {
        const arrayBuffer = await resultBlob.arrayBuffer()
        const { value } = await mammoth.convertToHtml({ arrayBuffer })
        setDocxHtml(value)
      }
    }

    loadDocx()

    return () => {
      if (resultUrl) {
        URL.revokeObjectURL(resultUrl)
      }
      setDocxHtml(null)
    }
  }, [resultBlob, fileType])

  return (
    <div>
      <div className="">
        {!file ? (
          <div>Some error occurred.</div>
        ) : (
          <div className="w-full h-[80vh] flex items-center justify-center">
            {fileType === 'application/pdf' ? (
              <iframe
                src={resultUrl ?? ""}
                title="Document Viewer"
                className="w-full h-full rounded-md border"
              />
            ) : fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? (
              <div
                className="w-full h-full overflow-auto p-4 border rounded-md bg-white"
                dangerouslySetInnerHTML={{ __html: docxHtml || 'Loading document...' }}
              />
            ) : (
              <div>
                <p>Preview not available for this file type.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default DisplayResultBlobDialog
