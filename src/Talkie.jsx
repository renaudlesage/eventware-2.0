import { useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import { supabase } from './supabaseClient'
import { ajouterVocal, enAttenteVocaux, surChangementVocaux, demarrerVocaux, abandonnerVocal } from './fileVocaux'

/**
 * TALKIE-TÉLÉPHONE, côté bénévole (162).
 *
 * Un bouton maintenu : on parle, on relâche, le message part au QG dès
 * qu'il y a du réseau, avec l'heure où l'on a parlé et la position.
 * Glisser hors du bouton annule. Vingt secondes au plus. Si l'appareil
 * sait reconnaître la parole, la transcription part avec l'audio — mais
 * l'audio d'abord : un message sans transcription reste parfaitement
 * utilisable par le QG. Sous le bouton, toujours : « Urgence vitale :
 * appelle le 112 ».
 */
const DUREE_MAX_S = 20
const CLE_CONSENTEMENT = 'eventware.talkie.consentement'

export function talkieDisponible() {
  return typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia
}

function formatAudio() {
  const candidats = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidats.find((c) => window.MediaRecorder?.isTypeSupported?.(c)) ?? ''
}

const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '')

/** L'écran d'information de la première fois — il vaut consentement. */
export function InfoTalkie({ onAccepter, onRefuser }) {
  return (
    <div className="voile" onClick={onRefuser}>
      <div className="tiroir talkie-info" onClick={(e) => e.stopPropagation()}>
        <div className="tiroir-tete"><strong>Parler au QG</strong></div>
        <p>Ton message vocal est enregistré, écouté par le QG, et l'audio est effacé à la clôture de l'événement. La transcription, si ton téléphone en fait une, reste.</p>
        <p>Pour quelques questions simples (ton canal, l'heure de la nuit, le DEA le plus proche, où en est ta demande), Eventware répond lui-même. Un humain lit tout le reste.</p>
        <p className="aide">Sur iPhone, l'application est suspendue quand l'écran est verrouillé : les réponses s'affichent à la réouverture.</p>
        <p><strong>Urgence vitale : appelle le 112.</strong></p>
        <div className="ligne-boutons">
          <button onClick={onAccepter}>J'ai compris, je parle</button>
          <button className="discret" onClick={onRefuser}>Pas maintenant</button>
        </div>
      </div>
    </div>
  )
}

/** (166) Pourquoi un message n'a pas de texte : le sort de la reconnaissance sur le téléphone, en clair. */
export function motifReconnaissance(sort) {
  if (!sort || sort === 'ok') return ''
  if (sort === 'absente') return 'pas de reconnaissance vocale sur ce téléphone (Firefox, ou navigateur ancien)'
  if (sort === 'vide') return 'rien reconnu par le téléphone'
  const motif = sort.replace(/^erreur:/, '')
  if (motif === 'audio-capture' || motif === 'not-allowed' || motif === 'service-not-allowed') return 'le téléphone a refusé le micro à la reconnaissance (déjà pris par l’enregistrement, ou autorisation refusée)'
  if (motif === 'network') return 'reconnaissance impossible sans réseau sur ce téléphone'
  if (motif === 'language-not-supported') return 'français non reconnu par ce téléphone'
  return `reconnaissance en erreur (${motif})`
}

export function BoutonParler({ evenement, membre, onEnvoye, variante = 'pave' }) {
  const [etat, setEtat] = useState('repos') // repos | enregistre | annule
  const [reste, setReste] = useState(DUREE_MAX_S)
  const [info, setInfo] = useState(false)
  const [erreur, setErreur] = useState(null)
  const enregistreur = useRef(null)
  const morceaux = useRef([])
  const debut = useRef(null)
  const minuteur = useRef(null)
  const reconnaissance = useRef(null)
  const sort = useRef('absente') // ok | absente | vide | erreur:<motif>
  const texte = useRef('')
  const position = useRef(null)
  const annule = useRef(false)

  useEffect(() => { demarrerVocaux() }, [])

  async function demarrer() {
    if (etat !== 'repos') return
    let consentement = false
    try { consentement = localStorage.getItem(CLE_CONSENTEMENT) === 'oui' } catch { consentement = false }
    if (!consentement) { setInfo(true); return }
    setErreur(null)
    annule.current = false
    texte.current = ''
    position.current = null
    try {
      const flux = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = formatAudio()
      const r = new MediaRecorder(flux, mime ? { mimeType: mime } : undefined)
      morceaux.current = []
      r.ondataavailable = (e) => { if (e.data?.size) morceaux.current.push(e.data) }
      r.onstop = () => { flux.getTracks().forEach((t) => t.stop()); terminer(r.mimeType || mime) }
      enregistreur.current = r
      debut.current = new Date()
      r.start(250)
      setEtat('enregistre')
      setReste(DUREE_MAX_S)
      navigator.vibrate?.(30)
      minuteur.current = setInterval(() => {
        const ecoule = (Date.now() - debut.current.getTime()) / 1000
        setReste(Math.max(0, Math.ceil(DUREE_MAX_S - ecoule)))
        if (ecoule >= DUREE_MAX_S) arreter()
      }, 250)
      navigator.geolocation?.getCurrentPosition(
        (p) => { position.current = { latitude: p.coords.latitude, longitude: p.coords.longitude, precision_m: Math.round(p.coords.accuracy) } },
        () => {}, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      )
      // La reconnaissance sur l'appareil, en option : certaines plateformes refusent le micro à deux
      // consommateurs. Si elle échoue, le message part sans transcription, jamais sans audio — mais
      // avec le motif (166), pour que le QG sache pourquoi le texte manque.
      const Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition
      sort.current = Reconnaissance ? 'vide' : 'absente'
      if (Reconnaissance) {
        try {
          const rec = new Reconnaissance()
          rec.lang = 'fr-BE'; rec.continuous = true; rec.interimResults = true
          rec.onresult = (e) => { texte.current = Array.from(e.results).map((x) => x[0]?.transcript ?? '').join(' ').trim(); if (texte.current) sort.current = 'ok' }
          rec.onerror = (e) => { if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') sort.current = `erreur:${e.error}` }
          // Sur Android, la reconnaissance s'arrête d'elle-même au premier silence : on la relance tant qu'on parle.
          rec.onend = () => { if (enregistreur.current && enregistreur.current.state === 'recording' && !String(sort.current).startsWith('erreur')) { try { rec.start() } catch { /* rien */ } } }
          rec.start()
          reconnaissance.current = rec
        } catch (e) { reconnaissance.current = null; sort.current = `erreur:${e?.name ?? 'inconnue'}` }
      }
    } catch (e) {
      setErreur(e?.name === 'NotAllowedError' ? 'Micro refusé : autorise-le dans les réglages du navigateur.' : 'Micro indisponible sur cet appareil.')
      setEtat('repos')
    }
  }

  function arreter(annuler = false) {
    if (etat !== 'enregistre' && !enregistreur.current) return
    annule.current = annuler
    clearInterval(minuteur.current)
    try { enregistreur.current?.state !== 'inactive' && enregistreur.current?.stop() } catch { /* rien */ }
    try { if (reconnaissance.current) { reconnaissance.current.onend = null; reconnaissance.current.stop() } } catch { /* rien */ }
    navigator.vibrate?.(annuler ? [20, 40, 20] : 50)
    setEtat(annuler ? 'annule' : 'repos')
    if (annuler) setTimeout(() => setEtat('repos'), 900)
  }

  async function terminer(mime) {
    enregistreur.current = null
    if (annule.current) return
    const duree = Math.round(((Date.now() - debut.current.getTime()) / 1000) * 10) / 10
    const blob = new Blob(morceaux.current, { type: mime || 'audio/webm' })
    if (duree < 0.5 || blob.size === 0) return
    // La reconnaissance livre parfois son dernier mot après l'arrêt : on lui laisse un instant.
    await new Promise((r) => setTimeout(r, 400))
    await ajouterVocal({
      id: crypto.randomUUID(), evenement_id: evenement.id, membre_id: membre.id,
      parle_le: debut.current.toISOString(), duree_s: duree, blob, mime: blob.type,
      transcription: texte.current || null, reconnaissance: texte.current ? 'ok' : sort.current, ...(position.current ?? {})
    })
    onEnvoye?.()
  }

  if (!membre?.id) return null
  return (
    <>
      <div className={`talkie-pile ${variante}`}>
        <button
          type="button"
          className={`${variante === 'flottant' ? 'flottant' : 'parler-pave'} parler ${etat}`}
          aria-label="Parler au QG — maintenir pour parler"
          onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); demarrer() }}
          onPointerUp={() => arreter(false)}
          onPointerCancel={() => arreter(true)}
          onPointerLeave={() => { if (etat === 'enregistre') arreter(true) }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Mic size={variante === 'flottant' ? 20 : 26} strokeWidth={2} aria-hidden="true" />
          <span>{etat === 'enregistre' ? `${reste} s — relâche pour envoyer` : etat === 'annule' ? 'Annulé' : variante === 'flottant' ? 'Parler' : 'Maintenir pour parler au QG'}</span>
        </button>
        <span className="talkie-112">Urgence vitale : appelle le 112.</span>
        {erreur && <span className="talkie-erreur">{erreur}</span>}
      </div>
      {info && (
        <InfoTalkie
          onAccepter={() => { try { localStorage.setItem(CLE_CONSENTEMENT, 'oui') } catch { /* rien */ } setInfo(false) }}
          onRefuser={() => setInfo(false)}
        />
      )}
    </>
  )
}

