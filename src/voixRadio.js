/**
 * LA VOIX DU PONT RADIO — ce qui se dit sur le canal, et comment (13/11).
 *
 * Un poste du QG, connecté à Eventware et câblé à une radio calée sur
 * le canal d'urgence, lit les signalements à voix de synthèse : la
 * radio, en VOX, émet dès qu'elle reçoit du son. Tout se passe dans le
 * navigateur — la voix est celle de l'appareil, aucun service tiers.
 *
 * Trois règles, parce que c'est un canal d'urgence :
 *
 * — le message dit ce qu'il faut pour agir : la nature, la gravité si
 *   elle est connue, le lieu comme le montre la carte du signalement
 *   (kilomètre sur le parcours et repère), puis ce que la personne a
 *   écrit (14/11, retour de Ren : « le message n'est que partiel »).
 *   Pas la référence : sur le canal, on désigne un cas par sa nature et
 *   son lieu. Pas le contact. Les numéros et adresses de ce qui a été
 *   écrit sont masqués par la base (masquer_numeros, la même que pour
 *   la page du QR) ; le texte d'un participant anonyme ne part qu'après
 *   qu'un humain l'a lu au QG ;
 * — il est dit DEUX FOIS : la première phrase d'une émission se perd
 *   souvent (le VOX coupe l'attaque, quelqu'un tourne la tête) ;
 * — on ne parle pas par-dessus quelqu'un : si le poste écoute le canal,
 *   il attend deux secondes de silence — mais pas plus de quinze, une
 *   urgence ne reste pas en file derrière une conversation.
 *
 * Ce fichier ne contient que ce qui se compose et se joue ; l'écran
 * (PontRadio.jsx) décide QUOI annoncer et le consigne.
 */

import { situerSurTrace } from './geometrie'

/** La nature, telle qu'on la dit à la radio. */
export const NATURES_PARLEES = {
  malaise: 'Malaise',
  blessure: 'Blessure',
  danger: 'Danger',
  materiel: 'Problème matériel',
  egare: 'Personne égarée',
  autre: 'Incident'
}

/**
 * D'où vient un signalement. C'est ce qui décide s'il part seul sur le canal :
 *   benevole    — bouton « Signaler un incident » d'un membre connecté (INT-) : on sait qui parle ;
 *   participant — page publique du QR, personne n'est connecté (created_by vide) ;
 *   radio       — saisi au QG d'après un appel radio ou téléphonique (RAD-) : le canal
 *                 l'a peut-être déjà entendu, au QG de dire s'il faut le répéter.
 */
export function origine(s) {
  if (/^RAD-/i.test(s?.reference ?? '')) return 'radio'
  return s?.created_by ? 'benevole' : 'participant'
}
export const LIBELLE_ORIGINE = {
  benevole: 'Bénévole',
  participant: 'Participant',
  radio: 'Reçu par radio ou téléphone',
  mayday: 'Mayday'
}

/** Au-delà, un signalement resté en file dans un téléphone n'est plus une nouvelle : au QG de juger. */
export const RETARD_MAX_MS = 10 * 60 * 1000
/** Un signalement jamais pris en charge mais vieux de plus de trois heures n'est plus proposé. */
export const ANCIENNETE_MAX_MS = 3 * 60 * 60 * 1000
/** Un lieu du dispositif « à côté » : en deçà, on dit « près de … ». */
const PROCHE_M = 300

function metres(a, b) {
  const R = 6371000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLon = rad(b.longitude - a.longitude) * Math.cos(rad((a.latitude + b.latitude) / 2))
  return R * Math.sqrt(dLat * dLat + dLon * dLon)
}

/** « 6 » ou « 6,4 » : le kilomètre tel qu'une voix française le lit. */
const kmParle = (km) => km.toFixed(1).replace('.', ',').replace(/,0$/, '')

/**
 * Le lieu, tel qu'on le dit :
 *   1. le lieu choisi par la personne ;
 *   2. sur un parcours, le kilomètre et le repère, comme la carte du
 *      signalement au QG (« km 6.0 · après E3B » → « Kilomètre 6, après
 *      E3B ») — à moins de 300 m de la trace ;
 *   3. le lieu du dispositif le plus proche, à moins de 300 m ;
 *   4. sinon ce qu'on sait. Jamais de coordonnées : personne ne note une
 *      latitude dictée à la radio.
 */
