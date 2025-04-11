import { sbclient } from "../supabase-client";
import { User } from "@supabase/supabase-js";
import { create } from "zustand"

interface AuthState {
  
  user: User | null
  isLoading: boolean
  error: string | null

  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>;
  setUser: (user: User | null) => void;
  setError: (error: string | null) => void;

}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  error: null,

  signInWithGoogle: async () =>{
    try {
      set({ isLoading: true, error: null })
      const { data, error } = await sbclient.auth.signInWithOAuth({
        provider: "google"
      });

      if(error) {
        set({ error: error.message, isLoading: false })
      }
      
    } catch (err) {
      set({ error: err instanceof Error ? err.message: "Sign In Failed..", isLoading: false })
    } finally {
      set({ isLoading: false })
    }
  },
  signOut: async () => {
    try {
      set({ isLoading: true, error: null });
      const { error } = await sbclient.auth.signOut();
  
      if (error) {
        set({ error: error.message });
      } else {
        set({ user: null });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Sign out failed." });
    } finally {
      set({ isLoading: false });
    }
  },
  
  setError: (error) => {
    set({ error })
  },
  setUser: (user) => {
    set({ user })
  }
}))


export const initializeAuthListener = () => {
  const { data: { subscription } } = sbclient.auth.onAuthStateChange((event, session) => {
    console.log("Auth state changed:", event);
    
    const user = session?.user || null;
    useAuthStore.getState().setUser(user);
    
    if (event === 'SIGNED_IN') {
      console.log("User signed in:", user);
    } else if (event === 'SIGNED_OUT') {
      console.log("User signed out");
    }
  });
  
  return () => {
    subscription.unsubscribe();
  };
};