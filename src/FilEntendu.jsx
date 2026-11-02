import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'
import { FormDemande } from './Missions'

/**
 * LE FIL « ENTENDU » — les messages vocaux au QG (162).
 *
 * Sur la Situation, parce que c'est l'écran du QG en exploitation :
 * c'est là que tombent déjà les alertes, les messages de la commune et
 * les demandes qui attendent. Ordre : urgences (reconnues ou
 * douteuses), puis les « nouveau » du plus ancien au plus récent, puis
 * le reste. Un « nouveau » non entendu depuis plus de 5 min passe en
 * vigilance, en urgence s'il est marqué urgent. Chaque geste du QG
 * (Entendu, Répondre, → Demande, Classer) passe au journal.
 */
const INTENTIONS = { URGENCE: 'Urgence', URGENCE_DOUTEUSE: 'Urgence ?', DEA: 'DEA', STATUT_DEMANDE: 'Statut de demande', CANAL: 'Canal radio', NUIT: 'Nuit', AUCUNE: '' }
const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '')
const minutes = (iso) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : 0)

export default function FilEntendu({ evenement, membre, peut, toutPouvoir, setMessage }) {
  const [messages, setMessages] = useState([])
  const [membres, setMembres] = useState({})
  const [lieux, setLieux] = useState([])
  const [audio, setAudio] = useState({}) // id → url signée
  const [reponse, setReponse] = useState({}) // id → brouillon
  const [demande, setDemande] = useState(null) // message → formulaire
  const [tout, setTout] = useState(false)
  const [tic, setTic] = useState(0)
  const peutGerer = toutPouvoir || peut?.('missions', 'modifier')

  async function lire() {
    const [m, mb, l] = await Promise.all([
      supabase.from('messages_vocaux').select('*').eq('evenement_id', evenement.id).is('deleted_at', null).order('parle_le', { ascending: false }).limit(100),
      supabase.from('membres_evenement').select('id, nom_affiche, equipes(code, nom)').eq('evenement_id', evenement.id),
      supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenement.id).is('deleted_at', null).order('nom')
    ])
    setMessages(m.data ?? [])
    setMembres(Object.fromEntries((mb.data ?? []).map((x) => [x.id, x])))
    setLieux(l.data ?? [])
  }

  useEffect(() => {
    lire()
    const canal = supabase.channel(`entendu-${evenement.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages_vocaux', filter: `evenement_id=eq.${evenement.id}` }, lire)
      .subscribe()
    const t = setInterval(() => setTic((x) => x + 1), 30000)
    return () => { supabase.removeChannel(canal); clearInterval(t) }
  }, [evenement.id])

  async function journal(categorie, m, texte) {
    await supabase.rpc('journaliser', { p_evenement: evenement.id, p_module: 'talkie', p_categorie: categorie, p_texte: texte, p_importance: 'routine', p_objet_type: 'messages_vocaux', p_objet_id: m.id, p_objet_ref: null })
  }
  async function maj(m, champs) {
    const refus = await modifierOuRefuser('messages_vocaux', champs, { id: m.id })
    if (refus) { setMessage?.({ type: 'erreur', texte: refus }); return false }
    lire()
    return true
  }
  const qui = (m) => membres[m.membre_id]?.nom_affiche ?? 'membre inconnu'

  async function entendre(m) {
    if (await maj(m, { statut: m.statut === 'nouveau' ? 'entendu' : m.statut, entendu_le: m.entendu_le ?? new Date().toISOString(), entendu_par: membre?.user_id ?? null })) {
      journal('entendu', m, `Message vocal de ${qui(m)} (${heure(m.parle_le)}) entendu`)
    }
  }
  async function repondre(m) {
    const texte = (reponse[m.id] ?? '').trim()
    if (!texte) return
    const champs = { reponse: texte, reponse_le: new Date().toISOString(), reponse_source: 'qg' }
    if (m.statut === 'nouveau') Object.assign(champs, { statut: 'entendu', entendu_le: new Date().toISOString(), entendu_par: membre?.user_id ?? null })
    if (await maj(m, champs)) { setReponse({ ...reponse, [m.id]: '' }); journal('reponse', m, `Réponse du QG à ${qui(m)} : ${texte}`) }
  }
  async function classer(m) {
    if (await maj(m, { statut: 'traite' })) journal('classe', m, `Message vocal de ${qui(m)} classé sans suite`)
  }
  async function lier(m, missionId) {
    if (!missionId) { setDemande(null); return }
    if (await maj(m, { mission_id: missionId, statut: 'traite', entendu_le: m.entendu_le ?? new Date().toISOString(), entendu_par: m.entendu_par ?? membre?.user_id ?? null })) {
      journal('demande', m, `Demande créée depuis le message vocal de ${qui(m)}`)
    }
    setDemande(null)
  }
  async function ecouter(m) {
    if (audio[m.id] || !m.chemin_audio) return
    const { data, error } = await supabase.storage.from('vocaux').createSignedUrl(m.chemin_audio, 600)
    if (error) return setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    setAudio({ ...audio, [m.id]: data?.signedUrl })
  }

  const urgent = (m) => m.urgence || ['URGENCE', 'URGENCE_DOUTEUSE'].includes(m.intention)
  const rang = (m) => (m.statut !== 'traite' && urgent(m) ? 0 : m.statut === 'nouveau' ? 1 : m.statut === 'entendu' ? 2 : 3)
  const tries = [...messages].sort((a, b) => rang(a) - rang(b) || (rang(a) === 1 ? a.parle_le.localeCompare(b.parle_le) : b.parle_le.localeCompare(a.parle_le)))
  const visibles = tout ? tries : tries.filter((m) => m.statut !== 'traite').concat(tries.filter((m) => m.statut === 'traite').slice(0, 3))
  const niveau = (m) => {
    if (m.statut !== 'nouveau') return ''
    if (urgent(m)) return 'niv-urgence'
    return minutes(m.parle_le) > 5 ? 'niv-vigilance' : ''
  }
  const nouveaux = messages.filter((m) => m.statut === 'nouveau').length

  if (!messages.length) return null
  return (
    <div className="bloc-alerte fil-entendu" data-tic={tic}>
      <div className="pave-titre">
        Entendu — messages vocaux ({nouveaux} à entendre)
        {messages.some((m) => m.statut === 'traite') && <button className="lien" style={{ marginLeft: 8 }} onClick={() => setTout(!tout)}>{tout ? 'réduire' : 'tout voir'}</button>}
      </div>
      {visibles.map((m) => {
        const retard = m.recu_le && m.parle_le ? Math.round((new Date(m.recu_le) - new Date(m.parle_le)) / 60000) : 0
        const mb = membres[m.membre_id]
        return (
          <div className={`ligne-retard message-vocal statut-${m.statut} ${niveau(m)}`} key={m.id}>
            <strong>
              {urgent(m) && <span className="prc-jeton chaud">{m.intention === 'URGENCE_DOUTEUSE' ? 'urgence ?' : 'urgence'}</span>}{' '}
              {qui(m)}{mb?.equipes?.code ? ` (${mb.equipes.code})` : ''} · parlé à {heure(m.parle_le)}
              {retard > 2 && <span className="aide"> · reçu à {heure(m.recu_le)}, {retard} min de retard réseau</span>}
              {m.statut === 'nouveau' && minutes(m.parle_le) > 5 && <span className="aide"> · attend depuis {minutes(m.parle_le)} min</span>}
            </strong>
            <div className="vocal-corps">
              {m.chemin_audio ? (
                audio[m.id]
                  ? <audio controls src={audio[m.id]} preload="none" />
                  : <button className="discret" onClick={() => ecouter(m)}>▶ Écouter ({m.duree_s ?? '?'} s)</button>
              ) : <span className="aide">{m.transcription ? 'sans audio (effacé)' : 'sans audio'}</span>}
              {peutGerer ? (
                <input
                  className="vocal-transcription"
                  defaultValue={m.transcription_corrigee ?? m.transcription ?? ''}
                  placeholder={m.transcription ? '' : 'Pas de transcription : écrire ce qui a été dit'}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m.transcription_corrigee ?? m.transcription ?? '')) maj(m, { transcription_corrigee: v || null }) }}
                />
              ) : <span>{m.transcription_corrigee ?? m.transcription}</span>}
            </div>
            <div className="meta">
              {peutGerer ? (
                <select value={m.lieu_id ?? ''} onChange={(e) => maj(m, { lieu_id: e.target.value || null })} aria-label="Lieu">
                  <option value="">lieu : aucun</option>
                  {lieux.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
                </select>
              ) : <span>{lieux.find((l) => l.id === m.lieu_id)?.nom ?? ''}</span>}
              {m.intention && INTENTIONS[m.intention] && <span>intention : {INTENTIONS[m.intention]}</span>}
              {m.reponse && <span className={m.reponse_source === 'auto' ? 'aide' : ''}>{m.reponse_source === 'auto' ? 'réponse automatique' : 'réponse du QG'} : {m.reponse}</span>}
              {m.mission_id && <span>demande créée</span>}
              {m.entendu_le && <span>entendu à {heure(m.entendu_le)}</span>}
            </div>
            {peutGerer && m.statut !== 'traite' && (
              <div className="ligne-boutons vocal-gestes">
                {m.statut === 'nouveau' && <button onClick={() => entendre(m)}>Entendu</button>}
                <input value={reponse[m.id] ?? ''} placeholder="Répondre…" onChange={(e) => setReponse({ ...reponse, [m.id]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && repondre(m)} />
                <button className="discret" onClick={() => repondre(m)} disabled={!(reponse[m.id] ?? '').trim()}>Envoyer</button>
                <button className="discret" onClick={() => setDemande(m)}>→ Demande</button>
                <button className="discret" onClick={() => classer(m)}>Classer</button>
              </div>
            )}
          </div>
        )
      })}
      {demande && (
        <div className="voile" onClick={() => setDemande(null)}>
          <div className="tiroir" onClick={(e) => e.stopPropagation()}>
            <div className="tiroir-tete"><strong>Demande depuis le message de {qui(demande)}</strong><button className="lien" onClick={() => setDemande(null)}>Fermer</button></div>
            <FormDemande
              mode={urgent(demande) ? 'urgent' : 'normal'}
              evenement={evenement} membre={membre} module="logistique" libelle="Demande"
              lieux={lieux} setMessage={setMessage ?? (() => {})}
              initial={{ precision: demande.transcription_corrigee ?? demande.transcription ?? '', descriptif: demande.transcription_corrigee ?? demande.transcription ?? '', lieuId: demande.lieu_id ?? '' }}
              onFait={(id) => lier(demande, id)} onSuivre={(id) => lier(demande, id)} onAnnuler={() => setDemande(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