export function lieuParle(o, lieux = [], traces = []) {
  const choisi = o?.lieu_id ? lieux.find((l) => l.id === o.lieu_id) : null
  if (choisi?.nom) return choisi.nom
  if (o?.latitude == null || o?.longitude == null) return 'Lieu non précisé'
  const sur = traces?.length ? situerSurTrace(traces, lieux, o.latitude, o.longitude) : null
  if (sur && sur.ecart_m <= PROCHE_M) {
    const nom = (l) => l.code || l.nom
    const repere = sur.avant && sur.apres ? `entre ${nom(sur.avant)} et ${nom(sur.apres)}`
      : sur.avant ? `après ${nom(sur.avant)}` : sur.apres ? `avant ${nom(sur.apres)}` : null
    return [`${sur.plusieurs && sur.trace ? `${sur.trace}, k` : 'K'}ilomètre ${kmParle(sur.km)}`, repere].filter(Boolean).join(', ')
  }
  let proche = null
  for (const l of lieux) {
    if (l.latitude == null || l.longitude == null || !l.nom) continue
    const d = metres(o, l)
    if (d <= PROCHE_M && (!proche || d < proche.d)) proche = { d, nom: l.nom }
  }
  return proche ? `Près de ${proche.nom}` : 'Position transmise au QG'
}

const GRAVITES_PARLEES = { mineur: 'Gravité mineure', modere: 'Gravité modérée', grave: 'Grave' }
const DESCRIPTION_MAX = 200

/**
 * Ce que la personne a écrit, prêt à être dit. `texte` a déjà été masqué par
 * la base : « [numéro : voir le QG] » se dit « numéro connu du QG ». La phrase
 * que l'application met d'office quand le bénévole n'a rien écrit (« Danger —
 * sans précision, rappeler ») n'apprend rien : elle n'est pas dite. Au-delà
 * de 200 caractères, on coupe au dernier mot : le reste est au QG.
 */
export function descriptionParlee(texte) {
  let t = String(texte ?? '').replace(/\s+/g, ' ').trim()
  if (!t || /—\s*sans précision, rappeler\.?$/i.test(t)) return ''
  t = t.replace(/\[numéro[^\]]*\]/gi, 'numéro connu du QG').replace(/\[adresse[^\]]*\]/gi, 'adresse connue du QG')
  if (t.length > DESCRIPTION_MAX) t = `${t.slice(0, DESCRIPTION_MAX).replace(/\s+\S*$/, '')}, la suite au QG`
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/**
 * Le message d'un signalement, dit une fois : nature, gravité, lieu, puis ce
 * que la personne a écrit (déjà masqué, voir `descriptionParlee`). Pas de
 * référence : sur le canal, un cas se désigne par sa nature et son lieu.
 */
export function texteAnnonce(s, { lieux = [], traces = [], description = '' } = {}) {
  const nature = NATURES_PARLEES[s?.type] ?? 'Incident'
  const gravite = GRAVITES_PARLEES[s?.gravite]
  const ecrit = descriptionParlee(description)
  return [`Signalement. ${nature}.`, gravite ? `${gravite}.` : null, `${lieuParle(s, lieux, traces)}.`, ecrit || null].filter(Boolean).join(' ')
}

/** Le message d'un Mayday : ni le nom de la personne ni son motif ; l'indicatif radio, lui, se dit. */
export function texteMayday(m, { lieux = [], traces = [] } = {}) {
  const indicatif = String(m?.indicatif ?? '').trim()
  return `Mayday. Bénévole en difficulté.${indicatif ? ` Indicatif ${indicatif}.` : ''} ${lieuParle(m, lieux, traces)}.`
}

/**
 * Ce que le pont doit dire, et comment.
 *
 * @param {object} d
 * @param {object[]} d.signalements
 * @param {object[]} d.maydays
 * @param {object[]} d.lieux
 * @param {object[]} [d.traces]   le parcours, pour dire le kilomètre
 * @param {Object<string, string>} [d.descriptions]  id → ce qui a été écrit, MASQUÉ par la base ('' si
 *   rien à dire ou si le masquage a échoué). Un signalement écrit mais pas encore masqué est rendu
 *   avec `attente: true` : il ne part pas avant d'être masqué.
 * @param {Set<string>} d.annonces  identifiants déjà annoncés (main courante et mémoire du poste)
 * @param {Set<string>|null} d.connus  identifiants présents au démarrage du pont ; null : pont arrêté
 * @param {number} [d.maintenant]
 * @returns {{cle, genre, id, reference, origine, texte, quand, mode: 'auto'|'main', retard: boolean}[]}
 *   `auto` : part seul (bénévole identifié ou Mayday, arrivé pendant que le pont tourne, sans retard) ;
 *   `main` : attend un appui du QG.
 */
