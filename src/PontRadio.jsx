import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import Message from './Message'
import {
  LIBELLE_ORIGINE, aAnnoncer, annonceComplete, attendreCanalLibre, captureDisponible, capterTransmissions, contexteAudio,
  deverrouillerVoix, ecouterCanal, parler, seTaire, voixDisponible, voixFrancaises
} from './voixRadio'
import { ajouterVocal, demarrerVocaux } from './fileVocaux'
import { nouvelleCle } from './reessai'

/**
 * PONT RADIO (13/11) — le poste du QG qui parle sur le canal d'urgence.
 *
 * Tous les bénévoles n'ont pas l'application ouverte ; tous ceux qui ont
 * une radio l'entendent. Ce poste, câblé à une radio en VOX, dit à voix
 * de synthèse ce qui vient d'arriver dans Eventware.
 *
 * Qui parle seul, qui attend un appui :
 *   — le signalement d'un BÉNÉVOLE connecté et un MAYDAY partent seuls :
 *     on sait qui parle, et chaque seconde compte ;
 *   — le signalement d'un PARTICIPANT (page publique, anonyme), un SOS
 *     saisi au QG d'après un appel, un signalement resté longtemps en
 *     file dans un téléphone : un appui du QG. Personne d'extérieur ne
 *     doit pouvoir faire parler le canal d'urgence tout seul.
 *
 * « Seul » veut dire : arrivé PENDANT que le pont tourne. Ce qui était
 * déjà là au démarrage reste proposé, jamais lancé d'office — rallumer
 * le poste ne rejoue pas la matinée sur le canal.
 *
 * Chaque annonce s'inscrit dans la main courante ; c'est aussi elle qui
 * dit ce qui a déjà été annoncé. Le pont ne tourne que tant que cet
 * écran reste ouvert, au premier plan : c'est un poste dédié.
 *
 * L'ÉCOUTE (175). La sortie haut-parleur de la radio branchée sur
 * l'entrée audio du poste, le pont peut :
 *   — attendre que le canal soit libre avant de parler ;
 *   — enregistrer chaque transmission entendue et la ranger dans le fil
 *     « Entendu » de la Situation, avec les messages du talkie, marquée
 *     « Radio ». Elle y est transcrite (par l'appareil, sinon par le
 *     serveur si l'événement le demande), classée (une urgence remonte en
 *     tête), et le QG en fait une demande d'un geste. Personne n'y reçoit
 *     de réponse écrite : on ne sait pas qui a parlé.
 */
const DEBITS = [['0.8', 'Lent'], ['0.9', 'Posé'], ['1', 'Normal']]
// Le niveau au-delà duquel le canal est « occupé ». Il dépend du volume de la radio et du gain de l'entrée :
// le poste le règle d'après la barre de niveau.
const SENSIBILITES = [['0.02', 'Sensible'], ['0.04', 'Normale'], ['0.08', 'Peu sensible']]
const MAX_LIBRE = 240
// Un signalement se dit avec tout ce qui est remonté (ce qui a été écrit : jusqu'à 400 caractères) : sa ligne a plus de place.
const MAX_SIGNALEMENT = 640
// Au-delà, les signalements suivants attendent un appui : un téléphone qui s'emballe (ou quelqu'un
// qui s'amuse) ne doit pas occuper le canal d'urgence à lui seul. Un Mayday, lui, part toujours.
const MAX_AUTO = 5
const FENETRE_AUTO_MS = 10 * 60 * 1000

const lire = (cle, defaut) => {
  try { return localStorage.getItem(cle) ?? defaut } catch { return defaut }
}
const ecrire = (cle, valeur) => {
  try { localStorage.setItem(cle, valeur) } catch { /* mémoire indisponible : le réglage vaudra pour cette séance */ }
}
const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '')

