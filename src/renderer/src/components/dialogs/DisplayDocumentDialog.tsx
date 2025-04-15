import { useEffect, useState } from 'react'
import { Dialog, DialogContent } from '../ui/dialog'
import { useDocumentStore } from '../../stores/documentStore'
import mammoth from 'mammoth'

const DisplayDocumentDialog = () => {
  const { file, setDisplayFile, displayFile } = useDocumentStore()
  const [docxHtml, setDocxHtml] = useState<string | null>(null)

  const fileType = file?.type || ''
  const fileUrl = file ? URL.createObjectURL(file) : null

  useEffect(() => {
    const loadDocx = async () => {
      if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && file) {
        const arrayBuffer = await file.arrayBuffer()
        const { value } = await mammoth.convertToHtml({ arrayBuffer })
        setDocxHtml(value)
      }
    }

    loadDocx()

    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl)
      }
      setDocxHtml(null)
    }
  }, [file, fileType])

  return (
    <Dialog open={displayFile} onOpenChange={setDisplayFile}>
      <DialogContent className="max-w-full min-w-full overflow-hidden">
        {!file ? (
          <div>Some error occurred.</div>
        ) : (
          <div className="w-full h-[80vh] flex items-center justify-center">
            {fileType === 'application/pdf' ? (
              <iframe
                src={fileUrl ?? ""}
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
      </DialogContent>
    </Dialog>
  )
}

export default DisplayDocumentDialog
