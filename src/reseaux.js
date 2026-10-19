/**
 * Réseaux d'électricité et d'eau du plan d'implantation (118, 15/10).
 *
 * Les objets du plan portent leurs caractéristiques (tension, phases,
 * calibre, différentiel, IP, puissance) ; les câbles sont des lignes
 * tracées d'un objet (`de_id`) à un autre (`vers_id`). Ce module ne
 * touche pas à la carte : il construit l'arbre de distribution, calcule
 * courants et chutes de tension, et vérifie ce qu'un plan peut vérifier
 * du RGIE (Livre 1). Rien ici ne remplace le contrôle par un organisme
 * agréé avant mise en usage (RGIE 6.4) : c'est une pré-vérification.
 */

export const COS_PHI = 0.8
/** Résistivité du cuivre à la température de service, en Ω·mm²/m. */
export const RHO_CUIVRE = 0.0225
/** Chutes de tension : HD 60364-5-52 annexe G (3 % éclairage, 5 % autres usages, depuis l'origine). */
export const CHUTE_VEILLE = 3
export const CHUTE_MAX = 5

export const estSource = (o) => Number(o.production_kva) > 0
export const estDistributeur = (o) => estSource(o) || Number(o.calibre_a) > 0 || o.categorie === 'coffret_electrique'
export const estCable = (o) => o.nature === 'ligne' && o.reseau === 'electricite'
export const estConduite = (o) => o.nature === 'ligne' && o.reseau === 'eau'

const num = (v) => (v == null || v === '' ? 0 : Number(v))

/** Courant (A) pour une puissance (kW) sous une tension et un nombre de phases. */
export function courant(kw, tension = 400, phases = 3) {
  if (!(kw > 0)) return 0
  const u = tension || (phases === 1 ? 230 : 400)
  return phases === 1 ? (kw * 1000) / (u * COS_PHI) : (kw * 1000) / (Math.sqrt(3) * u * COS_PHI)
}

/** Chute de tension (%) d'un câble de longueur L (m), section S (mm²), parcouru par I (A). */
export function chuteTension(longueur, section, intensite, tension = 400, phases = 3) {
  if (!(longueur > 0) || !(section > 0) || !(intensite > 0)) return 0
  const u = tension || (phases === 1 ? 230 : 400)
  const k = phases === 1 ? 2 : Math.sqrt(3)
  return (100 * k * RHO_CUIVRE * longueur * intensite) / (section * u)
}

/** Degré IP numérique (« IP44 » → 44, « IP 65 » → 65, sinon null). */
export function degreIp(ip) {
  const m = /IP\s*(\d)(\d|X)/i.exec(ip ?? '')
  return m ? Number(m[1]) * 10 + (m[2].toUpperCase() === 'X' ? 0 : Number(m[2])) : null
}

/**
 * L'arbre de distribution électrique.
 * Retourne { racines, noeuds (id → nœud), cablesOrphelins, boucles }.
 * Un nœud : { o, enfants, cable (le câble qui l'alimente, s'il est tracé),
 * kwPropre, kwTotal, kva, intensite, chute (cumulée depuis la source, %) }.
 */
