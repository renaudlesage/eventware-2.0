/**
 * Fond de carte hors ligne (17/10, scénario du fond de vallée).
 *
 * La saisie marchait sans réseau depuis la 007 ; la carte, non : une
 * tuile OpenStreetMap exige du réseau, et la carte tactique devenait
 * un damier gris exactement là où on en a besoin — sous les arbres,
 * avec une barre de signal.
 *
 * Deux mécanismes, et pas plus, parce que ce sont les deux que les
 * fournisseurs de tuiles admettent :
 *
 *   1. LA RÉSERVE DES TUILES VUES. Le service worker (public/sw.js)
 *      garde une copie de chaque tuile affichée, dans un cache à part
 *      (`eventware-tuiles`), trente jours, six mille tuiles au plus.
 *      C'est ce que fait déjà le cache HTTP du navigateur — en moins
 *      fiable, puisqu'il l'évince sans prévenir. Tous les fournisseurs
 *      l'admettent : la politique d'OpenStreetMap parle de « cache du
 *      navigateur » comme d'un usage normal, et les autres ne disent
 *      rien de plus restrictif.
 *
 *   2. LA PRÉPARATION D'UNE ZONE. Télécharger d'avance les tuiles
 *      d'une emprise, à plusieurs zooms, pour une sortie qu'on sait
 *      sans réseau. OpenStreetMap l'INTERDIT explicitement (« bulk
 *      downloading »), OpenTopoMap et CARTO aussi, Esri le réserve à
 *      ses propres SDK. Seule la carte IGN belge (CartoWeb.be, données
 *      ouvertes) le permet : c'est donc le seul fond où le bouton
 *      existe. Si l'IGN change d'avis, c'est une ligne de FONDS_CARTE
 *      à changer (`reserve: 'vues'`).
 *
 * Ce que ça ne fait pas : servir une tuile en cache alors que le
 * réseau marche et qu'elle a plus de trente jours (la carte vit), ni
 * mettre en cache une réponse « opaque » (sans CORS) — Chrome compte
 * chacune pour plusieurs mégaoctets de quota, et le quota sauterait
 * en une sortie. Un fournisseur sans CORS reste affiché, mais ne va
 * pas dans la réserve.
 *
 * Les tuiles sont des images : elles ne changent pas la règle du
 * service worker sur les données (jamais de réponse Supabase en
 * cache). Une carte périmée reste une carte ; une situation périmée
 * est un mensonge.
 */

/** Même nom que dans public/sw.js — le worker y lit, la page y écrit. */
export const CACHE_TUILES = 'eventware-tuiles'
/** En-tête posé sur chaque tuile mise en réserve : sa date. */
export const ENTETE_DATE = 'x-eventware-date'
/** Au-delà, on refuse de préparer : zoomer sur une zone plus petite. */
export const MAX_TUILES_ZONE = 3000
export const ZOOM_MIN_ZONE = 12

/** Les hôtes de tuiles connus — le worker porte la même liste. */
export const HOTES_TUILES =
  /(^|\.)(tile\.openstreetmap\.org|cartoweb\.wmts\.ngi\.be|tile\.opentopomap\.org|basemaps\.cartocdn\.com|server\.arcgisonline\.com)$/

/**
 * Ce que Leaflet affiche à la place d'une tuile qu'il n'a pas pu
 * charger : hors réseau, « pas en réserve » vaut mieux qu'un carré
 * gris muet — on sait pourquoi la carte est vide et quoi faire.
 */
export const TUILE_MANQUANTE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">' +
      '<rect width="256" height="256" fill="#e9ebee"/>' +
      '<path d="M0 0h256v256" fill="none" stroke="#d6d9de"/>' +
      '<text x="128" y="124" font-family="system-ui,sans-serif" font-size="13" fill="#8a9099" text-anchor="middle">pas en réserve</text>' +
      '<text x="128" y="142" font-family="system-ui,sans-serif" font-size="11" fill="#aab0b8" text-anchor="middle">hors réseau</text>' +
      '</svg>'
  )

/* ------------------------------------------------------------------ */
/* Arithmétique des tuiles (Web Mercator, XYZ)                          */

function versTuile(lat, lon, z) {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const phi = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n)
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) }
}

/**
 * Les tuiles {z, x, y} qui couvrent une emprise Leaflet entre deux
 * zooms. L'ordre va du zoom le plus grossier au plus fin : si on
 * interrompt la préparation à mi-chemin, on a au moins une carte
 * grossière complète plutôt qu'un coin détaillé.
 */
