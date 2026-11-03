// Faux client Supabase : chaque table rend un jeu de données plausible.
export const DONNEES = {
  signalements: [
    { id: 's1', reference: 'SOS-001', type: 'malaise', statut: 'recu', description: 'Personne au sol', recu_le: new Date().toISOString(), emis_le: new Date().toISOString(), latitude: 50.3845, longitude: 5.6215, lieu_id: 'l1', precision_m: 12, contact: '0477 00 00 00', gravite: 'grave', doublon_de: null, updated_at: new Date().toISOString() },
    { id: 's2', reference: 'SOS-002', type: 'malaise', statut: 'recu', recu_le: new Date().toISOString(), emis_le: new Date().toISOString(), lieu_id: 'l1', doublon_de: 's1' },
    { id: 's3', reference: 'SOS-003', type: 'danger', statut: 'clos', recu_le: new Date().toISOString(), emis_le: new Date().toISOString(), clos_le: new Date().toISOString(), lieu_id: null }
  ],
  missions: [{ id: 'm1', reference: 'SEC-001', titre: 'Renfort', priorite: 'P1', statut: 'attribuee', module: 'securite', signalement_id: 's1', latitude: 50.385, longitude: 5.62, lieu_id: null, equipe_id: 'e1', membre_id: null, attribuee_le: new Date().toISOString(), demarree_le: null, equipe: { code: 'A' }, lieu: null, membre: null }],
  traces: [{ id: 't1', nom: 'Boucle', couleur: null, points: [[50.38, 5.61, 300], [50.39, 5.62, 310], [50.395, 5.63, 320]] }],
  // (162) Deux messages vocaux : une urgence reconnue, à entendre ; une question de canal déjà répondue et entendue.
  messages_vocaux: [
    { id: 'mv1', evenement_id: 'ev1', membre_id: 'mb1', parle_le: '2026-11-11T20:58:00+01:00', recu_le: '2026-11-11T21:03:00+01:00', duree_s: 6, chemin_audio: 'ev1/mb1/mv1.webm', transcription: 'il y a un blessé à l’étape 2', transcription_corrigee: null, latitude: null, longitude: null, lieu_id: 'l1', urgence: true, statut: 'nouveau', entendu_le: null, entendu_par: null, mission_id: null, reponse: 'Si quelqu’un est en danger, appelle le 112 maintenant. Le QG a reçu ton message.', reponse_le: '2026-11-11T21:03:01+01:00', reponse_source: 'auto', intention: 'URGENCE', deleted_at: null },
    { id: 'mv2', evenement_id: 'ev1', membre_id: 'mb1', parle_le: '2026-11-11T20:40:00+01:00', recu_le: '2026-11-11T20:40:05+01:00', duree_s: 3, chemin_audio: 'ev1/mb1/mv2.webm', transcription: 'c’est quoi mon canal', transcription_corrigee: null, latitude: null, longitude: null, lieu_id: null, urgence: false, statut: 'entendu', entendu_le: '2026-11-11T20:42:00+01:00', entendu_par: 'u1', mission_id: null, reponse: 'Ton canal : 3 Logistique. Urgence : canal 8 Urgence.', reponse_le: '2026-11-11T20:40:06+01:00', reponse_source: 'auto', intention: 'CANAL', deleted_at: null },
    // (166) Un message sans transcription : le téléphone a refusé le micro à la reconnaissance.
    { id: 'mv3', evenement_id: 'ev1', membre_id: 'mb1', parle_le: '2026-11-11T20:30:00+01:00', recu_le: '2026-11-11T20:30:04+01:00', duree_s: 5, chemin_audio: 'ev1/mb1/mv3.webm', transcription: null, transcription_corrigee: null, reconnaissance: 'erreur:audio-capture', latitude: null, longitude: null, lieu_id: null, urgence: false, statut: 'entendu', entendu_le: '2026-11-11T20:31:00+01:00', entendu_par: 'u1', mission_id: null, reponse: null, reponse_le: null, reponse_source: null, intention: null, deleted_at: null }
  ],
  talkie_intentions: [{ id: 'ti1', code: 'URGENCE', libelle: 'Urgence vitale', motifs: ['malaise', 'bless', '112'], ordre: 10, actif: true }, { id: 'ti2', code: 'CANAL', libelle: 'Quel canal radio', motifs: ['canal'], ordre: 40, actif: true }],
  // (158) Une liaison avec la commune, un message d'urgence non lu, aucun accusé encore.
  liaisons_commune: [{ id: 'lc1', evenement_id: 'ev1', commune: 'Ferrières', entete: 'X-Commune-Secret', actif: true, est_exercice: false, exercice_code: null, nb_messages: 1, dernier_message_le: '2026-11-11T21:02:00+01:00', created_at: '2026-10-01T10:00:00+02:00' }],
  messages_commune: [{ id: 'mc1', evenement_id: 'ev1', liaison_id: 'lc1', reference: 'CW-001', niveau: 'urgence', titre: 'Évacuation partielle du camping', message: 'Montée de l’Ourthe annoncée pour 23 h.', consigne: 'Rassembler les campeurs au PRV', incident_type: 'inondation', incident_phase: 'communale', emise_le: '2026-11-11T21:00:00+01:00', recu_le: '2026-11-11T21:02:00+01:00', lu_par: null, lu_le: null, est_exercice: false, exercice_code: null }],
  messages_commune_accuses: [], journal_receptions: [],
  // (160) La grille de test lue par l'éditeur.
  grille_dmp_criteres: [{ id: 'k1', grille_id: 'g1', code: 'PUBLIC_1000', libelle: 'Plus de 1 000 personnes', famille: 'Affluence', source: 'frequentation', seuil_min: 1000, seuil_max: null, points: 20, ordre: 10 }],
  grille_dmp_seuils: [{ id: 's1', grille_id: 'g1', niveau: 1, score_min: -100, score_max: 10, avis_coamu: false }, { id: 's4', grille_id: 'g1', niveau: 4, score_min: 31, score_max: 35, avis_coamu: true }],
  dmp_reponses: [],
  // (167) Un constat proposé par Eventware, un consigné par un humain ; une édition précédente dans l'organisation.
  rex_entrees: [
    { id: 'rx1', evenement_id: 'ev1', nature: 'suggestion', module: 'logistique', impact: 'gene', phase: 'cloture', constat: '12 demandes « Réassort boissons » au fil de l’événement, une toutes les 28 min en médiane — surtout à Étape 1 ×9.', proposition: 'Prévoir une ronde « réassort boissons » toutes les 15 min sur ces lieux plutôt qu’attendre les demandes.', statut: 'a_arbitrer', source: 'eventware', cle_auto: 'famille_boissons', lieu_id: 'l1', created_at: '2026-11-12T10:00:00Z' },
    { id: 'rx2', evenement_id: 'ev1', nature: 'reussite', module: 'rh', impact: 'mineur', phase: 'exploitation', constat: 'Le briefing du matin a mis tout le monde au même niveau.', proposition: null, statut: 'retenu', source: 'humain', porteur: 'Ren', created_at: '2026-11-11T08:00:00Z' }
  ],
  // (168) Deux QR de poste, l'un sans fiche ; une fiche de poste.
  postes_qr: [
    { id: 'pq1', evenement_id: 'ev1', poste: 'Bar étape 1', jeton: 'jeton-poste-1', fiche_id: 'fp1', lieu_id: 'l1', equipe_id: 'e1', consigne: null, actif: true, nb_acces: 4 },
    { id: 'pq2', evenement_id: 'ev1', poste: 'Jetons', jeton: 'jeton-poste-2', fiche_id: null, lieu_id: null, equipe_id: null, consigne: null, actif: true, nb_acces: 0 }
  ],
  fiches_poste: [{ id: 'fp1', evenement_id: 'ev1', intitule: 'Bar' }],
  evenements: [{ id: 'ev0', nom: 'Rando VTT 2025', date_debut: '2025-11-08', edition_precedente_id: null, organisation_id: 'org1' }],
  prima_referentiel: [
    { famille: 'type_evenement', code: 3, libelle: 'Rock, pop, …', groupe: 'Concert', coefficient: 10, scoring: 100 }, { famille: 'type_evenement', code: 12, libelle: 'Fête de quartier (braderie, brocante, …)', groupe: 'Rassemblement', coefficient: 6, scoring: 60 },
    { famille: 'cloture', code: 1, libelle: 'Zone ouverte', coefficient: 0.75, scoring: 75 }, { famille: 'cloture', code: 3, libelle: 'Zone clôturée (par Nadar / Heras)', coefficient: 1, scoring: 100 },
    { famille: 'surface', code: 2, libelle: 'Surface entre 0,01 km² et 1 km²', coefficient: 1, scoring: 50 }, { famille: 'structure', code: 2, libelle: 'Site provisoire', coefficient: 1.5, scoring: 100 },
    { famille: 'infrastructure', code: 2, libelle: 'Chapiteau(x) de plus de 15 m²', coefficient: 1.5, scoring: 100 }, { famille: 'certitude', code: 2, libelle: 'Raisonnable', coefficient: 1.5, scoring: 15 },
    { famille: 'type_public', code: 3, libelle: 'Debout, dynamique', coefficient: 1.5, scoring: 100 }, { famille: 'age', code: 2, libelle: 'Jeunes / jeunes adultes', coefficient: 1.5, scoring: 75 }, { famille: 'age', code: 5, libelle: 'Public mixte', coefficient: 1, scoring: 50 },
    { famille: 'groupes_risque', code: 1, libelle: 'Exclue', coefficient: 1, scoring: 50 }, { famille: 'densite', code: 2, libelle: 'Moyenne', coefficient: 1, scoring: 50 }, { famille: 'densite', code: 4, libelle: 'Très forte', coefficient: 10, scoring: 100 },
    { famille: 'type_actifs', code: 5, libelle: 'Concert — non professionnels', coefficient: 2, scoring: 50 }, { famille: 'violence', code: 1, libelle: 'Exclue', coefficient: 1, scoring: 0 },
    { famille: 'alcool', code: 3, libelle: 'Probable / médiane', coefficient: 2, scoring: 75 }, { famille: 'meteo', code: 2, libelle: 'Possible / mineure', coefficient: 1.25, scoring: null }
  ],
  prima_saisies: [],
  // (159) Un avis D3 favorable avec une prescription, et un lien d'avis ouvert pour D1.
  avis_autorite: [{ id: 'av1', dossier_id: 'dos1', version: 1, discipline: 'D3', avis: 'favorable_conditions', commentaire: 'Sous réserve du plan de circulation.', rendu_le: '2026-10-21T09:00:00+02:00', remplace_le: null, rendu_par: 'ZP Condroz', prescriptions_dossier: [{ id: 'pr1', texte: 'Plan de circulation validé par la police', caractere: 'obligatoire' }] }],
  acces_autorite: [{ id: 'aa1', evenement_id: 'ev1', jeton: 'jeton-avis', libelle: 'Zone de secours', organisation: 'ZS', niveau: 'avis', discipline: 'D1', actif: true, expire_le: null, nb_acces: 0, dernier_acces: null, created_at: '2026-10-20T10:00:00+02:00' }],
  // (157) Un dossier déposé une fois, avec sa version figée.
  dossiers_securite: [{ id: 'dos1', evenement_id: 'ev1', statut: 'depose', version_courante: 1, depose_le: '2026-10-20T10:00:00+02:00', decide_le: null, niveau_dmp: null, score_dmp: null }],
  dossier_versions: [{ id: 'dv1', dossier_id: 'dos1', version: 1, created_at: '2026-10-20T10:00:00+02:00', auteur_nom: 'Ren', contenu: { evenement: { frequentation_max: 1200, date_montage: '2026-11-09', date_demontage: '2026-11-13' }, prescriptions: [{ code: 'H1' }], lieux: [{}, {}], plan: [{}], contacts: [{}], controles: [{ gravite: 'alerte' }] } }],
  // (155) Un profil de sécurité à moitié rempli : trois champs à compléter.
  organisations_profil_securite: [{ organisation_id: 'org1', responsable_legal: 'Jean Dupont', responsable_legal_tel: '0470 11 11 11', assurance_compagnie: 'Ethias', assurance_police: null, securite_nom: null, securite_tel: null }],
  // (152) Deux jalons de l'événement : l'un en préparation (par sa date), l'autre forcé en montage.
  jalons: [
    { id: 'j1', evenement_id: 'ev1', code: 'J-01', libelle: 'Dossier commune', echeance: '2026-10-20T17:00:00+02:00', statut: 'a_venir', critique: true, groupe_travail_id: null, phase_cible: null, avancement: 0, visibilite: 'membres' },
    { id: 'j2', evenement_id: 'ev1', code: 'J-02', libelle: 'Commande chapiteau', echeance: '2026-11-10T17:00:00+01:00', statut: 'a_venir', critique: false, groupe_travail_id: null, phase_cible: 'preparation', avancement: 0, visibilite: 'membres' },
    { id: 'j3', evenement_id: 'ev1', code: 'J-03', libelle: 'Montage scène', echeance: '2026-11-10T09:00:00+01:00', statut: 'a_venir', critique: false, groupe_travail_id: null, phase_cible: null, avancement: 0, visibilite: 'membres' }
  ],
  types_mission: [{ id: 'tm1', evenement_id: 'ev1', code: 'reappro', libelle: 'Réappro boissons / consommables', categorie: 'reappro_boissons', priorite: 'P3', delai_cible_min: 45 }, { id: 'tm2', evenement_id: 'ev1', code: 'energie', libelle: 'Énergie / éclairage', categorie: 'energie', priorite: 'P2', delai_cible_min: 20 }],
  lieux: [{ id: 'l1', code: 'E1', nom: 'Étape 1', type: 'etape', latitude: 50.385, longitude: 5.615, pk_km: 1.2, capacite: null }, { id: 'l2', code: 'P0', nom: 'Point 0', type: 'pc_ops', latitude: 50.38, longitude: 5.61, pk_km: 0 }],
  liens_plan: [{ id: 'li1', evenement_id: 'ev1', de_id: 'ep3', vers_id: 'ep2', nature: 'alimente', note: 'câble 3G2,5' }], catalogue_equipements: [{ id: 'cat1', code: 'EXT6ABC', libelle: 'Extincteur poudre ABC 6 kg', calque: 'securite', categorie: 'extincteur', forme: 'cercle', largeur_m: 0.5, longueur_m: 0.5, nature: 'picto', picto: 'extincteur', agent_extinction: 'poudre_abc', capacite_extinction: 6 }, { id: 'cat2', code: 'CHAP', libelle: 'Chapiteau 6 × 12 m', calque: 'infrastructures', categorie: 'autre', forme: 'rect', largeur_m: 6, longueur_m: 12 }, { id: 'cat3', code: 'VOIESEC', libelle: 'Voie d’accès secours', calque: 'securite', categorie: 'voie_engins', forme: 'rect', largeur_m: 4, longueur_m: 0.1, nature: 'ligne', picto: 'voie_secours' }], fonds_plan: [], elements_plan: [{ id: 'ep5', code: 'BAR1', nom: 'Barrière Heras (3,5 m)', nature: 'ligne', calque: 'circulation', categorie: 'perimetre', forme: 'ligne', forme_echelle: 'rect', centre_lat: 50.3856, centre_lon: 5.6156, largeur_m: 3.5, longueur_m: 40, quantite: 12, rotation_deg: 0, geometrie: [[50.3855, 5.6152], [50.3858, 5.6158], [50.3854, 5.6162]], confirme: false }, { id: 'ep3', code: 'GE1', nom: 'Groupe 60 kVA', nature: 'objet', calque: 'energie', categorie: 'groupe_electrogene', forme_echelle: 'rect', centre_lat: 50.3858, centre_lon: 5.6158, largeur_m: 2, longueur_m: 4, rotation_deg: 0, production_kva: 60, puissance_kw: 0, geometrie: [[50.3858, 5.6158], [50.3858, 5.6159], [50.3859, 5.6159]], confirme: true, source_eau: false, besoin_eau: false }, { id: 'ep4', code: 'EXT1', nom: 'Extincteur poudre ABC 6 kg', nature: 'picto', picto: 'extincteur', calque: 'securite', categorie: 'extincteur', forme_echelle: 'cercle', centre_lat: 50.3857, centre_lon: 5.6157, largeur_m: 0.5, longueur_m: 0.5, rotation_deg: 0, agent_extinction: 'poudre_abc', capacite_extinction: 6, geometrie: [[50.3857, 5.6157]], confirme: false }, { id: 'ep1', code: 'DEA1', nom: 'DEA', nature: 'picto', picto: 'extincteur', categorie: 'dea', geometrie: [[50.386, 5.616]], centre_lat: 50.386, centre_lon: 5.616, rotation_deg: 0, confirme: true }, { id: 'ep2', code: 'PRV', nom: 'PRV', nature: 'objet', forme: 'zone', calque: 'securite', categorie: 'prv', forme_echelle: 'rect', centre_lat: 50.3861, centre_lon: 5.6162, largeur_m: 5, longueur_m: 5, rotation_deg: 0, geometrie: [[50.3861, 5.6161], [50.3862, 5.6163], [50.386, 5.6164]], confirme: true, besoin_eau: true, debit_l_min: 6, adresse: 'Rue du Vicinal 12, 4190 Ferrières' },
    // (27/10) Une table posée sur le PRV : l'objet sous un autre, à sélectionner clic après clic.
    // (29/10) Décalée de 2,2 m vers l'est : elle déborde du PRV, c'est un vrai chevauchement.
    { id: 'ep6', code: 'TABLE', nom: 'Table pliante', nature: 'objet', calque: 'infrastructures', categorie: 'autre', forme_echelle: 'rect', centre_lat: 50.3861, centre_lon: 5.616231, largeur_m: 0.8, longueur_m: 1.8, rotation_deg: 0, geometrie: [[50.3861, 5.616231]], confirme: true },
    // (29/10) Un PRV et un accès secours en pictogrammes : les deux bouts d'une voie d'accès tracée comme un câble.
    { id: 'ep11', code: 'PRVP-01', nom: 'PRV nord', nature: 'picto', picto: 'prv', calque: 'securite', categorie: 'point_rencontre_secours', forme_echelle: 'cercle', centre_lat: 50.3863, centre_lon: 5.6150, largeur_m: 0.6, longueur_m: 0.6, rotation_deg: 0, geometrie: [[50.3863, 5.6150]], confirme: true },
    { id: 'ep12', code: 'ACCESSEC-01', nom: 'Accès secours', nature: 'picto', picto: 'acces_secours', calque: 'securite', categorie: 'voie_engins', forme_echelle: 'cercle', centre_lat: 50.3865, centre_lon: 5.6153, largeur_m: 0.6, longueur_m: 0.6, rotation_deg: 0, geometrie: [[50.3865, 5.6153]], confirme: true },
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
  maydays: [], groupes: [], transports: [{ id: 'tr1', reference: 'TRA-001', priorite: 'P2', statut: 'attribuee', nb_personnes: 3, motif: 'Navette gare', souhaite_pour: new Date().toISOString(), contact: '0477 11 22 33', adresse_depart: 'Gare de Ferrières', etape: 'en_route', depart: null, arrivee: null, chauffeur: null, depart_libre: 'Gare', arrivee_libre: 'Départ' }], programme: [], journal: [], recherches: [], canaux_radio: [], attributions: [], alertes: [], alertes_accuses: [], mission_commentaires: [], objets_plan: [], moyens_premiers_secours: [], veille_meteo: [], passages: []
}
const J = '2026-11-11'
// (130) Trois fournisseurs : deux de barriérage, un d'énergie.
const fournisseur = (id, nom, categories, extra = {}) => ({ id, nom, tva: null, adresse: null, site: null, telephone: '04 111 11 11', email: `info@${id}.be`, categories, zone: 'province de Liège', notes: null, actif: true, contact_id: null, contact_nom: null, contact_fonction: null, contact_telephone: null, contact_email: null, nb_contacts: 0, nb_consultations: 0, nb_retenues: 0, note_moyenne: null, nb_evaluations: 0, dernier_verdict: null, derniere_evaluation: null, dernier_evenement: null, ...extra })
export const ANNUAIRE = [
  fournisseur('f1', 'Barrières Lemaire', ['barrierage'], { contact_id: 'fc1', contact_nom: 'Sophie Lemaire', contact_fonction: 'planning', contact_telephone: '0470 00 00 02', contact_email: 'sophie@lemaire.be', nb_contacts: 2, nb_consultations: 3, nb_retenues: 1, note_moyenne: 4.0, nb_evaluations: 1, dernier_verdict: 'a_reprendre', dernier_evenement: 'Rando VTT 2025' }),
  fournisseur('f2', 'Clôtures Dupont', ['barrierage', 'signaletique'], { contact_id: 'fc3', contact_nom: 'Jean Dupont', contact_email: 'jean@dupont.be', nb_contacts: 1, nb_consultations: 1 }),
  fournisseur('f3', 'Énergie Mobile', ['energie']),
  // (1/11) Sans catégorie : proposé dans toute demande.
  fournisseur('f4', 'Généraliste SA', [])
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
    situation: { evenement: { nom: 'Essai', phase: 'exploitation', geometrie: 'parcours', modules: { securite: true, logistique: true, parcours: true } }, alertes: [], signalements: { ouverts: 1, non_pris_en_charge: 1, total: 3, derniers: [] }, missions: { ouvertes: 1, p1: 1, par_module: {} }, parcours: { en_route: 0, groupes: [], sans_nouvelles: 0, etapes: [{ id: 'l1', code: 'E1', nom: 'Étape 1', pk_km: 1.2, capacite: 50, charge: 46 }] }, jalons_en_retard: 2, journal: [{ horodatage: new Date(Date.now() - 5 * 60000).toISOString(), texte: 'Alerte météo levée', importance: 'majeur', module: 'securite', source: 'humain' }, { horodatage: new Date(Date.now() - 12 * 60000).toISOString(), texte: 'Navette gare partie', importance: 'normale', module: 'logistique', source: 'systeme' }], logistique: { jauge: 10, sous_seuil: [], transports: [{ id: 'tr1', reference: 'TRA-001', statut: 'en_cours', priorite: 'P2', depart: 'Gare', arrivee: 'Départ', nb_personnes: 3, etape: 'charge', chauffeur: 'Ren' }], transports_ouverts: 1 }, rh: {}, recherches: [], jalons: [] },
    situation_autorite: { destinataire: { libelle: 'Bourgmestre', niveau: 'operationnel' }, evenement: { nom: 'Essai', phase: 'exploitation', geometrie: 'parcours', point_0: { lat: 50.38, lon: 5.61 } }, alertes: [], activite: {}, interventions: [{ source: 'signalement', reference: 'SOS-001', heure: new Date().toISOString(), nature: 'malaise', gravite: 'grave', statut: 'recu', position: { lat: 50.3845, lon: 5.6215 }, sur_trace: { km: 1.1, ecart_m: 40, avant: { code: 'P0' }, apres: { code: 'E1' } }, doublons: 1 }], recherches: [], public: { groupes: [] }, meteo: {}, acces_secours: [{ code: 'PRVP-01', nom: 'PRV nord', categorie: 'point_rencontre_secours', adresse: 'Rue du Vicinal 12, 4190 Ferrières', position: { lat: 50.381, lon: 5.611 } }, { code: 'PRVP-02', nom: 'PRV sud', categorie: 'point_rencontre_secours', confirme: false, position: { lat: 50.383, lon: 5.613 } }, { code: 'ACCESSEC-01', nom: 'Accès secours', categorie: 'voie_engins', adresse: 'Chemin des Crêtes 3', position: { lat: 50.3825, lon: 5.6125 } }], traces: [{ nom: 'Boucle', points: [[50.38, 5.61], [50.39, 5.62]] }], reperes: [{ code: 'E1', nom: 'Étape 1', type: 'etape', pk_km: 1.2, capacite: 50, charge: 60, position: { lat: 50.385, lon: 5.615 } }], segments: [], ressources: {}, installations_risque: [], programme: [], radio: [], contacts: [], documents: [], interlocuteurs: [{ role: 'interlocuteur', nom: 'J. Grosjean', fonction: 'Directeur', telephone: '0477 88 89 99' }], plan: [{ id: 'cab1', code: 'CAB-01', nom: 'Câble', nature: 'ligne', calque: 'energie', reseau: 'electricite', de_id: 'grp1', vers_id: 'cof1', section_mm2: 6, calibre_a: 32, longueur_m: 30, type_cable: 'H07RN-F', phases: 3, points: [[50.3842, 5.6212], [50.3844, 5.6216]] }, { id: 'grp1', code: 'GRP-01', nom: 'Groupe 20 kVA', nature: 'objet', calque: 'energie', categorie: 'groupe_electrogene', production_kva: 20, tension_v: 400, phases: 3, terre: true, points: [[50.3841, 5.6210], [50.3841, 5.6212], [50.3842, 5.6212], [50.3842, 5.6210]], centre: { lat: 50.38415, lon: 5.6211 }, largeur_m: 2, longueur_m: 3 }, { id: 'cof1', code: 'COF-01', nom: 'Coffret scène', nature: 'objet', calque: 'energie', categorie: 'coffret_electrique', alimente_par: 'grp1', calibre_a: 32, differentiel_ma: 30, tension_v: 400, phases: 3, puissance_kw: 6, points: [[50.3844, 5.6216], [50.3844, 5.6217], [50.3845, 5.6217], [50.3845, 5.6216]], centre: { lat: 50.38445, lon: 5.62165 }, largeur_m: 1, longueur_m: 1 }, { code: 'CHAP-01', nom: 'Chapiteau', nature: 'objet', calque: 'infrastructures', accueil_public: true, points: [[50.3846, 5.6210], [50.3846, 5.6214], [50.3848, 5.6214], [50.3848, 5.6210]], centre: { lat: 50.3847, lon: 5.6212 } }, { code: 'PRVP-01', nom: 'PRV nord', nature: 'picto', picto: 'prv', calque: 'securite', centre: { lat: 50.381, lon: 5.611 } }, { code: 'EXT-01', nom: 'Extincteur', nature: 'picto', picto: 'extincteur', calque: 'securite', agent_extinction: 'poudre_abc', capacite_extinction: 6, centre: { lat: 50.3843, lon: 5.6218 } }] },
    contenu_public: { evenement: { nom: 'Essai' }, alertes: [], lieux: [], traces: [{ nom: 'Boucle', points: [[50.38, 5.61], [50.39, 5.62]] }], programme: [], jalons: [], communications: [] },
    evenement_public: [{ nom: 'Essai', sos_actif: true }],
    mon_terrain: [{ genre: 'transport', id: 'tr1', reference: 'TRA-001', titre: 'Gare → Départ', priorite: 'P2', statut: 'attribuee', pour_moi: true }, { genre: 'mission', id: 'm1', reference: 'SEC-001', titre: 'Renfort', priorite: 'P1', statut: 'attribuee', latitude: 50.385, longitude: 5.62, pour_moi: true }],
    mes_capacites: [], jauge_courante: 10, couverture_creneaux: [],
    prc_synthese: [{ lieux_niveau_3: 1, grappes: 2, demandes_ouvertes: 3, demandes_en_retard: 0, demandes_sans_lieu: 0, charge_totale: 4.5 }],
    // (129) Huit jalons dans deux groupes, quatre dépendances dont une violée (GJ-05 commence avant la fin de GJ-04).
    gantt: GANTT, deplacer_jalon: [{ deplaces: 2, apres_j: 1 }], recaler_jalons: [{ touches: 3, exemples: ['Chapiteau', 'Scène'] }],
    // (155) Le coordinateur gère le profil de sécurité de son organisation.
    mes_droits_organisation: [{ lire: true, gerer: true }],
    // (156, 157) Deux bloquants, une alerte, une ligne d'avant-vol : le dépôt attend.
    controle_dossier: [
      { code: 'DOS_COORDINATEUR', gravite: 'bloquant', titre: 'Coordinateur sécurité non désigné ou sans téléphone', detail: 'Réglages › Partage › Interlocuteur', table_source: 'contacts', source_id: null, stimulus: null, objectif: 'DOSSIER' },
      { code: 'DOS_PC_OPS', gravite: 'bloquant', titre: 'PC-Ops non positionné', detail: 'Préparation › Lieux', table_source: 'lieux', source_id: null, stimulus: null, objectif: 'DOSSIER' },
      { code: 'DOS_SECOURS', gravite: 'alerte', titre: 'Aucun moyen de premiers secours déclaré', detail: 'Réglages › Conformité', table_source: 'moyens_premiers_secours', source_id: null, stimulus: null, objectif: 'DOSSIER' },
      { code: 'VEILLE_INACTIVE', gravite: 'veille', titre: 'Veille météo inactive', detail: 'Aucun seuil ne déclenchera rien', table_source: 'veille_meteo', source_id: null, stimulus: 'Météo…', objectif: 'METEO' }
    ],
    deposer_dossier: [{ dossier_id: 'dos1', version: 2, statut: 'depose' }],
    // (163) Deux formulaires applicables (la commune, le fédéral) ; le formulaire lu : trois sections visibles, un pré-rempli,
    // une saisie qui prime, une obligatoire qui manque, un délai de 60 jours.
    formulaires_applicables: [
      { id: 'f1', code: 'FERRIERES_2023', libelle: 'Organisation de manifestations publiques — commune de Ferrières', portee: 'commune', commune: 'Ferrières', province: 'Liège', delai_jours: 60 },
      { id: 'f2', code: 'IBZ_2017', libelle: 'Formulaire multidisciplinaire événement', portee: 'federal', delai_jours: 90 }
    ],
    formulaire_dossier: {
      formulaire: { id: 'f1', code: 'FERRIERES_2023', libelle: 'Organisation de manifestations publiques — commune de Ferrières', autorite: 'Commune de Ferrières, zone de police du Condroz, zone de secours HEMECO',
        portee: 'commune', version: 'Collège communal du 16 novembre 2023', delai_jours: 60, delai_note: '90 jours si une présence policière est requise.', adresse_envoi: 'manifestations@ferrieres.be' },
      sections: [{ section: 1, titre: 'Information générale sur l’événement' }, { section: 3, titre: 'Données sur le public' }, { section: 11, titre: 'Coordonnées de contacts utiles pendant l’événement' }],
      questions: [
        { code: '1.01', section: 1, sous_section: null, libelle: 'Dénomination de l’événement', aide: null, type: 'texte', options: null, obligatoire: true, valeur: 'Rando VTT 2026', prerempli: 'Rando VTT 2026', saisie: null },
        { code: '1.04', section: 1, sous_section: null, libelle: 'Domaine public, lieu accessible au public ou terrain privé ?', aide: null, type: 'choix', options: ['Domaine public', 'Lieu publiquement accessible', 'Terrain privé'], obligatoire: true, valeur: null, prerempli: null, saisie: null },
        { code: '1.09', section: 1, sous_section: null, libelle: 'Date de début', aide: null, type: 'date', options: null, obligatoire: true, valeur: '2026-11-11', prerempli: '2026-11-11', saisie: null },
        { code: '3.01', section: 3, sous_section: null, libelle: 'Nombre de visiteurs attendus', aide: null, type: 'nombre', options: null, obligatoire: true, valeur: 1500, prerempli: 1200, saisie: 1500 },
        { code: '3.05', section: 3, sous_section: null, libelle: 'Public assis, debout ou mixte ?', aide: null, type: 'choix', options: ['Assis', 'Debout', 'Mixte'], obligatoire: false, valeur: null, prerempli: null, saisie: null },
        { code: '4.48', section: 3, sous_section: '4.4 Infrastructure', libelle: 'Structures sur le terrain', aide: null, type: 'multi', options: ['Podium', 'Tribune', 'Tente'], obligatoire: true, valeur: ['Tente'], prerempli: ['Tente'], saisie: null },
        { code: '11.02', section: 11, sous_section: null, libelle: 'Responsable sécurité événement', aide: 'Nom, fonction, GSM', type: 'contact', options: null, obligatoire: true, valeur: { nom: 'Marie Martin', fonction: 'responsable sécurité', gsm: '0470 22 22 22' }, prerempli: { nom: 'Marie Martin', fonction: 'responsable sécurité', gsm: '0470 22 22 22' }, saisie: null },
        { code: '11.04', section: 11, sous_section: null, libelle: 'Hôpital le plus proche (conforme AMU)', aide: null, type: 'contact', options: null, obligatoire: true, valeur: null, prerempli: null, saisie: null }
      ],
      repondues: 5, total: 8, obligatoires_manquantes: ['1.04', '11.04']
    },
    // (159) Le lien D1 lit le dossier déposé ; la D3 a déjà rendu son avis.
    dossier_par_jeton: { destinataire: { libelle: 'Zone de secours', organisation: 'ZS Vesdre-Hoëgne & Plateau', discipline: 'D1', niveau: 'avis' },
      evenement: { nom: 'Rando VTT 2026', commune: 'Ferrières', phase: 'preparation' },
      dossier: { id: 'dos1', statut: 'en_instruction', version: 1, depose_le: '2026-10-20T10:00:00+02:00', niveau_dmp: null },
      contenu: { evenement: { nom: 'Rando VTT 2026', commune: 'Ferrières', province: 'Liège', zone_secours: 'Vesdre-Hoëgne & Plateau', date_montage: '2026-11-09', date_debut: '2026-11-11', date_fin: '2026-11-11', date_demontage: '2026-11-13', frequentation_min: 300, frequentation_max: 1200 },
        organisateur: { nom: 'Les Amis du Vélo', contact_nom: 'Ren', contact_tel: '0470 00 00 00' },
        profil_securite: { responsable_legal: 'Jean Dupont', responsable_legal_tel: '0470 11 11 11', assurance_compagnie: 'Ethias', assurance_police: 'RC-123', securite_nom: 'Marie Martin', securite_tel: '0470 22 22 22' },
        questionnaire: { structure: { chapiteau: true }, cuisson: { gaz: true, barbecue: false } },
        prescriptions: [{ code: 'H1', titre: 'Extincteur par stand de cuisson', caractere: 'obligatoire', referentiel: 'HEMECO' }],
        lieux: [{ code: 'P0', nom: 'Point 0', type: 'pc_ops' }], plan: [{}, {}], secours: [{ type: 'secouristes', quantite: 4 }],
        contacts: [{ nom: 'Coord A', telephone: '0470 00 00 01', role_autorite: 'interlocuteur' }], controles: [{ gravite: 'alerte', titre: 'Plan d’implantation vide' }] },
      avis: [{ id: 'av1', discipline: 'D3', avis: 'favorable', commentaire: 'RAS', rendu_le: '2026-10-21T09:00:00+02:00', rendu_par: 'ZP Condroz', prescriptions: [] }],
      mon_avis: null },
    deposer_avis: [{ avis_id: 'av2', discipline: 'D1', version: 1, prescriptions: 1, statut: 'en_instruction' }],
    // (160) 33 points : niveau 4, avis CoAMU ; le critère « nocturne » se coche.
    calcul_dmp: { grille: { id: 'g1', code: 'T', libelle: 'Grille de test', organisation_id: null }, score: 33, niveau: 4, avis_coamu: true, points_a_saisir: 0,
      details: [{ id: 'k1', code: 'PUBLIC_1000', libelle: 'Plus de 1 000 personnes', famille: 'Affluence', source: 'frequentation', points: 20, applique: true },
        { id: 'k2', code: 'CHAPITEAU', libelle: 'Chapiteau', famille: 'Aménagement du site', source: 'conformite', points: 8, applique: true },
        { id: 'k3', code: 'NUIT', libelle: 'Manifestation nocturne', famille: 'Facteurs aggravants', source: 'manuel', points: 5, applique: true },
        { id: 'k4', code: 'AMBU', libelle: 'Ambulance à moins de 10 min', famille: 'Correctifs', source: 'manuel', points: -3, applique: false }] },
    peut_editer_grille_dmp: [false],
    // (165) La notification DMP : pré-remplie (prestataire, créneaux, adresses), pas encore envoyée, date limite au 28/10/2026.
    notification_dmp: {
      nom: 'Essai', nature: 'Rock, pop, …', creneaux: [{ date: '2026-11-11', acces_debut: '14:00', acces_fin: '23:00', dmp_debut: '14:00', dmp_fin: '23:00' }],
      documents: ['plan(s) d’implantation du site', 'localisation du/des poste(s) de soins'],
      prestataire_interne: false, prestataire_nom: 'Croix-Rouge, section de Ferrières', contact_nom: 'Anne Secours', contact_gsm: '0471 00 00 00',
      responsable_dmp: { nom: 'Anne Secours', gsm: '0471 00 00 00' }, medecin_coordinateur: {}, personnel: [], effectifs: { secouriste: 6 },
      moyens: { poste_soins: { fixes: 1, mobiles: 0 } }, vecteurs: {}, informations: '2 ambulance(s) déclarée(s) dans Eventware : à répartir entre ATNUP et agréées 112 (partie I, vecteurs).',
      adresses: { acces_public: { rue: 'Rue de la Fête 1', localite: 'Ferrières' }, poste_soins: { rue: 'Poste de secours', localite: 'Ferrières' } }, ambulances_112: [], smur: [],
      preremplis: ['nature', 'creneaux', 'documents', 'prestataire_nom', 'contact_nom', 'contact_gsm', 'responsable_dmp', 'effectifs', 'moyens', 'informations', 'adresses'],
      destinataires: { coamu: 'admin.lie@health.fgov.be', cu112: 'expert@cs112.com' }, date_limite: '2026-10-28', jours_ouvres_restants: -4, niveau_dossier: 4, complete: true,
      version: 'Formulaire de notification DMP CoAMU & CU 112, v1.6 (février 2025)'
    },
    // (164) La grille PRIMA : concert rock de nuit, 1 200 personnes → 34,17, ÉLEVÉ, niveau 4 ; le type vient d'une saisie, les spectateurs d'Eventware, le reste par défaut.
    calcul_prima: {
      version: 'PRIMA v1.0 (janvier 2024), mémento v1.6 (mars 2025)',
      entrees: {
        type_evenement: { code: 3, libelle: 'Rock, pop, …', coefficient: 10, scoring: 100, source: 'saisie' },
        spectateurs: { valeur: 1200, source: 'eventware' }, actifs: { valeur: 0, source: 'defaut' }, vip: { valeur: 0, source: 'defaut' }, duree_h: { valeur: 6, source: 'defaut' },
        moments: { journee: false, soiree: false, nuit: true, multijour: false, source: 'saisie' }, impact_riverains: { valeur: false, source: 'defaut' },
        cloture: { code: 1, libelle: 'Zone ouverte', coefficient: 0.75, scoring: 75, source: 'defaut' }, surface: { code: 2, libelle: 'Surface entre 0,01 km² et 1 km²', coefficient: 1, scoring: 50, source: 'defaut' },
        structure: { code: 2, libelle: 'Site provisoire et/ou non prévu à cet effet', coefficient: 1.5, scoring: 100, source: 'defaut' }, infrastructure: { code: 2, libelle: 'Chapiteau(x) de plus de 15 m²', coefficient: 1.5, scoring: 100, source: 'eventware' },
        certitude: { code: 2, libelle: 'Raisonnable', coefficient: 1.5, scoring: 15, source: 'eventware' }, type_public: { code: 3, libelle: 'Debout, dynamique, démonstratif, revendicateur', coefficient: 1.5, scoring: 100, source: 'saisie' },
        age_spectateurs: { code: 2, libelle: 'Jeunes / jeunes adultes', coefficient: 1.5, scoring: 75, source: 'saisie' }, groupes_risque: { code: 1, libelle: 'Exclue', coefficient: 1, scoring: 50, source: 'defaut' },
        densite: { code: 2, libelle: 'Moyenne', coefficient: 1, scoring: 50, source: 'defaut' }, type_actifs: { code: 5, libelle: 'Concert — non professionnels', coefficient: 2, scoring: 50, source: 'defaut' },
        age_actifs: { code: 5, libelle: 'Public mixte', coefficient: 1, scoring: 50, source: 'defaut' }, violence: { code: 1, libelle: 'Exclue', coefficient: 1, scoring: 0, source: 'defaut' },
        alcool: { code: 3, libelle: 'Probable / médiane', coefficient: 2, scoring: 75, source: 'saisie' }, meteo: { code: 2, libelle: 'Possible / mineure', coefficient: 1.25, scoring: null, source: 'defaut' }
      },
      facteurs: { type: 10, duree: 1, moment: 2, lieux: 1.688, certitude: 1.5, spectateurs: 2700, actifs: 0, vip: 1, risques: 2.5 },
      score: 34.17, zone: 'eleve', message: 'ÉLEVÉ : risques majeurs — l’avis de la CoAMU est demandé.', motifs_avis_office: [], ias2003: false, avis_coamu: true, informer_coamu: false,
      scoring: { total: 888, details: [{ critere: 'Type d’événement', points: 100 }, { critere: 'Surface ou distance', points: 50 }, { critere: 'Moment', points: 100 }],
        seuils: [{ niveau: 1, seuil: 450, dispositif: 'Point d’alerte (PA)' }, { niveau: 4, seuil: 875, dispositif: 'Poste de soins médicalisé (PS Med)' }] },
      niveau: 4, dispositif: 'Poste de soins médicalisé (PS Med)', composition: '1 médecin SMA/SMU/TPPSU, 1 infirmier titré SISU, 2 secouristes, 2 secouristes-ambulanciers ; 2 ou plusieurs équipes d’intervention.',
      remarques: null, a_confirmer: ['duree_h']
    },
    // (154) Une demande P1 qui attend plus que d'habitude (seuil appris : 15 min) : le bandeau « Attente ».
    missions_en_souffrance: [{ mission_id: 'm1', reference: 'SEC-001', titre: 'Renfort', priorite: 'P1', module: 'securite', attente_min: 22, seuil_min: 15, depassement: 1.5 }],
    seuils_prise_en_charge: [{ priorite: 'P1', seuil_min: 15, mesures: 22, source: 'appris : 9 demandes sur 10 prises en charge sous ce délai' }, { priorite: 'P2', seuil_min: 32, mesures: 15, source: 'appris : 9 demandes sur 10 prises en charge sous ce délai' }, { priorite: 'P3', seuil_min: 32, mesures: 21, source: 'appris, relevé au niveau de la priorité plus urgente' }, { priorite: 'P4', seuil_min: 120, mesures: 0, source: 'par défaut : moins de 10 mesures dans les événements clos' }],
    // (130, 131) ?ecran=…-lecture : membre qui lit sans gérer l'annuaire.
    mes_droits_annuaire: [{ lire: true, gerer: !(typeof location !== 'undefined' && /-lecture/.test(location.search)) }],
    annuaire: ANNUAIRE, historique_fournisseur: [{ consultation_id: 'h1', evenement_id: 'ev0', evenement: 'Rando VTT 2025', reference: 'DP-02', objet: 'Barriérage', statut: 'retenue', montant_ht: 120, taux_tva: 21, envoyee_le: '2025-10-01T10:00:00Z', retenue: true }],
    demandes_prix_vue: DEMANDES_PRIX, comparaison: COMPARAISON, suivi_demandes: [{ categorie: 'a_comparer', demande_id: 'dp1', reference: 'DP-01', objet: 'Barriérage périmètre scène', date_limite: '2026-11-01T12:00:00+01:00', consultation_id: null, fournisseur: null, detail: '2 offres reçues' }],
    retenir_offre: 'cmd1', marquer_envoyee: true, relancer: true, epingler_fournisseur: 'ct9',
    // (166) La suppression d'un message vocal rend le chemin de l'audio.
    supprimer_message_vocal: 'ev1/mb1/mv3.webm',
    // (167) Eventware qui apprend : familles, mémoire des lieux, constats proposés.
    familles_evenement: [
      { famille: 'boissons', libelle: 'Réassort boissons', ronde: true, module: 'logistique', n: 12, intervalle_median_min: 28, lieux: 'Étape 1 ×9, Point 0 ×3', lieu_id: 'l1' },
      { famille: 'transport_personnes', libelle: 'Transport de personnes', ronde: false, module: 'logistique', n: 4, intervalle_median_min: 95, lieux: null, lieu_id: null }
    ],
    memoire_lieux: [{ lieu_id: 'l1', nom: 'Étape 1', editions: 1, demandes: 11, familles: [{ code: 'boissons', libelle: 'Réassort boissons', n: 9 }, { code: 'jetons', libelle: 'Jetons et caisses', n: 2 }], signalements: 1, rex: 1, constats: ['12 demandes « Réassort boissons » au fil de l’événement, une toutes les 28 min en médiane — surtout à Étape 1 ×9.'] }],
    rex_proposer: 3, rattacher_demandes_lieux: 2, rapprocher_lieux: 2,
    // (168) La page du poste, telle que le serveur la rend (numéros déjà masqués).
    generer_postes_qr: 2,
    poste_par_jeton: {
      evenement: { nom: 'Essai', logo_url: null, phase: 'exploitation', date_debut: '2026-11-11', date_fin: '2026-11-11', telephone_qg: '0470 99 88 77' },
      poste: { poste: 'Bar étape 1', consigne: 'Clé des fûts chez le QG : [numéro : voir le QG].', lieu: 'Étape 1', equipe: 'A · Alpha' },
      fiche: { intitule: 'Bar', mission: 'Servir et tenir la caisse.', taches: ['Servir', 'Compter les fûts'], materiel: 'Tablier, pompe', a_signaler: 'Bagarre, malaise', contact: 'Marc [numéro : voir le QG] ou le 112' },
      creneau_courant: { code: 'CR-01', debut: '2026-11-11T14:00:00+01:00', fin: '2026-11-11T18:00:00+01:00', consignes: null, besoin: 2, equipe: 'A', lieu: 'Étape 1' },
      creneau_suivant: { code: 'CR-02', debut: '2026-11-11T18:00:00+01:00', fin: '2026-11-11T22:00:00+01:00', consignes: 'Fermer la caisse à 22 h', besoin: 2, equipe: 'A', lieu: 'Étape 1' },
      radio: { equipe: { numero: '3', libelle: 'Équipe Alpha' }, urgence: { numero: '1', libelle: 'Urgence' } },
      secours: [{ categorie: 'dea', nom: 'DEA', distance_m: 110 }, { categorie: 'sortie_secours', nom: 'Sortie nord', distance_m: 240 }],
      reflexes: [{ code: 'R1', titre: 'Malaise', categorie: 'sanitaire', declencheur: 'Une personne s’effondre', conduite: ['Appeler le 112', 'Prévenir le QG'], a_ne_pas_faire: ['Déplacer la personne'], contacts: 'QG [numéro : voir le QG], secours 112' }]
    }
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
      if (prop === 'update' || prop === 'insert' || prop === 'upsert') return (champs) => { if (typeof window !== 'undefined') (window.__ecritures ||= []).push({ table, op: prop, champs }); return b }
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
  // (transcription serveur) Les appels aux Edge Functions sont notés comme les RPC.
  functions: { invoke: async (fn, opts) => { if (typeof window !== 'undefined') (window.__appels ||= []).push({ fn, args: opts?.body }); return { data: fn === 'transcrire-vocal' ? { transcription: 'texte transcrit par le serveur' } : {}, error: null } } },
  channel: () => ({ on() { return this }, subscribe() { return this } }),
  removeChannel() {}
}
