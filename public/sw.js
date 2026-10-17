/*
 * Service worker d'Eventware.
 *
 * Ce qu'il fait : permettre à l'application de SE CHARGER sans réseau.
 * Jusqu'ici, le mémento était en cache mais l'application elle-même ne
 * démarrait pas hors réseau — le cache ne servait donc qu'à qui avait
 * gardé son onglet ouvert.
 *
 * Ce qu'il ne fait PAS, volontairement :
 *   il ne met JAMAIS en cache les réponses de Supabase. Une donnée
 *   opérationnelle périmée servie comme fraîche est plus dangereuse
 *   qu'une absence de donnée : on croirait lire la situation courante.
 *   Les seules données disponibles hors réseau sont celles que
 *   l'application a explicitement enregistrées — le mémento d'urgence
 *   et la file d'attente des signalements.
 *
 * Ce qu'il fait depuis le 17/10 : garder une RÉSERVE DES TUILES de
 * carte déjà affichées (voir src/tuiles.js pour le pourquoi et les
 * règles des fournisseurs). Une tuile est une image, pas une donnée :
 * une carte de la semaine dernière reste une carte. La réserve vit
 * dans son propre cache, `eventware-tuiles`, qui survit aux versions
 * de l'application — on ne jette pas 80 Mo de tuiles parce qu'un
 * bouton a changé de place.
 */

const VERSION = 'eventware-v5'
const TUILES = 'eventware-tuiles'
const ENTETE_DATE = 'x-eventware-date'
const AGE_MAX_TUILE_MS = 30 * 24 * 3600 * 1000
const MAX_TUILES = 6000
// Même liste que src/tuiles.js.
const HOTES_TUILES =
  /(^|\.)(tile\.openstreetmap\.org|cartoweb\.wmts\.ngi\.be|tile\.opentopomap\.org|basemaps\.cartocdn\.com|server\.arcgisonline\.com)$/
const COQUILLE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icone.svg'
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(COQUILLE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((noms) =>
        Promise.all(noms.filter((n) => n !== VERSION && n !== TUILES).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e

  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Les tuiles de carte : la réserve (voir plus bas).
  if (HOTES_TUILES.test(url.hostname)) {
    e.respondWith(repondreTuile(request))
    return
  }

  // Appels à Supabase et à toute API tierce : réseau uniquement.
  // Rien de tout cela ne doit être resservi depuis un cache.
  if (url.origin !== self.location.origin) return

  // Navigation : réseau d'abord, coquille en secours.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then((r) => r ?? caches.match('/'))
      )
    )
    return
  }

  // Ressources de l'application : cache d'abord, rafraîchi en arrière-plan.
  e.respondWith(
    caches.match(request).then((cachee) => {
      const reseau = fetch(request)
        .then((reponse) => {
          if (reponse && reponse.status === 200 && reponse.type === 'basic') {
            const copie = reponse.clone()
            caches.open(VERSION).then((c) => c.put(request, copie))
          }
          return reponse
        })
        .catch(() => cachee)
      return cachee ?? reseau
    })
  )
})

/* ------------------------------------------------------------------ */
/* La réserve des tuiles                                                */

function ageTuile(reponse) {
  const d = reponse.headers.get(ENTETE_DATE)
  return d ? Date.now() - new Date(d).getTime() : Infinity
}

// Une copie datée : l'en-tête de date est ce qui permet de servir la
// réserve sans réseau quel que soit son âge, et de la rafraîchir
// avec réseau passé trente jours.
async function dater(reponse) {
  const corps = await reponse.blob()
  const entetes = new Headers()
  for (const [k, v] of reponse.headers) entetes.set(k, v)
  entetes.set(ENTETE_DATE, new Date().toISOString())
  return new Response(corps, { status: 200, statusText: 'OK', headers: entetes })
}

let depuisElagage = 0

// Le cache garde l'ordre d'insertion (une tuile réécrite repasse en
// queue) : les premières clés sont les plus anciennes. On en retire
// par paquets de cinq cents, pas une à une.
async function elaguer(cache) {
  if (++depuisElagage < 50) return
  depuisElagage = 0
  const cles = await cache.keys()
  if (cles.length <= MAX_TUILES) return
  const trop = cles.length - MAX_TUILES + 500
  await Promise.all(cles.slice(0, trop).map((c) => cache.delete(c)))
}

async function repondreTuile(request) {
  const cache = await caches.open(TUILES)
  const cachee = await cache.match(request.url)
  if (cachee && ageTuile(cachee) < AGE_MAX_TUILE_MS) return cachee

  // Une image demandée par <img> arrive en mode no-cors : la réponse
  // serait « opaque », et Chrome compte chaque réponse opaque pour
  // plusieurs mégaoctets de quota. On la redemande en CORS — tous les
  // grands fournisseurs répondent — et on ne range que du lisible.
  try {
    const reponse = await fetch(new Request(request.url, { mode: 'cors', credentials: 'omit' }))
    if (reponse.ok && reponse.type !== 'opaque') {
      const copie = await dater(reponse.clone())
      cache.put(request.url, copie).then(() => elaguer(cache)).catch(() => {})
    }
    return reponse
  } catch {
    // Réseau tombé : la réserve, même vieille — ou, si le serveur
    // refuse le CORS, la requête telle quelle, sans mise en réserve.
    if (cachee) return cachee
    return fetch(request)
  }
}

/* Permet à la page de forcer l'activation d'une nouvelle version. */
self.addEventListener('message', (e) => {
  if (e.data === 'activer') self.skipWaiting()
})
