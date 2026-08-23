/**
 * Cache local du mémento d'urgence.
 *
 * Trois choses qu'on cherche quand ça se passe mal : la conduite à
 * tenir, où couper, qui appeler. Aucune des trois ne peut dépendre du
 * réseau — le moment où on les consulte est précisément celui où on
 * est dehors, sous les arbres, avec une barre de signal.
 *
 * Le cache est rafraîchi à chaque chargement réussi et sert de repli
 * sinon. L'âge des données est TOUJOURS affiché : un mémento périmé
 * qui se présente comme à jour est plus dangereux qu'un mémento absent.
 */

const CLEF = (evenementId) => `eventware.memento.${evenementId}`

export function lireCache(evenementId) {
  try {
    const brut = localStorage.getItem(CLEF(evenementId))
    return brut ? JSON.parse(brut) : null
  } catch {
    return null
  }
}

export function ecrireCache(evenementId, donnees) {
  try {
    localStorage.setItem(
      CLEF(evenementId),
      JSON.stringify({ ...donnees, enregistre_le: new Date().toISOString() })
    )
  } catch {
    /* stockage plein ou navigation privée : on continue sans cache */
  }
}

export function ageCache(cache) {
  if (!cache?.enregistre_le) return null
  const minutes = Math.round((Date.now() - new Date(cache.enregistre_le)) / 60000)
  if (minutes < 60) return `${minutes} min`
  const heures = Math.round(minutes / 60)
  if (heures < 48) return `${heures} h`
  return `${Math.round(heures / 24)} j`
}
