/**
 * Ce qu'on affiche quand ça casse.
 *
 * Une erreur technique brute — « Failed to fetch », « TypeError » —
 * ne dit rien à qui la lit, et surtout elle dit la mauvaise chose :
 * quelqu'un qui perd le réseau sous les arbres croit que
 * l'application est cassée, ferme tout, et va chercher du réseau au
 * lieu de continuer son poste.
 *
 * Trois familles méritent une traduction, parce qu'elles appellent
 * trois réactions différentes :
 *
 *   réseau  — attendre, ça repartira tout seul
 *   droits  — inutile d'insister, il faut demander à quelqu'un
 *   session — se reconnecter
 *
 * Tout le reste passe tel quel. Traduire une erreur qu'on ne
 * comprend pas la rendrait seulement plus difficile à diagnostiquer,
 * et un message rassurant sur une panne réelle est pire qu'un
 * message obscur.
 */

const RESEAU = [
  'failed to fetch',
  'networkerror',
  'network request failed',
  'load failed',
  'timeout',
  'aborted',
  'err_internet_disconnected'
]

const DROITS = [
  'row-level security',
  'permission denied',
  'violates row-level',
  'insufficient privilege',
  'droits insuffisants'
]

// Motifs étroits à dessein : « session » seul attrapait le nom de la
// table `controles_sessions` dans un refus RLS et annonçait « session
// expirée » à quelqu'un qui manquait simplement de droits.
const SESSION = ['jwt', 'invalid claim', 'auth session', 'session expired', 'refresh_token', 'not authenticated']

function contient(texte, liste) {
  return liste.some((m) => texte.includes(m))
}

/**
 * @param {Error|{message?: string, name?: string}} e
 * @returns {string} le message à montrer
 */
export function texteErreur(e) {
  if (!e) return 'Une erreur est survenue.'
  const brut = `${e.name ?? ''} ${e.message ?? ''}`.toLowerCase()

  if (contient(brut, RESEAU)) {
    return 'Réseau indisponible — rien n’est perdu, réessayez quand le signal revient.'
  }
  // Les droits avant la session : un refus RLS cite le nom d'une table,
  // qui peut contenir n'importe quel mot.
  if (contient(brut, DROITS)) {
    return 'Action refusée : vos droits ne le permettent pas dans cette phase.'
  }
  if (contient(brut, SESSION)) {
    return 'Session expirée — reconnectez-vous.'
  }
  return e.message || 'Une erreur est survenue.'
}

/** Vrai si l'erreur vient du réseau — pour décider d'une mise en file. */
export function estReseau(e) {
  if (!e) return false
  return contient(`${e.name ?? ''} ${e.message ?? ''}`.toLowerCase(), RESEAU)
}
