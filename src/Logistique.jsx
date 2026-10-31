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
 * plus. Trois groupes, comme Sécurité (Opérationnel / Documents), et
 * dessous les seuls onglets du groupe :
 *
 *   EXPLOITATION — ce qui se passe : demandes, transports, jauge,
 *                  main courante. Le jour J.
 *   MATÉRIEL     — ce qu'on a et où c'est : inventaire de l'organisation,
 *                  stocks de l'événement, clés & radios, matrice radio.
 *   ACHATS       — ce qu'on commande : demandes de prix, fournisseurs.
 *
 * Le groupe ouvert est mémorisé sur l'appareil ; un lien ciblé (pavé de
 * Mon poste, étiquette scannée) ouvre le bon groupe et le bon onglet.
 */
const GROUPES = {
  exploitation: {
    libelle: 'Exploitation',
    onglets: [
      ['interventions', 'Demandes'],
      ['transports', 'Transports'],
      ['jauge', 'Jauge'],
      ['journal', 'Main courante']
    ]
  },
  materiel: {
    libelle: 'Matériel',
    onglets: [
      // (138) Le matériel de l'organisation : inventaire, prêts et locations.
      ['inventaire', 'Inventaire'],
      ['stocks', 'Stocks'],
      ['attributions', 'Clés & radios'],
      ['radio', 'Matrice radio']
    ]
  },
  achats: {
    libelle: 'Achats',
    onglets: [
      // (130, 131) Les demandes de prix de l'événement et l'annuaire de l'organisation.
      ['demandes_prix', 'Demandes de prix'],
      ['fournisseurs', 'Fournisseurs']
    ]
  }
}
const groupeDe = (onglet) => Object.keys(GROUPES).find((g) => GROUPES[g].onglets.some(([k]) => k === onglet))

function groupeMemorise() {
  try {
    const g = localStorage.getItem('logistique.groupe')
    return GROUPES[g] ? g : 'exploitation'
  } catch {
    return 'exploitation'
  }
}

export default function Logistique({ evenement, membre, peut, toutPouvoir, ongletCible }) {
  const [groupe, setGroupe] = useState(groupeMemorise)
  const [onglet, setOnglet] = useState(() => GROUPES[groupeMemorise()].onglets[0][0])
  const [message, setMessage] = useState(null)

  useEffect(() => {
    try { localStorage.setItem('logistique.groupe', groupe) } catch {}
  }, [groupe])

  function choisirGroupe(g) {
    setGroupe(g)
    setOnglet(GROUPES[g].onglets[0][0])
    setMessage(null)
  }

  // Navigation ciblée depuis un autre écran (le pavé « Demandes de
  // prix » de Mon poste, une étiquette de matériel scannée) : on ouvre
  // directement le bon groupe et le bon onglet.
  useEffect(() => {
    const g = ongletCible && groupeDe(ongletCible)
    if (!g) return
    setGroupe(g)
    setOnglet(ongletCible)
  }, [ongletCible])

  return (
    <div className="bloc securite dom-bronze">
      <h2>Logistique</h2>

      <div className="ligne-boutons groupes-logistique" role="tablist" aria-label="Groupes de la logistique" style={{ marginBottom: 10 }}>
        {Object.entries(GROUPES).map(([g, { libelle }]) => (
          <button key={g} role="tab" aria-selected={groupe === g} className={groupe === g ? '' : 'discret'} onClick={() => choisirGroupe(g)}>
            {libelle}
          </button>
        ))}
      </div>

      <div className="onglets" role="tablist" aria-label={GROUPES[groupe].libelle}>
        {GROUPES[groupe].onglets.map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={onglet === k}
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
