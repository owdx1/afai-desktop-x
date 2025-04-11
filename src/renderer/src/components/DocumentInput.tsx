import React, { ChangeEvent } from 'react'
import { Input } from './ui/input'
import { useDocumentStore } from '../stores/documentStore'
import { CheckCircle, FileIcon } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'

type Props = {}

const DocumentInput = (props: Props) => {


  const { file, setFile, error, setError } = useDocumentStore()

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

  return (
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
          <Input type='file' onChange={handleFileChange}/>
        }
      </CardContent>
      
    </Card>
  )
}

export default DocumentInput