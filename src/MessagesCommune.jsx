import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * MESSAGES DE LA COMMUNE au QG (158).
 *
 * Tout message non lu d'urgence ou d'évacuation reste en bandeau tant
 * que personne n'a pressé « Bien reçu » ; les autres s'empilent
 * dessous. Un accusé par membre et par message (messages_commune_accuses)
 * : le PC sait qui a lu, et quand. Relu à chaque changement de la table
 * et toutes les minutes.
 */
const NIVEAUX = { information: 'Information', vigilance: 'Vigilance', urgence: 'Urgence', evacuation: 'Évacuation' }
const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '')

export default function MessagesCommune({ evenement }) {
  const [messages, setMessages] = useState([])
  const [accuses, setAccuses] = useState([]) // tous les accusés de l'événement
  const [moi, setMoi] = useState(null)
  const [tout, setTout] = useState(false)

  async function lire() {
    const [m, a, s] = await Promise.all([
      supabase.from('messages_commune').select('*').eq('evenement_id', evenement.id).order('recu_le', { ascending: false }).limit(50),
      supabase.from('messages_commune_accuses').select('message_id, user_id, nom, accuse_le').eq('evenement_id', evenement.id),
      supabase.auth.getSession()
    ])
    setMessages(m.data ?? [])
    setAccuses(a.data ?? [])
    setMoi(s.data?.session?.user?.id ?? null)
  }

  useEffect(() => {
    if (!evenement?.id) return undefined
    lire()
    const minuteur = setInterval(lire, 60000)
    const canal = supabase
      .channel(`commune-${evenement.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages_commune', filter: `evenement_id=eq.${evenement.id}` }, lire)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages_commune_accuses', filter: `evenement_id=eq.${evenement.id}` }, lire)
      .subscribe()
    return () => { clearInterval(minuteur); supabase.removeChannel(canal) }
  }, [evenement?.id])

  async function accuser(m) {
    const { error } = await supabase.from('messages_commune_accuses').insert({ evenement_id: evenement.id, message_id: m.id })
    if (!error || error.code === '23505') lire()
  }

  if (!messages.length) return null
  const mesAccuses = new Set(accuses.filter((a) => a.user_id === moi).map((a) => a.message_id))
  const lu = (m) => (moi ? mesAccuses.has(m.id) : false)
  const urgents = messages.filter((m) => ['urgence', 'evacuation'].includes(m.niveau) && !m.lu_le && !lu(m))
  const autres = messages.filter((m) => !urgents.includes(m))

  const Accuses = ({ m }) => {
    const liste = accuses.filter((a) => a.message_id === m.id)
    if (!liste.length) return <span className="aide">personne n’a encore accusé réception</span>
    return <span className="aide">lu par {liste.length} : {liste.map((a) => `${a.nom ?? '?'} (${heure(a.accuse_le)})`).join(' · ')}</span>
  }

  return (
    <div className="messages-commune">
      {urgents.map((m) => (
        <section className={`bandeau-alerte message-commune niv-${m.niveau}`} key={m.id} role="alert">
          <div className="niv">Commune</div>
          <div className="contenu">
            <strong>{NIVEAUX[m.niveau]} — {m.titre}</strong>
            {m.message && <div className="msg">{m.message}</div>}
            {m.consigne && <div className="consigne">→ {m.consigne}</div>}
            <div className="meta">
              <span>{m.est_exercice ? 'EXERCICE · ' : ''}{m.incident_type ? `${m.incident_type}${m.incident_phase ? ` (${m.incident_phase})` : ''} · ` : ''}reçu à {heure(m.recu_le)}</span>
              {moi && !lu(m) && <button className="discret" onClick={() => accuser(m)}>Bien reçu</button>}
              <Accuses m={m} />
            </div>
          </div>
        </section>
      ))}
      {autres.length > 0 && (
        <div className="bloc-alerte messages-commune-liste">
          <div className="pave-titre">
            Messages de la commune ({autres.length})
            {autres.length > 3 && <button className="lien" style={{ marginLeft: 8 }} onClick={() => setTout(!tout)}>{tout ? 'réduire' : 'tout voir'}</button>}
          </div>
          {(tout ? autres : autres.slice(0, 3)).map((m) => (
            <div className="ligne-retard" key={m.id}>
              <strong><span className={`prc-jeton ${['urgence', 'evacuation'].includes(m.niveau) ? 'chaud' : 'veille'}`}>{NIVEAUX[m.niveau]}</span> {m.titre}</strong>
              {m.consigne && <div>→ {m.consigne}</div>}
              <div className="meta">
                <span>{m.est_exercice ? 'EXERCICE · ' : ''}reçu à {heure(m.recu_le)}</span>
                {moi && !lu(m) && <button className="discret" onClick={() => accuser(m)}>Bien reçu</button>}
                <Accuses m={m} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
