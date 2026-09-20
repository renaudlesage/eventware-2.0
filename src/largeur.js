import { useEffect, useState } from 'react'

/**
 * Le palier de largeur du poste de travail.
 *
 * La feuille de style sait déjà placer les colonnes (media queries) ;
 * ce que le code doit savoir, c'est QUOI monter dans chaque colonne :
 * une colonne de veille n'a pas à charger son journal sur un portable
 * de 13 pouces, ni le mur de situation ses tableaux sur un 16 pouces.
 * Les seuils sont ceux de la refonte du 20/09 : 940 (rail vertical),
 * 1440 (colonne de veille), 2200 (mur). Un seul endroit les connaît.
 */
export const SEUILS = {
  rail: 940,
  veille: 1440,
  mur: 2200
}

function palierDe(largeur) {
  if (largeur >= SEUILS.mur) return 'mur'
  if (largeur >= SEUILS.veille) return 'veille'
  if (largeur >= SEUILS.rail) return 'simple'
  return 'mobile'
}

export function usePalier() {
  const [palier, setPalier] = useState(() => palierDe(window.innerWidth))

  useEffect(() => {
    // matchMedia plutôt que resize : on n'est prévenu qu'au franchissement
    // d'un seuil, pas à chaque pixel d'un redimensionnement.
    const requetes = Object.values(SEUILS).map((s) => window.matchMedia(`(min-width: ${s}px)`))
    const recalculer = () => setPalier(palierDe(window.innerWidth))
    requetes.forEach((q) => q.addEventListener('change', recalculer))
    return () => requetes.forEach((q) => q.removeEventListener('change', recalculer))
  }, [])

  return palier
}