export function aAnnoncer({ signalements = [], maydays = [], lieux = [], traces = [], descriptions = {}, annonces = new Set(), connus = null, maintenant = Date.now() }) {
  const liste = []
  const recent = (iso) => !iso || maintenant - new Date(iso).getTime() <= ANCIENNETE_MAX_MS
  for (const s of signalements) {
    if (s.statut !== 'recu' || s.doublon_de || s.deleted_at || annonces.has(s.id)) continue
    const quand = s.recu_le ?? s.emis_le
    if (!recent(quand)) continue
    const o = origine(s)
    const retard = !!(s.emis_le && s.recu_le && new Date(s.recu_le) - new Date(s.emis_le) > RETARD_MAX_MS)
    const nouveau = !!connus && !connus.has(s.id)
    const attente = !!s.description && !(s.id in descriptions)
    liste.push({
      cle: `s:${s.id}`, genre: 'signalements', id: s.id, reference: s.reference, origine: o,
      texte: texteAnnonce(s, { lieux, traces, description: descriptions[s.id] ?? '' }), quand, retard, attente,
      mode: o === 'benevole' && nouveau && !retard ? 'auto' : 'main'
    })
  }
  for (const m of maydays) {
    if (m.statut !== 'emis' || annonces.has(m.id)) continue
    if (!recent(m.emis_le)) continue
    const nouveau = !!connus && !connus.has(m.id)
    liste.push({
      cle: `m:${m.id}`, genre: 'maydays', id: m.id, reference: m.reference, origine: 'mayday',
      texte: texteMayday(m, { lieux, traces }), quand: m.emis_le, retard: false,
      mode: nouveau ? 'auto' : 'main'
    })
  }
  // Le Mayday d'abord, puis le plus ancien : c'est l'ordre dans lequel on les dirait.
  return liste.sort((a, b) => (b.genre === 'maydays') - (a.genre === 'maydays') || new Date(a.quand) - new Date(b.quand))
}

/** Le message tel qu'il part sur le canal : annoncé, répété, clos. */
export function annonceComplete(texte) {
  const t = String(texte ?? '').trim().replace(/\s+/g, ' ')
  if (!t) return ''
  const phrase = /[.!?]$/.test(t) ? t : `${t}.`
  return `Message du QG. ${phrase} Je répète. ${phrase} Terminé.`
}

/* ------------------------------------------------------------------ */
/* La voix                                                              */
/* ------------------------------------------------------------------ */

export function voixDisponible() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
}

/** Les voix françaises de l'appareil ; celles de Belgique et de France d'abord. */
export function voixFrancaises() {
  if (!voixDisponible()) return []
  const rang = (v) => (/^fr[-_]BE/i.test(v.lang) ? 0 : /^fr[-_]FR/i.test(v.lang) ? 1 : 2)
  return window.speechSynthesis.getVoices().filter((v) => /^fr/i.test(v.lang)).sort((a, b) => rang(a) - rang(b) || a.name.localeCompare(b.name))
}

let contexte = null
/** Le contexte audio du poste. À créer sur un geste (bouton « Démarrer ») : sans cela le navigateur le garde muet. */
export function contexteAudio() {
  if (!contexte) {
    const C = window.AudioContext || window.webkitAudioContext
    if (C) contexte = new C()
  }
  contexte?.resume?.()
  return contexte
}

/** Le bip d'ouverture : il déclenche le VOX avant le premier mot, qui sinon se perd. */
export function bip(dureeMs = 450) {
  return new Promise((resoudre) => {
    try {
      const ctx = contexteAudio()
      if (!ctx) return resoudre()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 1000
      gain.gain.value = 0.35
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + dureeMs / 1000)
      setTimeout(resoudre, dureeMs + 150)
    } catch {
      resoudre()
    }
  })
}

/** Dit une phrase. Se résout quand elle est finie ; rejette si la voix refuse. */
function dire(phrase, { voix, debit }) {
  return new Promise((resoudre, rejeter) => {
    const u = new window.SpeechSynthesisUtterance(phrase)
    u.lang = voix?.lang ?? 'fr-FR'
    if (voix) u.voice = voix
    u.rate = debit ?? 0.9
    // Une voix qui ne rend jamais la main (cela arrive) bloquerait toutes les annonces suivantes
    // sans que personne le voie : passé un délai large pour la phrase, on le dit.
    const garde = setTimeout(() => {
      seTaire()
      rejeter(new Error('la voix ne répond pas'))
    }, 8000 + phrase.length * 150)
    u.onend = () => { clearTimeout(garde); resoudre() }
    u.onerror = (e) => {
      clearTimeout(garde)
      if (e?.error === 'interrupted' || e?.error === 'canceled') resoudre()
      else rejeter(new Error(e?.error ?? 'voix indisponible'))
    }
    window.speechSynthesis.speak(u)
  })
}

