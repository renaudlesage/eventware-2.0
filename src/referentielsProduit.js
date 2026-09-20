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
  ['analyse', 'Analyse / REX']
]
