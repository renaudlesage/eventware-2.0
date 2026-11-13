import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'

/**
 * Les messages vocaux du QG (162), partagés entre le fil Entendu de la
 * Situation et le mode QG : lecture, temps réel, membres et lieux,
 * écoute (URL signée), et les deux gestes de base — Entendu, Classer —
 * avec leur trace au journal. Les gestes plus riches (répondre, lier à
 * une demande, transcrire, supprimer) restent dans le fil Entendu.
 */
export const INTENTIONS = { URGENCE: 'Urgence', URGENCE_DOUTEUSE: 'Urgence ?', DEA: 'DEA', STATUT_DEMANDE: 'Statut de demande', CANAL: 'Canal radio', NUIT: 'Nuit', AUCUNE: '' }
export const heureVocal = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '')
export const urgentVocal = (m) => m.urgence || ['URGENCE', 'URGENCE_DOUTEUSE'].includes(m.intention)
/** (175) Capté sur le canal d'urgence par le pont radio : on ne sait pas qui a parlé. */
export const radioVocal = (m) => m?.source === 'radio'

export function useMessagesVocaux({ evenement, membre, setMessage, actif = true }) {
  const [messages, setMessages] = useState([])
  const [membres, setMembres] = useState({})
  const [lieux, setLieux] = useState([])
  const [audio, setAudio] = useState({}) // id → url signée

  async function lire() {
    if (!actif) return
    const [m, mb, l] = await Promise.all([
      supabase.from('messages_vocaux').select('*').eq('evenement_id', evenement.id).is('deleted_at', null).order('parle_le', { ascending: false }).limit(100),
      supabase.from('membres_evenement').select('id, nom_affiche, equipes(code, nom)').eq('evenement_id', evenement.id),
      supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenement.id).is('deleted_at', null).order('nom')
    ])
    setMessages(m.data ?? [])
    setMembres(Object.fromEntries((mb.data ?? []).map((x) => [x.id, x])))
    setLieux(l.data ?? [])
  }

  useEffect(() => {
    if (!actif) return undefined
    lire()
    const canal = supabase.channel(`vocaux-qg-${evenement.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages_vocaux', filter: `evenement_id=eq.${evenement.id}` }, lire)
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [evenement.id, actif])

  // (175) Une transmission radio est rangée sous le membre qui tient le pont : ce n'est pas lui qui a parlé.
  const qui = (m) => (radioVocal(m) ? 'la radio' : membres[m.membre_id]?.nom_affiche ?? 'membre inconnu')

  async function journal(categorie, m, texte) {
    await supabase.rpc('journaliser', { p_evenement: evenement.id, p_module: 'talkie', p_categorie: categorie, p_texte: texte, p_importance: 'routine', p_objet_type: 'messages_vocaux', p_objet_id: m.id, p_objet_ref: null })
  }
  async function maj(m, champs) {
    const refus = await modifierOuRefuser('messages_vocaux', champs, { id: m.id })
    if (refus) { setMessage?.({ type: 'erreur', texte: refus }); return false }
    lire()
    return true
  }
  async function entendre(m) {
    if (await maj(m, { statut: m.statut === 'nouveau' ? 'entendu' : m.statut, entendu_le: m.entendu_le ?? new Date().toISOString(), entendu_par: membre?.user_id ?? null })) {
      journal('entendu', m, `Message vocal de ${qui(m)} (${heureVocal(m.parle_le)}) entendu`)
    }
  }
  async function classer(m) {
    if (await maj(m, { statut: 'traite' })) journal('classe', m, `Message vocal de ${qui(m)} classé sans suite`)
  }
  async function ecouter(m) {
    if (audio[m.id] || !m.chemin_audio) return
    const { data, error } = await supabase.storage.from('vocaux').createSignedUrl(m.chemin_audio, 600)
    if (error) return setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    setAudio((a) => ({ ...a, [m.id]: data?.signedUrl }))
  }

  return { messages, membres, lieux, audio, lire, maj, journal, qui, entendre, classer, ecouter }
}
