// Faux client Supabase : chaque table rend un jeu de données plausible.
export const DONNEES = {
  signalements: [
    { id: 's1', reference: 'SOS-001', type: 'malaise', statut: 'recu', description: 'Personne au sol', recu_le: new Date().toISOString(), emis_le: new Date().toISOString(), latitude: 50.3845, longitude: 5.6215, lieu_id: 'l1', precision_m: 12, contact: '0477 00 00 00', gravite: 'grave', doublon_de: null, updated_at: new Date().toISOString() },
    { id: 's2', reference: 'SOS-002', type: 'malaise', statut: 'recu', recu_le: new Date().toISOString(), emis_le: new Date().toISOString(), lieu_id: 'l1', doublon_de: 's1' },
    { id: 's3', reference: 'SOS-003', type: 'danger', statut: 'clos', recu_le: new Date().toISOString(), emis_le: new Date().toISOString(), clos_le: new Date().toISOString(), lieu_id: null }
  ],
  missions: [{ id: 'm1', reference: 'SEC-001', titre: 'Renfort', priorite: 'P1', statut: 'attribuee', module: 'securite', signalement_id: 's1', latitude: 50.385, longitude: 5.62, lieu_id: null, equipe_id: 'e1', membre_id: null, attribuee_le: new Date().toISOString(), demarree_le: null, equipe: { code: 'A' }, lieu: null, membre: null }],
  traces: [{ id: 't1', nom: 'Boucle', couleur: null, points: [[50.38, 5.61, 300], [50.39, 5.62, 310], [50.395, 5.63, 320]] }],
  lieux: [{ id: 'l1', code: 'E1', nom: 'Étape 1', type: 'etape', latitude: 50.385, longitude: 5.615, pk_km: 1.2, capacite: null }, { id: 'l2', code: 'P0', nom: 'Point 0', type: 'pc_ops', latitude: 50.38, longitude: 5.61, pk_km: 0 }],
  liens_plan: [{ id: 'li1', evenement_id: 'ev1', de_id: 'ep3', vers_id: 'ep2', nature: 'alimente', note: 'câble 3G2,5' }], catalogue_equipements: [{ id: 'cat1', code: 'EXT6ABC', libelle: 'Extincteur poudre ABC 6 kg', calque: 'securite', categorie: 'extincteur', forme: 'cercle', largeur_m: 0.5, longueur_m: 0.5, nature: 'picto', picto: 'extincteur', agent_extinction: 'poudre_abc', capacite_extinction: 6 }, { id: 'cat2', code: 'CHAP', libelle: 'Chapiteau 6 × 12 m', calque: 'infrastructures', categorie: 'autre', forme: 'rect', largeur_m: 6, longueur_m: 12 }], fonds_plan: [], elements_plan: [{ id: 'ep5', code: 'BAR1', nom: 'Barrière Heras (3,5 m)', nature: 'ligne', calque: 'circulation', categorie: 'perimetre', forme: 'ligne', forme_echelle: 'rect', centre_lat: 50.3856, centre_lon: 5.6156, largeur_m: 3.5, longueur_m: 40, quantite: 12, rotation_deg: 0, geometrie: [[50.3855, 5.6152], [50.3858, 5.6158], [50.3854, 5.6162]], confirme: false }, { id: 'ep3', code: 'GE1', nom: 'Groupe 60 kVA', nature: 'objet', calque: 'energie', categorie: 'groupe_electrogene', forme_echelle: 'rect', centre_lat: 50.3858, centre_lon: 5.6158, largeur_m: 2, longueur_m: 4, rotation_deg: 0, production_kva: 60, puissance_kw: 0, geometrie: [[50.3858, 5.6158], [50.3858, 5.6159], [50.3859, 5.6159]], confirme: true, source_eau: false, besoin_eau: false }, { id: 'ep4', code: 'EXT1', nom: 'Extincteur poudre ABC 6 kg', nature: 'picto', picto: 'extincteur', calque: 'securite', categorie: 'extincteur', forme_echelle: 'cercle', centre_lat: 50.3857, centre_lon: 5.6157, largeur_m: 0.5, longueur_m: 0.5, rotation_deg: 0, agent_extinction: 'poudre_abc', capacite_extinction: 6, geometrie: [[50.3857, 5.6157]], confirme: false }, { id: 'ep1', code: 'DEA1', nom: 'DEA', nature: 'picto', picto: 'extincteur', categorie: 'dea', geometrie: [[50.386, 5.616]], centre_lat: 50.386, centre_lon: 5.616, rotation_deg: 0, confirme: true }, { id: 'ep2', code: 'PRV', nom: 'PRV', nature: 'objet', forme: 'zone', calque: 'securite', categorie: 'prv', forme_echelle: 'rect', centre_lat: 50.3861, centre_lon: 5.6162, largeur_m: 5, longueur_m: 5, rotation_deg: 0, geometrie: [[50.3861, 5.6161], [50.3862, 5.6163], [50.386, 5.6164]], confirme: true, besoin_eau: true, debit_l_min: 6, adresse: 'Rue du Vicinal 12, 4190 Ferrières' },
    // (27/10) Une table posée sur le PRV : l'objet sous un autre, à sélectionner clic après clic.
    // (29/10) Décalée de 2,2 m vers l'est : elle déborde du PRV, c'est un vrai chevauchement.
    { id: 'ep6', code: 'TABLE', nom: 'Table pliante', nature: 'objet', calque: 'infrastructures', categorie: 'autre', forme_echelle: 'rect', centre_lat: 50.3861, centre_lon: 5.616231, largeur_m: 0.8, longueur_m: 1.8, rotation_deg: 0, geometrie: [[50.3861, 5.616231]], confirme: true },
    // (29/10) Un frigo entièrement dans le PRV : intégré, pas un chevauchement.
    { id: 'ep10', code: 'FRIGO-01', nom: 'Frigo', nature: 'objet', calque: 'restauration', categorie: 'autre', forme_echelle: 'rect', centre_lat: 50.3861, centre_lon: 5.6162, largeur_m: 1, longueur_m: 2, rotation_deg: 0, puissance_kw: 0.3, geometrie: [[50.3861, 5.6162]], confirme: true },
    // (139) Une voie d'accès secours tracée : chaussée rouge, sans jonctions.
    { id: 'ep7', code: 'VOIESEC-01', nom: 'Voie d’accès secours', nature: 'ligne', calque: 'securite', categorie: 'voie_engins', forme: 'ligne', forme_echelle: 'rect', centre_lat: 50.3864, centre_lon: 5.6166, largeur_m: 4, longueur_m: 60, quantite: 15, rotation_deg: 0, geometrie: [[50.3863, 5.6164], [50.3865, 5.6168]], confirme: true },
    // (145) Un poteau et une guirlande LED dont le premier sommet est à 10 cm du poteau : « Accrocher aux poteaux » le colle dessus.
    { id: 'ep8', code: 'POTEAU-01', nom: 'Poteau (support)', nature: 'objet', calque: 'infrastructures', categorie: 'autre', forme_echelle: 'rect', centre_lat: 50.3859, centre_lon: 5.6170, largeur_m: 0.3, longueur_m: 0.3, hauteur_m: 4, rotation_deg: 0, geometrie: [[50.3859, 5.6170]], confirme: true },
    { id: 'ep9', code: 'GUIRLAND-01', nom: 'Guirlande LED (par 10 m)', nature: 'ligne', calque: 'energie', categorie: 'autre', forme: 'ligne', forme_echelle: 'rect', centre_lat: 50.38595, centre_lon: 5.6173, largeur_m: 10, longueur_m: 42, quantite: 5, puissance_kw: 0.5, rotation_deg: 0, geometrie: [[50.385901, 5.617001], [50.3860, 5.6176]], confirme: false }],
  membres_evenement: [{ id: 'mb1', user_id: 'u1', nom_affiche: 'Ren' }],
  equipes: [{ id: 'e1', code: 'A', nom: 'Alpha' }],
  // (130, 131) L'annuaire et une demande de prix en comparaison.
  // (138) L'inventaire de l'organisation : trois articles, une location en retard et un prêt rendu.
  inventaire_etat: [
    { id: 'in1', organisation_id: 'org1', code: 'INV-0001', description: 'Tente 3 × 3 m blanche', categorie: 'tentes', quantite: 4, emplacement: 'Hangar, étagère B', valeur_htva: 250, prix_location: 15, actif: true, sorti: 3, disponible: 1, nb_prets: 1 },
    { id: 'in2', organisation_id: 'org1', code: 'INV-0002', description: 'Sono 2 × 300 W', categorie: 'sono', quantite: 1, emplacement: 'Local technique', valeur_htva: 900, prix_location: 40, actif: true, sorti: 0, disponible: 1, nb_prets: 1 },
    { id: 'in3', organisation_id: 'org1', code: 'INV-0003', description: 'Table pliante 1,8 m', categorie: 'mobilier', quantite: 20, emplacement: 'Hangar', valeur_htva: 45, prix_location: null, actif: true, sorti: 0, disponible: 20, nb_prets: 0 }
  ],
  inventaire: [{ id: 'in1', code: 'INV-0001' }],
  prets_inventaire_vue: [
    { id: 'pr1', organisation_id: 'org1', inventaire_id: 'in1', materiel_code: 'INV-0001', materiel: 'Tente 3 × 3 m blanche', quantite: 3, nature: 'location', loueur: 'Comité des fêtes', loueur_contact: '0470 00 00 09', date_sortie: '2026-10-10', date_retour_prevue: '2026-10-20', date_retour: null, prix: 450, responsable: 'Ren', statut: 'en_retard' },
    { id: 'pr2', organisation_id: 'org1', inventaire_id: 'in2', materiel_code: 'INV-0002', materiel: 'Sono 2 × 300 W', quantite: 1, nature: 'pret', loueur: 'École communale', loueur_contact: null, date_sortie: '2026-09-01', date_retour_prevue: '2026-09-03', date_retour: '2026-09-03', prix: 0, responsable: 'Ren', statut: 'rendu' }
  ],
  prets_inventaire: [],
  organisations: [{ id: 'org1', nom: 'Bucolique Ferrières', contact_nom: 'Ren', contact_email: 'ren@exemple.be', contact_tel: null }],
  fournisseur_contacts: [{ id: 'fc1', fournisseur_id: 'f1', nom: 'Sophie Lemaire', fonction: 'planning', telephone: '0470 00 00 02', email: 'sophie@lemaire.be', principal: true }, { id: 'fc2', fournisseur_id: 'f1', nom: 'Marc Lemaire', fonction: 'commercial', telephone: null, email: 'marc@lemaire.be', principal: false }, { id: 'fc3', fournisseur_id: 'f2', nom: 'Jean Dupont', fonction: null, telephone: null, email: 'jean@dupont.be', principal: true }],
  fournisseur_evaluations: [{ id: 'ev1', fournisseur_id: 'f1', evenement_id: 'ev0', note: 4, verdict: 'a_reprendre', commentaire: 'ponctuel', created_at: '2025-11-12T10:00:00Z', evenements: { nom: 'Rando VTT 2025' } }],
  demande_prix_lignes: [{ id: 'dl1', demande_id: 'dp1', ordre: 1, designation: 'Barrière Heras 3,5 m', quantite: 10, unite: 'pièce', precision: null, materiel_id: null }, { id: 'dl2', demande_id: 'dp1', ordre: 2, designation: 'Pied béton', quantite: 5, unite: 'pièce', precision: null, materiel_id: null }, { id: 'dl3', demande_id: 'dp1', ordre: 3, designation: 'Transport aller-retour', quantite: 1, unite: 'forfait', precision: 'livraison vendredi 8 h', materiel_id: null }],
  consultations: [], offre_lignes: [], commandes: [], journal_imports: [], groupes_travail: [{ id: 'gt1', nom: 'Sécurité', ordre: 1, couleur: '#2a9d8f' }, { id: 'gt2', nom: 'Logistique', ordre: 2 }],
  // (27/10) Un fond de plan de 60 × 30 m tourné de 20°, pour voir l'image tournée et ses réglages.
  fonds_plan: [{ id: 'fp1', evenement_id: 'ev1', nom: 'plan-proprio.png', chemin: 'ev1/plan.png', coins: { no: [50.3858188, 5.6152751], ne: [50.3856344, 5.6160694], so: [50.3855656, 5.6151306] }, opacite: 0.6, visible: true, updated_at: '2026-10-27T10:00:00Z' }],
  materiel: [{ id: 'mat1', code: 'HER-01', nom: 'Barrière Heras 3,5 m', unite: 'pièce', categorie: 'barriérage' }],
  maydays: [], groupes: [], transports: [{ id: 'tr1', reference: 'TRA-001', priorite: 'P2', statut: 'attribuee', nb_personnes: 3, motif: 'Navette gare', souhaite_pour: new Date().toISOString(), contact: '0477 11 22 33', adresse_depart: 'Gare de Ferrières', etape: 'en_route', depart: null, arrivee: null, chauffeur: null, depart_libre: 'Gare', arrivee_libre: 'Départ' }], programme: [], jalons: [], journal: [], recherches: [], canaux_radio: [], attributions: [], alertes: [], alertes_accuses: [], mission_commentaires: [], objets_plan: [], moyens_premiers_secours: [], veille_meteo: [], passages: []
}
const J = '2026-11-11'
// (130) Trois fournisseurs : deux de barriérage, un d'énergie.
const fournisseur = (id, nom, categories, extra = {}) => ({ id, nom, tva: null, adresse: null, site: null, telephone: '04 111 11 11', email: `info@${id}.be`, categories, zone: 'province de Liège', notes: null, actif: true, contact_id: null, contact_nom: null, contact_fonction: null, contact_telephone: null, contact_email: null, nb_contacts: 0, nb_consultations: 0, nb_retenues: 0, note_moyenne: null, nb_evaluations: 0, dernier_verdict: null, derniere_evaluation: null, dernier_evenement: null, ...extra })
export const ANNUAIRE = [
  fournisseur('f1', 'Barrières Lemaire', ['barrierage'], { contact_id: 'fc1', contact_nom: 'Sophie Lemaire', contact_fonction: 'planning', contact_telephone: '0470 00 00 02', contact_email: 'sophie@lemaire.be', nb_contacts: 2, nb_consultations: 3, nb_retenues: 1, note_moyenne: 4.0, nb_evaluations: 1, dernier_verdict: 'a_reprendre', dernier_evenement: 'Rando VTT 2025' }),
  fournisseur('f2', 'Clôtures Dupont', ['barrierage', 'signaletique'], { contact_id: 'fc3', contact_nom: 'Jean Dupont', contact_email: 'jean@dupont.be', nb_contacts: 1, nb_consultations: 1 }),
  fournisseur('f3', 'Énergie Mobile', ['energie'])
]
// (131) DP-01 en comparaison : offre A par lignes (135 € HT), offre B forfait (1 850 € HT) ; DP-02 en brouillon.
const dpVue = (id, reference, objet, statut, extra = {}) => ({ id, reference, objet, categorie: 'barrierage', description: null, statut, date_limite: '2026-11-01T12:00:00+01:00', livraison_de: '2026-11-09T08:00:00+01:00', livraison_a: '2026-11-13T18:00:00+01:00', lieu_id: null, lieu_nom: null, groupe_travail_id: 'gt2', groupe_nom: 'Logistique', responsable_membre_id: 'mb1', responsable: 'Ren', jalon_id: null, jalon_statut: null, decision_motif: null, nb_lignes: 3, nb_consultations: 2, nb_a_envoyer: 0, nb_envoyees: 0, nb_offres: 2, nb_sans_reponse: 0, meilleure_offre_ht: 135, retenu_fournisseur: null, retenu_montant_ht: null, retenu_taux_tva: null, commande_id: null, commande_statut: null, en_retard: false, updated_at: '2026-10-26T10:00:00Z', ...extra })
export const DEMANDES_PRIX = [
  dpVue('dp1', 'DP-01', 'Barriérage périmètre scène', 'comparaison', { jalon_id: 'j1', jalon_statut: 'fait' }),
  dpVue('dp2', 'DP-02', 'Groupe électrogène', 'brouillon', { categorie: 'energie', nb_lignes: 0, nb_consultations: 0, nb_offres: 0, meilleure_offre_ht: null, date_limite: null })
]
export const COMPARAISON = [
  { consultation_id: 'c1', fournisseur_id: 'f1', fournisseur_nom: 'Barrières Lemaire', contact_id: 'fc1', contact_nom: 'Sophie Lemaire', contact_email: 'sophie@lemaire.be', contact_telephone: '0470 00 00 02', statut: 'offre_recue', envoyee_le: '2026-10-20T10:00:00Z', relances: [], offre_recue_le: '2026-10-24T10:00:00Z', offre_validite: '2026-11-30', offre_delai: '48 h', offre_conditions: 'transport inclus', montant_ht: 135, taux_tva: 21, montant_ttc: 163.35, commentaire: null, note_moyenne: 4.0, dernier_verdict: 'a_reprendre', lignes: [{ ligne_id: 'dl1', prix_unitaire_ht: 2, quantite_offerte: null, total_ht: 20, remarque: null }, { ligne_id: 'dl2', prix_unitaire_ht: 3, quantite_offerte: null, total_ht: 15, remarque: null }, { ligne_id: 'dl3', prix_unitaire_ht: 100, quantite_offerte: null, total_ht: 100, remarque: null }] },
  { consultation_id: 'c2', fournisseur_id: 'f2', fournisseur_nom: 'Clôtures Dupont', contact_id: 'fc3', contact_nom: 'Jean Dupont', contact_email: 'jean@dupont.be', contact_telephone: null, statut: 'offre_recue', envoyee_le: '2026-10-20T10:00:00Z', relances: [{ le: '2026-10-23T10:00:00Z', note: 'rappel' }], offre_recue_le: '2026-10-25T10:00:00Z', offre_validite: null, offre_delai: 'sous 3 semaines', offre_conditions: 'caution 500 €', montant_ht: 1850, taux_tva: 21, montant_ttc: 2238.5, commentaire: 'forfait', note_moyenne: null, dernier_verdict: null, lignes: [] }
]
const jalonGantt = (n, groupe, debut, fin, extra = {}) => ({
  id: 'gj' + n, code: 'GJ-0' + n, libelle: ['Dossier commune', 'Avis zone de secours', 'Commande chapiteau', 'Montage chapiteau', 'Montage scène', 'Briefing bénévoles', 'Démontage', 'Bilan', 'Lancement pré-vente'][n - 1],
  debut: debut ? new Date(debut + 'T09:00:00+01:00').toISOString() : null, fin: new Date(fin + 'T17:00:00+01:00').toISOString(),
  phase: 'preparation', groupe_travail_id: groupe === 'A' ? 'gt1' : groupe === 'B' ? 'gt2' : null, groupe_nom: groupe === 'A' ? 'Sécurité' : groupe === 'B' ? 'Logistique' : null,
  groupe_ordre: groupe === 'A' ? 1 : 2, groupe_pilote: groupe === 'A' ? 'Ren' : null, responsable: 'Ren', responsable_membre_id: null,
  statut: 'a_venir', avancement: 0, critique: false, en_retard: false, sur_chemin_critique: false, marge_j: 5, predecesseurs: [], successeurs: [],
  offset_debut_j: null, offset_fin_j: null, ancre: 'debut', phase_cible: null, visibilite: 'membres', commentaire: null, ...extra
})
export const GANTT = [
  jalonGantt(1, 'A', '2026-09-01', '2026-09-20', { statut: 'fait', avancement: 100, marge_j: 10 }),
  jalonGantt(2, 'A', null, '2026-10-05', { successeurs: ['gj4'] }),
  jalonGantt(3, 'B', '2026-10-01', '2026-10-15', { statut: 'en_cours', avancement: 40, successeurs: ['gj4'] }),
  jalonGantt(4, 'B', '2026-11-08', '2026-11-10', { predecesseurs: ['gj2', 'gj3'], successeurs: ['gj5'], sur_chemin_critique: true, marge_j: 0, phase: 'montage' }),
  jalonGantt(5, 'B', '2026-11-09', '2026-11-10', { predecesseurs: ['gj4'], critique: true, phase: 'montage', sur_chemin_critique: true, marge_j: 0 }),
  jalonGantt(6, null, null, '2026-11-10', { phase: 'montage' }),
  jalonGantt(7, 'B', '2026-11-12', '2026-11-13', { phase: 'demontage', predecesseurs: ['gj5'] }),
  jalonGantt(8, null, null, '2026-11-20', { phase: 'demontage' }),
  // (27/10) Un jalon plus de 120 jours avant J : la fenêtre doit remonter jusqu'à lui.
  jalonGantt(9, 'A', '2026-04-01', '2026-04-10', { statut: 'fait', avancement: 100 })
]
export const DEPENDANCES = [
  { id: 'd1', evenement_id: 'ev1', jalon_id: 'gj4', precede_id: 'gj2', decalage_j: 0 },
  { id: 'd2', evenement_id: 'ev1', jalon_id: 'gj4', precede_id: 'gj3', decalage_j: 0 },
  { id: 'd3', evenement_id: 'ev1', jalon_id: 'gj5', precede_id: 'gj4', decalage_j: 0 }, // violée : GJ-05 commence avant la fin de GJ-04
  { id: 'd4', evenement_id: 'ev1', jalon_id: 'gj7', precede_id: 'gj5', decalage_j: 1 }
]
DONNEES.jalon_dependances = DEPENDANCES

