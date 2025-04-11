import { create } from "zustand"

interface DocumentState {
  file: File | null
  
  resultBlob: Blob | null
  error: string | null

  setFile: (file: File | null) => void
  setResultBlob: (resultBlob: Blob | null) => void
  setError: (error: string | null) => void

}

export const useDocumentStore = create<DocumentState>((set) => ({
  file: null,
  resultBlob: null,
  error: null,
  setFile(file) {
      set({ file })
  },
  setResultBlob(resultBlob) {
      set({ resultBlob })
  },
  setError(error) {
      set({ error })
  },
}))