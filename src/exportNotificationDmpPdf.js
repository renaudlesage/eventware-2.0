import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { CATEGORIES_PERSONNEL, MOYENS, VECTEURS, ADRESSES } from './NotificationDmp'

/**
 * EXPORT PDF DE LA NOTIFICATION DMP (165), au format du « Formulaire de
 * notification DMP — CoAMU & CU 112 » v1.6 (février 2025) des clusters
 * BHN-LILU : en-tête avec les adresses par province, informations
 * générales et créneaux, partie I CoAMU (prestataire, responsables,
 * personnel, moyens, vecteurs), partie II CU 112 (adresses, ambulances
 * agréées, SMUR).
 */
const jour = (d) => (d ? new Date(d).toLocaleDateString('fr-BE') : '')
const PROVINCES = [['Province de Liège', 'admin.lie@health.fgov.be'], ['Province de Luxembourg', 'admin.lux@health.fgov.be'],
  ['Province du Brabant wallon', 'prima.brw@health.fgov.be'], ['Province de Hainaut', 'prima.hai@health.fgov.be'], ['Province de Namur', 'prima.nam@health.fgov.be']]

export function construireNotificationDmpPdf({ evenement, notification: n }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const largeur = doc.internal.pageSize.getWidth()
  const marge = 14
  let y = 0
  const entete = () => {
    doc.setFontSize(7.5); doc.setTextColor(90)
    doc.text('Veuillez compléter le formulaire, le sauvegarder et le renvoyer aux adresses suivantes (en y joignant tous les documents) :', marge, 9)
    PROVINCES.forEach(([p, m], i) => doc.text(`${p} : ${m}`, marge + (i % 2) * 92, 13 + Math.floor(i / 2) * 3.5))
    doc.text('Février 2025 v1.6', largeur - marge, 9, { align: 'right' })
    doc.setTextColor(0); y = 28
  }
  const nouvellePage = () => { doc.addPage(); entete() }
  const place = (h) => { if (y + h > doc.internal.pageSize.getHeight() - 14) nouvellePage() }
  const titre = (t, taille = 12) => { place(12); doc.setFontSize(taille); doc.setFont(undefined, 'bold'); doc.text(t, marge, y); doc.setFont(undefined, 'normal'); y += 6 }
  const ligne = (t, taille = 9.5) => {
    doc.setFontSize(taille)
    const lignes = doc.splitTextToSize(t, largeur - 2 * marge)
    place(lignes.length * taille * 0.45 + 2)
    doc.text(lignes, marge, y); y += lignes.length * taille * 0.45 + 2
  }
  const cles = (paires) => {
    autoTable(doc, { startY: y, margin: { left: marge, right: marge }, theme: 'grid', styles: { fontSize: 9, cellPadding: 1.4 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } }, body: paires.map(([k, v]) => [k, v ?? '']) })
    y = doc.lastAutoTable.finalY + 4
  }
  const tableau = (entetes, lignes, styles = {}) => {
    autoTable(doc, { startY: y, margin: { left: marge, right: marge }, head: [entetes], body: lignes.length ? lignes : [entetes.map(() => '')],
      styles: { fontSize: 8.5, cellPadding: 1.4 }, headStyles: { fillColor: [60, 60, 60] }, theme: 'grid', ...styles })
    y = doc.lastAutoTable.finalY + 4
  }
  // La police standard du PDF n'a pas de cases à cocher : des crochets.
  const case_ = (b) => (b ? '[X]' : '[  ]')
  const pers = (p) => [p?.nom, p?.prenom].filter(Boolean).join(' ')

  entete()
  doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.text('FORMULAIRE DE NOTIFICATION DMP', largeur / 2, y, { align: 'center' }); y += 6
  doc.text('COAMU & CU112', largeur / 2, y, { align: 'center' }); doc.setFont(undefined, 'normal'); y += 8
  ligne('Ce document est à compléter par le prestataire de soins et/ou l\'organisateur en vue d\'une bonne coordination des services de secours lors d\'un événement autorisé par l\'Autorité compétente. L\'autorité ou le CPU devra le transmettre, au plus tard 10 jours ouvrés avant l\'événement, à la Commission d\'Aide Médicale Urgente territorialement compétente. Passé ce délai, ce formulaire ne sera pas pris en considération.', 8.5)
  y += 2
  titre('Informations générales')
  cles([['a. Nom complet de l\'événement', n.nom ?? evenement.nom], ['b. Nature de l\'événement', n.nature]])
  ligne('c. Dates et heures', 9.5)
  tableau(['Date', 'Accès public : début', 'Accès public : fin', 'DMP opérationnel : début', 'DMP opérationnel : fin'],
    (n.creneaux ?? []).map((c) => [jour(c.date), c.acces_debut ?? '', c.acces_fin ?? '', c.dmp_debut ?? '', c.dmp_fin ?? '']))
  const docs = n.documents ?? []
  ligne(`${case_(docs.length)} Je joins les documents suivants : ${docs.length ? docs.join(', ') : 'dossier de présentation, plan(s) d\'implantation du site, plan(s) de sécurité, itinéraire (circuit), plan de mobilité (accès, IN-OUT, …), localisation du/des poste(s) de soins, …'}`, 9)
  if (n.date_limite) ligne(`Date limite d'envoi (10 jours ouvrés avant l'événement) : ${jour(n.date_limite)}${n.envoyee_le ? ` — envoyée le ${jour(n.envoyee_le)}${n.envoyee_a ? ` à ${n.envoyee_a}` : ''}` : ''}.`, 8.5)

  nouvellePage()
  titre('PARTIE I — COAMU')
  ligne('Moyens de secours médicaux mis en œuvre :', 10)
  cles([
    ['Prestataire de soins', `${case_(n.prestataire_interne === true)} Interne   ${case_(n.prestataire_interne === false)} Externe : ${n.prestataire_nom ?? ''}`],
    ['Personne de contact', [n.contact_nom, n.contact_gsm ? `GSM : ${n.contact_gsm}` : null].filter(Boolean).join(' — ')],
    ['Responsable du DMP (nom, prénom, NN, GSM)', [pers(n.responsable_dmp), n.responsable_dmp?.nn, n.responsable_dmp?.gsm].filter(Boolean).join(' — ')],
    ['Médecin coordinateur (nom, prénom, NN, GSM, N° INAMI)', [pers(n.medecin_coordinateur), n.medecin_coordinateur?.nn, n.medecin_coordinateur?.gsm, n.medecin_coordinateur?.inami].filter(Boolean).join(' — ')]
  ])
  ligne('Personnel engagé', 10)
  const eff = n.effectifs ?? {}
  const personnel = n.personnel ?? []
  const lignesPersonnel = CATEGORIES_PERSONNEL.flatMap(([k, l, nominatif]) => {
    const nommes = personnel.filter((p) => p.categorie === k)
    const nombre = eff[k] ?? (nommes.length || '')
    if (!nommes.length) return [[`${l}${nominatif ? ' *' : ''}`, nombre, '', '', '', '']]
    return nommes.map((p, i) => [i === 0 ? `${l}${nominatif ? ' *' : ''}` : '', i === 0 ? nombre : '', p.nom ?? '', p.prenom ?? '', p.num_nat ?? '', p.badge ?? ''])
  })
  tableau(['Catégorie', 'Nbre', 'Nom', 'Prénom', 'Num. nat.', 'Badge / visa / INAMI'], lignesPersonnel, { columnStyles: { 0: { cellWidth: 44 }, 1: { cellWidth: 12 } } })
  ligne('Moyens engagés (pour information)', 10)
  const m = n.moyens ?? {}
  tableau(['Moyen', 'Total', 'Fixes', 'Mobiles'], MOYENS.map(([k, l]) => {
    const x = m[k] ?? {}
    return [k === 'autre' ? `Autre : ${x.libelle ?? ''}` : l, (x.fixes ?? 0) + (x.mobiles ?? 0) || '', x.fixes ?? '', x.mobiles ?? '']
  }))
  ligne('Vecteurs engagés', 10)
  const v = n.vecteurs ?? {}
  tableau(['Vecteur', 'Nombre'], VECTEURS.map(([k, l]) => [l, v[k] ?? '']))
  ligne('Les informations annotées avec une (*) seront complétées de manière précise pour vérification/validation, les autres données sont pour information.', 8)
  ligne(`Informations complémentaires utiles à la bonne gestion des secours liés à la manifestation : ${n.informations ?? ''}`, 9.5)

  nouvellePage()
  titre('PARTIE II — CU 112')
  ligne('Adresses postales des lieux concernés par l\'événement :', 10)
  const a = n.adresses ?? {}
  tableau(['Lieu', 'Rue(s) n°', 'Code postal', 'Localité'], ADRESSES.map(([k, l]) => [l, a[k]?.rue ?? '', a[k]?.cp ?? '', a[k]?.localite ?? '']))
  ligne('Moyens de secours médicaux mis en œuvre :', 10)
  ligne('À compléter si présence d\'ambulances agréées par le SPF SP :', 9)
  tableau(['Indicatif radio', 'Plaque d\'immatriculation', 'ISSI ASTRID', 'Numéro de contact (GSM)'], (n.ambulances_112 ?? []).map((x) => [x.indicatif ?? '', x.plaque ?? '', x.issi ?? '', x.gsm ?? '']))
  ligne('À compléter si présence de SMUR pour interventions et éventuelles évacuations vers les hôpitaux :', 9)
  tableau(['Indicatif radio', 'Plaque d\'immatriculation', 'ISSI ASTRID', 'Numéro de contact (GSM)'], (n.smur ?? []).map((x) => [x.indicatif ?? '', x.plaque ?? '', x.issi ?? '', x.gsm ?? '']))
  ligne(`Généré depuis Eventware le ${new Date().toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })} — ${n.version ?? ''}`, 7.5)

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120)
    doc.text(`Page ${i} sur ${pages}`, largeur - marge, doc.internal.pageSize.getHeight() - 7, { align: 'right' }); doc.setTextColor(0)
  }
  return doc
}

export function telechargerNotificationDmpPdf(params) {
  const doc = construireNotificationDmpPdf(params)
  const nom = `Notification-DMP-${(params.evenement.nom ?? 'evenement').replace(/[^a-z0-9]+/gi, '-')}.pdf`
  doc.save(nom)
  return nom
}
