import { supabase } from './supabaseClient'

/**
 * Les notifications poussées (11/11, audit : fonction manquante n° 2).
 *
 * Jusqu'ici, une alerte, une mission attribuée ou la réponse du QG ne
 * touchaient que les personnes dont l'application était ouverte, à
 * l'écran. Un bénévole à son poste, le téléphone en poche, ne savait
 * rien. Le navigateur sait recevoir un message quand l'application est
 * fermée (Web Push) : chaque appareil s'abonne, s'il le veut, depuis
 * « Mon compte ».
 *
 * Trois règles :
 * — c'est un PLUS. L'alerte existe et s'affiche sans lui ; un envoi
 *   qui échoue ne bloque ni ne signale rien (`pousser` tire et oublie) ;
 * — le texte de la notification est composé par le serveur à partir de
 *   la base (fonction `notifier`), jamais envoyé par l'application ;
 * — rien n'est demandé au navigateur sans un geste de la personne :
 *   pas de fenêtre d'autorisation à l'ouverture.
 *
 * Sur iPhone et iPad, le navigateur n'accepte les notifications que
 * pour une application installée sur l'écran d'accueil (iOS 16.4+).
 */

export const PREFERENCES_PUSH = [
  ['alertes', 'Alertes du QG'],
  ['missions', 'Missions qui me sont attribuées'],
  ['demandes', 'Suivi de mes demandes'],
  ['reponses', 'Réponses du QG à mes messages vocaux'],
  ['rappels', 'Rappels avant ma prise de poste']
]

const installee = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
const appareilApple = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

function decoderCle(base64url) {
  const b = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const brut = atob(b)
  return Uint8Array.from(brut, (c) => c.charCodeAt(0))
}

function nomAppareil() {
  const ua = navigator.userAgent
  const os = /android/i.test(ua) ? 'Android' : appareilApple() ? 'iPhone ou iPad' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : 'Appareil'
  const nav = /edg\//i.test(ua) ? 'Edge' : /firefox/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'navigateur'
  return `${os} · ${nav}`
}

async function enregistrement() {
  if (!('serviceWorker' in navigator)) return null
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    return null
  }
}

/**
 * Où en est cet appareil.
 *   { possible: false, raison }                         → on explique pourquoi
 *   { possible: true, permission, abonne, preferences } → on propose le geste
 */
export async function etatPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (appareilApple() && !installee()) {
      return { possible: false, raison: 'Sur iPhone et iPad, installe d’abord Eventware sur l’écran d’accueil (Partager › Sur l’écran d’accueil), puis ouvre-la depuis son icône : les notifications se règlent ensuite ici.' }
    }
    return { possible: false, raison: 'Ce navigateur ne sait pas recevoir de notifications.' }
  }
  const reg = await enregistrement()
  if (!reg) return { possible: false, raison: 'Les notifications ne sont disponibles que sur l’application en ligne (pas en mode développement ni en aperçu).' }
  let abonnement = null
  try {
    abonnement = await reg.pushManager.getSubscription()
  } catch {
    /* lecture refusée : on fait comme s'il n'y en avait pas */
  }
  let preferences = {}
  if (abonnement) {
    const { data } = await supabase.from('abonnements_push').select('preferences').eq('endpoint', abonnement.endpoint).maybeSingle()
    // L'abonnement du navigateur existe mais plus sa ligne (retirée après un échec) : on le redira à l'activation.
    if (!data) return { possible: true, permission: Notification.permission, abonne: false, preferences: {} }
    preferences = data.preferences ?? {}
  }
  return { possible: true, permission: Notification.permission, abonne: !!abonnement, preferences }
}

/** Abonne cet appareil. À appeler depuis un clic : le navigateur demande l'autorisation. */
export async function activerPush() {
  const reg = await enregistrement()
  if (!reg) return { erreur: 'Notifications indisponibles sur cet appareil.' }

  // La clé publique du serveur : sans elle, pas d'abonnement possible.
  let cle = null
  try {
    const { data, error } = await supabase.functions.invoke('notifier', { method: 'GET' })
    if (!error) cle = data?.cle_publique ?? null
  } catch {
    /* fonction absente ou réseau coupé : même message */
  }
  if (!cle) return { erreur: 'Les notifications ne sont pas encore activées sur ce serveur (ou le réseau est coupé).' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { erreur: permission === 'denied'
      ? 'Les notifications sont bloquées pour ce site : autorise-les dans les réglages du navigateur, puis réessaie.'
      : 'Autorisation non accordée.' }
  }

  let abonnement
  try {
    abonnement = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decoderCle(cle) }))
  } catch (e) {
    return { erreur: `Le navigateur a refusé l’abonnement : ${e?.message ?? e}` }
  }
  const j = abonnement.toJSON()
  const { error } = await supabase.rpc('abonner_push', {
    p_endpoint: j.endpoint,
    p_p256dh: j.keys?.p256dh,
    p_auth: j.keys?.auth,
    p_appareil: nomAppareil()
  })
  if (error) {
    await abonnement.unsubscribe().catch(() => {})
    return { erreur: error.code === 'PGRST202' ? 'Les notifications ne sont pas encore activées sur cette base (migration 170).' : error.message }
  }
  return { ok: true }
}

/** Désabonne cet appareil, et retire sa ligne. */
export async function desactiverPush() {
  const reg = await enregistrement()
  const abonnement = await reg?.pushManager.getSubscription().catch(() => null)
  if (!abonnement) return { ok: true }
  await supabase.from('abonnements_push').delete().eq('endpoint', abonnement.endpoint)
  await abonnement.unsubscribe().catch(() => {})
  return { ok: true }
}

/** Ce que cet appareil veut recevoir : { alertes: false } coupe les alertes, le reste suit. */
export async function reglerPreferencesPush(preferences) {
  const reg = await enregistrement()
  const abonnement = await reg?.pushManager.getSubscription().catch(() => null)
  if (!abonnement) return { erreur: 'Cet appareil n’est pas abonné.' }
  const { error } = await supabase.from('abonnements_push').update({ preferences }).eq('endpoint', abonnement.endpoint)
  return error ? { erreur: error.message } : { ok: true }
}

/**
 * Prévient les appareils concernés, en tâche de fond, juste après un geste réussi.
 *
 *   pousser('alerte', alerte.id)          tous les membres actifs
 *   pousser('mission', mission.id)        la personne ou l'équipe à qui elle est attribuée
 *   pousser('demande_statut', mission.id) celui qui a posé la demande
 *   pousser('reponse_vocal', message.id)  l'auteur du message vocal
 *   pousser('rappel_creneau', creneau.id) les personnes affectées au créneau
 *
 * Silencieux par conception : l'objet existe déjà dans Eventware, la notification est un plus.
 * Ne pas l'appeler pour une écriture partie en file d'attente : l'objet n'est pas encore en base.
 */
export function pousser(type, id) {
  if (!id || navigator.onLine === false) return
  try {
    supabase.functions.invoke('notifier', { body: { type, id } }).catch(() => {})
  } catch {
    /* jamais bloquant */
  }
}

/**
 * Un clic sur une notification, application déjà ouverte : le service worker nous dit où aller.
 * L'adresse commande (voir route.js) ; l'événement, lui, se change par le signal `eventware:evenement`.
 */
export function ecouterNotifications() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data
    if (!d || d.type !== 'eventware:ouvrir') return
    if (d.evenement_id) window.dispatchEvent(new CustomEvent('eventware:evenement', { detail: d.evenement_id }))
    if (typeof d.url === 'string' && d.url.startsWith('#')) window.location.hash = d.url
  })
}
