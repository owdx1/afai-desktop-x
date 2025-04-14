import { UserData } from "@/lib/db-types"
import { create } from "zustand"

interface ClientState {
  client_email: string | null
  setClientEmail: (id: string) => void

  userData: UserData | null

  setUserData: (ud: UserData) => void

}

export const useClientStore = create<ClientState>((set) => ({
  
  client_email: null,
  userData: null,

  setClientEmail: (id) => set({ client_email: id }),
  setUserData: (ud) => set({ userData: ud })

}))