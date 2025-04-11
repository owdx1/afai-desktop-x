import { UserData } from "@/lib/db-types"
import { create } from "zustand"

interface ClientState {
  client_id: string | null
  setClientId: (id: string) => void

  userData: UserData | null

  setUserData: (ud: UserData) => void

}

export const useClientStore = create<ClientState>((set) => ({
  
  client_id: null,
  userData: null,

  setClientId: (id) => set({ client_id: id }),
  setUserData: (ud) => set({ userData: ud })

}))