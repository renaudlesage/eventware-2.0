import { useEffect, useState } from 'react'

const LIBELLE = { vert: 'Vert', jaune: 'Jaune', orange: 'Orange', rouge: 'Rouge' }

// Dérivée de la variable d'environnement, comme le client Supabase :
// une URL de projet en dur casserait toute branche ou projet de test,
// silencieusement — le pavé afficherait « injoignable » sans dire
// pourquoi.
const URL_FONCTION = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/irm-vigilance`
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
// Meteoalarm publie au rythme des bulletins IRM : dix minutes suffisent.
// Avant, le pavé se chargeait une fois et restait figé toute la journée
// sous un pied de page qui promettait un rafraîchissement (comparatif
// BFMF 2026, lot 1).
const RAFRAICHISSEMENT_MS = 10 * 60 * 1000

export default function MoniteurIrm({ province }) {
  const [etat, setEtat] = useState({ chargement: true })
  const [releve, setReleve] = useState(null)
  const [pannePuis, setPannePuis] = useState(null)

  useEffect(() => {
    let vivant = true
    const q = province ? `?province=${encodeURIComponent(province)}` : ''
    function charger() {
      fetch(URL_FONCTION + q)
        .then((r) => r.json())
        .then((d) => {
          if (!vivant) return
          setEtat({ chargement: false, ...d })
          setReleve(new Date())
          setPannePuis(null)
        })
        .catch(() => {
          if (!vivant) return
          // On garde le dernier relevé lisible et on date la panne.
          setPannePuis((p) => p ?? new Date())
          setEtat((e) => (e.chargement ? { chargement: false, erreur: 'injoignable' } : e))
        })
    }
    charger()
    const t = setInterval(charger, RAFRAICHISSEMENT_MS)
    return () => {
      vivant = false
      clearInterval(t)
    }
  }, [province])

  const heure = (d) => d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
  const datation = pannePuis
    ? `relais indisponible depuis ${heure(pannePuis)}${releve ? `, dernier relevé ${heure(releve)}` : ''}`
    : releve
      ? `relevé ${heure(releve)}`
      : null

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
        <p className="aide irm-ras" style={{ margin: '6px 0 0' }}>
          ✓ Aucun avertissement officiel en cours pour {province}.
        </p>
      )}

      <p className="aide" style={{ marginTop: 6 }}>
        Via Meteoalarm (relais européen des services météo nationaux, dont l'IRM)
        {datation && <> — {datation}</>} —{' '}
        <a href={etat.lien ?? URL_PORTAIL} target="_blank" rel="noreferrer">
          voir sur meteoalarm.org →
        </a>
      </p>
    </div>
  )
}
