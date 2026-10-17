import { useState } from 'react'
import { Missions } from './Missions'
import { Journal } from './Journal'
import Radio from './Radio'
import Stocks from './Stocks'
import Attributions from './Attributions'
import Jauge from './Jauge'
import Transports from './Transports'

const ONGLETS = [
  ['interventions', 'Demandes'],
  ['stocks', 'Stocks'],
  ['attributions', 'Clés & radios'],
  ['radio', 'Matrice radio'],
  ['jauge', 'Jauge'],
  ['transports', 'Transports'],
  ['journal', 'Main courante']
]

export default function Logistique({ evenement, membre, peut, toutPouvoir }) {
  const [onglet, setOnglet] = useState('interventions')
  const [message, setMessage] = useState(null)

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
