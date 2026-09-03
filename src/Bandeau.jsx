import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { diffuserAlerte } from './diffusion'

const NIVEAUX = [
  ['information', 'Information'],
  ['vigilance', 'Vigilance'],
  ['urgence', 'Urgence'],
  ['evacuation', 'Évacuation']
]

/**
 * Le bandeau s'impose : il n'est pas refermable tant que l'alerte est
 * active. Une alerte qu'on peut masquer d'un clic est une alerte qu'on
 * masque au pire moment.
 *
 * Il ne montre que les alertes de l'événement COURANT. La version
 * précédente affichait celles de tous les événements dont on est membre,
 * au motif qu'une urgence ne doit jamais être masquée : le raisonnement
 * était faux. Un Mayday sur une rando n'a rien à faire sur l'écran de
 * quelqu'un qui travaille sur un festival — il y crée du bruit et brouille
 * le cloisonnement entre organisateurs.
 */
export default function Bandeau({ evenement }) {
  const [alertes, setAlertes] = useState([])

  async function charger() {
    if (!evenement?.id) return setAlertes([])
    const { data } = await supabase
      .from('alertes')
      .select('*')
      .eq('evenement_id', evenement.id)
      .eq('active', true)
      .order('emise_le', { ascending: false })
    setAlertes(data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 15000)
    return () => clearInterval(t)
  }, [evenement?.id])

  if (!alertes.length) return null

  return (
    <div className="bandeaux">
      {alertes.map((a) => (
        <div className={`bandeau-alerte niv-${a.niveau}`} key={a.id}>
          <div className="niv">{a.niveau}</div>
          <div className="contenu">
            <strong>{a.titre}</strong>
            {a.message && <div className="msg">{a.message}</div>}
            {a.consigne && <div className="consigne">→ {a.consigne}</div>}
            <div className="meta">
              <span>
                {new Date(a.emise_le).toLocaleTimeString('fr-BE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Émission et levée — réservé aux rôles qui en ont le droit           */
/* ------------------------------------------------------------------ */

export function GestionAlertes({ evenement, setMessage }) {
  const [alertes, setAlertes] = useState([])
  const [ouvrir, setOuvrir] = useState(false)
  const [f, setF] = useState({
    niveau: 'vigilance',
    titre: '',
    message: '',
    consigne: ''
  })

  async function charger() {
    const { data, error } = await supabase
      .from('alertes')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('emise_le', { ascending: false })
      .limit(20)
    if (error) setMessage?.({ type: 'erreur', texte: error.message })
    else setAlertes(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function emettre() {
    if (!f.titre.trim()) return
    const { data, error } = await supabase
      .from('alertes')
      .insert({ evenement_id: evenement.id, ...f })
      .select('id')
      .single()
    if (error) setMessage?.({ type: 'erreur', texte: error.message })
    else {
      setF({ niveau: 'vigilance', titre: '', message: '', consigne: '' })
      setOuvrir(false)
      charger()
      diffuserAlerte(data.id)
    }
  }

  async function lever(id) {
    const motif = prompt('Motif de la levée ?')
    if (motif === null) return
    const { error, count } = await supabase
      .from('alertes')
      .update({ active: false, motif_levee: motif }, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage?.({ type: 'erreur', texte: error.message })
    else if (count === 0) setMessage?.({ type: 'erreur', texte: 'Levée refusée.' })
    else charger()
  }

  const actives = alertes.filter((a) => a.active)

  return (
    <div className="gestion-alertes">
      <div className="entete-dashboard">
        <h2>Alertes</h2>
        <button className="lien" onClick={() => setOuvrir(!ouvrir)}>
          {ouvrir ? 'Annuler' : 'Émettre une alerte'}
        </button>
      </div>

      {ouvrir && (
        <div className="formulaire">
          <label htmlFor="niv">Niveau</label>
          <select
            id="niv"
            value={f.niveau}
            onChange={(e) => setF({ ...f, niveau: e.target.value })}
          >
            {NIVEAUX.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input
            value={f.titre}
            onChange={(e) => setF({ ...f, titre: e.target.value })}
            placeholder="Titre — ce qui se passe"
          />
          <input
            value={f.message}
            onChange={(e) => setF({ ...f, message: e.target.value })}
            placeholder="Précisions (facultatif)"
          />
          <input
            value={f.consigne}
            onChange={(e) => setF({ ...f, consigne: e.target.value })}
            placeholder="Consigne — ce qu'il faut faire"
          />
          <button disabled={!f.titre.trim()} onClick={emettre}>
            Diffuser
          </button>
          <p className="aide">
            La consigne est le champ le plus important. Une alerte qui décrit sans prescrire
            laisse chacun improviser — et improviser à dix, c'est dix décisions différentes.
          </p>
        </div>
      )}

      {actives.length === 0 ? (
        <p className="vide">Aucune alerte active.</p>
      ) : (
        actives.map((a) => (
          <div className="carte urgent" key={a.id}>
            <div className="titre">
              <span className="jeton alerte-texte">{a.niveau}</span> {a.titre}
            </div>
            {a.consigne && <p style={{ margin: '4px 0' }}>→ {a.consigne}</p>}
            <div className="ligne-boutons" style={{ marginTop: 10 }}>
              <button onClick={() => lever(a.id)}>Lever l'alerte</button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
