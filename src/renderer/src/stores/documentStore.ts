import { create } from "zustand"

interface DocumentState {
  file: File | null

  displayFile: boolean
  setDisplayFile: (b: boolean) => void

  displayResultBlob: boolean
  setDisplayResultBlob: (b: boolean) => void

  resultBlob: Blob | null
  error: string | null

  setFile: (file: File | null) => void
  setResultBlob: (resultBlob: Blob | null) => void
  setError: (error: string | null) => void

  restartDocument: () => void

}

export const useDocumentStore = create<DocumentState>((set) => ({
    restartDocument() {
        set({
            file: null,
            resultBlob: null,
            error: null
        })
    },
  file: null,
  displayFile: false,
  displayResultBlob: false,
  setDisplayResultBlob(b) {
      set({ displayFile: b })
  },
  setDisplayFile(b) {
      set({ displayFile: b })
  },
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