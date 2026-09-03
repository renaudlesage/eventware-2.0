import { useEffect, useState } from 'react'

const LIBELLE = { vert: 'Vert', jaune: 'Jaune', orange: 'Orange', rouge: 'Rouge' }

const URL_FONCTION =
  'https://kunvnnfejhnuhflycyfz.supabase.co/functions/v1/irm-vigilance'
const URL_PORTAIL = 'https://meteoalarm.org/en/live/country/belgium'

/**
 * Avertissement officiel IRM, relayé via Meteoalarm.
 *
 * Distinct de la veille à seuils juste au-dessus : celle-ci porte sur
 * le point précis de l'événement, avec des seuils que tu as choisis.
 * Celui-ci porte sur toute la province, avec les critères propres à
 * l'IRM. Les deux se complètent — aucun ne remplace l'autre, d'où
 * l'affichage côte à côte plutôt qu'une fusion des deux en un chiffre.
 *
 * L'IRM lui-même n'a pas d'API publique gratuite ; Meteoalarm, le
 * portail européen qui relaie les services météo nationaux, en a une.
 */
export default function MoniteurIrm({ province }) {
  const [etat, setEtat] = useState({ chargement: true })

  useEffect(() => {
    let vivant = true
    const q = province ? `?province=${encodeURIComponent(province)}` : ''
    fetch(URL_FONCTION + q)
      .then((r) => r.json())
      .then((d) => vivant && setEtat({ chargement: false, ...d }))
      .catch(() => vivant && setEtat({ chargement: false, erreur: 'injoignable' }))
    return () => {
      vivant = false
    }
  }, [province])

  if (!province) {
    return (
      <div className="irm-bloc irm-vide">
        <span className="pave-titre">Avertissement officiel IRM</span>
        <p className="aide" style={{ margin: '4px 0 0' }}>
          Renseigne la province de l'événement, dans Réglages → Dispositif, pour voir ici
          l'avertissement officiel — celui-ci porte sur toute la province, en plus de la
          veille à seuils ci-dessus qui porte sur le point précis de l'événement.
        </p>
      </div>
    )
  }

  if (etat.chargement) return null

  if (etat.erreur) {
    return (
      <div className="irm-bloc">
        <span className="pave-titre">Avertissement officiel IRM</span>
        <p className="aide" style={{ margin: '4px 0 0' }}>
          Relais Meteoalarm injoignable pour l'instant.{' '}
          <a href={URL_PORTAIL} target="_blank" rel="noreferrer">
            Consulter directement meteoalarm.org →
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className={`irm-bloc irm-${etat.niveau}`}>
      <div className="irm-tete">
        <span className="pave-titre">Avertissement officiel IRM — {province}</span>
        <span className={`badge-vigilance niv-${etat.niveau}`}>{LIBELLE[etat.niveau]}</span>
      </div>

      {etat.avertissements?.length > 0 ? (
        <ul className="chrono" style={{ marginTop: 8 }}>
          {etat.avertissements.map((a, i) => (
            <li key={i}>
              <span className="heure mono">{LIBELLE[a.niveau]}</span>
              <span className="corps">
                {a.evenement} — {a.zone}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="aide" style={{ margin: '6px 0 0' }}>
          Aucun avertissement officiel en cours pour {province}.
        </p>
      )}

      <p className="aide" style={{ marginTop: 6 }}>
        Via Meteoalarm (relais européen des services météo nationaux, dont l'IRM) —{' '}
        <a href={etat.lien ?? URL_PORTAIL} target="_blank" rel="noreferrer">
          voir sur meteoalarm.org →
        </a>
      </p>
    </div>
  )
}
