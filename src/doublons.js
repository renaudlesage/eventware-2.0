/**
 * Détection de doublons à la saisie — REX BFMF 2026, point 9 :
 * trois remontées séparées pour les bouchons d'oreille, par trois
 * personnes différentes, jamais rapprochées ; deux missions
 * identiques pour le même seau de jetons à 21 minutes d'intervalle.
 *
 * Similarité de texte simple et transparente — comparaison des mots
 * partagés entre deux textes, pas un modèle de langage. L'idée n'est
 * pas de détecter tous les doublons possibles, c'est d'attraper les
 * cas grossiers (même titre, même zone, à quelques minutes d'écart)
 * qui coûtent cher : deux personnes qui envoient quelqu'un au même
 * endroit pour la même chose.
 */

const MOTS_VIDES = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'à', 'au', 'aux',
  'pour', 'sur', 'dans', 'avec', 'sans', 'plus', 'pas', 'il', 'y', 'a', 'en', 'ce',
  'ne', 'que', 'qui', 'se'
])

function normaliser(texte) {
  return (texte ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((mot) => mot.length > 0 && !MOTS_VIDES.has(mot))
    // Un token court contenant un chiffre porte souvent un numéro de
    // lieu ou d'étape (« 2 », « e1 », « p0 ») — jamais filtré pour sa
    // longueur, lui : c'est justement ce qui distingue deux lieux
    // différents, testé et confirmé avant d'écrire cette exception.
    .filter((mot) => /[0-9]/.test(mot) || mot.length > 2)
    // Racinisation grossière sur le reste : retire un « s » final
    // (pluriel courant) et tronque à six caractères — imparfait, mais
    // rapproche « bouchons » de « bouchon », « oreilles » de « oreille ».
    .map((mot) => (/[0-9]/.test(mot) ? mot : mot.replace(/s$/, '').slice(0, 6)))
}

/** Similarité par mots partagés (Jaccard) — entre 0 et 1. */
export function similariteTexte(a, b) {
  const motsA = new Set(normaliser(a))
  const motsB = new Set(normaliser(b))
  if (motsA.size === 0 || motsB.size === 0) return 0
  let communs = 0
  for (const mot of motsA) if (motsB.has(mot)) communs++
  const union = motsA.size + motsB.size - communs
  return union === 0 ? 0 : communs / union
}

/**
 * Cherche, parmi une liste de candidats déjà en base, ceux qui
 * ressemblent au nouveau texte — même zone si elle est précisée,
 * dans la fenêtre de temps donnée, au-delà du seuil de similarité.
 *
 * @param candidats - chaque élément doit porter {id, texte, lieu_id, cree_le, auteur}
 */
export function detecterDoublons({
  texte,
  lieuId,
  candidats,
  fenetreMinutes = 120,
  seuil = 0.5
}) {
  const limite = Date.now() - fenetreMinutes * 60000
  return candidats
    .filter((c) => new Date(c.cree_le).getTime() >= limite)
    .filter((c) => !lieuId || !c.lieu_id || c.lieu_id === lieuId)
    .map((c) => ({ ...c, similarite: similariteTexte(texte, c.texte) }))
    .filter((c) => c.similarite >= seuil)
    .sort((a, b) => b.similarite - a.similarite)
}
