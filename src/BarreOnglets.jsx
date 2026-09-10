import { useState } from 'react'
import { MoreHorizontal, X } from 'lucide-react'
import { Icone, DOMAINES } from './icones'

/**
 * Barre d'onglets du bas — navigation mobile.
 *
 * Sur téléphone, la navigation par plaques ne tient pas : onze entrées
 * qui se replient sur quatre lignes mangent le tiers de l'écran avant
 * qu'une seule donnée ne s'affiche. La barre du bas fixe trois entrées
 * au pouce et renvoie le reste dans un tiroir.
 *
 * Le choix des trois n'est pas « les trois premières » : ce sont celles
 * dont on a besoin en intervention. Mon poste d'abord — c'est la page
 * de qui est sur le terrain. Sécurité ensuite pour qui doit traiter les
 * signalements, Mémento à sa place pour qui ne les traite pas : un
 * bénévole n'a pas d'écran Sécurité, mais il a besoin des fiches
 * réflexe. Planning enfin, parce qu'on le consulte debout, entre deux
 * postes.
 *
 * Situation, Logistique, Bénévoles et les écrans d'administration
 * passent par « Plus » : ce sont des écrans de PC, tenus assis devant
 * un grand écran, pas des écrans de terrain.
 */
export default function BarreOnglets({ ecrans, ecran, onAller }) {
  const [ouvert, setOuvert] = useState(false)

  const dispo = (clef) => ecrans.some((e) => e.clef === clef)
  const clefsBarre = ['accueil', dispo('securite') ? 'securite' : 'memento', 'planning']

  const barre = clefsBarre.filter(dispo).map((clef) => ecrans.find((e) => e.clef === clef))
  const autres = ecrans.filter((e) => !clefsBarre.includes(e.clef))

  // Un écran ouvert depuis le tiroir doit rester signalé quelque part :
  // sans ça, la barre n'affiche aucun onglet actif et l'on ne sait plus
  // où l'on est.
  const dansAutres = autres.some((e) => e.clef === ecran)

  function aller(clef) {
    setOuvert(false)
    onAller(clef)
  }

  return (
    <>
      <nav className="barre-onglets" aria-label="Navigation">
        {barre.map((e) => (
          <button
            key={e.clef}
            className={`onglet-bas ${ecran === e.clef ? 'actif' : ''}`}
            aria-current={ecran === e.clef ? 'page' : undefined}
            onClick={() => aller(e.clef)}
          >
            <Icone domaine={e.clef} taille={20} />
            <span>{e.libelle}</span>
          </button>
        ))}

        {autres.length > 0 && (
          <button
            className={`onglet-bas ${dansAutres ? 'actif' : ''}`}
            aria-expanded={ouvert}
            onClick={() => setOuvert(true)}
          >
            <MoreHorizontal size={20} strokeWidth={2} aria-hidden="true" />
            <span>Plus</span>
          </button>
        )}
      </nav>

      {ouvert && (
        <div className="voile" onClick={() => setOuvert(false)}>
          <div className="tiroir tiroir-plus" onClick={(e) => e.stopPropagation()}>
            <div className="tiroir-tete">
              <strong>Autres écrans</strong>
              <button className="lien" onClick={() => setOuvert(false)} aria-label="Fermer">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <div className="liste-ecrans">
              {autres.map((e) => (
                <button
                  key={e.clef}
                  className={`plaque-nav dom-${DOMAINES[e.clef]?.teinte ?? 'gris'} ${
                    ecran === e.clef ? 'actif' : ''
                  }`}
                  onClick={() => aller(e.clef)}
                >
                  <Icone domaine={e.clef} />
                  <span>{e.libelle}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
