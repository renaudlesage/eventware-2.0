/**
 * « Enregistré ✓ » (11/11, audit M11).
 *
 * La plupart des écritures réussies ne se voyaient pas : l'écran se
 * rechargeait, identique à un écran où rien ne s'est passé. On tapait
 * deux fois, ou on doutait. Plutôt que d'ajouter une confirmation à
 * chacune des deux cents écritures, on regarde passer les réponses du
 * serveur et on ne signale que ce qui est SÛR :
 *
 * — un ajout accepté (POST sur une table, réponse 2xx : RLS refuse par
 *   une erreur, jamais en silence) ;
 * — une modification ou une suppression dont le serveur dit avoir
 *   touché au moins une ligne (en-tête Content-Range, présent quand on
 *   demande le compte — c'est le cas de `modifierOuRefuser`). Sans
 *   compte, on ne sait pas : on se tait ;
 * — jamais un appel de fonction (`rpc`) : on ne sait pas s'il écrit.
 *
 * Et seulement dans les secondes qui suivent un geste de la personne :
 * les écritures de fond (position, pointage automatique) ne font pas
 * clignoter le témoin.
 */
import { suivreLecture } from './chargement'

const SIGNAL = 'eventware:ecrit'
const FENETRE_GESTE_MS = 4000
let dernierGeste = 0

if (typeof window !== 'undefined') {
  const noter = () => { dernierGeste = Date.now() }
  window.addEventListener('pointerdown', noter, { capture: true, passive: true })
  window.addEventListener('keydown', noter, { capture: true, passive: true })
}

/** À appeler après une écriture réussie qui ne passe pas par une table (fonction serveur). */
export function signalerEcriture() {
  window.dispatchEvent(new Event(SIGNAL))
}

export function surEcriture(fn) {
  window.addEventListener(SIGNAL, fn)
  return () => window.removeEventListener(SIGNAL, fn)
}

function lignesTouchees(reponse) {
  // « 0-0/1 », « */3 », « */0 » : ce qui suit la barre est le compte.
  const cr = reponse.headers.get('content-range')
  const n = cr ? Number(cr.split('/')[1]) : NaN
  return Number.isFinite(n) ? n : null
}

/** Le `fetch` du client Supabase : identique, mais il regarde passer les écritures réussies. */
export async function fetchTemoin(entree, init) {
  // Les lectures en cours font dire « Chargement… » aux listes encore vides (voir chargement.js).
  const reponse = await suivreLecture(fetch(entree, init))
  try {
    const methode = (init?.method ?? entree?.method ?? 'GET').toUpperCase()
    const url = typeof entree === 'string' ? entree : entree?.url ?? String(entree)
    if (reponse.ok && methode !== 'GET' && methode !== 'HEAD' && /\/rest\/v1\/(?!rpc\/)/.test(url) && Date.now() - dernierGeste < FENETRE_GESTE_MS) {
      if (methode === 'POST') signalerEcriture()
      else if ((lignesTouchees(reponse) ?? 0) > 0) signalerEcriture()
    }
  } catch {
    /* le témoin ne doit jamais gêner une requête */
  }
  return reponse
}
