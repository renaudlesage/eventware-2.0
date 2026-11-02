import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'

/**
 * LIAISON COMMUNE — le sens commune → Eventware (158).
 *
 * La commune (Crisiware) écrit ses messages à l'événement sur l'Edge
 * Function `reception-commune`, en présentant un secret dans un
 * en-tête. Le secret se génère ici, s'affiche une seule fois et se
 * transmet à la commune ; la base n'en garde que l'empreinte. Qui crée
 * les alertes (ou tout pouvoir) gère les liaisons.
 */
const RECEPTEUR = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reception-commune`

export default function LiaisonsCommune({ evenement, setMessage }) {
  const [liaisons, setLiaisons] = useState([])
  const [rejets, setRejets] = useState([])
  const [ouvrir, setOuvrir] = useState(false)
  const [commune, setCommune] = useState(evenement.commune ?? '')
  const [entete, setEntete] = useState('X-Commune-Secret')
  const [secret, setSecret] = useState(null) // { commune, secret } — affiché une seule fois
  const [occupe, setOccupe] = useState(false)

  async function charger() {
    const [l, r] = await Promise.all([
      supabase.from('liaisons_commune').select('id, commune, entete, actif, est_exercice, exercice_code, nb_messages, dernier_message_le, created_at')
        .eq('evenement_id', evenement.id).is('deleted_at', null).order('created_at'),
      supabase.from('journal_receptions').select('recu_le, motif, detail').eq('evenement_id', evenement.id).order('recu_le', { ascending: false }).limit(5)
    ])
    setLiaisons(l.data ?? [])
    setRejets(r.data ?? [])
  }

  useEffect(() => { charger() }, [evenement.id])

  async function creer() {
    if (!commune.trim()) return
    setOccupe(true)
    const { data, error } = await supabase.rpc('creer_liaison_commune', { p_evenement: evenement.id, p_commune: commune.trim(), p_entete: entete.trim() || 'X-Commune-Secret' })
    setOccupe(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    const r = Array.isArray(data) ? data[0] : data
    setSecret({ commune: commune.trim(), entete: entete.trim() || 'X-Commune-Secret', secret: r?.secret })
    setOuvrir(false)
    charger()
  }

  async function regenerer(l) {
    if (!window.confirm(`Régénérer le secret de la liaison « ${l.commune} » ? L’ancien cesse de fonctionner immédiatement.`)) return
    const { data, error } = await supabase.rpc('regenerer_secret_liaison', { p_liaison: l.id })
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    const r = Array.isArray(data) ? data[0] : data
    setSecret({ commune: l.commune, entete: l.entete, secret: r?.secret })
  }

  async function basculerActif(l) {
    const refus = await modifierOuRefuser('liaisons_commune', { actif: !l.actif }, { id: l.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }

  function copier(texte) {
    navigator.clipboard?.writeText(texte).then(() => setMessage({ type: 'succes', texte: 'Copié.' })).catch(() => {})
  }

  return (
    <section className="bloc liaisons-commune">
      <h2>Liaison commune</h2>
      <p className="aide" style={{ marginTop: 0 }}>
        Le sens commune → QG : les messages de la commune arrivent sur la Situation.
        Récepteur : <code className="code-discret">{RECEPTEUR}</code>
        <button className="discret" style={{ marginLeft: 6 }} onClick={() => copier(RECEPTEUR)}>Copier</button>
      </p>

      {secret && (
        <div className="message secret-liaison" role="status">
          <strong>Secret de la liaison « {secret.commune} » — affiché une seule fois.</strong>
          <div>En-tête <code className="code-discret">{secret.entete}</code> : <code className="code-discret">{secret.secret}</code></div>
          <div className="ligne-boutons">
            <button className="discret" onClick={() => copier(secret.secret)}>Copier le secret</button>
            <button className="discret" onClick={() => setSecret(null)}>J’ai transmis, fermer</button>
          </div>
        </div>
      )}

      {liaisons.length === 0 ? (
        <p className="vide">Aucune liaison : la commune ne peut pas encore écrire à cet événement.</p>
      ) : (
        <table className="tableau">
          <thead><tr><th>Commune</th><th>En-tête</th><th>Messages</th><th>État</th><th></th></tr></thead>
          <tbody>
            {liaisons.map((l) => (
              <tr key={l.id} className={l.actif ? '' : 'inactif'}>
                <td>{l.commune}{l.est_exercice && <span className="prc-jeton veille" style={{ marginLeft: 6 }}>exercice {l.exercice_code}</span>}</td>
                <td className="mono">{l.entete}</td>
                <td>{l.nb_messages}{l.dernier_message_le && <span className="aide"> · {new Date(l.dernier_message_le).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}</span>}</td>
                <td>{l.actif ? 'active' : 'inactive'}</td>
                <td className="ligne-boutons">
                  <button className="discret" onClick={() => regenerer(l)}>Nouveau secret</button>
                  <button className="discret" onClick={() => basculerActif(l)}>{l.actif ? 'Désactiver' : 'Réactiver'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {ouvrir ? (
        <div className="formulaire">
          <label>Commune<input value={commune} onChange={(e) => setCommune(e.target.value)} /></label>
          <label>Nom de l’en-tête<input value={entete} onChange={(e) => setEntete(e.target.value)} placeholder="X-Commune-Secret" /></label>
          <div className="ligne-boutons">
            <button onClick={creer} disabled={occupe || !commune.trim()}>Créer et afficher le secret</button>
            <button className="discret" onClick={() => setOuvrir(false)}>Annuler</button>
          </div>
        </div>
      ) : (
        <button className="discret" onClick={() => setOuvrir(true)}>+ Nouvelle liaison</button>
      )}

      {rejets.length > 0 && (
        <details className="rejets-liaison">
          <summary>Derniers rejets ({rejets.length})</summary>
          <ul>
            {rejets.map((r, i) => (
              <li key={i} className="aide">
                {new Date(r.recu_le).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })} — {r.motif}{r.detail ? ` : ${r.detail}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
