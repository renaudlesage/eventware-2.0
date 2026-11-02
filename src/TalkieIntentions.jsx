import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/**
 * TALKIE — le référentiel des intentions (162), console plateforme.
 *
 * La réponse automatique reconnaît une intention par mots-clés, sans
 * modèle de langage : la première intention, dans l'ordre, dont un
 * motif figure dans le texte normalisé (minuscules, sans accents)
 * l'emporte. Les motifs sont des débuts de mots (« bless » attrape
 * « blessé », « blessure »). Commun à tous les événements ; l'exploitant
 * seul le modifie.
 */
export default function TalkieIntentions({ setMessage }) {
  const [liste, setListe] = useState([])
  const [brouillons, setBrouillons] = useState({})

  async function charger() {
    const { data, error } = await supabase.from('talkie_intentions').select('*').order('ordre').order('code')
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    setListe(data ?? [])
    setBrouillons(Object.fromEntries((data ?? []).map((i) => [i.id, i.motifs.join(', ')])))
  }
  useEffect(() => { charger() }, [])

  async function enregistrer(i) {
    const motifs = (brouillons[i.id] ?? '').split(',').map((m) => m.trim().toLowerCase()).filter(Boolean)
    const { error } = await supabase.from('talkie_intentions').update({ motifs }).eq('id', i.id)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    setMessage({ type: 'succes', texte: `Motifs de « ${i.libelle} » enregistrés.` })
    charger()
  }

  async function basculer(i) {
    const { error } = await supabase.from('talkie_intentions').update({ actif: !i.actif }).eq('id', i.id)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    charger()
  }

  return (
    <section className="bloc talkie-intentions">
      <h2>Intentions reconnues dans un message vocal</h2>
      <p className="aide">
        La première intention, dans l'ordre, dont un motif figure dans le texte l'emporte. Un motif est un début de mot,
        sans accent : « bless » attrape « blessé ». Une négation juste avant un motif d'urgence (« pas de blessé ») rend
        l'urgence douteuse au lieu de la conclure. Aucune réponse automatique ne donne d'information à une urgence, hormis le 112.
      </p>
      {liste.length === 0 ? <p className="vide">Aucune intention.</p> : (
        <table className="tableau">
          <thead><tr><th>Ordre</th><th>Code</th><th>Intention</th><th>Motifs (séparés par des virgules)</th><th></th></tr></thead>
          <tbody>
            {liste.map((i) => (
              <tr key={i.id} className={i.actif ? '' : 'inactif'}>
                <td>{i.ordre}</td>
                <td className="mono">{i.code}</td>
                <td>{i.libelle}</td>
                <td>
                  <input value={brouillons[i.id] ?? ''} onChange={(e) => setBrouillons({ ...brouillons, [i.id]: e.target.value })} />
                </td>
                <td className="ligne-boutons">
                  <button className="discret" onClick={() => enregistrer(i)} disabled={(brouillons[i.id] ?? '') === i.motifs.join(', ')}>Enregistrer</button>
                  <button className="discret" onClick={() => basculer(i)}>{i.actif ? 'Désactiver' : 'Réactiver'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
