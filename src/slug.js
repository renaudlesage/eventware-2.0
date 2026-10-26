/**
 * L'identifiant court d'un événement ou d'une organisation (26/10).
 *
 * C'est le nom, sans accent ni espace : « Fête du Vin » → fete-du-vin.
 * Quatre écrans le recalculaient chacun à leur façon ; une seule
 * définition, et une seule règle sur les doublons.
 *
 * Un événement supprimé garde son identifiant : la contrainte
 * d'unicité ne connaît pas `deleted_at`. « bfmf2027 » reste pris
 * après la suppression de BFMF2027. Plutôt que de refuser, on
 * suffixe (-2, -3…) jusqu'à trouver une adresse libre.
 */
export function slugDe(nom) {
  return (nom ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Les variantes à essayer, dans l'ordre : base, base-2, base-3… */
export function variantesSlug(base, n = 5) {
  return Array.from({ length: n }, (_, i) => (i === 0 ? base : `${base}-${i + 1}`))
}
