import { supabase } from './supabaseClient'

/**
 * Diffusion externe d'une alerte, en tâche de fond.
 *
 * L'alerte existe déjà dans Eventware au moment où cette fonction est
 * appelée — c'est ce qui compte en premier. La diffusion vers un canal
 * externe (plateforme-crise ou tout autre système, via un webhook) est
 * un plus, jamais une condition : son échec ne remonte à personne et
 * ne bloque rien. Le journal des diffusions, dans Réglages, reste la
 * source de vérité si on veut savoir ce qui est réellement parti.
 */
export function diffuserAlerte(alerteId) {
  supabase.functions
    .invoke('diffuser-alerte', { body: { alerte_id: alerteId } })
    .catch(() => {
      /* Silencieux par conception — voir le commentaire ci-dessus. */
    })
}
