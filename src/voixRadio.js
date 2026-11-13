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
 * — le message est COURT et sans donnée personnelle : nature, lieu,
 *   référence. Jamais la description libre ni le contact : un canal
 *   radio s'écoute, et le texte d'un participant anonyme n'a pas à y
 *   être lu sans qu'un humain l'ait vu ;
 * — il est dit DEUX FOIS : la première phrase d'une émission se perd
 *   souvent (le VOX coupe l'attaque, quelqu'un tourne la tête) ;
 * — on ne parle pas par-dessus quelqu'un : si le poste écoute le canal,
 *   il attend deux secondes de silence — mais pas plus de quinze, une
 *   urgence ne reste pas en file derrière une conversation.
 *
 * Ce fichier ne contient que ce qui se compose et se joue ; l'écran
 * (PontRadio.jsx) décide QUOI annoncer et le consigne.
 */

/** La nature, telle qu'on la dit à la radio. */
export const NATURES_PARLEES = {
  malaise: 'Malaise',
  blessure: 'Blessure',
  danger: 'Danger',
  materiel: 'Problème matériel',
  egare: 'Personne égarée',
  autre: 'Incident'
}

const CHIFFRES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf']

/**
 * Une référence, épelée : « SOS-014 » → « S, O, S, zéro, un, quatre ».
 * Une voix de synthèse lit « SOS-014 » comme elle veut (« sosse moins quatorze ») ;
 * lettre à lettre et chiffre à chiffre, tout le monde note la même chose.
 */
export function epeler(reference) {
  return String(reference ?? '')
    .toUpperCase()
    .split('')
    .map((c) => (/[0-9]/.test(c) ? CHIFFRES[Number(c)] : /[A-Z]/.test(c) ? c : null))
    .filter(Boolean)
    .join(', ')
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

/**
 * Le lieu, tel qu'on le dit : le lieu choisi, sinon le lieu du dispositif le
 * plus proche de la position, sinon ce qu'on sait. Jamais de coordonnées :
 * personne ne note une latitude dictée à la radio.
 */
export function lieuParle(o, lieux = []) {
  const choisi = o?.lieu_id ? lieux.find((l) => l.id === o.lieu_id) : null
  if (choisi?.nom) return choisi.nom
  if (o?.latitude == null || o?.longitude == null) return 'Lieu non précisé'
  let proche = null
  for (const l of lieux) {
    if (l.latitude == null || l.longitude == null || !l.nom) continue
    const d = metres(o, l)
    if (d <= PROCHE_M && (!proche || d < proche.d)) proche = { d, nom: l.nom }
  }
  return proche ? `Près de ${proche.nom}` : 'Position transmise au QG'
}

/** Le message d'un signalement, dit une fois : nature, lieu, référence — rien d'autre. */
export function texteAnnonce(s, lieux) {
  const nature = NATURES_PARLEES[s?.type] ?? 'Incident'
  const reference = epeler(s?.reference)
  return `Signalement. ${nature}. ${lieuParle(s, lieux)}.${reference ? ` Référence ${reference}.` : ''}`
}

/** Le message d'un Mayday : ni le nom de la personne ni son motif ; l'indicatif radio, lui, se dit. */
export function texteMayday(m, lieux) {
  const indicatif = String(m?.indicatif ?? '').trim()
  const reference = epeler(m?.reference)
  return `Mayday. Bénévole en difficulté.${indicatif ? ` Indicatif ${indicatif}.` : ''} ${lieuParle(m, lieux)}.${reference ? ` Référence ${reference}.` : ''}`
}

/**
 * Ce que le pont doit dire, et comment.
 *
 * @param {object} d
 * @param {object[]} d.signalements
 * @param {object[]} d.maydays
 * @param {object[]} d.lieux
 * @param {Set<string>} d.annonces  identifiants déjà annoncés (main courante et mémoire du poste)
 * @param {Set<string>|null} d.connus  identifiants présents au démarrage du pont ; null : pont arrêté
 * @param {number} [d.maintenant]
 * @returns {{cle, genre, id, reference, origine, texte, quand, mode: 'auto'|'main', retard: boolean}[]}
 *   `auto` : part seul (bénévole identifié ou Mayday, arrivé pendant que le pont tourne, sans retard) ;
 *   `main` : attend un appui du QG.
 */
export function aAnnoncer({ signalements = [], maydays = [], lieux = [], annonces = new Set(), connus = null, maintenant = Date.now() }) {
  const liste = []
  const recent = (iso) => !iso || maintenant - new Date(iso).getTime() <= ANCIENNETE_MAX_MS
  for (const s of signalements) {
    if (s.statut !== 'recu' || s.doublon_de || s.deleted_at || annonces.has(s.id)) continue
    const quand = s.recu_le ?? s.emis_le
    if (!recent(quand)) continue
    const o = origine(s)
    const retard = !!(s.emis_le && s.recu_le && new Date(s.recu_le) - new Date(s.emis_le) > RETARD_MAX_MS)
    const nouveau = !!connus && !connus.has(s.id)
    liste.push({
      cle: `s:${s.id}`, genre: 'signalements', id: s.id, reference: s.reference, origine: o,
      texte: texteAnnonce(s, lieux), quand, retard,
      mode: o === 'benevole' && nouveau && !retard ? 'auto' : 'main'
    })
  }
  for (const m of maydays) {
    if (m.statut !== 'emis' || annonces.has(m.id)) continue
    if (!recent(m.emis_le)) continue
    const nouveau = !!connus && !connus.has(m.id)
    liste.push({
      cle: `m:${m.id}`, genre: 'maydays', id: m.id, reference: m.reference, origine: 'mayday',
      texte: texteMayday(m, lieux), quand: m.emis_le, retard: false,
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
