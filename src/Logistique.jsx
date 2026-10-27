import { useEffect, useState } from 'react'
import { Missions } from './Missions'
import { Journal } from './Journal'
import Radio from './Radio'
import Stocks from './Stocks'
import Attributions from './Attributions'
import Jauge from './Jauge'
import Transports from './Transports'
import Fournisseurs from './Fournisseurs'
import DemandesPrix from './DemandesPrix'
import Inventaire from './Inventaire'

const ONGLETS = [
  ['interventions', 'Demandes'],
  ['stocks', 'Stocks'],
  ['attributions', 'Clés & radios'],
  ['radio', 'Matrice radio'],
  ['jauge', 'Jauge'],
  ['transports', 'Transports'],
  // (130, 131) L'annuaire de l'organisation et les demandes de prix de l'événement.
  ['fournisseurs', 'Fournisseurs'],
  ['demandes_prix', 'Demandes de prix'],
  // (138) Le matériel de l'organisation : inventaire, prêts et locations.
  ['inventaire', 'Matériel'],
  ['journal', 'Main courante']
]

export default function Logistique({ evenement, membre, peut, toutPouvoir, ongletCible }) {
  const [onglet, setOnglet] = useState('interventions')
  const [message, setMessage] = useState(null)

  // Navigation ciblée depuis un autre écran (le pavé « Demandes de
  // prix » de Mon poste) : on ouvre directement le bon onglet.
  useEffect(() => {
    if (ongletCible && ONGLETS.some(([k]) => k === ongletCible)) setOnglet(ongletCible)
  }, [ongletCible])

  return (
    <div className="bloc securite dom-bronze">
      <h2>Logistique</h2>

      <div className="onglets">
        {ONGLETS.map(([k, l]) => (
          <button
            key={k}
            className={`module ${onglet === k ? 'actif' : ''}`}
            onClick={() => setOnglet(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {onglet === 'interventions' && (
        <Missions
          key="logistique"
          evenement={evenement}
          membre={membre}
          peut={peut}
          toutPouvoir={toutPouvoir}
          setMessage={setMessage}
          module="logistique"
          libelle="Demandes logistiques"
        />
      )}
      {onglet === 'stocks' && (
        <Stocks
          evenement={evenement}
          membre={membre}
          peut={peut}
          toutPouvoir={toutPouvoir}
          setMessage={setMessage}
        />
      )}
      {onglet === 'attributions' && (
        <Attributions
          evenement={evenement}
          peut={peut}
          toutPouvoir={toutPouvoir}
          setMessage={setMessage}
        />
      )}
      {onglet === 'radio' && (
        <Radio evenement={evenement} setMessage={setMessage} peut={peut} toutPouvoir={toutPouvoir} />
      )}
      {onglet === 'jauge' && (
        <Jauge
          evenement={evenement}
          membre={membre}
          peut={peut}
          toutPouvoir={toutPouvoir}
          setMessage={setMessage}
        />
      )}
      {onglet === 'transports' && (
        <Transports
          evenement={evenement}
          peut={peut}
          toutPouvoir={toutPouvoir}
          setMessage={setMessage}
        />
      )}
      {onglet === 'fournisseurs' && (
        <Fournisseurs evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} setMessage={setMessage} />
      )}
      {onglet === 'demandes_prix' && (
        <DemandesPrix evenement={evenement} membre={membre} peut={peut} toutPouvoir={toutPouvoir} setMessage={setMessage} />
      )}
      {onglet === 'inventaire' && (
        <Inventaire evenement={evenement} membre={membre} peut={peut} toutPouvoir={toutPouvoir} setMessage={setMessage} />
      )}
      {onglet === 'journal' && (
        <Journal
          evenement={evenement}
          setMessage={setMessage}
          moduleParDefaut="logistique"
          peut={peut}
          toutPouvoir={toutPouvoir}
          membre={membre}
        />
      )}
    </div>
  )
}

/* Les onglets vivent chacun dans leur fichier depuis le 03/10 :
   Stocks.jsx, Attributions.jsx, Jauge.jsx, Transports.jsx. */
