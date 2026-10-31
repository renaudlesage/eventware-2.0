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

/**
 * (31/10, retour de Ren) Dix onglets sur une seule rangée, ça ne se lisait
 * plus ; deux rangées de boutons (groupes, puis onglets), pas mieux sur un
 * téléphone. Une seule liste déroulante, les rubriques rangées en trois
 * groupes :
 *
 *   EXPLOITATION — ce qui se passe : demandes, transports, jauge,
 *                  main courante. Le jour J.
 *   MATÉRIEL     — ce qu'on a et où c'est : inventaire de l'organisation,
 *                  stocks de l'événement, clés & radios, matrice radio.
 *   ACHATS       — ce qu'on commande : demandes de prix, fournisseurs.
 *
 * La rubrique ouverte est mémorisée sur l'appareil ; un lien ciblé (pavé de
 * Mon poste, étiquette scannée) ouvre directement la bonne.
 */
const GROUPES = [
  ['Exploitation', [
    ['interventions', 'Demandes'],
    ['transports', 'Transports'],
    ['jauge', 'Jauge'],
    ['journal', 'Main courante']
  ]],
  ['Matériel', [
    // (138) Le matériel de l'organisation : inventaire, prêts et locations.
    ['inventaire', 'Inventaire'],
    ['stocks', 'Stocks'],
    ['attributions', 'Clés & radios'],
    ['radio', 'Matrice radio']
  ]],
  ['Achats', [
    // (130, 131) Les demandes de prix de l'événement et l'annuaire de l'organisation.
    ['demandes_prix', 'Demandes de prix'],
    ['fournisseurs', 'Fournisseurs']
  ]]
]
const RUBRIQUES = GROUPES.flatMap(([, onglets]) => onglets.map(([k]) => k))

function rubriqueMemorisee() {
  try {
    const r = localStorage.getItem('logistique.rubrique')
    return RUBRIQUES.includes(r) ? r : 'interventions'
  } catch {
    return 'interventions'
  }
}

export default function Logistique({ evenement, membre, peut, toutPouvoir, ongletCible }) {
  const [onglet, setOnglet] = useState(rubriqueMemorisee)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    try { localStorage.setItem('logistique.rubrique', onglet) } catch {}
  }, [onglet])

  // Navigation ciblée depuis un autre écran (le pavé « Demandes de
  // prix » de Mon poste, une étiquette de matériel scannée) : on ouvre
  // directement la bonne rubrique.
  useEffect(() => {
    if (ongletCible && RUBRIQUES.includes(ongletCible)) setOnglet(ongletCible)
  }, [ongletCible])

  return (
    <div className="bloc securite dom-bronze">
      <h2>Logistique</h2>

      <label className="rubrique-logistique">
        Rubrique
        <select value={onglet} onChange={(e) => { setOnglet(e.target.value); setMessage(null) }} aria-label="Rubrique de la logistique">
          {GROUPES.map(([groupe, onglets]) => (
            <optgroup key={groupe} label={groupe}>
              {onglets.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </optgroup>
          ))}
        </select>
      </label>

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
