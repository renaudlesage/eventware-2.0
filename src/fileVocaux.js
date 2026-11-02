import { supabase } from './supabaseClient'
import { surRetourReseau } from './reessai'

/**
 * La file des messages vocaux (162).
 *
 * Un message vocal pèse des dizaines de kilo-octets : il n'a pas sa
 * place dans `fileEcritures` (localStorage, dimensionné pour quelques
 * dizaines d'opérations légères). Il attend ici, dans IndexedDB, avec
 * ses métadonnées — dont `parle_le`, l'heure du téléphone au moment de
 * parler — et repart au retour du réseau, sur les mêmes déclencheurs
 * que les autres files (reessai.js). L'envoi est idempotent : l'`id`
 * est tiré sur le téléphone, le fichier s'écrase (upsert), et une
 * ligne déjà insérée (23505) compte comme envoyée.
 */
const BASE = 'eventware-vocaux'
const MAGASIN = 'file'
const MAX_ESSAIS = 50
const abonnes = new Set()
let enCours = false

function ouvrir() {
  return new Promise((resoudre, rejeter) => {
    if (!('indexedDB' in window)) return rejeter(new Error('IndexedDB indisponible'))
    const req = indexedDB.open(BASE, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(MAGASIN, { keyPath: 'id' })
    req.onsuccess = () => resoudre(req.result)
    req.onerror = () => rejeter(req.error)
  })
}

function transaction(mode, fn) {
  return ouvrir().then((db) => new Promise((resoudre, rejeter) => {
    const t = db.transaction(MAGASIN, mode)
    const r = fn(t.objectStore(MAGASIN))
    t.oncomplete = () => { db.close(); resoudre(r?.result ?? r) }
    t.onerror = () => { db.close(); rejeter(t.error) }
  }))
}

const prevenir = () => abonnes.forEach((cb) => { try { cb() } catch { /* un abonné ne casse pas les autres */ } })

/** Se tenir au courant des changements de la file (ajout, envoi, échec). */
export function surChangementVocaux(cb) {
  abonnes.add(cb)
  return () => abonnes.delete(cb)
}

/** Ce qui attend le réseau, du plus ancien au plus récent (sans l'audio). */
export async function enAttenteVocaux() {
  try {
    const tout = await transaction('readonly', (m) => m.getAll())
    return (tout ?? []).sort((a, b) => a.parle_le.localeCompare(b.parle_le)).map(({ blob, ...reste }) => ({ ...reste, taille: blob?.size ?? 0 }))
  } catch {
    return []
  }
}

/**
 * Met un message en file et tente l'envoi tout de suite.
 * @param {object} m  { id, evenement_id, membre_id, parle_le, duree_s, blob, mime, transcription, latitude, longitude, precision_m }
 */
export async function ajouterVocal(m) {
  await transaction('readwrite', (s) => s.put({ ...m, essais: 0, erreur: null }))
  prevenir()
  rejouerVocaux()
}

function extension(mime) {
  if (/mp4|aac|m4a/.test(mime ?? '')) return 'm4a'
  if (/ogg/.test(mime ?? '')) return 'ogg'
  return 'webm'
}

async function envoyer(m) {
  let chemin = null
  if (m.blob && m.blob.size > 0) {
    chemin = `${m.evenement_id}/${m.membre_id}/${m.id}.${extension(m.mime)}`
    const { error } = await supabase.storage.from('vocaux').upload(chemin, m.blob, { upsert: true, contentType: m.mime || 'audio/webm' })
    if (error) throw error
  }
  const { error } = await supabase.from('messages_vocaux').insert({
    id: m.id, evenement_id: m.evenement_id, membre_id: m.membre_id, parle_le: m.parle_le, duree_s: m.duree_s,
    chemin_audio: chemin, transcription: m.transcription || null, reconnaissance: m.reconnaissance ?? null,
    latitude: m.latitude ?? null, longitude: m.longitude ?? null, precision_m: m.precision_m ?? null
  })
  // Déjà insérée par un essai précédent dont la réponse s'est perdue : c'est envoyé.
  if (error && error.code !== '23505') throw error
}

/** Vide la file, dans l'ordre ; s'arrête à la première panne réseau. */
export async function rejouerVocaux() {
  if (enCours) return
  enCours = true
  try {
    const tout = await transaction('readonly', (s) => s.getAll())
    for (const m of (tout ?? []).sort((a, b) => a.parle_le.localeCompare(b.parle_le))) {
      try {
        await envoyer(m)
        await transaction('readwrite', (s) => s.delete(m.id))
        prevenir()
      } catch (e) {
        const refus = e?.code && /^(42501|23|22|PGRST)/.test(String(e.code)) // droits ou données : inutile d'insister
        const essais = (m.essais ?? 0) + 1
        await transaction('readwrite', (s) => s.put({ ...m, essais, erreur: e?.message ?? String(e), definitif: refus || essais >= MAX_ESSAIS }))
        prevenir()
        if (!refus) break
      }
    }
  } catch {
    /* IndexedDB indisponible : rien à rejouer */
  } finally {
    enCours = false
  }
}

/** Retire un message refusé définitivement (décision humaine). */
export async function abandonnerVocal(id) {
  await transaction('readwrite', (s) => s.delete(id))
  prevenir()
}

let installe = false
export function demarrerVocaux() {
  if (installe) return
  installe = true
  surRetourReseau(rejouerVocaux)
}
