// =====================================================================
// transcrire-vocal
// ---------------------------------------------------------------------
// Transcrit côté serveur un message vocal du talkie (162) quand le
// téléphone n'a pas pu le faire : sur Android et iOS, la reconnaissance
// du navigateur n'obtient pas le micro déjà pris par l'enregistrement.
// Appelée par le téléphone juste après l'envoi (fileVocaux.js) et par
// le QG (bouton « Transcrire » du fil Entendu), avec le JWT de
// l'appelant : il doit pouvoir lire le message (auteur ou QG, RLS).
//
// Conditions : l'événement a l'option `talkie_transcription_serveur`
// (Réglages › Modules) et le secret OPENAI_API_KEY est déclaré. L'audio
// est lu dans le compartiment privé « vocaux » avec la clé de service,
// envoyé à l'API de transcription d'OpenAI (modèle
// TRANSCRIPTION_MODELE, par défaut gpt-4o-mini-transcribe, français),
// et le texte est écrit dans `transcription` avec
// `reconnaissance = 'serveur'` : le déclencheur de la 162/166 reconnaît
// alors les mots-clés et répond. Un échec est noté dans
// `reconnaissance` (erreur:serveur:<motif>) sans toucher au message.
// L'audio n'est jamais conservé ailleurs que dans le compartiment.
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ENTETES_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}
const JSON_ENTETES = { ...ENTETES_CORS, 'Content-Type': 'application/json' }
const reponse = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: JSON_ENTETES })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ENTETES_CORS })
  if (req.method !== 'POST') return new Response('Méthode non autorisée', { status: 405, headers: ENTETES_CORS })

  let message_id: string
  let force = false
  try {
    const corps = await req.json()
    message_id = corps.message_id
    force = corps.force === true
    if (!message_id) throw new Error('message_id manquant')
  } catch {
    return reponse({ erreur: 'Requête invalide' }, 400)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const autorisation = req.headers.get('Authorization') ?? ''
  // Le client de l'appelant : la RLS décide s'il peut lire ce message (auteur ou QG).
  const appelant = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: autorisation } } })
  const { data: m, error: erreurLecture } = await appelant
    .from('messages_vocaux')
    .select('id, evenement_id, chemin_audio, transcription, duree_s, reconnaissance')
    .eq('id', message_id)
    .maybeSingle()
  if (erreurLecture || !m) return reponse({ erreur: 'Message introuvable ou inaccessible' }, 404)
  if (m.transcription && !force) return reponse({ deja: true, transcription: m.transcription })
  if (!m.chemin_audio) return reponse({ erreur: 'Message sans audio' }, 409)

  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const noter = async (sort: string) => {
    await service.from('messages_vocaux').update({ reconnaissance: sort }).eq('id', message_id).is('transcription', null)
  }

  const { data: ev } = await service.from('evenements').select('modules, nom').eq('id', m.evenement_id).maybeSingle()
  if (!ev?.modules?.talkie_transcription_serveur) return reponse({ erreur: 'Option « transcription par le serveur » inactive sur cet événement' }, 409)
  const cle = Deno.env.get('OPENAI_API_KEY')
  if (!cle) { await noter('erreur:serveur:cle-absente'); return reponse({ erreur: 'Secret OPENAI_API_KEY absent' }, 503) }

  const { data: fichier, error: erreurFichier } = await service.storage.from('vocaux').download(m.chemin_audio)
  if (erreurFichier || !fichier) { await noter('erreur:serveur:audio-introuvable'); return reponse({ erreur: 'Audio introuvable dans le compartiment' }, 404) }

  // Les noms des lieux de l'événement guident la reconnaissance (« étape 3 », « PC Ops »…).
  const { data: lieux } = await service.from('lieux').select('nom').eq('evenement_id', m.evenement_id).is('deleted_at', null).limit(40)
  const contexte = `Message radio d'un bénévole pendant l'événement « ${ev.nom} », en français de Belgique. Lieux : ${(lieux ?? []).map((l: { nom: string }) => l.nom).join(', ')}.`

  const extension = m.chemin_audio.split('.').pop() ?? 'webm'
  const formulaire = new FormData()
  formulaire.append('file', fichier, `message.${extension}`)
  formulaire.append('model', Deno.env.get('TRANSCRIPTION_MODELE') ?? 'gpt-4o-mini-transcribe')
  formulaire.append('language', 'fr')
  formulaire.append('response_format', 'json')
  formulaire.append('prompt', contexte.slice(0, 900))

  let texte = ''
  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${cle}` }, body: formulaire })
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200)
      await noter(`erreur:serveur:${r.status}`)
      return reponse({ erreur: `Service de transcription : ${r.status}`, detail }, 502)
    }
    const corps = await r.json()
    texte = String(corps.text ?? '').trim()
  } catch (e) {
    await noter('erreur:serveur:reseau')
    return reponse({ erreur: `Service de transcription injoignable : ${(e as Error)?.message ?? e}` }, 502)
  }
  if (!texte) { await noter('erreur:serveur:vide'); return reponse({ vide: true }) }

  // L'écriture déclenche talkie_lieu et talkie_repondre (162/166).
  const { error: erreurEcriture } = await service.from('messages_vocaux')
    .update({ transcription: texte, reconnaissance: 'serveur' })
    .eq('id', message_id)
  if (erreurEcriture) return reponse({ erreur: erreurEcriture.message }, 500)
  return reponse({ transcription: texte, duree_s: m.duree_s })
})
