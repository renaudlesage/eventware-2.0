import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/* ================================================================== */
/* Jauge                                                               */
/* ================================================================== */

export default function Jauge({ evenement, membre, peut, toutPouvoir, setMessage }) {
  const [jauge, setJauge] = useState(null)
  const [lieux, setLieux] = useState([])
  const [lieu, setLieu] = useState('')
  const [derniers, setDerniers] = useState([])

  const peutCompter = toutPouvoir || peut?.('logistique', 'creer')

  async function charger() {
    const [j, l, c] = await Promise.all([
      supabase.rpc('jauge_courante', { p_evenement: evenement.id }),
      supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenement.id),
      supabase
        .from('comptages')
        .select('*')
        .eq('evenement_id', evenement.id)
        .order('horodatage', { ascending: false })
        .limit(8)
    ])
    if (!j.error) setJauge(j.data)
    setLieux(l.data ?? [])
    setDerniers(c.data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function compter(sens, nombre) {
    const { error } = await supabase.from('comptages').insert({
      evenement_id: evenement.id,
      sens,
      nombre,
      lieu_id: lieu || null,
      membre_id: membre.id
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else charger()
  }

  return (
    <>
      <div className="pave" style={{ marginBottom: 14 }}>
        <div className="pave-titre">Présents estimés</div>
        <div className="grand">{jauge ?? '…'}</div>
      </div>

      {peutCompter && (
        <>
          <label htmlFor="lieu-jauge">Point d'accès</label>
          <select id="lieu-jauge" value={lieu} onChange={(e) => setLieu(e.target.value)}>
            <option value="">— tous —</option>
            {lieux.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.nom}
              </option>
            ))}
          </select>

          <div className="grille-comptage">
            {[1, 5, 10, 25].map((n) => (
              <button key={'e' + n} onClick={() => compter('entree', n)}>
                + {n}
              </button>
            ))}
            {[1, 5, 10, 25].map((n) => (
              <button key={'s' + n} className="discret" onClick={() => compter('sortie', n)}>
                − {n}
              </button>
            ))}
          </div>

          <p className="aide">
            Saisie par lots : sur le terrain on compte un groupe, pas une personne à la fois.
          </p>
        </>
      )}

      {derniers.length > 0 && (
        <ul className="chrono">
          {derniers.map((c) => (
            <li key={c.id}>
              <span className="heure mono">
                {new Date(c.horodatage).toLocaleTimeString('fr-BE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="corps">
                {c.sens === 'entree' ? '+' : '−'}
                {c.nombre}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
