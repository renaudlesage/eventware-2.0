/**
 * Les calques du plan d'implantation (21/10).
 *
 * Huit calques, une couleur chacun, et un filtre d'affichage à cocher :
 * c'est ce que la carte de conception montrait depuis la 117, et ce
 * que Ren a demandé pour TOUTES les cartes (« comme celle de
 * conception : tous les objets et menus cochables »). La carte du
 * plan, la carte tactique et la carte de l'autorité dessinaient
 * chacune le plan à leur façon — ronds gris, secours seuls, rien.
 *
 * Ce module ne tire pas Leaflet : la page autorité (SVG) l'importe
 * aussi. Les couches Leaflet sont dans couchesPlan.jsx.
 */
import { useState } from 'react'

export const CALQUES = [
  ['infrastructures', 'Infrastructures', '#7a4fb0'],
  ['restauration', 'Restauration', '#c25a12'],
  ['energie', 'Énergie', '#8a6212'],
  ['eau', 'Eau', '#1f6ba8'],
  ['sanitaires', 'Sanitaires', '#17796f'],
  ['logistique', 'Logistique', '#5d6874'],
  ['securite', 'Sécurité', '#a8324a'],
  ['circulation', 'Circulation', '#3f7a2e']
]
export const COULEUR_CALQUE = Object.fromEntries(CALQUES.map(([k, , c]) => [k, c]))
export const LIBELLE_CALQUE = Object.fromEntries(CALQUES.map(([k, l]) => [k, l]))

/** Le calque d'un objet : le sien, sinon sécurité pour un picto, infrastructures pour le reste. */
export const calqueDe = (o) => o.calque ?? (o.nature === 'picto' ? 'securite' : 'infrastructures')

/** [visibles (Set), basculer(k)] — tous visibles au départ. */
export function useCalques() {
  const [visibles, setVisibles] = useState(() => new Set(CALQUES.map(([k]) => k)))
  function basculer(k) {
    setVisibles((s) => {
      const n = new Set(s)
      n.has(k) ? n.delete(k) : n.add(k)
      return n
    })
  }
  return [visibles, basculer]
}

/** La rangée de cases à cocher, un calque par case, avec le nombre d'objets. */
export function FiltreCalques({ objets = [], visibles, onBasculer, enfants }) {
  return (
    <div className="impl-calques calques-carte">
      {CALQUES.map(([k, l, c]) => (
        <label key={k} className={`impl-calque ${visibles.has(k) ? '' : 'masque'}`} style={{ '--c': c }}>
          <input type="checkbox" checked={visibles.has(k)} onChange={() => onBasculer(k)} />
          <span className="impl-pastille" />
          {l}
          <span className="mono">{objets.filter((o) => calqueDe(o) === k).length}</span>
        </label>
      ))}
      {enfants}
    </div>
  )
}
