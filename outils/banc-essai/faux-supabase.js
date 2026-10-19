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
  liens_plan: [{ id: 'li1', evenement_id: 'ev1', de_id: 'ep3', vers_id: 'ep2', nature: 'alimente', note: 'câble 3G2,5' }], catalogue_equipements: [{ id: 'cat1', code: 'EXT6ABC', libelle: 'Extincteur poudre ABC 6 kg', calque: 'securite', categorie: 'extincteur', forme: 'cercle', largeur_m: 0.5, longueur_m: 0.5, nature: 'picto', picto: 'extincteur', agent_extinction: 'poudre_abc', capacite_extinction: 6 }, { id: 'cat2', code: 'CHAP', libelle: 'Chapiteau 6 × 12 m', calque: 'infrastructures', categorie: 'autre', forme: 'rect', largeur_m: 6, longueur_m: 12 }], fonds_plan: [], elements_plan: [{ id: 'ep5', code: 'BAR1', nom: 'Barrière Heras (3,5 m)', nature: 'ligne', calque: 'circulation', categorie: 'perimetre', forme: 'ligne', forme_echelle: 'rect', centre_lat: 50.3856, centre_lon: 5.6156, largeur_m: 3.5, longueur_m: 40, quantite: 12, rotation_deg: 0, geometrie: [[50.3855, 5.6152], [50.3858, 5.6158], [50.3854, 5.6162]], confirme: false }, { id: 'ep3', code: 'GE1', nom: 'Groupe 60 kVA', nature: 'objet', calque: 'energie', categorie: 'groupe_electrogene', forme_echelle: 'rect', centre_lat: 50.3858, centre_lon: 5.6158, largeur_m: 2, longueur_m: 4, rotation_deg: 0, production_kva: 60, puissance_kw: 0, geometrie: [[50.3858, 5.6158], [50.3858, 5.6159], [50.3859, 5.6159]], confirme: true, source_eau: false, besoin_eau: false }, { id: 'ep4', code: 'EXT1', nom: 'Extincteur poudre ABC 6 kg', nature: 'picto', picto: 'extincteur', calque: 'securite', categorie: 'extincteur', forme_echelle: 'cercle', centre_lat: 50.3857, centre_lon: 5.6157, largeur_m: 0.5, longueur_m: 0.5, rotation_deg: 0, agent_extinction: 'poudre_abc', capacite_extinction: 6, geometrie: [[50.3857, 5.6157]], confirme: false }, { id: 'ep1', code: 'DEA1', nom: 'DEA', nature: 'picto', picto: 'extincteur', categorie: 'dea', geometrie: [[50.386, 5.616]], centre_lat: 50.386, centre_lon: 5.616, rotation_deg: 0, confirme: true }, { id: 'ep2', code: 'PRV', nom: 'PRV', nature: 'objet', forme: 'zone', calque: 'securite', categorie: 'prv', forme_echelle: 'rect', centre_lat: 50.3861, centre_lon: 5.6162, largeur_m: 5, longueur_m: 5, rotation_deg: 0, geometrie: [[50.3861, 5.6161], [50.3862, 5.6163], [50.386, 5.6164]], confirme: true, besoin_eau: true, debit_l_min: 6 }],
  membres_evenement: [{ user_id: 'u1', nom_affiche: 'Ren' }],
  equipes: [{ id: 'e1', code: 'A', nom: 'Alpha' }],
  maydays: [], groupes: [], transports: [{ id: 'tr1', reference: 'TRA-001', priorite: 'P2', statut: 'attribuee', nb_personnes: 3, motif: 'Navette gare', souhaite_pour: new Date().toISOString(), contact: '0477 11 22 33', adresse_depart: 'Gare de Ferrières', etape: 'en_route', depart: null, arrivee: null, chauffeur: null, depart_libre: 'Gare', arrivee_libre: 'Départ' }], programme: [], jalons: [], journal: [], recherches: [], canaux_radio: [], attributions: [], alertes: [], alertes_accuses: [], mission_commentaires: [], objets_plan: [], moyens_premiers_secours: [], veille_meteo: [], passages: []
}
function constructeur(table, fn) {
  const RPC = {
    situation: { evenement: { nom: 'Essai', phase: 'exploitation', geometrie: 'parcours', modules: { securite: true, logistique: true, parcours: true } }, alertes: [], signalements: { ouverts: 1, non_pris_en_charge: 1, total: 3, derniers: [] }, missions: { ouvertes: 1, p1: 1, par_module: {} }, parcours: { en_route: 0, groupes: [], sans_nouvelles: 0, etapes: [{ id: 'l1', code: 'E1', nom: 'Étape 1', pk_km: 1.2, capacite: 50, charge: 46 }] }, jalons_en_retard: 2, logistique: { jauge: 10, sous_seuil: [], transports: [{ id: 'tr1', reference: 'TRA-001', statut: 'en_cours', priorite: 'P2', depart: 'Gare', arrivee: 'Départ', nb_personnes: 3, etape: 'charge', chauffeur: 'Ren' }], transports_ouverts: 1 }, rh: {}, recherches: [], jalons: [], journal: [] },
    situation_autorite: { destinataire: { libelle: 'Bourgmestre', niveau: 'operationnel' }, evenement: { nom: 'Essai', phase: 'exploitation', geometrie: 'parcours', point_0: { lat: 50.38, lon: 5.61 } }, alertes: [], activite: {}, interventions: [{ source: 'signalement', reference: 'SOS-001', heure: new Date().toISOString(), nature: 'malaise', gravite: 'grave', statut: 'recu', position: { lat: 50.3845, lon: 5.6215 }, sur_trace: { km: 1.1, ecart_m: 40, avant: { code: 'P0' }, apres: { code: 'E1' } }, doublons: 1 }], recherches: [], public: { groupes: [] }, meteo: {}, acces_secours: [{ code: 'PRS', nom: 'PRS', categorie: 'point_rencontre_secours', position: { lat: 50.381, lon: 5.611 } }], traces: [{ nom: 'Boucle', points: [[50.38, 5.61], [50.39, 5.62]] }], reperes: [{ code: 'E1', nom: 'Étape 1', type: 'etape', pk_km: 1.2, capacite: 50, charge: 60, position: { lat: 50.385, lon: 5.615 } }], segments: [], ressources: {}, installations_risque: [], programme: [], radio: [], contacts: [], documents: [], interlocuteurs: [{ role: 'interlocuteur', nom: 'J. Grosjean', fonction: 'Directeur', telephone: '0477 88 89 99' }] },
    contenu_public: { evenement: { nom: 'Essai' }, alertes: [], lieux: [], traces: [{ nom: 'Boucle', points: [[50.38, 5.61], [50.39, 5.62]] }], programme: [], jalons: [], communications: [] },
    evenement_public: [{ nom: 'Essai', sos_actif: true }],
    mon_terrain: [{ genre: 'transport', id: 'tr1', reference: 'TRA-001', titre: 'Gare → Départ', priorite: 'P2', statut: 'attribuee', pour_moi: true }, { genre: 'mission', id: 'm1', reference: 'SEC-001', titre: 'Renfort', priorite: 'P1', statut: 'attribuee', latitude: 50.385, longitude: 5.62, pour_moi: true }],
    mes_capacites: [], jauge_courante: 10, couverture_creneaux: []
  }
  const resultat = () => ({ data: fn === 'rpc' ? (RPC[table] ?? []) : (DONNEES[table] ?? []), error: null, count: (DONNEES[table] ?? []).length })
  const b = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve(resultat()).then(res, rej)
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: (DONNEES[table] ?? [])[0] ?? null, error: null })
      return () => b
    }
  })
  return b
}
export const supabase = {
  from: (t) => constructeur(t),
  rpc: (f) => constructeur(f, 'rpc'),
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: null } }), getPublicUrl: () => ({ data: { publicUrl: '' } }), upload: async () => ({ error: null }), remove: async () => ({}) }) },
  channel: () => ({ on() { return this }, subscribe() { return this } }),
  removeChannel() {}
}
