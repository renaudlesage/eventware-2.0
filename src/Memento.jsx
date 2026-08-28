import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { lireCache, ecrireCache, ageCache } from './horsLigne'

export default function Memento({ evenement }) {
  const [donnees, setDonnees] = useState(() => lireCache(evenement.id))
  const [depuisCache, setDepuisCache] = useState(!!lireCache(evenement.id))
  const [enLigne, setEnLigne] = useState(navigator.onLine)
  const [ouverte, setOuverte] = useState(null)
  const [section, setSection] = useState('fiches')

  async function rafraichir() {
    const [f, c, r] = await Promise.all([
      supabase
        .from('fiches_reflexe')
        .select('*')
        .eq('evenement_id', evenement.id)
        .order('ordre'),
      supabase
        .from('contacts')
        .select('*')
        .eq('evenement_id', evenement.id)
        .order('nom'),
      supabase
        .from('elements_plan')
        .select('*')
        .eq('evenement_id', evenement.id)
        .eq('est_risque', true)
        .order('code')
    ])
    // Un seul échec suffit à invalider le rafraîchissement : mieux vaut
    // garder un cache cohérent qu'un mélange de neuf et d'ancien.
    if (f.error || c.error || r.error) return
    const nouveau = {
      fiches: f.data ?? [],
      contacts: c.data ?? [],
      risques: r.data ?? [],
      evenement: evenement.nom
    }
    ecrireCache(evenement.id, nouveau)
    setDonnees({ ...nouveau, enregistre_le: new Date().toISOString() })
    setDepuisCache(false)
  }

  useEffect(() => {
    if (navigator.onLine) rafraichir()
    const on = () => {
      setEnLigne(true)
      rafraichir()
    }
    const off = () => setEnLigne(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [evenement.id])

  if (!donnees) {
    return (
      <div className="memento dom-sarcelle">
        <h2>Mémento d'urgence</h2>
        <p className="vide">
          {enLigne
            ? 'Chargement…'
            : "Pas de réseau et aucune copie locale. Ouvre cet écran une fois connecté : le contenu restera ensuite disponible hors réseau."}
        </p>
      </div>
    )
  }

  const age = ageCache(donnees)

  return (
    <div className="memento dom-sarcelle">
      <div className="entete-dashboard">
        <h2>Mémento d'urgence</h2>
        <span className={`session ${!enLigne ? 'hors-ligne' : ''}`}>
          {enLigne ? 'à jour' : 'hors réseau'}
        </span>
      </div>

      <div className={`age-cache ${!enLigne || depuisCache ? 'alerte' : ''}`}>
        {enLigne && !depuisCache
          ? 'Données à jour, copiées sur cet appareil pour un usage hors réseau.'
          : `Copie locale enregistrée il y a ${age}. Vérifie qu'elle correspond au dispositif en place.`}
      </div>

      <div className="onglets">
        {[
          ['fiches', `Conduites (${donnees.fiches.length})`],
          ['coupures', `Coupures (${donnees.risques.length})`],
          ['contacts', `Contacts (${donnees.contacts.length})`]
        ].map(([k, l]) => (
          <button
            key={k}
            className={`module ${section === k ? 'actif' : ''}`}
            onClick={() => setSection(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {section === 'fiches' &&
        (donnees.fiches.length === 0 ? (
          <p className="vide">Aucune fiche. Installe le pack standard depuis Sécurité.</p>
        ) : (
          donnees.fiches.map((fi) => (
            <div className="carte" key={fi.id}>
              <div
                className="titre"
                style={{ cursor: 'pointer' }}
                onClick={() => setOuverte(ouverte === fi.id ? null : fi.id)}
              >
                <span className="mono">{fi.code}</span> — {fi.titre}
              </div>
              {fi.declencheur && (
                <div className="meta">
                  <span>{fi.declencheur}</span>
                </div>
              )}
              {ouverte === fi.id && (
                <div style={{ marginTop: 10 }}>
                  <ol className="liste-pave">
                    {(fi.conduite ?? []).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ol>
                  {(fi.a_ne_pas_faire ?? []).length > 0 && (
                    <>
                      <div className="pave-titre" style={{ marginTop: 10 }}>
                        À ne pas faire
                      </div>
                      <ul className="liste-pave">
                        {fi.a_ne_pas_faire.map((x, i) => (
                          <li key={i} className="alerte-texte">
                            {x}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {fi.contacts && <p className="aide">{fi.contacts}</p>}
                </div>
              )}
            </div>
          ))
        ))}

      {section === 'coupures' &&
        (donnees.risques.length === 0 ? (
          <p className="vide">Aucune installation à risque déclarée.</p>
        ) : (
          donnees.risques.map((r) => (
            <div className="carte urgent" key={r.id}>
              <div className="titre">
                <span className="mono">{r.code}</span> — {r.nom}
              </div>
              <dl className="fiche">
                {r.organe_coupure && (
                  <>
                    <dt>Où couper</dt>
                    <dd>
                      <strong>{r.organe_coupure}</strong>
                    </dd>
                  </>
                )}
                {r.moyens_proximite && (
                  <>
                    <dt>Moyens à proximité</dt>
                    <dd>{r.moyens_proximite}</dd>
                  </>
                )}
                {r.mesures_maitrise && (
                  <>
                    <dt>Mesures en place</dt>
                    <dd>{r.mesures_maitrise}</dd>
                  </>
                )}
              </dl>
              {r.contact && (
                <div className="ligne-boutons" style={{ marginTop: 8 }}>
                  <a className="lien-externe" href={`tel:${r.contact.replace(/\s/g, '')}`}>
                    {r.responsable} · {r.contact}
                  </a>
                </div>
              )}
            </div>
          ))
        ))}

      {section === 'contacts' &&
        (donnees.contacts.length === 0 ? (
          <p className="vide">Aucun contact encodé.</p>
        ) : (
          <>
            <div className="carte urgent">
              <div className="titre">Urgences</div>
              <div className="ligne-boutons" style={{ marginTop: 8 }}>
                <a className="bouton-appel" href="tel:112">
                  112
                </a>
                <a className="bouton-appel" href="tel:101">
                  101
                </a>
              </div>
            </div>
            {donnees.contacts.map((c) => (
              <div className="carte" key={c.id}>
                <div className="titre">{c.nom}</div>
                <div className="meta">
                  {c.organisation && <span>{c.organisation}</span>}
                  {c.fonction && <span>{c.fonction}</span>}
                  {c.disponibilite && <span>{c.disponibilite}</span>}
                </div>
                {c.telephone && (
                  <div className="ligne-boutons" style={{ marginTop: 8 }}>
                    <a
                      className="lien-externe"
                      href={`tel:${c.telephone.replace(/\s/g, '')}`}
                    >
                      {c.telephone}
                    </a>
                  </div>
                )}
              </div>
            ))}
          </>
        ))}
    </div>
  )
}
