/**
 * (152, 1/11) Les phases d'un événement, et la phase d'un jalon.
 *
 * Les phases portent des dates (Réglages › Dates) : début du montage,
 * premier jour, dernier jour, fin du démontage. Un jalon appartient
 * d'office à la phase où tombe son échéance ; `phase_cible` la force
 * quand la règle se trompe (« commande du chapiteau » reste en
 * préparation même datée en montage). La même règle vit dans la base
 * (gantt(), migration 152) : ce fichier la répète pour les écrans qui
 * lisent la table `jalons` directement.
 */
import { PHASES } from './referentielsProduit'

export const LIBELLE_PHASE = {
  preparation: 'Préparation',
  montage: 'Montage',
  exploitation: 'Exploitation',
  demontage: 'Démontage',
  cloture: 'Clôture'
}

export const ORDRE_PHASES = PHASES

/** La date locale (AAAA-MM-JJ) d'un instant, en Belgique. */
function jourLocal(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  // Les dates de l'événement sont des jours civils : on compare des jours.
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
}

/** Vrai si l'événement a de quoi déduire une phase d'une date. */
export const phasesDatees = (evenement) => !!evenement?.date_debut

/** La phase où tombe une date, d'après les dates de l'événement. */
export function phaseDeDate(evenement, iso) {
  const jour = jourLocal(iso)
  if (!jour || !evenement?.date_debut) return 'preparation'
  const montage = evenement.date_montage || evenement.date_debut
  const fin = evenement.date_fin || evenement.date_debut
  const demontage = evenement.date_demontage || fin
  if (jour < montage) return 'preparation'
  if (jour < evenement.date_debut) return 'montage'
  if (jour <= fin) return 'exploitation'
  if (jour <= demontage) return 'demontage'
  return 'cloture'
}

/** La phase d'un jalon : celle qu'on a forcée, sinon celle de son échéance. */
export function phaseDeJalon(evenement, jalon) {
  if (jalon?.phase_cible) return jalon.phase_cible
  if (jalon?.phase && !phasesDatees(evenement)) return jalon.phase
  return phaseDeDate(evenement, jalon?.echeance ?? jalon?.fin)
}

/** La phase que les dates suggèrent aujourd'hui ; nulle sans dates. */
export function phaseSuggeree(evenement, maintenant = new Date()) {
  if (!phasesDatees(evenement)) return null
  return phaseDeDate(evenement, maintenant.toISOString())
}

/** « montage dès le 15/08 » : la date à laquelle une phase commence. */
export function debutDePhase(evenement, phase) {
  if (!phasesDatees(evenement)) return null
  const plusUn = (j) => { const d = new Date(j + 'T12:00:00'); d.setDate(d.getDate() + 1); return d.toLocaleDateString('sv-SE') }
  const fin = evenement.date_fin || evenement.date_debut
  return {
    preparation: null,
    montage: evenement.date_montage || evenement.date_debut,
    exploitation: evenement.date_debut,
    demontage: plusUn(fin),
    cloture: plusUn(evenement.date_demontage || fin)
  }[phase] ?? null
}