/** Mes messages : en attente de réseau, envoyés, entendus, la réponse. */
export function MesMessages({ evenement, membre, onCompteurs }) {
  const [attente, setAttente] = useState([])
  const [envoyes, setEnvoyes] = useState([])

  async function lire() {
    const enAttente = await enAttenteVocaux()
    setAttente(enAttente)
    if (!membre?.id) return
    const { data } = await supabase
      .from('messages_vocaux')
      .select('id, parle_le, recu_le, duree_s, transcription, transcription_corrigee, reconnaissance, statut, entendu_le, reponse, reponse_le, reponse_source, intention, urgence, mission_id')
      .eq('evenement_id', evenement.id).eq('membre_id', membre.id).order('parle_le', { ascending: false }).limit(20)
    setEnvoyes(data ?? [])
    onCompteurs?.({ attente: enAttente.filter((m) => !m.definitif).length, reponses: (data ?? []).filter((m) => m.reponse).length })
  }

  useEffect(() => {
    lire()
    const off = surChangementVocaux(lire)
    const canal = supabase.channel(`vocaux-${evenement.id}-${membre?.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages_vocaux', filter: `evenement_id=eq.${evenement.id}` }, lire)
      .subscribe()
    return () => { off(); supabase.removeChannel(canal) }
  }, [evenement.id, membre?.id])

  if (!attente.length && !envoyes.length) return <p className="vide">Aucun message vocal envoyé.</p>
  return (
    <ul className="mes-messages">
      {attente.map((m) => (
        <li key={m.id} className={m.definitif ? 'refuse' : 'attente'}>
          <strong>{heure(m.parle_le)}</strong> — {m.transcription || `${m.duree_s ?? '?'} s d'audio`}
          <div className="aide">
            {m.definitif ? `refusé : ${m.erreur}` : 'en attente de réseau'}
            {m.definitif && <button className="lien" style={{ marginLeft: 8 }} onClick={() => abandonnerVocal(m.id)}>abandonner</button>}
          </div>
        </li>
      ))}
      {envoyes.map((m) => (
        <li key={m.id} className={`envoye statut-${m.statut}`}>
          <strong>{heure(m.parle_le)}</strong> — {m.transcription_corrigee || m.transcription || `${m.duree_s ?? '?'} s d'audio`}
          <div className="aide">
            envoyé à {heure(m.recu_le)}
            {m.entendu_le ? ` · entendu par le QG à ${heure(m.entendu_le)}` : ' · pas encore entendu'}
            {m.mission_id ? ' · demande créée' : ''}
            {!m.transcription && !m.transcription_corrigee && m.reconnaissance && m.reconnaissance !== 'ok' ? ` · ${motifReconnaissance(m.reconnaissance)}` : ''}
          </div>
          {m.reponse && (
            <div className={`talkie-reponse ${m.reponse_source}`}>
              <span className="prc-jeton veille">{m.reponse_source === 'auto' ? 'réponse automatique' : 'QG'}</span> {m.reponse}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
