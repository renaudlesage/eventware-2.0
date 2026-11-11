import { createClient } from '@supabase/supabase-js'
import { fetchTemoin } from './temoinEcriture'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    "Variables Supabase absentes. Vérifie que le fichier .env est bien présent à la racine du projet."
  )
}

// Le `fetch` du client regarde passer les écritures réussies, pour le témoin « Enregistré ✓ ».
export const supabase = createClient(url, key, { global: { fetch: fetchTemoin } })
