import { createClient } from "@supabase/supabase-js"

const key: string = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const url: string= "https://uxdrmhptzpaiskqrnlwe.supabase.co"

export const sbclient = createClient(
  url,
  key,
)