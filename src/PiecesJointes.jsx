import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Pièces jointes d'un objet — un jalon aujourd'hui, une demande demain.
 *
 * Le compartiment est PRIVÉ : contrairement aux logos et au référentiel
 * public, un devis ou un contrat ne doit pas se lire sur simple
 * connaissance de l'adresse. Les liens de téléchargement sont donc
 * signés à la demande et expirent — ils ne se transmettent pas.
 */
export default function PiecesJointes({ evenement, objetType, objetId, peutGerer, setMessage }) {
  const [pieces, setPieces] = useState(null)
  const [occupe, setOccupe] = useState(false)

  async function charger() {
    const { data, error } = await supabase
      .from('pieces_jointes')
      .select('*')
      .eq('objet_type', objetType)
      .eq('objet_id', objetId)
      .is('deleted_at', null)
      .order('created_at')
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setPieces(data ?? [])
  }

  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objetId])

  async function deposer(fichier) {
    if (!fichier) return
    if (fichier.size > 20 * 1024 * 1024) {
      setMessage({ type: 'erreur', texte: 'Fichier trop lourd — 20 Mo au maximum.' })
      return
    }
    setOccupe(true)

    // Le chemin commence par l'identifiant d'événement : c'est lui que
    // les règles de stockage lisent pour accorder ou refuser l'accès.
    const propre = fichier.name.replace(/[^\w.\-]/g, '_')
    const chemin = `${evenement.id}/${objetType}/${objetId}/${Date.now()}-${propre}`

    const { error: e1 } = await supabase.storage.from('pieces').upload(chemin, fichier)
    if (e1) {
      setMessage({ type: 'erreur', texte: e1.message })
      setOccupe(false)
      return
    }

    const { error: e2 } = await supabase.from('pieces_jointes').insert({
      evenement_id: evenement.id,
      objet_type: objetType,
      objet_id: objetId,
      nom: fichier.name,
      chemin,
      taille: fichier.size,
      type_mime: fichier.type || null
    })
    if (e2) {
      // La ligne n'a pas été écrite : on retire le fichier, sinon il
      // resterait dans le stockage sans que rien n'y renvoie.
      await supabase.storage.from('pieces').remove([chemin])
      setMessage({ type: 'erreur', texte: e2.message })
    } else charger()
    setOccupe(false)
  }

  async function ouvrir(p) {
    const { data, error } = await supabase.storage
      .from('pieces')
      .createSignedUrl(p.chemin, 60)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function retirer(p) {
    if (!window.confirm(`Retirer « ${p.nom} » ?`)) return
    const { error } = await supabase
      .from('pieces_jointes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', p.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      await supabase.storage.from('pieces').remove([p.chemin])
      charger()
    }
  }

  if (pieces === null) return null

  const poids = (o) =>
    o == null ? '' : o > 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${Math.round(o / 1024)} ko`

  return (
    <div style={{ marginTop: 8 }}>
      {pieces.length > 0 && (
        <ul className="chrono">
          {pieces.map((p) => (
            <li key={p.id}>
              <span className="corps">
                <button className="lien" onClick={() => ouvrir(p)}>
                  {p.nom}
                </button>
                <span className="aide"> {poids(p.taille)}</span>
              </span>
              {peutGerer && (
                <button className="lien" onClick={() => retirer(p)}>
                  retirer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {peutGerer && (
        <label className="aide" style={{ display: 'block', marginTop: 4 }}>
          {occupe ? 'Dépôt en cours…' : 'Joindre un fichier (20 Mo max)'}
          <input
            type="file"
            disabled={occupe}
            onChange={(e) => {
              deposer(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      )}
    </div>
  )
}