/**
 * À appeler sur le geste qui démarre le pont : certains navigateurs (Safari, sur téléphone et
 * tablette) ne laissent parler une page qu'après une première parole lancée par un appui.
 * Celle-ci est muette.
 */
export function deverrouillerVoix() {
  try {
    const u = new window.SpeechSynthesisUtterance(' ')
    u.volume = 0
    window.speechSynthesis.speak(u)
  } catch {
    /* pas de voix : demarrer() l'a déjà dit */
  }
}

/**
 * Émet un message : bip d'ouverture, puis le texte, phrase par phrase
 * (certains navigateurs coupent une lecture trop longue d'un seul tenant).
 */
export async function parler(texte, { voix = null, debit = 0.9, avecBip = true, arrete = () => false } = {}) {
  if (!voixDisponible()) throw new Error('Ce navigateur n’a pas de voix de synthèse.')
  const phrases = String(texte ?? '').match(/[^.!?]+[.!?]?/g)?.map((p) => p.trim()).filter(Boolean) ?? []
  if (!phrases.length) return false
  if (avecBip) await bip()
  for (const p of phrases) {
    // Arrêté en cours de route (bouton « Arrêter le pont ») : le message n'a pas été dit en entier.
    if (arrete()) return false
    await dire(p, { voix, debit })
  }
  return !arrete()
}

export function seTaire() {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* rien à arrêter */
  }
}

/* ------------------------------------------------------------------ */
/* L'écoute du canal (facultative)                                      */
/* ------------------------------------------------------------------ */

/**
 * Ouvre l'entrée audio du poste (la sortie haut-parleur de la radio y est
 * branchée) et rend de quoi lire le niveau du canal. Sans traitement de la
 * voix : on mesure un signal radio, pas une conversation.
 */
export async function ecouterCanal() {
  const flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const ctx = contexteAudio()
  const source = ctx.createMediaStreamSource(flux)
  const analyseur = ctx.createAnalyser()
  analyseur.fftSize = 1024
  source.connect(analyseur)
  const tampon = new Float32Array(analyseur.fftSize)
  return {
    /** Le flux de l'entrée audio : la capture des transmissions l'enregistre. */
    flux,
    /** Le niveau du canal, de 0 à 1 (valeur efficace). */
    niveau() {
      analyseur.getFloatTimeDomainData(tampon)
      let somme = 0
      for (let i = 0; i < tampon.length; i++) somme += tampon[i] * tampon[i]
      return Math.sqrt(somme / tampon.length)
    },
    fermer() {
      try { source.disconnect() } catch { /* déjà fermé */ }
      flux.getTracks().forEach((t) => t.stop())
    }
  }
}

/**
 * Attend que le canal soit libre : `silenceMs` sous le seuil, sans dépasser `maxMs`.
 * @returns {Promise<'libre'|'force'>} 'force' : on a attendu le maximum, on parle quand même.
 */
export function attendreCanalLibre(niveau, { seuil = 0.04, silenceMs = 2000, maxMs = 15000, pasMs = 100 } = {}) {
  return new Promise((resoudre) => {
    const debut = Date.now()
    let calmeDepuis = null
    const t = setInterval(() => {
      const maintenant = Date.now()
      if (niveau() < seuil) {
        calmeDepuis ??= maintenant
        if (maintenant - calmeDepuis >= silenceMs) { clearInterval(t); resoudre('libre') }
      } else {
        calmeDepuis = null
      }
      if (maintenant - debut >= maxMs) { clearInterval(t); resoudre('force') }
    }, pasMs)
  })
}

/* ------------------------------------------------------------------ */
/* La capture des transmissions (175)                                   */
/* ------------------------------------------------------------------ */

function formatEnregistrement() {
  const candidats = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidats.find((c) => window.MediaRecorder?.isTypeSupported?.(c)) ?? ''
}

export function captureDisponible() {
  return typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia
}

