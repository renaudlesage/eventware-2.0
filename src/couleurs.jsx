/**
 * (146) Les couleurs qu'on pose soi-même : groupes de travail, jalons.
 *
 * Douze teintes lisibles sur fond sombre comme sur fond clair, assez
 * éloignées des couleurs d'état (gris, bleu information, vert fait,
 * rouge retard) pour qu'un contour de statut reste visible dessus.
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

/** Une pastille de choix : la palette, et « aucune » pour revenir au neutre. */
export function Palette({ valeur, onChoisir, aucune = 'aucune', disabled = false, taille = 18 }) {
  return (
    <span className="palette" role="radiogroup">
      <button type="button" className={`palette-case palette-aucune ${!valeur ? 'actif' : ''}`} disabled={disabled} title={aucune} aria-label={aucune}
        onClick={() => onChoisir(null)} style={{ width: taille, height: taille }}>×</button>
      {PALETTE.map(([c, nom]) => (
        <button key={c} type="button" className={`palette-case ${valeur?.toLowerCase() === c ? 'actif' : ''}`} disabled={disabled} title={nom} aria-label={nom}
          onClick={() => onChoisir(c)} style={{ background: c, width: taille, height: taille }} />
      ))}
    </span>
  )
}