export function arbreElectrique(objets) {
  const noeuds = new Map()
  const cables = objets.filter(estCable)
  const parCible = new Map(cables.filter((c) => c.vers_id).map((c) => [c.vers_id, c]))
  for (const o of objets) {
    if (o.nature === 'ligne' || o.nature === 'picto') continue
    noeuds.set(o.id, { o, enfants: [], cable: parCible.get(o.id) ?? null, kwPropre: num(o.puissance_kw), kwTotal: 0, kva: 0, intensite: 0, chute: 0 })
  }
  const racines = []
  for (const n of noeuds.values()) {
    const parent = n.o.alimente_par ? noeuds.get(n.o.alimente_par) : null
    if (parent && parent !== n) parent.enfants.push(n)
    else if (estSource(n.o) || n.enfants.length || !n.o.alimente_par) racines.push(n)
  }
  // Ne garder comme racines que les sources et les distributeurs sans amont ;
  // un simple consommateur non raccordé n'est pas un arbre.
  const racinesUtiles = racines.filter((n) => estSource(n.o) || (estDistributeur(n.o) && n.enfants.length))
  const boucles = []
  const vus = new Set()
  function cumuler(n, pile) {
    if (pile.has(n)) {
      boucles.push(n.o)
      return 0
    }
    pile.add(n)
    vus.add(n)
    let kw = n.kwPropre
    for (const e of n.enfants) kw += cumuler(e, pile)
    pile.delete(n)
    n.kwTotal = kw
    n.kva = kw / COS_PHI
    const phases = Number(n.o.phases) || (n.cable ? Number(n.cable.phases) || 3 : 3)
    const tension = Number(n.o.tension_v) || (n.cable ? Number(n.cable.tension_v) : 0) || (phases === 1 ? 230 : 400)
    n.intensite = courant(kw, tension, phases)
    return kw
  }
  function propagerChute(n, amont) {
    const c = n.cable
    const propre = c ? chuteTension(num(c.longueur_m), num(c.section_mm2), n.intensite, Number(c.tension_v) || Number(n.o.tension_v) || 400, Number(c.phases) || Number(n.o.phases) || 3) : 0
    n.chutePropre = propre
    n.chute = amont + propre
    for (const e of n.enfants) propagerChute(e, n.chute)
  }
  for (const r of racinesUtiles) {
    cumuler(r, new Set())
    propagerChute(r, 0)
  }
  const cablesOrphelins = cables.filter((c) => !c.de_id || !c.vers_id)
  return { racines: racinesUtiles, noeuds, cables, cablesOrphelins, boucles }
}

/** L'arbre du réseau d'eau : sources (source_eau) → raccordés (raccord_eau). */
export function arbreEau(objets) {
  const noeuds = new Map()
  const conduites = objets.filter(estConduite)
  const parCible = new Map(conduites.filter((c) => c.vers_id).map((c) => [c.vers_id, c]))
  for (const o of objets) {
    if (o.nature === 'ligne' || o.nature === 'picto') continue
    if (!o.source_eau && !o.besoin_eau && !o.raccord_eau) continue
    noeuds.set(o.id, { o, enfants: [], conduite: parCible.get(o.id) ?? null, debitPropre: o.besoin_eau ? Number(o.debit_l_min) || 0 : 0, debitTotal: 0 })
  }
  const racines = []
  for (const n of noeuds.values()) {
    const parent = n.o.raccord_eau ? noeuds.get(n.o.raccord_eau) : null
    if (parent && parent !== n) parent.enfants.push(n)
    else if (n.o.source_eau) racines.push(n)
  }
  // (126) Le débit demandé remonte des postes vers la source, comme les
  // kW dans l'arbre électrique : une source sait ce qu'on lui demande.
  const vus = new Set()
  function cumuler(n) {
    if (vus.has(n)) return 0
    vus.add(n)
    n.debitTotal = n.debitPropre + n.enfants.reduce((s, e) => s + cumuler(e), 0)
    return n.debitTotal
  }
  for (const r of racines) cumuler(r)
  return { racines, noeuds, conduites, conduitesOrphelines: conduites.filter((c) => !c.de_id || !c.vers_id) }
}

/**
 * Les contrôles que le plan peut faire sur le réseau électrique, avec la
 * référence RGIE (Livre 1) ou de bonne pratique sur laquelle chacun
 * s'appuie. Gravité : chaud (à corriger) ou veille (à vérifier).
 */
