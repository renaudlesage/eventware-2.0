import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { modifierOuRefuser } from './ecriture'
import { texteErreur } from './erreurs'

/* ================================================================== */
/* Attributions — clés et radios                                       */
/* ================================================================== */

export default function Attributions({ evenement, peut, toutPouvoir, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [filtre, setFiltre] = useState('dehors')
  const [f, setF] = useState({
    nature: 'cle',
    code: '',
    libelle: '',
    detail: '',
    porteur_libre: ''
  })

  const peutRemettre = toutPouvoir || peut?.('logistique', 'creer')
  const peutRendre = toutPouvoir || peut?.('logistique', 'modifier')

  async function charger() {
    const { data, error } = await supabase
      .from('attributions')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('created_at', { ascending: false })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function remettre() {
    if (!f.code.trim() || !f.libelle.trim()) return
    const { error } = await supabase.from('attributions').insert({
      evenement_id: evenement.id,
      ...f,
      remis_le: new Date().toISOString()
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setF({ nature: 'cle', code: '', libelle: '', detail: '', porteur_libre: '' })
      charger()
    }
  }

  async function rendre(id) {
    const refus = await modifierOuRefuser(
      'attributions',
      { rendu_le: new Date().toISOString() },
      { id }
    )
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }

  const dehors = lignes.filter((l) => !l.rendu_le)
  const visibles = filtre === 'dehors' ? dehors : lignes

  return (
    <>
      <div className="compteurs">
        <span className={dehors.length ? 'alerte-texte' : ''}>
          Non rendus <strong>{dehors.length}</strong>
        </span>
        <span>
          Total <strong>{lignes.length}</strong>
        </span>
      </div>

      {peutRemettre && (
        <div className="saisie-rapide">
          <select
            value={f.nature}
            onChange={(e) => setF({ ...f, nature: e.target.value })}
            style={{ width: 'auto', marginBottom: 0 }}
          >
            <option value="cle">Clé</option>
            <option value="radio">Radio</option>
            <option value="equipement">Équipement</option>
            <option value="vehicule">Véhicule</option>
          </select>
          <input
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value })}
            placeholder="Code / indicatif"
            style={{ flex: '0 1 130px' }}
          />
          <input
            value={f.libelle}
            onChange={(e) => setF({ ...f, libelle: e.target.value })}
            placeholder="Libellé"
          />
          <input
            value={f.detail}
            onChange={(e) => setF({ ...f, detail: e.target.value })}
            placeholder="Canal, local…"
            style={{ flex: '0 1 140px' }}
          />
          <input
            value={f.porteur_libre}
            onChange={(e) => setF({ ...f, porteur_libre: e.target.value })}
            placeholder="Remis à"
            style={{ flex: '0 1 140px' }}
          />
          <button onClick={remettre}>Remettre</button>
        </div>
      )}

      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        {[
          ['dehors', 'Non rendus'],
          ['tout', 'Tout']
        ].map(([k, l]) => (
          <button
            key={k}
            className={`module ${filtre === k ? 'actif' : ''}`}
            onClick={() => setFiltre(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <p className="vide">Rien en circulation.</p>
      ) : (
        visibles.map((l) => (
          <div className={`carte ${!l.rendu_le ? 'urgent' : ''}`} key={l.id}>
            <div className="titre">
              <span className="mono">{l.code}</span> — {l.libelle}
            </div>
            <div className="meta">
              <span className="jeton">{l.nature}</span>
              {l.detail && <span>{l.detail}</span>}
              {l.porteur_libre && <span>chez {l.porteur_libre}</span>}
              {l.rendu_le ? (
                <span>rendu {new Date(l.rendu_le).toLocaleString('fr-BE')}</span>
              ) : (
                <span className="alerte-texte">non rendu</span>
              )}
            </div>
            {peutRendre && !l.rendu_le && (
              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                <button onClick={() => rendre(l.id)}>Retour</button>
              </div>
            )}
          </div>
        ))
      )}
      <p className="aide">
        Le démontage est le moment où les clés disparaissent — l'équipe est fatiguée et
        personne ne note rien. Cette liste est ce qu'on relit le dimanche soir.
      </p>
    </>
  )
}