function constructeur(table, fn, args) {
  // Les appels RPC sont notés, pour que le banc vérifie ce que l'écran a envoyé.
  if (fn === 'rpc' && typeof window !== 'undefined') (window.__appels ||= []).push({ fn: table, args })
  const RPC = {
    situation: { evenement: { nom: 'Essai', phase: 'exploitation', geometrie: 'parcours', modules: { securite: true, logistique: true, parcours: true } }, alertes: [], signalements: { ouverts: 1, non_pris_en_charge: 1, total: 3, derniers: [] }, missions: { ouvertes: 1, p1: 1, par_module: {} }, parcours: { en_route: 0, groupes: [], sans_nouvelles: 0, etapes: [{ id: 'l1', code: 'E1', nom: 'Étape 1', pk_km: 1.2, capacite: 50, charge: 46 }] }, jalons_en_retard: 2, logistique: { jauge: 10, sous_seuil: [], transports: [{ id: 'tr1', reference: 'TRA-001', statut: 'en_cours', priorite: 'P2', depart: 'Gare', arrivee: 'Départ', nb_personnes: 3, etape: 'charge', chauffeur: 'Ren' }], transports_ouverts: 1 }, rh: {}, recherches: [], jalons: [], journal: [] },
    situation_autorite: { destinataire: { libelle: 'Bourgmestre', niveau: 'operationnel' }, evenement: { nom: 'Essai', phase: 'exploitation', geometrie: 'parcours', point_0: { lat: 50.38, lon: 5.61 } }, alertes: [], activite: {}, interventions: [{ source: 'signalement', reference: 'SOS-001', heure: new Date().toISOString(), nature: 'malaise', gravite: 'grave', statut: 'recu', position: { lat: 50.3845, lon: 5.6215 }, sur_trace: { km: 1.1, ecart_m: 40, avant: { code: 'P0' }, apres: { code: 'E1' } }, doublons: 1 }], recherches: [], public: { groupes: [] }, meteo: {}, acces_secours: [{ code: 'PRVP-01', nom: 'PRV nord', categorie: 'point_rencontre_secours', adresse: 'Rue du Vicinal 12, 4190 Ferrières', position: { lat: 50.381, lon: 5.611 } }, { code: 'PRVP-02', nom: 'PRV sud', categorie: 'point_rencontre_secours', confirme: false, position: { lat: 50.383, lon: 5.613 } }, { code: 'ACCESSEC-01', nom: 'Accès secours', categorie: 'voie_engins', adresse: 'Chemin des Crêtes 3', position: { lat: 50.3825, lon: 5.6125 } }], traces: [{ nom: 'Boucle', points: [[50.38, 5.61], [50.39, 5.62]] }], reperes: [{ code: 'E1', nom: 'Étape 1', type: 'etape', pk_km: 1.2, capacite: 50, charge: 60, position: { lat: 50.385, lon: 5.615 } }], segments: [], ressources: {}, installations_risque: [], programme: [], radio: [], contacts: [], documents: [], interlocuteurs: [{ role: 'interlocuteur', nom: 'J. Grosjean', fonction: 'Directeur', telephone: '0477 88 89 99' }], plan: [{ id: 'cab1', code: 'CAB-01', nom: 'Câble', nature: 'ligne', calque: 'energie', reseau: 'electricite', de_id: 'grp1', vers_id: 'cof1', section_mm2: 6, calibre_a: 32, longueur_m: 30, type_cable: 'H07RN-F', phases: 3, points: [[50.3842, 5.6212], [50.3844, 5.6216]] }, { id: 'grp1', code: 'GRP-01', nom: 'Groupe 20 kVA', nature: 'objet', calque: 'energie', categorie: 'groupe_electrogene', production_kva: 20, tension_v: 400, phases: 3, terre: true, points: [[50.3841, 5.6210], [50.3841, 5.6212], [50.3842, 5.6212], [50.3842, 5.6210]], centre: { lat: 50.38415, lon: 5.6211 }, largeur_m: 2, longueur_m: 3 }, { id: 'cof1', code: 'COF-01', nom: 'Coffret scène', nature: 'objet', calque: 'energie', categorie: 'coffret_electrique', alimente_par: 'grp1', calibre_a: 32, differentiel_ma: 30, tension_v: 400, phases: 3, puissance_kw: 6, points: [[50.3844, 5.6216], [50.3844, 5.6217], [50.3845, 5.6217], [50.3845, 5.6216]], centre: { lat: 50.38445, lon: 5.62165 }, largeur_m: 1, longueur_m: 1 }, { code: 'CHAP-01', nom: 'Chapiteau', nature: 'objet', calque: 'infrastructures', accueil_public: true, points: [[50.3846, 5.6210], [50.3846, 5.6214], [50.3848, 5.6214], [50.3848, 5.6210]], centre: { lat: 50.3847, lon: 5.6212 } }, { code: 'PRVP-01', nom: 'PRV nord', nature: 'picto', picto: 'prv', calque: 'securite', centre: { lat: 50.381, lon: 5.611 } }, { code: 'EXT-01', nom: 'Extincteur', nature: 'picto', picto: 'extincteur', calque: 'securite', agent_extinction: 'poudre_abc', capacite_extinction: 6, centre: { lat: 50.3843, lon: 5.6218 } }] },
    contenu_public: { evenement: { nom: 'Essai' }, alertes: [], lieux: [], traces: [{ nom: 'Boucle', points: [[50.38, 5.61], [50.39, 5.62]] }], programme: [], jalons: [], communications: [] },
    evenement_public: [{ nom: 'Essai', sos_actif: true }],
    mon_terrain: [{ genre: 'transport', id: 'tr1', reference: 'TRA-001', titre: 'Gare → Départ', priorite: 'P2', statut: 'attribuee', pour_moi: true }, { genre: 'mission', id: 'm1', reference: 'SEC-001', titre: 'Renfort', priorite: 'P1', statut: 'attribuee', latitude: 50.385, longitude: 5.62, pour_moi: true }],
    mes_capacites: [], jauge_courante: 10, couverture_creneaux: [],
    // (129) Huit jalons dans deux groupes, quatre dépendances dont une violée (GJ-05 commence avant la fin de GJ-04).
    gantt: GANTT, deplacer_jalon: [{ deplaces: 2, apres_j: 1 }], recaler_jalons: [{ touches: 3, exemples: ['Chapiteau', 'Scène'] }],
    // (130, 131) ?ecran=…-lecture : membre qui lit sans gérer l'annuaire.
    mes_droits_annuaire: [{ lire: true, gerer: !(typeof location !== 'undefined' && /-lecture/.test(location.search)) }],
    annuaire: ANNUAIRE, historique_fournisseur: [{ consultation_id: 'h1', evenement_id: 'ev0', evenement: 'Rando VTT 2025', reference: 'DP-02', objet: 'Barriérage', statut: 'retenue', montant_ht: 120, taux_tva: 21, envoyee_le: '2025-10-01T10:00:00Z', retenue: true }],
    demandes_prix_vue: DEMANDES_PRIX, comparaison: COMPARAISON, suivi_demandes: [{ categorie: 'a_comparer', demande_id: 'dp1', reference: 'DP-01', objet: 'Barriérage périmètre scène', date_limite: '2026-11-01T12:00:00+01:00', consultation_id: null, fournisseur: null, detail: '2 offres reçues' }],
    retenir_offre: 'cmd1', marquer_envoyee: true, relancer: true, epingler_fournisseur: 'ct9'
  }
  // ?site=1 : un site sans parcours ni lieu (un festival), pour voir une carte se cadrer sur le plan.
  const site = typeof location !== 'undefined' && new URLSearchParams(location.search).get('site') === '1'
  const lignes = () => (fn === 'rpc' ? (RPC[table] ?? []) : site && (table === 'traces' || table === 'lieux') ? [] : (DONNEES[table] ?? []))
  const resultat = () => ({ data: lignes(), error: null, count: lignes().length })
  const b = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve(resultat()).then(res, rej)
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: (DONNEES[table] ?? [])[0] ?? null, error: null })
      // (28/10) Les écritures sont notées aussi, pour vérifier ce qu'un écran envoie.
      if (prop === 'update' || prop === 'insert') return (champs) => { if (typeof window !== 'undefined') (window.__ecritures ||= []).push({ table, op: prop, champs }); return b }
      return () => b
    }
  })
  return b
}
export const supabase = {
  from: (t) => constructeur(t),
  rpc: (f, args) => constructeur(f, 'rpc', args),
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  storage: { from: () => ({ createSignedUrl: async (chemin) => ({ data: { signedUrl: /\.dwg$/.test(chemin ?? '') ? `https://kunvnnfejhnuhflycyfz.supabase.co/storage/v1/object/sign/plans/${chemin}?token=x` : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEklEQVQIW2P8z8DwnwEIGGEMAD/0A/8MO6tKAAAAAElFTkSuQmCC' } }), getPublicUrl: () => ({ data: { publicUrl: '' } }), upload: async () => ({ error: null }), remove: async () => ({}),
    // (27/10) Conversion DWG : adresses signées du projet, et le DXF « converti » est celui que le banc a glissé dans window.__dxfConverti.
    createSignedUploadUrl: async (chemin) => ({ data: { signedUrl: `https://kunvnnfejhnuhflycyfz.supabase.co/storage/v1/object/upload/sign/plans/${chemin}?token=x`, token: 'x', path: chemin } }),
    download: async () => ({ data: new Blob([window.__dxfConverti ?? ''], { type: 'application/dxf' }) }) }) },
  channel: () => ({ on() { return this }, subscribe() { return this } }),
  removeChannel() {}
}