export function controlesReseau(objets) {
  const liste = []
  const { racines, noeuds, cables, cablesOrphelins, boucles } = arbreElectrique(objets)
  const nom = (id) => noeuds.get(id)?.o.nom ?? objets.find((x) => x.id === id)?.nom ?? '?'

  for (const b of boucles) liste.push({ gravite: 'chaud', type: 'Boucle', texte: `${b.nom} est alimenté par lui-même via la chaîne de raccordement`, ids: [b.id], ref: '' })
  for (const c of cablesOrphelins) liste.push({ gravite: 'veille', type: 'Câble en l’air', texte: `${c.nom} (${c.code}) n'est pas raccordé aux deux bouts`, ids: [c.id], ref: 'Tracer le câble d’un objet à un autre' })

  function parcourir(n, amont, ddrAmont) {
    const o = n.o
    const c = n.cable
    const consommateur = !estDistributeur(o) && n.kwPropre > 0
    if (c) {
      const adm = num(c.calibre_a)
      if (adm && n.intensite > adm) liste.push({ gravite: 'chaud', type: 'Câble sous-dimensionné', texte: `${c.nom} vers ${o.nom} : ${n.intensite.toFixed(0)} A demandés pour ${adm} A admissibles (${c.type_cable ?? ''} ${num(c.section_mm2)} mm²)`, ids: [c.id, o.id], ref: 'RGIE 4.4 — protection contre les surintensités ; courant admissible des câbles souples H07RN-F' })
      if (adm && num(o.calibre_a) > adm && estDistributeur(o)) liste.push({ gravite: 'veille', type: 'Calibre amont > câble', texte: `${c.nom} (${adm} A) alimente ${o.nom} protégé à ${num(o.calibre_a)} A : la protection au départ doit être ≤ ${adm} A`, ids: [c.id, o.id], ref: 'RGIE 4.4 — la protection amont protège le câble' })
      const phC = Number(c.phases), phO = Number(o.phases)
      if (phC && phO && phC !== phO) liste.push({ gravite: 'chaud', type: 'Phases', texte: `${c.nom} (${phC === 1 ? 'mono' : 'tri'}) alimente ${o.nom} (${phO === 1 ? 'mono' : 'tri'})`, ids: [c.id, o.id], ref: '' })
      const uC = Number(c.tension_v), uO = Number(o.tension_v)
      if (uC && uO && uC !== uO) liste.push({ gravite: 'chaud', type: 'Tension', texte: `${c.nom} en ${uC} V alimente ${o.nom} en ${uO} V`, ids: [c.id, o.id], ref: '' })
    } else if (amont) {
      liste.push({ gravite: 'veille', type: 'Câble non tracé', texte: `${o.nom} est raccordé à ${amont.o.nom} sans câble tracé : longueur et section inconnues`, ids: [o.id], ref: 'RGIE 3.1.2 — le schéma unifilaire renseigne type, section et longueur des canalisations' })
    }
    if (n.chute > CHUTE_MAX) liste.push({ gravite: 'chaud', type: 'Chute de tension', texte: `${o.nom} : ${n.chute.toFixed(1)} % depuis la source (max ${CHUTE_MAX} %)`, ids: [o.id], ref: 'HD 60364-5-52 annexe G — 5 % depuis l’origine, 3 % pour l’éclairage' })
    else if (n.chute > CHUTE_VEILLE) liste.push({ gravite: 'veille', type: 'Chute de tension', texte: `${o.nom} : ${n.chute.toFixed(1)} % depuis la source (3 % si éclairage)`, ids: [o.id], ref: 'HD 60364-5-52 annexe G' })

    // Différentiel 30 mA : tout départ de prises ≤ 32 A accessible au public ou au personnel non averti.
    const ddr = num(o.differentiel_ma) || ddrAmont
    if (consommateur && (!ddr || ddr > 30) && n.intensite <= 32) {
      liste.push({ gravite: 'chaud', type: 'Différentiel 30 mA', texte: `${o.nom} (${n.intensite.toFixed(0)} A) n'est pas sous un différentiel ≤ 30 mA (amont : ${ddr ? ddr + ' mA' : 'aucun renseigné'})`, ids: [o.id, ...(amont ? [amont.o.id] : [])], ref: 'RGIE 4.2.4 et 7.4 — prises ≤ 32 A et installations extérieures / temporaires : DDR ≤ 30 mA' })
    }
    if (estDistributeur(o)) {
      const ip = degreIp(o.ip)
      if (ip == null) liste.push({ gravite: 'veille', type: 'Degré IP', texte: `${o.nom} : degré IP non renseigné (IP44 minimum en extérieur)`, ids: [o.id], ref: 'RGIE 7.4 — influences externes AD4 : IPX4 minimum ; tableaux et prises IP44' })
      else if (ip < 44) liste.push({ gravite: 'chaud', type: 'Degré IP', texte: `${o.nom} : ${o.ip} en extérieur (IP44 minimum)`, ids: [o.id], ref: 'RGIE 7.4 — influences externes AD4' })
      if (!num(o.differentiel_ma)) liste.push({ gravite: 'veille', type: 'Différentiel', texte: `${o.nom} : aucun différentiel renseigné sur ses départs`, ids: [o.id], ref: 'RGIE 4.2.4 — protection différentielle ; sélectivité 300 mA en tête / 30 mA aux prises' })
      if (num(o.calibre_a) && n.intensite > num(o.calibre_a)) liste.push({ gravite: 'chaud', type: 'Surcharge', texte: `${o.nom} : ${n.intensite.toFixed(0)} A demandés pour une protection de ${num(o.calibre_a)} A`, ids: [o.id], ref: 'RGIE 4.4 — surintensités' })
    }
    if (estSource(o)) {
      if (!o.terre) liste.push({ gravite: 'chaud', type: 'Mise à la terre', texte: `${o.nom} : mise à la terre non vérifiée (piquet, liaison du neutre et des masses)`, ids: [o.id], ref: 'RGIE 5.4 et 4.2.3.4 — schéma TN-S ou TT ; TN-C interdit en installation temporaire' })
      const kva = num(o.production_kva)
      if (kva && n.kva > kva) liste.push({ gravite: 'chaud', type: 'Surcharge', texte: `${o.nom} : ${n.kva.toFixed(1)} kVA demandés pour ${kva} kVA`, ids: [o.id], ref: '' })
      else if (kva && n.kva > 0.8 * kva) liste.push({ gravite: 'veille', type: 'Charge > 80 %', texte: `${o.nom} : ${Math.round((100 * n.kva) / kva)} % de charge, prévoir les démarrages (frigos, pompes)`, ids: [o.id], ref: '' })
    }
    for (const e of n.enfants) parcourir(e, n, estDistributeur(o) ? num(o.differentiel_ma) || ddrAmont : ddrAmont)
  }
  for (const r of racines) parcourir(r, null, 0)

  const orphelins = [...noeuds.values()].filter((n) => n.kwPropre > 0 && !n.o.alimente_par && !estSource(n.o))
  for (const n of orphelins) liste.push({ gravite: 'veille', type: 'Non raccordé', texte: `${n.o.nom} (${n.kwPropre} kW) n'est alimenté par rien`, ids: [n.o.id], ref: '' })
  return { liste, racines, cables, nom }
}

