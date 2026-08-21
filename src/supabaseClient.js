import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    "Variables Supabase absentes. Vérifie que le fichier .env est bien présent à la racine du projet."
  )
}

export const supabase = createClient(url, key)
