import { supabase } from './supabaseClient'

/**
 * Transmission du dossier de sécurité à la commune, en tâche de fond (161).
 *
 * Appelée juste après un changement de statut (dépôt, retrait,
 * décision). Le changement est déjà fait en base : la transmission vers
 * Crisiware est un plus, jamais une condition. Son échec se lit dans
 * Réglages › Partage › Diffusion externe, pas ici.
 */
export function diffuserDossier(evenementId) {
  supabase.functions
    .invoke('diffuser-dossier', {
      body: { evenement_id: evenementId, base_url: `${window.location.origin}${window.location.pathname}` }
    })
    .catch(() => {
      /* Silencieux par conception. */
    })
}