export default function PontRadio({ evenement, membre }) {
  const cleFaits = `pont-radio-faits:${evenement.id}`
  const [donnees, setDonnees] = useState({ signalements: [], maydays: [], lieux: [], journal: [] })
  const [pret, setPret] = useState(false)
  const [message, setMessage] = useState(null)

  const [actif, setActif] = useState(false)
  const [connus, setConnus] = useState(null) // ce qui était déjà là au démarrage
  const [faits, setFaits] = useState(() => {
    try { return new Set(JSON.parse(lire(cleFaits, '[]'))) } catch { return new Set() }
  })
  const [echecs, setEchecs] = useState(() => new Set())
  const [enCours, setEnCours] = useState(null) // { cle, texte, etape: 'attente' | 'emission' }
  const [textes, setTextes] = useState({}) // le texte retouché par le QG, par clé
  const [libre, setLibre] = useState('')

  const [voix, setVoix] = useState([])
  const [nomVoix, setNomVoix] = useState(() => lire('pont-radio-voix', ''))
  const [debit, setDebit] = useState(() => lire('pont-radio-debit', '0.9'))
  const [ecoute, setEcoute] = useState(false) // l'entrée audio est ouverte
  const [niveau, setNiveau] = useState(0)
  const [attendre, setAttendre] = useState(true) // attendre que le canal soit libre avant de parler
  const [enregistrer, setEnregistrer] = useState(false) // ranger les transmissions dans « Entendu »
  const [seuil, setSeuil] = useState(() => lire('pont-radio-seuil', '0.04'))
  const [capte, setCapte] = useState(false) // une transmission est en cours d'enregistrement
  const [captees, setCaptees] = useState([]) // ce que ce poste a capté depuis l'ouverture de l'écran
  const finEmission = useRef(0)
  const essaiEnCours = useRef(false)
  const attendreRef = useRef(true)
  attendreRef.current = attendre
  const seuilRef = useRef(0.04)
  seuilRef.current = Number(seuil) || 0.04

  const file = useRef([])
  const occupe = useRef(false)
  const arret = useRef(false)
  const lances = useRef(new Set())
  const autos = useRef([]) // l'heure des dernières annonces automatiques de signalements
  const canal = useRef(null)
  const verrou = useRef(null)
  const reglages = useRef({ voix: null, debit: 0.9 })
  const actifRef = useRef(false)
  actifRef.current = actif

  const voixChoisie = voix.find((v) => v.name === nomVoix) ?? voix[0] ?? null
  reglages.current = { voix: voixChoisie, debit: Number(debit) || 0.9 }

  /* --- Les voix de l'appareil : elles arrivent parfois après l'ouverture de la page --- */
  useEffect(() => {
    if (!voixDisponible()) return undefined
    const maj = () => setVoix(voixFrancaises())
    maj()
    window.speechSynthesis.addEventListener?.('voiceschanged', maj)
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', maj)
  }, [])

  /* --- Lecture : signalements, Mayday, lieux, et ce que la main courante dit du pont --- */
  async function charger() {
    const [s, m, l, j] = await Promise.all([
      supabase.from('signalements')
        // Ni le contact ni l'auteur : le pont n'en a pas besoin, il ne les charge pas.
        .select('id, reference, type, statut, description, lieu_id, latitude, longitude, emis_le, recu_le, created_by, doublon_de')
        .eq('evenement_id', evenement.id).order('recu_le', { ascending: false }).limit(60),
      supabase.from('maydays').select('id, reference, statut, emetteur_nom, indicatif, motif, latitude, longitude, emis_le')
        .eq('evenement_id', evenement.id).order('emis_le', { ascending: false }).limit(20),
      supabase.from('lieux').select('id, code, nom, latitude, longitude, pk_km').eq('evenement_id', evenement.id).is('deleted_at', null),
      supabase.from('journal').select('id, horodatage, categorie, texte, objet_id, objet_ref, auteur_nom')
        .eq('evenement_id', evenement.id).in('categorie', ['annonce_radio', 'pont_radio'])
        .order('horodatage', { ascending: false }).limit(60)
    ])
    const erreur = s.error ?? m.error ?? l.error
    if (erreur) {
      // Sans la liste, le pont est sourd : on le dit, et on le redit tant que ça dure.
      setMessage({ type: 'erreur', texte: `Le pont ne reçoit plus les signalements : ${texteErreur(erreur)}` })
      return null
    }
    const d = {
      signalements: s.data ?? [], maydays: m.data ?? [], lieux: l.data ?? [],
      // La main courante peut être fermée à ce membre : le pont marche sans, avec la seule mémoire du poste.
      journal: (j.data ?? []).filter((x) => x.categorie === 'annonce_radio' || x.categorie === 'pont_radio')
    }
    setDonnees(d)
    setPret(true)
    return d
  }
  useEffect(() => {
    charger()
    const t = setInterval(charger, actif ? 5000 : 15000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id, actif])

  // (14/11) Le parcours, pour dire le kilomètre comme la carte du signalement. Il ne bouge pas pendant l'événement : lu une fois.
  const [traces, setTraces] = useState([])
  useEffect(() => {
    supabase.from('traces').select('nom, points').eq('evenement_id', evenement.id).is('deleted_at', null).eq('actif', true)
      .then(({ data }) => setTraces(data ?? []))
  }, [evenement.id])

  // (14/11) Ce que la personne a écrit, masqué par la base avant d'être dit (numéros, adresses) : la même
  // fonction que la page du QR. Tant que ce n'est pas fait, le signalement attend ; si le masquage échoue,
  // on ne lit pas le texte — le reste du message part. Pas plus de cinq secondes d'attente : une urgence ne
  // reste pas bloquée derrière un réseau lent.
  const [descriptions, setDescriptions] = useState({})
  const demandees = useRef(new Set())
  useEffect(() => {
    // Ce qui a été écrit : la description d'un signalement, le motif d'un Mayday.
    const textes = [
      ...donnees.signalements.filter((s) => s.statut === 'recu' && !s.doublon_de).map((s) => [s.id, s.description]),
      ...donnees.maydays.filter((m) => m.statut === 'emis').map((m) => [m.id, m.motif])
    ]
    for (const [id, texte] of textes) {
      if (!texte || demandees.current.has(id)) continue
      demandees.current.add(id)
      const delai = new Promise((resoudre) => setTimeout(() => resoudre({ error: 'délai' }), 5000))
      Promise.race([supabase.rpc('masquer_numeros', { p_texte: texte }), delai])
        .then(({ data, error }) => setDescriptions((d) => (id in d ? d : { ...d, [id]: error || typeof data !== 'string' ? '' : data })))
        .catch(() => setDescriptions((d) => ({ ...d, [id]: '' })))
    }
  }, [donnees])

  const annonces = useMemo(() => {
    const ids = new Set(faits)
    for (const x of donnees.journal) if (x.categorie === 'annonce_radio' && x.objet_id) ids.add(x.objet_id)
    return ids
  }, [faits, donnees.journal])

  const [retenus, setRetenus] = useState(() => new Set()) // partis en « À annoncer » parce que le plafond était atteint
  const liste = useMemo(
    () => aAnnoncer({ ...donnees, traces, descriptions, annonces, connus: actif ? connus : null })
      .map((a) => (echecs.has(a.cle) ? { ...a, mode: 'main', echec: true } : retenus.has(a.cle) ? { ...a, mode: 'main', retenu: true } : a)),
    [donnees, traces, descriptions, annonces, connus, actif, echecs, retenus]
  )

  /* --- L'émission : une annonce à la fois, dans l'ordre --- */
  function noterFait(id) {
    setFaits((avant) => {
      const apres = new Set(avant).add(id)
      ecrire(cleFaits, JSON.stringify([...apres].slice(-200)))
      return apres
    })
  }

  async function emettre(a) {
    const attente = !!canal.current && attendreRef.current
    setEnCours({ cle: a.cle, texte: a.texte, etape: attente ? 'attente' : 'emission' })
    let force = false
    if (attente) {
      force = (await attendreCanalLibre(canal.current.niveau, { seuil: seuilRef.current })) === 'force'
      if (arret.current) return
      setEnCours({ cle: a.cle, texte: a.texte, etape: 'emission' })
    }
    let dit = false
    try {
      dit = await parler(annonceComplete(a.texte), { ...reglages.current, arrete: () => arret.current })
    } catch (e) {
      setEchecs((avant) => new Set(avant).add(a.cle))
      setMessage({ type: 'erreur', texte: `L’annonce n’est pas partie (${e.message}).${a.id ? ' Elle reste dans « À annoncer ».' : ''}` })
      return
    }
    if (!dit) return
    if (a.id) noterFait(a.id)
    const { error } = await supabase.rpc('journaliser', {
      p_evenement: evenement.id,
      p_module: 'securite',
      p_categorie: 'annonce_radio',
      p_texte: `Annonce radio${a.mode === 'auto' ? ' (automatique)' : ''}${force ? ', canal occupé' : ''} : ${a.texte}`,
      p_importance: 'notable',
      p_objet_type: a.genre ?? null,
      p_objet_id: a.id ?? null,
      p_objet_ref: a.reference ?? null
    })
    if (error) setMessage({ type: 'erreur', texte: `Annonce faite, mais pas inscrite dans la main courante : ${texteErreur(error)}` })
    else if (a.mode !== 'auto') setMessage({ texte: `Annoncé sur la radio${a.reference ? ` : ${a.reference}` : ''}.` })
  }

  async function vider() {
    if (occupe.current) return
    occupe.current = true
    try {
      while (file.current.length && !arret.current) await emettre(file.current.shift())
    } finally {
      occupe.current = false
      finEmission.current = Date.now()
      setEnCours(null)
      charger()
    }
  }
  function mettreEnFile(a) {
    // Une annonce automatique ne se lance qu'une fois ; un double appui ne dit pas le message deux fois.
    if (a.mode === 'auto' ? lances.current.has(a.cle) : file.current.some((x) => x.cle === a.cle)) return
    lances.current.add(a.cle)
    file.current.push(a)
    vider()
  }

  // Ce qui doit partir seul part dès qu'il apparaît — dans la limite du plafond pour les signalements.
  useEffect(() => {
    if (!actif) return
    for (const a of liste) {
      if (a.mode !== 'auto' || a.attente || lances.current.has(a.cle)) continue
      if (a.genre === 'signalements') {
        const maintenant = Date.now()
        autos.current = autos.current.filter((t) => maintenant - t < FENETRE_AUTO_MS)
        if (autos.current.length >= MAX_AUTO) {
          setRetenus((avant) => new Set(avant).add(a.cle))
          setMessage({ type: 'erreur', texte: `Plus de ${MAX_AUTO} annonces automatiques en dix minutes : les signalements suivants attendent ton appui dans « À annoncer ».` })
          continue
        }
        autos.current.push(maintenant)
      }
      mettreEnFile(a)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liste, actif])

  /* --- Démarrer, arrêter --- */
  async function garderEveille() {
    try {
      if ('wakeLock' in navigator) verrou.current = await navigator.wakeLock.request('screen')
    } catch { /* refusé (batterie faible, onglet caché) : l'aide dit de garder l'écran allumé */ }
  }
  async function demarrer() {
    if (!voixDisponible()) {
      setMessage({ type: 'erreur', texte: 'Ce navigateur n’a pas de voix de synthèse : le pont ne peut pas parler. Essaie Chrome, Edge ou Safari.' })
      return
    }
    contexteAudio() // sur ce geste, sinon le navigateur garde le poste muet
    deverrouillerVoix()
    const d = await charger()
    if (!d) return
    arret.current = false
    lances.current = new Set()
    autos.current = []
    setEchecs(new Set())
    setRetenus(new Set())
    setConnus(new Set([...d.signalements, ...d.maydays].map((x) => x.id)))
    setActif(true)
    garderEveille()
    supabase.rpc('journaliser', { p_evenement: evenement.id, p_module: 'securite', p_categorie: 'pont_radio', p_texte: 'Pont radio démarré', p_importance: 'routine' }).then(() => charger())
  }
  function couper() {
    arret.current = true
    file.current = []
    seTaire()
    verrou.current?.release?.()
    verrou.current = null
  }
  function arreter() {
    couper()
    setActif(false)
    setConnus(null)
    supabase.rpc('journaliser', { p_evenement: evenement.id, p_module: 'securite', p_categorie: 'pont_radio', p_texte: 'Pont radio arrêté', p_importance: 'routine' }).then(() => charger())
  }
  // Quitter l'écran arrête le pont, et la main courante le dit : personne ne doit le croire en veille.
  useEffect(() => () => {
    if (actifRef.current) {
      couper()
      supabase.rpc('journaliser', { p_evenement: evenement.id, p_module: 'securite', p_categorie: 'pont_radio', p_texte: 'Pont radio arrêté (écran quitté)', p_importance: 'routine' }).then(() => {})
    }
    canal.current?.fermer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Le verrou d'écran tombe quand l'onglet passe derrière : on le reprend au retour.
  useEffect(() => {
    if (!actif) return undefined
    const retour = () => { if (document.visibilityState === 'visible') garderEveille() }
    document.addEventListener('visibilitychange', retour)
    return () => document.removeEventListener('visibilitychange', retour)
  }, [actif])

  /* --- L'écoute du canal (facultative) --- */
  async function basculerEcoute(oui) {
    if (!oui) {
      if (enregistrer) basculerEnregistrement(false)
      canal.current?.fermer()
      canal.current = null
      setEcoute(false)
      return
    }
    try {
      canal.current = await ecouterCanal()
      setEcoute(true)
    } catch {
      setMessage({ type: 'erreur', texte: 'L’entrée audio est refusée ou absente : le pont parlera sans attendre que le canal soit libre, et n’enregistre rien.' })
    }
  }
  useEffect(() => {
    if (!ecoute) return undefined
    const t = setInterval(() => setNiveau(canal.current?.niveau() ?? 0), 250)
    return () => clearInterval(t)
  }, [ecoute])

  /* --- (175) Ranger les transmissions dans « Entendu » --- */
  // L'enregistrement range sous le membre qui tient le pont, avec les messages du talkie : il faut le module.
  const raisonSansEnregistrement = !captureDisponible() ? 'ce navigateur ne sait pas enregistrer'
    : evenement.modules?.talkie !== true ? 'le module Talkie n’est pas activé pour cet événement (Réglages › Modules)'
      : !membre?.id ? 'tu n’es pas membre de cet événement' : null
  useEffect(() => { demarrerVocaux() }, [])
  function basculerEnregistrement(oui) {
    setEnregistrer(oui)
    supabase.rpc('journaliser', {
      p_evenement: evenement.id, p_module: 'securite', p_categorie: 'pont_radio', p_importance: 'notable',
      p_texte: oui ? 'Pont radio : enregistrement du canal activé' : 'Pont radio : enregistrement du canal arrêté'
    }).then(() => charger())
  }
  async function ranger(t) {
    const id = nouvelleCle()
    setCaptees((c) => [{ id, quand: t.debut.toISOString(), duree: t.duree_s, texte: t.transcription }, ...c].slice(0, 10))
    await ajouterVocal({
      id, evenement_id: evenement.id, membre_id: membre.id, parle_le: t.debut.toISOString(), duree_s: t.duree_s,
      blob: t.blob, mime: t.mime, transcription: t.transcription, reconnaissance: t.reconnaissance,
      transcrire: evenement.modules?.talkie_transcription_serveur === true, source: 'radio'
    })
  }
  useEffect(() => {
    if (!actif || !ecoute || !enregistrer || !canal.current || raisonSansEnregistrement) return undefined
    const capteur = capterTransmissions(canal.current, {
      seuil: Number(seuil) || 0.04,
      // Pendant que le pont parle, et une seconde et demie après : ce serait sa propre voix.
      enPause: () => occupe.current || essaiEnCours.current || Date.now() - finEmission.current < 1500,
      surDebut: () => setCapte(true),
      surFin: () => setCapte(false),
      surTransmission: ranger,
      surBlocage: () => {
        setCapte(false)
        basculerEnregistrement(false)
        setMessage({ type: 'erreur', texte: 'Le canal semble ouvert en permanence (trois enregistrements de trente secondes de suite) : enregistrement arrêté. Vérifie le squelch de la radio ou baisse la sensibilité.' })
      }
    })
    return () => { capteur.arreter(); setCapte(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, ecoute, enregistrer, seuil, raisonSansEnregistrement])

  async function essai() {
    contexteAudio()
    essaiEnCours.current = true
    try {
      await parler('Essai du pont radio. Un, deux, trois. Terminé.', reglages.current)
    } catch (e) {
      setMessage({ type: 'erreur', texte: `La voix ne répond pas : ${e.message}` })
    } finally {
      essaiEnCours.current = false
      finEmission.current = Date.now()
    }
  }

  function annoncerLibre(e) {
    e.preventDefault()
    const texte = libre.trim()
    if (!texte) return
    mettreEnFile({ cle: `l:${Date.now()}`, genre: null, id: null, reference: null, origine: 'libre', texte, mode: 'main' })
    setLibre('')
  }

  const aLaMain = liste.filter((a) => a.mode === 'main')
  const faites = donnees.journal.filter((x) => x.categorie === 'annonce_radio')
  // Un autre poste a démarré un pont et ne l'a pas arrêté : deux ponts diraient tout deux fois.
  const dernierEtat = donnees.journal.find((x) => x.categorie === 'pont_radio' && /^Pont radio (démarré|arrêté)/.test(x.texte ?? ''))
  const autrePont = !actif && dernierEtat && /démarré/.test(dernierEtat.texte ?? '') && Date.now() - new Date(dernierEtat.horodatage).getTime() < 12 * 3600 * 1000
  const occupeCanal = ecoute && niveau >= (Number(seuil) || 0.04)

  return (
    <div className="pont-radio">
      <p className="aide">
        Ce poste lit les signalements sur le canal d’urgence, à voix de synthèse. Il doit être relié à une radio
        (sortie casque du poste vers l’entrée micro de la radio, radio en VOX) et rester sur cet écran, allumé, au premier plan.
        Le message dit tout ce qui est remonté : la nature, la gravité, le lieu (le kilomètre sur le parcours, comme la carte du signalement), ce que la personne a écrit, combien l’ont signalé, l’heure d’émission s’il est arrivé en retard ; pour un Mayday, qui, son indicatif et son motif. Numéros et adresses masqués ; pas la référence, pas le contact.
      </p>

      <Message message={message} onFermer={() => setMessage(null)} />

      <div className={`pont-etat ${actif ? 'actif' : ''}`} role="status">
        <div className="pont-etat-texte">
          <strong>{actif ? (enCours ? (enCours.etape === 'attente' ? 'Attend que le canal soit libre…' : 'Émission en cours') : 'Pont en veille') : 'Pont arrêté'}</strong>
          <span>
            {actif
              ? enCours ? enCours.texte : 'Un signalement de bénévole ou un Mayday partira seul sur le canal.'
              : 'Rien ne part sur le canal tant que le pont n’est pas démarré sur ce poste.'}
          </span>
        </div>
        {actif
          ? <button type="button" onClick={arreter}>Arrêter le pont</button>
          : <button type="button" className="principal" onClick={demarrer} disabled={!pret}>Démarrer le pont</button>}
      </div>

      {autrePont && (
        <p className="aide alerte">
          Un pont radio a été démarré à {heure(dernierEtat.horodatage)}{dernierEtat.auteur_nom ? ` par ${dernierEtat.auteur_nom}` : ''} et
          n’a pas été arrêté depuis. Un seul poste doit émettre : n’en démarre un second que si le premier est éteint.
        </p>
      )}

      <div className="pont-reglages">
        <label>
          Voix
          <select value={voixChoisie?.name ?? ''} onChange={(e) => { setNomVoix(e.target.value); ecrire('pont-radio-voix', e.target.value) }} disabled={!voix.length}>
            {!voix.length && <option value="">Voix par défaut de l’appareil</option>}
            {voix.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
          </select>
        </label>
        <label>
          Débit
          <select value={debit} onChange={(e) => { setDebit(e.target.value); ecrire('pont-radio-debit', e.target.value) }}>
            {DEBITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <button type="button" onClick={essai} disabled={!!enCours}>Essai de voix</button>
      </div>
      {voixDisponible() && !voix.length && (
        <p className="aide">Aucune voix française sur cet appareil : le message serait lu avec un accent étranger. Ajoute une voix française dans les réglages de l’appareil (synthèse vocale).</p>
      )}

      <h3>Écoute du canal</h3>
      <label className="pont-ecoute">
        <input type="checkbox" checked={ecoute} onChange={(e) => basculerEcoute(e.target.checked)} />
        <span>
          Écouter le canal
          <small>La sortie haut-parleur de la radio doit être branchée sur l’entrée audio de ce poste, et cette entrée doit être celle choisie par défaut — pas le micro intégré, qui entendrait la salle.</small>
        </span>
      </label>
      {ecoute && (
        <div className="pont-ecoute-options">
          <div className={`pont-niveau ${occupeCanal ? 'occupe' : ''}`} aria-label={occupeCanal ? 'Canal occupé' : 'Canal libre'}>
            <span className="pont-niveau-barre"><span style={{ width: `${Math.min(100, Math.round(niveau * 400))}%` }} /></span>
            <span>{capte ? 'Transmission en cours d’enregistrement' : occupeCanal ? 'Canal occupé' : 'Canal libre'}</span>
          </div>
          <label className="pont-sensibilite">
            Sensibilité
            <select value={seuil} onChange={(e) => { setSeuil(e.target.value); ecrire('pont-radio-seuil', e.target.value) }}>
              {SENSIBILITES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <p className="aide">Canal muet, la barre doit rester vide ; quand quelqu’un parle, elle doit dire « Canal occupé ». Sinon, change la sensibilité ou le volume de la radio.</p>
          <label className="pont-ecoute">
            <input type="checkbox" checked={attendre} onChange={(e) => setAttendre(e.target.checked)} />
            <span>
              Attendre que le canal soit libre avant de parler
              <small>Deux secondes de silence, quinze au plus : une urgence ne reste pas en file derrière une conversation.</small>
            </span>
          </label>
          <label className="pont-ecoute">
            <input type="checkbox" checked={enregistrer} disabled={!!raisonSansEnregistrement} onChange={(e) => basculerEnregistrement(e.target.checked)} />
            <span>
              Enregistrer les transmissions dans « Entendu »
              <small>
                {raisonSansEnregistrement
                  ? `Indisponible : ${raisonSansEnregistrement}.`
                  : 'Chaque transmission entendue, pont démarré, arrive dans le fil « Entendu » de la Situation, marquée « Radio », transcrite si possible. Le canal d’urgence est alors enregistré : dis-le aux bénévoles au briefing. L’audio est effacé à la clôture de l’événement, comme celui du talkie.'}
              </small>
            </span>
          </label>
          {enregistrer && !actif && <p className="aide">L’enregistrement commence quand le pont est démarré.</p>}
          {enregistrer && captees.length > 0 && (
            <ul className="pont-faites pont-captees">
              {captees.map((c) => (
                <li key={c.id}><span className="mono">{heure(c.quand)}</span> {c.duree} s — {c.texte ? `« ${c.texte} »` : 'transcription au QG'}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <h3>À annoncer{aLaMain.length ? ` (${aLaMain.length})` : ''}</h3>
      {!pret ? <p className="vide">Chargement…</p> : !aLaMain.length ? (
        <p className="vide">Rien n’attend. Le signalement d’un participant ou un SOS saisi au QG apparaîtra ici : il ne part sur le canal qu’après ton appui.</p>
      ) : (
        <div className="prc-liste">
          {aLaMain.map((a) => {
            const texte = textes[a.cle] ?? a.texte
            return (
              <div key={a.cle} className="prc-ligne pont-ligne" data-objet={a.id}>
                <div className="prc-ligne-texte">
                  <span>
                    <span className={`prc-jeton ${a.origine === 'mayday' ? 'chaud' : a.origine === 'benevole' ? 'ok' : 'veille'}`}>{LIBELLE_ORIGINE[a.origine]}</span>{' '}
                    <span className="mono">{a.reference}</span> · reçu à {heure(a.quand)}
                    {a.retard && ' · resté en file dans le téléphone'}
                    {a.echec && ' · l’annonce automatique a échoué'}
                    {a.retenu && ' · retenu, trop d’annonces automatiques'}
                  </span>
                  {a.attente && <span className="sourdine">Masquage des numéros en cours…</span>}
                  <textarea
                    rows={3} maxLength={MAX_SIGNALEMENT} value={texte} aria-label={`Message pour ${a.reference}`}
                    onChange={(e) => setTextes((t) => ({ ...t, [a.cle]: e.target.value }))}
                  />
                </div>
                <button type="button" className="principal" disabled={!actif || !texte.trim() || a.attente || enCours?.cle === a.cle} onClick={() => mettreEnFile({ ...a, texte: texte.trim() })}>
                  Annoncer sur la radio
                </button>
              </div>
            )
          })}
        </div>
      )}
      {!actif && aLaMain.length > 0 && <p className="aide">Démarre le pont sur ce poste pour annoncer : le message sort par le haut-parleur de l’appareil où tu appuies.</p>}

      <h3>Annonce libre</h3>
      <form className="pont-libre" onSubmit={annoncerLibre}>
        <textarea
          rows={2} maxLength={MAX_LIBRE} value={libre} onChange={(e) => setLibre(e.target.value)}
          placeholder="Ex. : Orage annoncé dans vingt minutes. Mettez-vous à l’abri aux étapes." aria-label="Texte de l’annonce libre"
        />
        <div className="ligne-boutons">
          <button type="submit" disabled={!actif || !libre.trim()}>Annoncer sur la radio</button>
          <span className="aide">Dit deux fois. Ni nom ni numéro : un canal radio s’écoute. {libre.length}/{MAX_LIBRE}</span>
        </div>
      </form>

      <h3>Annonces faites</h3>
      {!faites.length ? <p className="vide">Aucune annonce pour l’instant. Chacune s’inscrit dans la main courante.</p> : (
        <ul className="pont-faites">
          {faites.slice(0, 20).map((x) => (
            <li key={x.id}><span className="mono">{heure(x.horodatage)}</span> {x.texte}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
