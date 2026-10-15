/**
 * Listes gardées dans le téléphone (localStorage) : files d'écritures
 * différées, de signalements, de pointages.
 *
 * Trois copies identiques de ce code vivaient dans fileEcritures.js,
 * fileSos.js et Pointage.jsx (audit du 19/09) ; une seule ici. La règle
 * qu'elles partageaient est celle-ci : le stockage peut manquer
 * (navigation privée, quota plein) ; on n'échoue jamais pour autant —
 * une lecture impossible rend une liste vide, une écriture impossible
 * laisse l'application continuer en mémoire.
 */

export function lireListe(clef) {
  try {
    const v = JSON.parse(localStorage.getItem(clef) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function ecrireListe(clef, liste) {
  try {
    localStorage.setItem(clef, JSON.stringify(liste))
    return true
  } catch {
    return false
  }
}
