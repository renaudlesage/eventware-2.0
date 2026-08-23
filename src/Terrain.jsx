import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Vue terrain.
 *
 * Remplace quatre écrans de la v18 — équipe volante, chauffeur,
 * balade accompagnateur, tâches sanitaires — qui posaient tous la même
 * question : qu'est-ce qui m'attend, maintenant ?
 *
 * Contraintes de conception : on est debout, en mouvement, souvent
 * d'une seule main. Deux gestes maximum par action.
 */
export default function Terrain({ evenement, membre }) {
  const [lignes, setLignes] = useState([])
  const [message, setMessage] = useState(null)
  const [filtre, setFiltre] = useState('tout')

  async function charger() {
    const { data, error } = await supabase.rpc('mon_terrain', {
      p_evenement: evenement.id
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function avancer(l, statut) {
    const table = l.genre === 'transport' ? 'transports' : 'missions'
    const champs = { statut }
    if (statut === 'attribuee') {
      champs[l.genre === 'transport' ? 'chauffeur_id' : 'membre_id'] = membre.id
    }
    const { error, count } = await supabase
      .from(table)
      .update(champs, { count: 'exact' })
      .eq('id', l.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0)
      setMessage({ type: 'erreur', texte: 'Modification refusée : droits insuffisants.' })
    else charger()
  }

  const visibles = filtre === 'moi' ? lignes.filter((l) => l.pour_moi) : lignes
  const mesLignes = lignes.filter((l) => l.pour_moi).length
  const p1 = lignes.filter((l) => l.priorite === 'P1').length

  return (
    <div className="securite">
      <h2>Mon terrain</h2>

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      <div className="compteurs">
        <span>
          À faire <strong>{lignes.length}</strong>
        </span>
        <span>
          Pour moi <strong>{mesLignes}</strong>
        </span>
        <span className={p1 ? 'alerte-texte' : ''}>
          P1 <strong>{p1}</strong>
        </span>
      </div>

      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        {[
          ['tout', 'Tout'],
          ['moi', 'Pour moi']
        ].map(([k, l]) => (
          <button
            key={k}
            className={`module ${filtre === k ? 'actif' : ''}`}
            onClick={() => setFiltre(k)}
          >
            {l}
          </button>
        ))}
        <button className="discret" onClick={charger}>
          Rafraîchir
        </button>
      </div>

      {visibles.length === 0 ? (
        <p className="vide">Rien ne t'attend pour le moment.</p>
      ) : (
        visibles.map((l) => (
          <div
            className={`carte ${l.priorite === 'P1' ? 'urgent' : ''} ${
              l.pour_moi ? 'a-moi' : ''
            }`}
            key={l.id}
          >
            <div className="titre">
              <span className="mono">{l.reference}</span>{' '}
              <span className={`jeton prio-${l.priorite}`}>{l.priorite}</span> {l.titre}
            </div>
            {l.detail && <p style={{ margin: '4px 0' }}>{l.detail}</p>}
            <div className="meta">
              <span>{l.genre}</span>
              <span>{l.statut}</span>
              {l.pour_moi && <span className="jeton">à moi</span>}
              {l.latitude && (
                <a
                  className="lien-externe"
                  href={`https://www.google.com/maps?q=${l.latitude},${l.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Y aller
                </a>
              )}
            </div>

            <div className="ligne-boutons" style={{ marginTop: 10 }}>
              {l.statut === 'a_traiter' && (
                <button onClick={() => avancer(l, 'attribuee')}>Je prends</button>
              )}
              {l.statut === 'attribuee' && (
                <button onClick={() => avancer(l, 'en_cours')}>Je démarre</button>
              )}
              {l.statut === 'en_cours' && (
                <button onClick={() => avancer(l, 'resolue')}>Terminé</button>
              )}
            </div>
          </div>
        ))
      )}

      <p className="aide">
        « Je prends » t'attribue la tâche : le PC voit aussitôt qui s'en occupe, et personne
        n'y va à deux. C'est ce qui manquait au circuit jetons de 2026.
      </p>
    </div>
  )
}