export function tuilesDeZone(bornes, zMin, zMax) {
  const sortie = []
  const so = bornes.getSouthWest()
  const ne = bornes.getNorthEast()
  for (let z = zMin; z <= zMax; z++) {
    const a = versTuile(ne.lat, so.lng, z)
    const b = versTuile(so.lat, ne.lng, z)
    for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) sortie.push({ z, x, y })
  }
  return sortie
}

/** Le gabarit d'URL d'une couche, rempli. `{s}` prend le premier sous-domaine, `{r}` rien. */
export function urlTuile(gabarit, { z, x, y }) {
  return gabarit
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y)
    .replace('{s}', 'a')
    .replace('{r}', '')
}

/* ------------------------------------------------------------------ */
/* La réserve                                                           */

function disponible() {
  return typeof caches !== 'undefined'
}

/** Une réponse datée, prête à être rangée : le worker fait pareil. */
async function dater(reponse) {
  const corps = await reponse.blob()
  const entetes = new Headers()
  for (const [k, v] of reponse.headers) entetes.set(k, v)
  entetes.set(ENTETE_DATE, new Date().toISOString())
  return new Response(corps, { status: 200, statusText: 'OK', headers: entetes })
}

/**
 * Prépare une zone : télécharge et range les tuiles de `couches`
 * (les couches d'un fond) sur `tuiles`. `onProgres(fait, total)` à
 * chaque tuile ; `signal` pour interrompre. Les tuiles déjà en
 * réserve ne sont pas retéléchargées. Retourne { faites, echecs,
 * sansCors } — `sansCors` vrai si le fournisseur ne répond pas en
 * CORS, auquel cas rien n'est mis en réserve (voir en tête).
 */
export async function preparerZone(couches, tuiles, { signal, onProgres } = {}) {
  if (!disponible()) return { faites: 0, echecs: tuiles.length, sansCors: false, indisponible: true }
  const cache = await caches.open(CACHE_TUILES)
  const urls = []
  for (const c of couches) for (const t of tuiles) if (t.z <= (c.natif ?? 99)) urls.push(urlTuile(c.url, t))
  let faites = 0
  let echecs = 0
  let sansCors = false
  // Quatre à la fois : assez pour ne pas attendre, pas assez pour
  // ressembler à un aspirateur de tuiles.
  let i = 0
  async function ouvrier() {
    while (i < urls.length && !signal?.aborted && !sansCors) {
      const url = urls[i++]
      try {
        if (!(await cache.match(url))) {
          const r = await fetch(url, { mode: 'cors', credentials: 'omit', signal })
          if (r.ok && r.type !== 'opaque') await cache.put(url, await dater(r))
          else echecs++
        }
        faites++
      } catch (e) {
        if (signal?.aborted) return
        // TypeError sans réseau coupé : le serveur refuse le CORS.
        if (e instanceof TypeError && navigator.onLine && faites === 0 && echecs === 0) sansCors = true
        echecs++
      }
      onProgres?.(faites + echecs, urls.length)
    }
  }
  await Promise.all([ouvrier(), ouvrier(), ouvrier(), ouvrier()])
  return { faites, echecs, sansCors, total: urls.length }
}

/**
 * Ce qu'il y a dans la réserve : le nombre de tuiles, et par hôte.
 * Pas le poids — le lire obligerait à ouvrir chaque réponse ; on
 * l'estime à 20 ko la tuile, ce qui est l'ordre de grandeur partout.
 */
export async function etatReserve() {
  if (!disponible()) return { total: 0, parHote: {}, indisponible: true }
  try {
    const cache = await caches.open(CACHE_TUILES)
    const cles = await cache.keys()
    const parHote = {}
    for (const r of cles) {
      const h = new URL(r.url).hostname
      parHote[h] = (parHote[h] ?? 0) + 1
    }
    return { total: cles.length, parHote }
  } catch {
    return { total: 0, parHote: {}, indisponible: true }
  }
}

/** Les tuiles en réserve pour un fond (ses hôtes). */
export function tuilesDuFond(etat, couches) {
  let n = 0
  for (const c of couches) {
    const h = new URL(urlTuile(c.url, { z: 0, x: 0, y: 0 })).hostname
    for (const [hote, k] of Object.entries(etat.parHote ?? {})) if (hote.endsWith(h.replace(/^a\./, ''))) n += k
  }
  return n
}

export async function viderReserve() {
  if (!disponible()) return false
  try {
    return await caches.delete(CACHE_TUILES)
  } catch {
    return false
  }
}

/** « 1 240 tuiles · ≈ 25 Mo » */
export function libelleReserve(n) {
  const mo = (n * 20) / 1024
  return `${n.toLocaleString('fr-BE')} tuile${n > 1 ? 's' : ''} · ≈ ${mo < 1 ? '< 1' : Math.round(mo)} Mo`
}
