import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { libelleStatut } from './libelles'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'

/**
 * Recherches de personnes, sorties de Securite.jsx au lot 12 (26/09),
 * sans changement de comportement.
 */

export default function Recherches({ evenement, peut, toutPouvoir, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [ouvrir, setOuvrir] = useState(false)

  // Policies `recherches_creation` / `recherches_modification` : même
  // ressource que le SOS.
  const peutDeclarer = toutPouvoir || peut?.('sos', 'creer')
  const peutCloturer = toutPouvoir || peut?.('sos', 'modifier')
  const [f, setF] = useState({
    nom: '',
    age_approx: '',
    description: '',
    dernier_lieu: '',
    point_regroupement: '',
    accompagnant_nom: '',
    accompagnant_tel: ''
  })
  const [occupe, setOccupe] = useState(false)

  async function charger() {
    const { data, error } = await supabase
      .from('recherches')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('created_at', { ascending: false })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 15000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function declarer() {
    setOccupe(true)
    // La référence (REC-07) est attribuée par la base (110) : compter
    // les lignes affichées oubliait les recherches supprimées, et la
    // référence calculée existait déjà (audit 4.8).
    const { error } = await supabase.from('recherches').insert({
      evenement_id: evenement.id,
      ...f,
      age_approx: f.age_approx ? Number(f.age_approx) : null
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setF({
        nom: '',
        age_approx: '',
        description: '',
        dernier_lieu: '',
        point_regroupement: '',
        accompagnant_nom: '',
        accompagnant_tel: ''
      })
      setOuvrir(false)
      charger()
    }
    setOccupe(false)
  }

  async function cloturer(id, circonstances) {
    const refus = await modifierOuRefuser(
      'recherches',
      { statut: 'retrouve', retrouve_le: new Date().toISOString(), circonstances },
      { id }
    )
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }

  const actives = lignes.filter((l) => l.statut === 'en_cours')

  return (
    <>
      {actives.length > 0 && (
        <div className="message erreur">
          {actives.length} recherche(s) en cours — diffusion à toutes les équipes
        </div>
      )}

      {peutDeclarer && (
        <button className="discret" onClick={() => setOuvrir(!ouvrir)}>
          {ouvrir ? 'Annuler' : 'Déclarer une recherche'}
        </button>
      )}

      {peutDeclarer && ouvrir && (
        <div className="formulaire">
          {[
            ['nom', 'Nom / prénom'],
            ['age_approx', 'Âge approximatif'],
            ['description', 'Description — vêtements, signes distinctifs'],
            ['dernier_lieu', 'Vu pour la dernière fois'],
            ['point_regroupement', 'Point de regroupement'],
            ['accompagnant_nom', 'Accompagnant'],
            ['accompagnant_tel', 'Téléphone accompagnant']
          ].map(([k, l]) => (
            <div key={k}>
              <label htmlFor={k}>{l}</label>
              <input
                id={k}
                value={f[k]}
                onChange={(e) => setF({ ...f, [k]: e.target.value })}
              />
            </div>
          ))}
          <button disabled={occupe || !f.description.trim()} onClick={declarer}>
            Déclarer et diffuser
          </button>
          <p className="aide">
            La description compte plus que le nom : c'est elle qui permet de reconnaître la
            personne sur le terrain.
          </p>
        </div>
      )}

      {lignes.length === 0 ? (
        <p className="vide">Aucune recherche.</p>
      ) : (
        lignes.map((l) => (
          <div className={`carte ${l.statut === 'en_cours' ? 'urgent' : ''}`} key={l.id}>
            <div className="titre">
              <span className="mono">{l.reference}</span> — {l.nom || 'Personne non identifiée'}
              {l.age_approx ? `, ${l.age_approx} ans` : ''}
            </div>
            <p style={{ margin: '4px 0' }}>{l.description}</p>
            <div className="meta">
              {l.dernier_lieu && <span>vu·e : {l.dernier_lieu}</span>}
              {l.point_regroupement && <span>regroupement : {l.point_regroupement}</span>}
              {l.accompagnant_tel && <span>{l.accompagnant_tel}</span>}
              <span className="jeton">{libelleStatut(l.statut)}</span>
            </div>
            {peutCloturer && l.statut === 'en_cours' && (
              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                <button
                  onClick={() => {
                    const c = prompt('Circonstances ?')
                    if (c !== null) cloturer(l.id, c)
                  }}
                >
                  Retrouvé·e
                </button>
              </div>
            )}
            {l.circonstances && <p className="aide">{l.circonstances}</p>}
          </div>
        ))
      )}
    </>
  )
}

