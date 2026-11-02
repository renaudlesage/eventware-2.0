import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { texteReponse } from './FormulaireCommunal'

/**
 * EXPORT PDF DU DOSSIER DE SÉCURITÉ (étape 6).
 *
 * Produit depuis l'instantané (157) — la version déposée, figée, ou
 * l'instantané courant si rien n'est encore déposé. Quand l'instantané
 * porte le formulaire multidisciplinaire (163), le PDF suit ses douze
 * sections, telles que la commune les lit, puis ajoute ce qu'Eventware
 * sait en plus (prescriptions, DMP, plan, contacts, avis). Les versions
 * figées avant 163 gardent l'ancien ordre : organisateur, assurances,
 * manifestation, prescriptions, secours et DMP, plan, avis reçus.
 * En-tête : version et date de dépôt.
 * Nouvelle dépendance jsPDF (accord de Ren, 2/11).
 */
const jour = (d) => (d ? new Date(d).toLocaleDateString('fr-BE') : '—')
const quand = (d) => (d ? new Date(d).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const AVIS = { favorable: 'Favorable', favorable_conditions: 'Favorable sous conditions', defavorable: 'Défavorable' }
const DISCIPLINES = { D1: 'D1 — Secours', D2: 'D2 — Médical', D3: 'D3 — Police', D4: 'D4 — Logistique', D5: 'D5 — Information', COAMU: 'CoAMU', COMMUNE: 'Commune' }

/**
 * @param {object} p
 * @param {object} p.evenement  l'événement (nom, commune)
 * @param {object} p.contenu    l'instantané jsonb (157/160)
 * @param {number|null} p.version  numéro de version déposée, ou null
 * @param {string|null} p.deposeLe date de dépôt ISO, ou null
 * @param {string} p.statut     statut du dossier
 * @param {Array}  p.avis       avis en vigueur, avec `prescriptions_dossier` ou `prescriptions`
 * @returns {jsPDF}
 */
export function construireDossierPdf({ evenement, contenu, version, deposeLe, statut, avis = [] }) {
  const c = contenu ?? {}
  const ev = c.evenement ?? {}
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const largeur = doc.internal.pageSize.getWidth()
  const marge = 16
  let y = 0

  const entete = () => {
    doc.setFontSize(9); doc.setTextColor(120)
    doc.text(`Dossier de sécurité — ${evenement.nom}`, marge, 10)
    doc.text(version ? `Version ${version} · déposée le ${quand(deposeLe)}` : `Brouillon · instantané du ${quand(c.fige_le ?? new Date())}`, largeur - marge, 10, { align: 'right' })
    doc.setTextColor(0)
  }
  const nouvellePage = () => { doc.addPage(); entete(); y = 20 }
  const place = (h) => { if (y + h > doc.internal.pageSize.getHeight() - 16) nouvellePage() }
  const titre = (t) => { place(14); doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.text(t, marge, y); doc.setFont(undefined, 'normal'); y += 7 }
  const ligne = (t, taille = 10) => {
    doc.setFontSize(taille)
    const lignes = doc.splitTextToSize(t, largeur - 2 * marge)
    place(lignes.length * (taille * 0.45) + 2)
    doc.text(lignes, marge, y)
    y += lignes.length * (taille * 0.45) + 2
  }
  const cles = (paires) => {
    autoTable(doc, {
      startY: y, margin: { left: marge, right: marge }, theme: 'plain', styles: { fontSize: 10, cellPadding: 1.2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 48 } },
      body: paires.map(([k, v]) => [k, v ?? '—'])
    })
    y = doc.lastAutoTable.finalY + 4
  }
  const tableau = (entetes, lignes, styles = {}) => {
    if (!lignes.length) return
    autoTable(doc, {
      startY: y, margin: { left: marge, right: marge }, head: [entetes], body: lignes,
      styles: { fontSize: 9, cellPadding: 1.5 }, headStyles: { fillColor: [40, 40, 40] }, ...styles
    })
    y = doc.lastAutoTable.finalY + 4
  }

  // Page de titre
  entete()
  doc.setFontSize(26); doc.setFont(undefined, 'bold'); doc.text('Dossier de sécurité', largeur / 2, 70, { align: 'center' })
  doc.setFontSize(18); doc.setFont(undefined, 'normal'); doc.text(evenement.nom ?? '', largeur / 2, 84, { align: 'center' })
  doc.setFontSize(12); doc.text(ev.commune ? `Commune de ${ev.commune}` : '', largeur / 2, 94, { align: 'center' })
  doc.setFontSize(11)
  doc.text(version ? `Version ${version} — déposée le ${quand(deposeLe)} — ${statut ?? ''}` : 'Brouillon — non déposé', largeur / 2, 108, { align: 'center' })
  doc.setFontSize(9); doc.setTextColor(120)
  doc.text(`Généré depuis Eventware le ${quand(new Date())}`, largeur / 2, 118, { align: 'center' }); doc.setTextColor(0)
  nouvellePage()

  // (163) Les formulaires applicables (la commune, puis le fédéral), chacun dans l'ordre de ses sections.
  const formulaires = (Array.isArray(c.formulaires) && c.formulaires.length ? c.formulaires : [c.formulaire]).filter((f) => f?.questions?.length)
  const formulaire = formulaires.length ? formulaires[0] : null
  formulaires.forEach((f, i) => {
    if (i > 0) nouvellePage()
    const manquantes = new Set(f.obligatoires_manquantes ?? [])
    doc.setFontSize(16); doc.setFont(undefined, 'bold'); place(12); doc.text(f.formulaire?.libelle ?? 'Formulaire de demande', marge, y); doc.setFont(undefined, 'normal'); y += 8
    ligne([f.formulaire?.version, f.formulaire?.autorite ? `demandé par ${f.formulaire.autorite}` : null].filter(Boolean).join(' · '), 9)
    ligne(`${f.repondues} questions renseignées sur ${f.total}${manquantes.size ? ` — ${manquantes.size} obligatoire(s) sans réponse : ${[...manquantes].join(', ')}` : ''}.`)
    ;(f.sections ?? []).forEach((s) => {
      const qs = (f.questions ?? []).filter((q) => q.section === s.section)
      titre(`${s.section}. ${s.titre}`)
      const lignes = qs.filter((q) => q.valeur != null || q.obligatoire).map((q) => [
        q.code, q.sous_section ? `${q.sous_section} — ${q.libelle}` : q.libelle,
        q.valeur != null ? texteReponse(q) : q.obligatoire ? '(obligatoire, sans réponse)' : ''
      ])
      if (!lignes.length) ligne('Rien à signaler dans cette section.')
      else tableau(['N°', 'Question', 'Réponse'], lignes, { columnStyles: { 0: { cellWidth: 14 }, 1: { cellWidth: 78 } } })
    })
  })
  if (formulaire) {
    nouvellePage()
    titre('Compléments Eventware')
    ligne('Ce qui suit vient des données encodées dans Eventware : prescriptions des référentiels, dispositif médical préventif, plan d\'implantation, contacts partagés, avis des disciplines.')
  }

  // 1. Organisateur
  if (!formulaire) {
  titre('1. Organisateur')
  cles([
    ['Organisation', c.organisateur?.nom],
    ['Contact', [c.organisateur?.contact_nom, c.organisateur?.contact_tel, c.organisateur?.contact_email].filter(Boolean).join(' · ') || null],
    ['Responsable légal', [c.profil_securite?.responsable_legal, c.profil_securite?.responsable_legal_tel].filter(Boolean).join(' · ') || null],
    ['Responsable sécurité', [c.profil_securite?.securite_nom, c.profil_securite?.securite_tel].filter(Boolean).join(' · ') || null],
    ['Coordinateur (interlocuteur)', (c.contacts ?? []).filter((k) => k.role_autorite === 'interlocuteur').map((k) => [k.nom, k.telephone].filter(Boolean).join(' · ')).join(' ; ') || null]
  ])

  // 2. Assurances
  titre('2. Assurances')
  cles([['Compagnie', c.profil_securite?.assurance_compagnie], ['Numéro de police', c.profil_securite?.assurance_police]])

  // 3. Manifestation
  titre('3. Manifestation')
  const declare = Object.entries(c.questionnaire ?? {}).flatMap(([g, v]) => Object.entries(v ?? {}).filter(([, b]) => b).map(([k]) => `${g} · ${k}`))
  cles([
    ['Commune', [ev.commune, ev.province ? `(${ev.province})` : null].filter(Boolean).join(' ') || null],
    ['Zone de secours', ev.zone_secours], ['Zone de police', ev.zone_police],
    ['Montage', jour(ev.date_montage)], ['Manifestation', `du ${jour(ev.date_debut)} au ${jour(ev.date_fin)}`], ['Démontage', jour(ev.date_demontage)],
    ['Public attendu', ev.frequentation_max != null ? `${ev.frequentation_min ?? '?'} à ${ev.frequentation_max} personnes` : null],
    ['Point 0', ev.point_0 ? `${ev.point_0.lat?.toFixed(5)}, ${ev.point_0.lon?.toFixed(5)}` : null],
    ['Structures, activités déclarées', declare.length ? declare.join(', ') : 'rien de déclaré'],
    ['Encadrement', (c.contacts ?? []).length ? `${(c.contacts ?? []).length} contacts partagés (section 7)` : null]
  ])
  const lieux = c.lieux ?? []
  if (lieux.length) tableau(['Code', 'Lieu', 'Type', 'Position'], lieux.map((l) => [l.code, l.nom, l.type, l.lat != null ? `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}` : '']))
  }
  // Après le formulaire, les compléments sont lettrés pour ne pas se confondre avec ses sections.
  const n = (i) => (formulaire ? `${'ABCDE'[i - 4]}.` : `${i}.`)

  // 4. Prescriptions applicables
  titre(`${n(4)} Prescriptions applicables (${(c.prescriptions ?? []).length})`)
  if (!(c.prescriptions ?? []).length) ligne('Aucune prescription de référentiel ne s\'applique.')
  tableau(['Code', 'Prescription', 'Caractère', 'Référentiel'],
    (c.prescriptions ?? []).map((p) => [p.code, `${p.titre}${p.complement_local ? `\nLocal : ${p.complement_local}` : ''}`, p.caractere === 'recommande' ? 'recommandé' : 'obligatoire', p.referentiel]),
    { columnStyles: { 1: { cellWidth: 90 } } })

  // 5. Dispositif de secours et DMP
  titre(`${n(5)} Dispositif de secours et DMP`)
  if (!(c.secours ?? []).length) ligne('Aucun moyen de premiers secours déclaré.')
  tableau(['Moyen', 'Quantité', 'Commentaire'], (c.secours ?? []).map((m) => [m.type, m.quantite, m.commentaire ?? '']))
  const prima = c.prima
  const dmp = c.dmp ?? {}
  if (prima?.zone) {
    // (164) La grille PRIMA de la CoAMU, telle que figée au dépôt.
    ligne(`Grille PRIMA (${prima.version}) : ${prima.message}`)
    if (prima.score != null) ligne(`Score de risque ${prima.score} — scoring ${prima.scoring?.total} points → niveau ${prima.niveau} : ${prima.dispositif}.`)
    if (prima.composition) ligne(prima.composition, 9)
    const en = prima.entrees ?? {}
    const lib = (k) => (en[k]?.libelle ?? (en[k]?.valeur != null ? String(en[k].valeur) : '—')) + (en[k]?.source === 'defaut' ? ' (par défaut)' : '')
    tableau(['Entrée', 'Valeur'], [
      ['Type d\'événement', lib('type_evenement')], ['Spectateurs', lib('spectateurs')], ['Participants actifs', lib('actifs')], ['Personnalités', lib('vip')],
      ['Heures par jour', lib('duree_h')], ['Moments', Object.entries(en.moments ?? {}).filter(([k, v]) => v === true && k !== 'source').map(([k]) => ({ journee: 'journée', soiree: 'soirée', nuit: 'nuit', multijour: 'multi-jour' })[k]).join(', ') || '—'],
      ['Clôture', lib('cloture')], ['Surface ou distance', lib('surface')], ['Structures', lib('structure')], ['Infrastructures', lib('infrastructure')], ['Certitude globale', lib('certitude')],
      ['Type de public', lib('type_public')], ['Âge des spectateurs', lib('age_spectateurs')], ['Groupes à risque', lib('groupes_risque')], ['Densité maximale', lib('densite')],
      ['Type d\'actifs', lib('type_actifs')], ['Âge des actifs', lib('age_actifs')], ['Violence', lib('violence')], ['Alcool, drogue', lib('alcool')], ['Météo', lib('meteo')],
      ['Impact sur les riverains', en.impact_riverains?.valeur ? 'oui' : 'non']
    ])
    if (prima.remarques) ligne(`Remarques : ${prima.remarques}`)
  } else if (dmp.niveau != null) {
    ligne(`Dispositif médical préventif : ${dmp.score} points, niveau ${dmp.niveau}${dmp.avis_coamu ? ' — avis de la CoAMU requis' : ''}${dmp.grille?.libelle ? ` (${dmp.grille.libelle})` : ''}.`)
    tableau(['Critère', 'Famille', 'Points'], (dmp.details ?? []).filter((d) => d.applique).map((d) => [d.libelle, d.famille, d.points]))
  } else ligne('Dispositif médical préventif : non calculé.')

  // 6. Plan
  titre(`${n(6)} Plan du site`)
  const plan = c.plan ?? []
  if (!plan.length) ligne('Plan d\'implantation vide. Le plan graphique est joint séparément.')
  else {
    const parCalque = {}
    plan.forEach((o) => { (parCalque[o.calque ?? 'autre'] ||= []).push(o) })
    ligne(`${plan.length} objets d'implantation. Le plan graphique est joint séparément.`)
    tableau(['Calque', 'Code', 'Objet', 'Catégorie', 'Dimensions', 'Confirmé'],
      Object.entries(parCalque).flatMap(([k, liste]) => liste.map((o) => [k, o.code ?? '', o.nom ?? '', o.categorie ?? '', o.largeur_m ? `${o.largeur_m} × ${o.longueur_m ?? '?'} m` : '', o.confirme ? 'oui' : ''])))
  }

  // 7. Contacts et avis reçus
  titre(`${n(7)} Contacts partagés`)
  if (!(c.contacts ?? []).length) ligne('Aucun contact partagé avec les autorités.')
  tableau(['Nom', 'Fonction', 'Organisation', 'Téléphone', 'Rôle'], (c.contacts ?? []).map((k) => [k.nom, k.fonction ?? '', k.organisation ?? '', k.telephone ?? '', k.role_autorite ?? '']))

  titre(`${n(8)} Avis reçus (${avis.length})`)
  if (!avis.length) ligne('Aucun avis rendu sur cette version.')
  avis.forEach((a) => {
    const prescriptions = a.prescriptions_dossier ?? a.prescriptions ?? []
    ligne(`${DISCIPLINES[a.discipline] ?? a.discipline} — ${AVIS[a.avis] ?? a.avis}${a.rendu_par ? ` (${a.rendu_par})` : ''}, le ${quand(a.rendu_le)}${a.commentaire ? ` : ${a.commentaire}` : ''}`, 10)
    if (prescriptions.length) tableau(['Prescription', 'Caractère'], prescriptions.map((p) => [p.texte, p.caractere === 'recommande' ? 'recommandé' : 'obligatoire']))
  })

  const alertes = (c.controles ?? []).filter((k) => k.gravite === 'alerte')
  if (alertes.length) { titre('Points signalés au dépôt'); alertes.forEach((k) => ligne(`• ${k.titre}${k.detail ? ` — ${k.detail}` : ''}`)) }

  // Numéros de page
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120)
    doc.text(`${i} / ${pages}`, largeur - marge, doc.internal.pageSize.getHeight() - 8, { align: 'right' }); doc.setTextColor(0)
  }
  return doc
}

export function telechargerDossierPdf(params) {
  const doc = construireDossierPdf(params)
  const nom = `Dossier-securite-${(params.evenement.nom ?? 'evenement').replace(/[^a-z0-9]+/gi, '-')}${params.version ? `-v${params.version}` : '-brouillon'}.pdf`
  doc.save(nom)
  return nom
}
