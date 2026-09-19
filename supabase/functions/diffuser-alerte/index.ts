// =====================================================================
// diffuser-alerte
// ---------------------------------------------------------------------
// Pont de compatibilité entre Eventware et tout système externe —
// plateforme-crise en premier lieu, qui expose le même contrat de
// table (canaux_diffusion / diffusions). Les deux produits ne
// partagent jamais de base : le seul lien est ce webhook.
//
// Déclenché côté client juste après l'insertion d'une alerte (bandeau
// d'alerte, ou Mayday). L'échec de la diffusion externe n'annule
// jamais l'alerte elle-même — elle existe déjà dans Eventware, c'est
// ce qui compte en premier. La diffusion externe est un plus, pas une
// condition.
//
// Corrigé : sans en-têtes CORS, le navigateur bloquait la réponse côté
// client même quand l'appel serveur réussissait — et comme cette
// fonction est appelée en « tir et oublie » (l'échec ne remonte nulle
// part, volontairement), ce défaut serait resté invisible indéfiniment.
//
// Tourne avec la clé de service : lit et écrit sans passer par RLS,
// ce qui est approprié pour un répartiteur serveur de confiance.
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ENTETES_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: ENTETES_CORS })
  }

  if (req.method !== 'POST') {
    return new Response('Méthode non autorisée', { status: 405, headers: ENTETES_CORS })
  }

  let alerte_id: string
  try {
    const corps = await req.json()
    alerte_id = corps.alerte_id
    if (!alerte_id) throw new Error('alerte_id manquant')
  } catch {
    return new Response(JSON.stringify({ erreur: 'Requête invalide' }), {
      status: 400,
      headers: { ...ENTETES_CORS, 'Content-Type': 'application/json' }
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: alerte, error: erreurAlerte } = await supabase
    .from('alertes')
    .select('*, evenements(nom)')
    .eq('id', alerte_id)
    .single()

  if (erreurAlerte || !alerte) {
    return new Response(JSON.stringify({ erreur: 'Alerte introuvable' }), {
      status: 404,
      headers: { ...ENTETES_CORS, 'Content-Type': 'application/json' }
    })
  }

  const { data: canaux } = await supabase
    .from('canaux_diffusion')
    .select('*')
    .eq('evenement_id', alerte.evenement_id)
    .eq('actif', true)
    .is('deleted_at', null)

  const cibles = (canaux ?? []).filter((c) =>
    (c.niveaux_declencheurs ?? []).includes(alerte.niveau)
  )

  const resultats = []

  for (const canal of cibles) {
    const charge = {
      source: 'eventware',
      evenement: alerte.evenements?.nom ?? null,
      alerte: {
        niveau: alerte.niveau,
        titre: alerte.titre,
        message: alerte.message,
        consigne: alerte.consigne,
        emise_le: alerte.emise_le
      }
    }

    let statut = 'echec'
    let code_reponse: number | null = null
    let erreur: string | null = null

    try {
      const entetes: Record<string, string> = { 'Content-Type': 'application/json' }
      if (canal.secret_entete) entetes['X-Diffusion-Secret'] = canal.secret_entete

      const reponse = await fetch(canal.url, {
        method: 'POST',
        headers: entetes,
        body: JSON.stringify(charge)
      })
      code_reponse = reponse.status
      statut = reponse.ok ? 'ok' : 'echec'
      if (!reponse.ok) erreur = `HTTP ${reponse.status}`
    } catch (e) {
      erreur = e instanceof Error ? e.message : String(e)
    }

    await supabase.from('diffusions').insert({
      evenement_id: alerte.evenement_id,
      alerte_id: alerte.id,
      canal_id: canal.id,
      statut,
      code_reponse,
      erreur
    })

    resultats.push({ canal: canal.libelle, statut, code_reponse })
  }

  return new Response(JSON.stringify({ diffuse_vers: resultats.length, resultats }), {
    status: 200,
    headers: { ...ENTETES_CORS, 'Content-Type': 'application/json' }
  })
})
