import { supabase } from './supabaseClient'

/**
 * Transcription d'un message vocal par le serveur (Edge Function
 * `transcrire-vocal`), quand le téléphone n'a pas pu le faire.
 *
 * Le message existe déjà, audio compris : la transcription est un plus.
 * Appelée en tâche de fond par le téléphone après l'envoi, et par le QG
 * depuis le fil Entendu. Rend le résultat ({ transcription } ou
 * { erreur }) pour que le QG puisse l'afficher ; le téléphone l'ignore.
 */
export async function transcrireVocal(messageId, force = false) {
  try {
    const { data, error } = await supabase.functions.invoke('transcrire-vocal', { body: { message_id: messageId, force } })
    if (error) return { erreur: error.message ?? String(error) }
    return data ?? {}
  } catch (e) {
    return { erreur: e?.message ?? String(e) }
  }
}
