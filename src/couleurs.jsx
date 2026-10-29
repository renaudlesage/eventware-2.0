import { useEffect, useRef, useState } from 'react'

/**
 * (146) Les couleurs qu'on pose soi-même : groupes de travail, jalons.
 *
 * Douze teintes lisibles sur fond sombre comme sur fond clair, assez
 * éloignées des couleurs d'état (gris, bleu information, vert fait,
 * rouge retard) pour qu'un contour de statut reste visible dessus.
 *
 * (29/10, retour de Ren) La palette n'est plus une rangée de treize
 * pastilles étalée dans chaque fiche : une seule pastille, celle de la
 * couleur en place, et la grille s'ouvre dessous quand on la clique.
 * Échap, un clic ailleurs ou un choix la referment.
 */
export const PALETTE = [
  ['#2a9d8f', 'sarcelle'],
  ['#e9c46a', 'sable'],
  ['#f4a261', 'abricot'],
  ['#8d5a97', 'prune'],
  ['#4f86c6', 'bleuet'],
  ['#c9a227', 'ocre'],
  ['#6a994e', 'olive'],
  ['#bc6c25', 'cuivre'],
  ['#9b5de5', 'violet'],
  ['#00b4d8', 'turquoise'],
  ['#b5838d', 'vieux rose'],
  ['#7f8c8d', 'ardoise']
]

/** La couleur d'office d'un groupe d'après son rang, pour n'avoir rien à régler. */
export const couleurParDefaut = (rang) => PALETTE[Math.abs(Number(rang) || 0) % PALETTE.length][0]

/** Le nom d'une teinte de la palette, pour l'infobulle. */
export const nomCouleur = (c) => PALETTE.find(([k]) => k === c?.toLowerCase())?.[1] ?? c

/**
 * Une pastille : la couleur en place (en pointillé quand il n'y en a
 * pas), et au clic la grille des douze teintes plus « aucune ».
 */
export function Palette({ valeur, onChoisir, aucune = 'aucune', disabled = false, taille = 18, libelle = 'Couleur' }) {
  const [ouvert, setOuvert] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!ouvert) return
    const fermerSiDehors = (e) => { if (ref.current && !ref.current.contains(e.target)) setOuvert(false) }
    const touche = (e) => { if (e.key === 'Escape') setOuvert(false) }
    document.addEventListener('mousedown', fermerSiDehors)
    document.addEventListener('touchstart', fermerSiDehors)
    document.addEventListener('keydown', touche)
    return () => {
      document.removeEventListener('mousedown', fermerSiDehors)
      document.removeEventListener('touchstart', fermerSiDehors)
      document.removeEventListener('keydown', touche)
    }
  }, [ouvert])

  const choisir = (c) => { onChoisir(c); setOuvert(false) }
  const titre = valeur ? `${libelle} : ${nomCouleur(valeur)} — cliquer pour changer` : `${libelle} : ${aucune} — cliquer pour choisir`

  return (
    <span className="palette" ref={ref}>
      <button type="button" className={`palette-bouton ${valeur ? '' : 'vide'} ${ouvert ? 'ouvert' : ''}`} disabled={disabled}
        style={{ width: taille, height: taille, background: valeur || undefined }}
        title={titre} aria-label={titre} aria-haspopup="true" aria-expanded={ouvert}
        onClick={() => setOuvert((v) => !v)} />
      {ouvert && (
        <span className="palette-menu" role="radiogroup" aria-label={libelle}>
          {PALETTE.map(([c, nom]) => {
            const actif = valeur?.toLowerCase() === c
            return (
              <button key={c} type="button" role="radio" aria-checked={actif} className={`palette-case ${actif ? 'actif' : ''}`} title={nom} aria-label={nom}
                style={{ background: c }} onClick={() => choisir(c)}>{actif ? '✓' : ''}</button>
            )
          })}
          <button type="button" role="radio" aria-checked={!valeur} className={`palette-aucune ${!valeur ? 'actif' : ''}`} onClick={() => choisir(null)}>
            {aucune}
          </button>
        </span>
      )}
    </span>
  )
}
