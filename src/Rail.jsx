import { useState } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { Icone, DOMAINES, FAMILLES, SEUIL_GROUPEMENT } from './icones'

/**
 * Le rail de navigation (refonte du 20/09).
 *
 * Trois états, une seule liste d'écrans — celle que `Poste` a déjà
 * filtrée par module et par capacité, la barre du bas et le rail
 * n'ouvrant jamais rien de plus que ce à quoi la personne a droit.
 *
 *   MOBILE (< 940 px) — les plaques d'avant, à plat, avec leur libellé :
 *   sous 700 px elles cèdent la place à la barre du bas (mobile.css),
 *   entre 700 et 940 elles s'enroulent en ligne. Le groupement n'a pas
 *   de sens à l'horizontale.
 *
 *   COMPACT (≥ 940 px) — 56 px, icônes seules, les domaines rangés en
 *   quatre familles séparées d'un filet. Au survol, ou quand le clavier
 *   y entre, un panneau de 200 px se déplie à droite avec les mêmes
 *   blocs, nommés. Chaque domaine y garde sa hauteur et sa teinte :
 *   rien ne change de place entre les deux états.
 *
 *   ÉPINGLÉ — le panneau déplié devient le rail lui-même, 200 px, dans
 *   le flux. C'est un réglage de la personne, rangé avec le thème.
 *
 * Deux règles de rendu : une famille sans module visible disparaît,
 * filet compris ; sous SEUIL_GROUPEMENT modules visibles au total, le
 * groupement saute et le rail redevient une pile sans filet.
 */
export default function Rail({ visibles, ecran, onAller, palier, epingle, setEpingle }) {
  const [survol, setSurvol] = useState(false)
  const [focus, setFocus] = useState(false)

  const parClef = Object.fromEntries(visibles.map((e) => [e.clef, e]))

  if (palier === 'mobile') {
    return (
      <nav className="plaques" aria-label="Modules">
        {visibles.map((e) => (
          <PlaqueNav key={e.clef} ecran={e} actif={ecran === e.clef} onAller={onAller} />
        ))}
      </nav>
    )
  }

  const gardees = FAMILLES.map(([titre, cles]) => [
    titre,
    cles.filter((c) => parClef[c])
  ]).filter(([, cles]) => cles.length > 0)
  // Un écran absent des familles (un futur module) n'est pas perdu : il
  // rejoint la dernière famille plutôt que de disparaître du rail.
  const ranges = new Set(gardees.flatMap(([, cles]) => cles))
  const orphelins = visibles.map((e) => e.clef).filter((c) => !ranges.has(c))
  if (orphelins.length && gardees.length) gardees[gardees.length - 1][1].push(...orphelins)
  const total = gardees.reduce((n, [, cles]) => n + cles.length, 0)
  const grouper = total >= SEUIL_GROUPEMENT
  const groupes = grouper ? gardees : [['', gardees.flatMap(([, cles]) => cles)]]

  const boutonEpingle = (
    <button
      className="rail-epingle"
      aria-pressed={epingle}
      aria-label={epingle ? 'Replier le menu' : 'Garder le menu déplié'}
      title={epingle ? 'Replier le menu' : 'Garder le menu déplié'}
      onClick={() => setEpingle(!epingle)}
    >
      {epingle ? <PinOff size={15} strokeWidth={1.75} aria-hidden="true" /> : <Pin size={15} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  )

  if (epingle) {
    return (
      <nav className="plaques rail-groupe" aria-label="Modules">
        {groupes.map(([titre, cles]) => (
          <div
            className="rail-famille"
            role={titre ? 'group' : undefined}
            aria-label={titre || undefined}
            key={titre || 'plat'}
          >
            {titre && <h2 className="famille-titre">{titre}</h2>}
            {cles.map((c) => (
              <PlaqueNav key={c} ecran={parClef[c]} actif={ecran === c} onAller={onAller} />
            ))}
          </div>
        ))}
        {boutonEpingle}
      </nav>
    )
  }

  const deploye = survol || focus

  return (
    <nav
      className={`plaques rail-compact ${deploye ? 'deploye' : ''}`}
      aria-label="Modules"
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocus(false)
      }}
    >
      {groupes.map(([titre, cles]) => (
        <div
          className="rail-famille"
          role={titre ? 'group' : undefined}
          aria-label={titre || undefined}
          key={titre || 'plat'}
        >
          {cles.map((c) => (
            <PlaqueNav key={c} ecran={parClef[c]} actif={ecran === c} onAller={onAller} compact />
          ))}
        </div>
      ))}
      {boutonEpingle}

      {/* Le panneau déplié : mêmes blocs, cette fois nommés. Il est
          décoratif pour les lecteurs d'écran — chaque icône porte déjà
          son libellé — et sort du flux pour ne rien décaler. */}
      {deploye && (
        <div className="rail-deploye" aria-hidden="true">
          <span className="survol-note">Modules</span>
          {groupes.map(([titre, cles]) => (
            <div key={titre || 'plat'}>
              {titre && <h2 className="famille-titre">{titre}</h2>}
              {cles.map((c) => (
                <PlaqueNav key={c} ecran={parClef[c]} actif={ecran === c} onAller={onAller} tabIndex={-1} />
              ))}
            </div>
          ))}
        </div>
      )}
    </nav>
  )
}

function PlaqueNav({ ecran, actif, onAller, compact = false, tabIndex }) {
  const teinte = DOMAINES[ecran.clef]?.teinte ?? 'gris'
  return (
    <button
      className={`plaque-nav dom-${teinte} ${actif ? 'actif' : ''}`}
      onClick={() => onAller(ecran.clef)}
      aria-current={actif ? 'page' : undefined}
      aria-label={compact ? ecran.libelle : undefined}
      title={compact ? ecran.libelle : undefined}
      tabIndex={tabIndex}
    >
      <Icone domaine={ecran.clef} />
      {!compact && <span>{ecran.libelle}</span>}
    </button>
  )
}
