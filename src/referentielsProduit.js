/**
 * Référentiels de produit partagés par plusieurs écrans.
 *
 * Aucune donnée client ici — des listes figées au niveau du produit,
 * qui existaient en double (App, Roles, Plateforme) et divergeaient :
 * Plateforme oubliait `preparation`. Une seule liste, importée partout.
 */

export const PHASES = ['preparation', 'montage', 'exploitation', 'demontage', 'cloture']

export const GEOMETRIES = [
  ['site_ferme', 'Site fermé'],
  ['parcours', 'Parcours'],
  ['hybride', 'Hybride']
]

export const MODULES = [
  ['securite', 'Sécurité'],
  ['preparation', 'Préparation'],
  ['logistique', 'Logistique'],
  ['rh', 'Bénévoles'],
  ['parcours', 'Parcours'],
  ['sos_participants', 'SOS participants'],
  ['plan_implantation', "Plan d'implantation"],
  ['analyse', 'Analyse / REX'],
  ['precurseur', 'Précurseur (charge des lieux)'],
  ['exercices', 'Exercices sur mesure']
]

/*
 * Catégories des éléments du plan d'implantation : [code, libellé,
 * forme attendue, installation à risque]. Les codes sont ceux de l'enum
 * `categorie_element`. Vivaient dans PlanImplantation.jsx, et l'import
 * KML en avait sa propre copie, sans les sept catégories du dispositif
 * de secours (PMA, PRV, aire hélico…) : un calque « PMA » ne pouvait pas
 * y être envoyé (03/10).
 */
export const CATEGORIES_PLAN = [
  // Dispositif de secours — vocabulaire de la doctrine belge
  ['point_rencontre_secours', 'Point de rencontre des secours', 'point', false],
  ['prv', 'PRV — regroupement des victimes', 'point', false],
  ['pma', 'PMA — poste médical avancé', 'point', false],
  ['aire_helico', 'Aire hélicoptère', 'zone', false],
  ['point_rassemblement', 'Point de rassemblement', 'point', false],
  ['point_transfert', 'Point de transfert', 'point', false],
  ['noria', 'Noria', 'ligne', false],
  // Installations
  ['foodtruck', 'Foodtruck', 'point', true],
  ['groupe_electrogene', 'Groupe électrogène', 'point', true],
  ['stockage_gaz', 'Stockage gaz', 'point', true],
  ['bar_installation', 'Bar', 'point', true],
  ['feu', 'Feu / brasero', 'point', true],
  ['extincteur', 'Extincteur', 'point', false],
  ['dea', 'DEA', 'point', false],
  ['point_eau', "Point d'eau", 'point', false],
  ['poste_secours', 'Poste de secours', 'point', false],
  ['coupure_gaz', 'Coupure gaz', 'point', false],
  ['coffret_electrique', 'Coffret électrique', 'point', false],
  ['sortie_secours', 'Sortie de secours', 'point', false],
  ['cheminement', 'Cheminement', 'ligne', false],
  ['itineraire_evacuation', "Itinéraire d'évacuation", 'ligne', false],
  ['voie_engins', 'Voie engins', 'ligne', false],
  ['cable', 'Câble', 'ligne', false],
  ['tuyau', 'Tuyau', 'ligne', false],
  ['scene', 'Scène', 'zone', false],
  ['bar', 'Zone bar', 'zone', false],
  ['camping', 'Camping', 'zone', false],
  ['parking', 'Parking', 'zone', false],
  ['perimetre', 'Périmètre', 'zone', false],
  ['zone_interdite', 'Zone interdite', 'zone', false],
  ['autre', 'Autre', 'point', false]
]

/** Types de lieu : enum `type_lieu`. Partagés par l'import CSV et l'import KML. */
export const TYPES_LIEU = [
  'etape', 'poste_secours', 'pc_ops', 'scene', 'bar', 'camping',
  'parking', 'entree', 'zone', 'point_kilometrique', 'autre'
]

/** Priorités d'une demande : enum `priorite_mission`. */
export const PRIORITES = ['P1', 'P2', 'P3', 'P4']

/** Niveaux d'alerte : enum `niveau_alerte`. Bandeau et Diffusion. */
export const NIVEAUX_ALERTE = [
  ['information', 'Information'],
  ['vigilance', 'Vigilance'],
  ['urgence', 'Urgence'],
  ['evacuation', 'Évacuation']
]

/*
 * (130) Catégories de fournisseurs : [code, libellé, exemples]. Codes
 * stables (ils vivent dans `fournisseurs.categories` et
 * `demandes_prix.categorie`), libellés modifiables. Les références
 * réglementaires (`referentiels` / `referentiel_items`) ne sont pas
 * faites pour une liste de catégories : celle-ci est un référentiel
 * produit, comme CATEGORIES_PLAN.
 */
export const CATEGORIES_FOURNISSEUR = [
  ['barrierage', 'Barriérage', 'Heras, Nadar, crash'],
  ['energie', 'Énergie', 'groupes, coffrets, câblage'],
  ['sanitaires', 'Sanitaires', ''],
  ['tentes', 'Tentes', 'chapiteaux, tonnelles, podiums'],
  ['sono_lumiere', 'Son et lumière', ''],
  ['gardiennage', 'Gardiennage', 'sécurité privée agréée'],
  ['secours', 'Secours', 'Croix-Rouge, ambulances privées, postes médicaux'],
  ['restauration', 'Restauration', 'traiteur, foodtrucks, bar'],
  ['boissons', 'Boissons', ''],
  ['transport', 'Transport', 'navettes, camions'],
  ['signaletique', 'Signalétique', 'impression, panneaux, pictos'],
  ['dechets', 'Déchets', 'conteneurs, nettoyage'],
  ['eau', 'Eau', 'citernes, raccordements'],
  ['assurance', 'Assurance', ''],
  ['autre', 'Autre', '']
]
export const libelleCategorieFournisseur = (code) =>
  CATEGORIES_FOURNISSEUR.find(([c]) => c === code)?.[1] ?? code ?? ''

/* (130) Verdict d'une évaluation post-événement. */
export const VERDICTS_FOURNISSEUR = [
  ['a_reprendre', 'À reprendre'],
  ['sous_reserve', 'Sous réserve'],
  ['a_eviter', 'À éviter']
]
export const libelleVerdict = (code) => VERDICTS_FOURNISSEUR.find(([c]) => c === code)?.[1] ?? code ?? ''

/* (131) Cycle d'une demande de prix (statut dérivé, sauf « close »), d'une
 * consultation et d'une commande. */
export const STATUTS_DEMANDE_PRIX = [
  ['brouillon', 'Brouillon'],
  ['envoyee', 'Envoyée'],
  ['comparaison', 'En comparaison'],
  ['decidee', 'Décidée'],
  ['close', 'Close']
]
export const STATUTS_CONSULTATION = [
  ['a_envoyer', 'À envoyer'],
  ['envoyee', 'Envoyée'],
  ['relancee', 'Relancée'],
  ['offre_recue', 'Offre reçue'],
  ['retenue', 'Retenue'],
  ['ecartee', 'Écartée'],
  ['sans_reponse', 'Sans réponse']
]
export const STATUTS_COMMANDE = [
  ['commandee', 'Commandée'],
  ['livree', 'Livrée'],
  ['facturee', 'Facturée'],
  ['payee', 'Payée']
]
export const libelleDe = (liste, code) => liste.find(([c]) => c === code)?.[1] ?? code ?? ''
export const TAUX_TVA = [21, 6, 0]
export const UNITES_LIGNE = ['pièce', 'm', 'jour', 'h', 'forfait']