/**
 * Le dossier RGIE que le plan ne peut pas vérifier à ta place : la liste
 * à cocher avant le contrôle de l'organisme agréé.
 */
export const RAPPELS_RGIE = [
  ['Contrôle avant mise en usage', 'Installation temporaire : contrôle de conformité par un organisme agréé avant la mise sous tension, rapport sur site pendant l’événement.', 'RGIE 6.4 (Livre 1) ; installations foraines 7.11'],
  ['Schéma unifilaire et plan de position', 'Le schéma généré ici, complété des calibres réels des départs, et le plan d’implantation (position des tableaux, prises, groupes), tenus à disposition du contrôleur et de l’exploitant.', 'RGIE 3.1.2 et 9.1'],
  ['Régime de neutre', 'Groupe électrogène : neutre relié à une prise de terre, masses reliées, TN-S ou TT ; jamais de conducteur PEN (TN-C) en installation temporaire.', 'RGIE 4.2.3.4, 5.4'],
  ['Différentiels', '300 mA sélectif en tête de chaque source, ≤ 30 mA sur tous les départs de prises ≤ 32 A et sur tout ce qui est manipulé par le public ou le personnel non averti ; bouton test actionné à la mise en service.', 'RGIE 4.2.4, 7.4'],
  ['Câbles', 'Souples type H07RN-F (ou équivalent) de bout en bout, sans épissure, passages protégés (passe-câbles, enterrés ou aériens ≥ 4 m sur les voies engins), connecteurs CEE IP44 ; pas de rallonges domestiques en extérieur.', 'RGIE 5.2, 7.4'],
  ['Coupure d’urgence', 'Chaque tableau et chaque groupe dispose d’un organe de coupure générale accessible, repéré, et l’exploitant sait où il est.', 'RGIE 2.9, 5.3'],
  ['Degrés IP', 'Tableaux, prises et luminaires IP44 au minimum à l’extérieur (IP65 si jet d’eau ou lavage) ; portes des coffrets fermées en exploitation.', 'RGIE 7.4 — influences externes AD4'],
  ['Repérage', 'Chaque coffret porte son nom du plan (code), chaque départ son destinataire ; le code de l’objet sert de repère sur le schéma.', 'RGIE 3.1.2 — schémas'],
  ['Groupes', 'Jerrican et appoint carburant moteur arrêté, extincteur à portée, distance de sécurité et de bruit respectée, mise à la terre vérifiée avant chaque remise en route.', 'Fiche catalogue, distance de sécurité']
]