/**
 * Enregistre chaque transmission entendue sur le canal.
 *
 * Le canal est muet entre deux transmissions (le squelch de la radio coupe
 * le souffle) : une transmission commence quand le niveau passe le seuil,
 * elle finit après `silenceMs` sous le seuil, ou à `maxMs`. Un bruit plus
 * court que `minMs` (le « clac » du squelch) n'est pas gardé. Pendant que le
 * pont parle, et un instant après, on n'écoute pas : ce serait sa propre voix.
 *
 * La reconnaissance vocale de l'appareil, si elle existe, tourne pendant la
 * transmission. Elle écoute l'entrée audio PAR DÉFAUT de l'appareil — c'est
 * pourquoi la radio doit en être l'entrée par défaut. Sans texte, le serveur
 * transcrira (si l'événement le demande) ou le QG écrira ce qu'il a entendu.
 *
 * Trois transmissions de suite qui vont jusqu'à `maxMs` : le canal est ouvert
 * en permanence (squelch trop bas, radio sur un canal bruité) ; on s'arrête et
 * on le dit, au lieu de remplir le stockage de souffle.
 *
 * @returns {{ arreter: () => void }}
 */
export function capterTransmissions(canal, {
  seuil = 0.04, silenceMs = 1500, minMs = 800, maxMs = 30000, pasMs = 50,
  enPause = () => false, surDebut = () => {}, surFin = () => {}, surTransmission, surBlocage = () => {}
} = {}) {
  let courante = null
  let pleinesDeSuite = 0
  let fini = false

  function demarrer(maintenant) {
    const mime = formatEnregistrement()
    let rec
    try {
      rec = new MediaRecorder(canal.flux, mime ? { mimeType: mime } : undefined)
    } catch {
      return
    }
    const c = { rec, mime: rec.mimeType || mime || 'audio/webm', morceaux: [], debut: maintenant, dernierSon: maintenant, texte: '', sort: 'absente', reconnaissance: null }
    rec.ondataavailable = (e) => { if (e.data?.size) c.morceaux.push(e.data) }
    rec.start(250)
    const Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition
    if (Reconnaissance) {
      c.sort = 'vide'
      try {
        const r = new Reconnaissance()
        r.lang = 'fr-BE'; r.continuous = true; r.interimResults = true
        r.onresult = (e) => { c.texte = Array.from(e.results).map((x) => x[0]?.transcript ?? '').join(' ').trim(); if (c.texte) c.sort = 'ok' }
        r.onerror = (e) => { if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') c.sort = `erreur:${e.error}` }
        r.start()
        c.reconnaissance = r
      } catch (e) {
        c.sort = `erreur:${e?.name ?? 'inconnue'}`
      }
    }
    courante = c
    surDebut()
  }

  function terminer(maintenant, garder = true) {
    const c = courante
    courante = null
    if (!c) return
    surFin()
    const voixMs = c.dernierSon - c.debut
    const pleine = maintenant - c.debut >= maxMs
    pleinesDeSuite = pleine ? pleinesDeSuite + 1 : 0
    try { if (c.reconnaissance) { c.reconnaissance.onend = null; c.reconnaissance.stop() } } catch { /* déjà arrêtée */ }
    c.rec.onstop = async () => {
      if (!garder || voixMs < minMs || !c.morceaux.length) return
      // La reconnaissance livre parfois ses derniers mots après l'arrêt : on lui laisse un instant.
      await new Promise((r) => setTimeout(r, 400))
      surTransmission?.({
        blob: new Blob(c.morceaux, { type: c.mime }), mime: c.mime,
        debut: new Date(c.debut), duree_s: Math.round((maintenant - c.debut) / 100) / 10,
        transcription: c.texte || null, reconnaissance: c.texte ? 'ok' : c.sort
      })
    }
    try { c.rec.state !== 'inactive' && c.rec.stop() } catch { /* déjà arrêté */ }
    if (pleinesDeSuite >= 3) {
      arreter()
      surBlocage()
    }
  }

  const minuteur = setInterval(() => {
    if (fini) return
    const n = canal.niveau()
    const maintenant = Date.now()
    if (!courante) {
      if (n >= seuil && !enPause()) demarrer(maintenant)
      return
    }
    if (n >= seuil) courante.dernierSon = maintenant
    if (maintenant - courante.dernierSon >= silenceMs || maintenant - courante.debut >= maxMs) terminer(maintenant)
  }, pasMs)

  function arreter() {
    if (fini) return
    fini = true
    clearInterval(minuteur)
    // Une transmission en cours au moment de l'arrêt est gardée : elle a été entendue.
    if (courante) terminer(Date.now())
  }
  return { arreter }
}
