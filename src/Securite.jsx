import { useEffect, useState } from 'react'
import Sitrep from './Sitrep'
import Maydays from './Maydays'
import Meteo from './Meteo'
import PcOps from './PcOps'
import { Effectifs } from './PlanImplantation'
import { Journal } from './Journal'
import { Missions } from './Missions'
import Recherches from './Recherches'
import Fiches from './FichesReflexe'

/*
 * Deux familles distinctes, pas huit onglets à plat :
 *   OPÉRATIONNEL — ce qui se passe maintenant : signalements, Mayday,
 *   main courante, demandes, recherches, effectifs présents et moyens
 *   de secours, plus les suggestions d'alerte de la veille météo,
 *   poussables d'ici sans repasser par la Situation.
 *   DOCUMENTS — ce qu'on consulte ou qu'on produit : fiches réflexe,
 *   rapport de situation.
 *
 * « Signalements » vivait comme écran séparé — regroupé ici parce que
 * c'est le même métier que la main courante et les demandes : réagir à
 * ce qui se passe, pas s'y préparer.
 *
 * La conformité et le dossier de sécurité ont quitté cet écran pour
 * Réglages › Conformité (campagne du 20/09, 3d-13) : ce sont des actes
 * de la coordination, à froid, et cet écran s'ouvre désormais à tout
 * membre. Les effectifs, eux, arrivent du Plan d'implantation (3c-03) :
 * combien de personnes sont attendues et quels moyens de secours sont
 * dénombrés, c'est une question qu'on se pose au PC, pas devant un plan.
 */
function groupesPour(modules) {
  return {
    operationnel: {
      libelle: 'Opérationnel',
      onglets: [
        ...(modules?.sos_participants ? [['signalements', 'Signalements']] : []),
        ['mayday', 'Mayday'],
        ['journal', 'Main courante'],
        ['missions', 'Demandes'],
        ['recherches', 'Recherches'],
        ['effectifs', 'Effectifs']
      ]
    },
    documents: {
      libelle: 'Documents',
      onglets: [
        ['fiches', 'Fiches réflexe'],
        ['sitrep', 'Rapport']
      ]
    }
  }
}

export default function Securite({ evenement, membre, session, peut, toutPouvoir, ongletCible }) {
  const GROUPES = groupesPour(evenement.modules)
  const [onglet, setOnglet] = useState(
    evenement.modules?.sos_participants ? 'signalements' : 'journal'
  )
  const [message, setMessage] = useState(null)
  // Le groupe se déduit de la rubrique : la veille météo compacte ne
  // s'affiche que sur l'opérationnel.
  const groupe = Object.keys(GROUPES).find((g) => GROUPES[g].onglets.some(([k]) => k === onglet)) ?? 'operationnel'

  // Navigation ciblée depuis un autre écran — ex. le pavé « Signalements
  // ouverts » du tableau de bord — ouvre directement la bonne rubrique.
  useEffect(() => {
    if (!ongletCible) return
    if (Object.values(GROUPES).some(({ onglets }) => onglets.some(([k]) => k === ongletCible))) setOnglet(ongletCible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ongletCible])

  return (
    <div className="bloc securite dom-grenat">
      <h2>Sécurité</h2>

      {/* (31/10, retour de Ren) Une liste déroulante au lieu de deux
          rangées de boutons (Opérationnel / Documents, puis les onglets),
          comme la Logistique. Pas de mémoire de la rubrique ici : Sécurité
          s'ouvre toujours sur ce qui se passe (signalements, sinon main
          courante). */}
      <label className="rubrique-logistique rubrique-securite">
        Rubrique
        <select value={onglet} onChange={(e) => { setOnglet(e.target.value); setMessage(null) }} aria-label="Rubrique de la sécurité">
          {Object.entries(GROUPES).map(([g, { libelle, onglets }]) => (
            <optgroup key={g} label={libelle}>
              {onglets.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </optgroup>
          ))}
        </select>
      </label>

      {groupe === 'operationnel' && (
        <Meteo
          evenement={evenement}
          peut={peut}
          toutPouvoir={toutPouvoir}
          compact
          autoJournal={false}
        />
      )}

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {onglet === 'signalements' && <PcOps evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} />}
      {onglet === 'mayday' && (
        <Maydays evenement={evenement} setMessage={setMessage} />
      )}
      {onglet === 'journal' && (
        <Journal
          evenement={evenement}
          peut={peut}
          toutPouvoir={toutPouvoir}
          setMessage={setMessage}
        />
      )}
      {onglet === 'missions' && (
        <Missions
          key="securite"
          evenement={evenement}
          membre={membre}
          peut={peut}
          toutPouvoir={toutPouvoir}
          setMessage={setMessage}
          module="securite"
          libelle="Demandes sécurité"
        />
      )}
      {onglet === 'recherches' && (
        <Recherches
          evenement={evenement}
          peut={peut}
          toutPouvoir={toutPouvoir}
          setMessage={setMessage}
        />
      )}
      {onglet === 'effectifs' && (
        <Effectifs
          evenement={evenement}
          peut={peut}
          toutPouvoir={toutPouvoir}
          setMessage={setMessage}
        />
      )}
      {onglet === 'fiches' && (
        <Fiches evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} />
      )}
      {onglet === 'sitrep' && (
        <Sitrep evenement={evenement} session={session} membre={membre} />
      )}
    </div>
  )
}


/* Le reste de l'écran vit depuis le lot 12 (26/09) dans Journal.jsx,
   Missions.jsx, Recherches.jsx et FichesReflexe.jsx. */
