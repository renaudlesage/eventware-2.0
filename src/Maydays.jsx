import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Traitement des Mayday.
 *
 * Trois temps, et ils comptent chacun :
 *   ACCUSER — dire à l'émetteur qu'on l'a vu. C'est le geste le plus
 *   urgent : quelqu'un en difficulté qui n'a aucun retour ne sait pas
 *   s'il doit insister ou attendre.
 *   PRENDRE EN CHARGE — quelqu'un est parti.
 *   CLÔTURER — l'alerte diffusée se lève dans le même mouvement.
 *
 * Les délais entre ces temps sont horodatés : ils sont la première
 * chose qu'on regarde au retour d'expérience.
 */

const OUVERTS = ['emis', 'accuse', 'en_cours']

export default function Maydays({ evenement, compact, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [tout, setTout] = useState(false)

  async function charger() {
    const { data, error } = await supabase
      .from('maydays')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('emis_le', { ascending: false })
    if (error) setMessage?.({ type: 'erreur', texte: error.message })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 10000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function changer(m, statut, resolution) {
    const champs = { statut }
    if (resolution !== undefined) champs.resolution = resolution
    const { error, count } = await supabase
      .from('maydays')
      .update(champs, { count: 'exact' })
      .eq('id', m.id)
    if (error) setMessage?.({ type: 'erreur', texte: error.message })
    else if (count === 0)
      setMessage?.({ type: 'erreur', texte: 'Traitement refusé : droits insuffisants.' })
    else charger()
  }

  const ouverts = lignes.filter((m) => OUVERTS.includes(m.statut))
  const visibles = tout ? lignes : ouverts

  // En mode compact — sur l'écran Situation — on ne montre rien s'il n'y
  // a rien : un bloc vide en tête de page dilue ce qui compte.
  if (compact && ouverts.length === 0) return null

  return (
    <section className="bloc mayday-bloc">
      <h2>Mayday{ouverts.length > 0 && ` — ${ouverts.length} en cours`}</h2>

      {visibles.length === 0 ? (
        <p className="vide">Aucun appel de détresse.</p>
      ) : (
        visibles.map((m) => {
          const ouvert = OUVERTS.includes(m.statut)
          return (
            <div className={`carte ${ouvert ? 'urgent' : ''}`} key={m.id}>
              <div className="titre">
                <span className="mono">{m.reference}</span> —{' '}
                {m.emetteur_nom ?? 'intervenant'}
                {m.indicatif && <span className="mono"> · {m.indicatif}</span>}
              </div>

              {m.motif && <p style={{ margin: '4px 0' }}>{m.motif}</p>}

              <div className="meta">
                <span>{new Date(m.emis_le).toLocaleTimeString('fr-BE')}</span>
                <span>{ecoule(m.emis_le)}</span>
                {m.canal && <span className="mono">{m.canal}</span>}
                {m.latitude ? (
                  <a
                    className="lien-externe"
                    href={`https://www.google.com/maps?q=${m.latitude},${m.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Y aller {m.precision_m && `(±${Math.round(m.precision_m)} m)`}
                  </a>
                ) : (
                  <span className="alerte-texte">sans position</span>
                )}
                <span className="jeton">{m.statut}</span>
              </div>

              {m.accuse_le && (
                <div className="meta">
                  <span>
                    accusé après{' '}
                    {Math.max(
                      0,
                      Math.round((new Date(m.accuse_le) - new Date(m.emis_le)) / 1000)
                    )}{' '}
                    s
                  </span>
                  {m.clos_le && (
                    <span>
                      clos après{' '}
                      {Math.round((new Date(m.clos_le) - new Date(m.emis_le)) / 60000)} min
                    </span>
                  )}
                </div>
              )}

              {m.resolution && <p className="aide">{m.resolution}</p>}

              {ouvert && (
                <div className="ligne-boutons" style={{ marginTop: 10 }}>
                  {m.statut === 'emis' && (
                    <button onClick={() => changer(m, 'accuse')}>
                      Accuser réception
                    </button>
                  )}
                  {m.statut !== 'en_cours' && (
                    <button className="discret" onClick={() => changer(m, 'en_cours')}>
                      Intervention en cours
                    </button>
                  )}
                  <button
                    className="discret"
                    onClick={() => {
                      const r = prompt('Comment cela s\\'est-il terminé ?')
                      if (r !== null) changer(m, 'clos', r || 'Clôturé')
                    }}
                  >
                    Clôturer
                  </button>
                  <button
                    className="discret"
                    onClick={() => {
                      if (confirm('Déclencher par erreur ? Le Mayday sera annulé.'))
                        changer(m, 'annule', 'Déclenchement accidentel')
                    }}
                  >
                    Fausse manœuvre
                  </button>
                </div>
              )}
            </div>
          )
        })
      )}

      {!compact && lignes.length > ouverts.length && (
        <div className="ligne-boutons" style={{ marginTop: 10 }}>
          <button className="discret" onClick={() => setTout(!tout)}>
            {tout ? 'Masquer les clôturés' : `Afficher les clôturés (${lignes.length - ouverts.length})`}
          </button>
        </div>
      )}

      {ouverts.length > 0 && (
        <p className="aide">
          Accuser réception est le geste le plus urgent : quelqu'un en difficulté sans
          retour ne sait pas s'il doit insister ou attendre. La clôture lève automatiquement
          l'alerte diffusée sur tous les écrans.
        </p>
      )}
    </section>
  )
}

function ecoule(date) {
  const min = Math.round((Date.now() - new Date(date)) / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  return `il y a ${h} h ${min % 60} min`
}
