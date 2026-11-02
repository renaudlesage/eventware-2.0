// =====================================================================
// diffuser-dossier
// ---------------------------------------------------------------------
// Transmet l'état du dossier de sécurité d'un événement à la commune
// (Crisiware, Edge Function `ingestion-dossier-evenement`), à chaque
// changement de statut : déposé, en instruction, autorisé, refusé,
// retiré. Même mécanique que `diffuser-alerte` : appelée depuis le
// client juste après le changement, en « tir et oublie » ; elle poste
// vers chaque canal actif de l'événement dont `objets` contient
// `dossier`, avec l'en-tête `X-Diffusion-Secret`, et inscrit chaque
// tentative dans `diffusions` (objet = dossier). Un échec n'annule
// jamais le changement de statut.
//
// La charge est construite en base par `transmission_dossier`
// (migration 161) : contrat partagé avec le briefing 03 (Crisiware,
// partie B). Tourne avec la clé de service ; JWT requis.
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ENTETES_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}
const JSON_ENTETES = { ...ENTETES_CORS, 'Content-Type': 'application/json' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ENTETES_CORS })
  if (req.method !== 'POST') return new Response('Méthode non autorisée', { status: 405, headers: ENTETES_CORS })

  let evenement_id: string
  let base_url: string | null = null
  try {
    const corps = await req.json()
    evenement_id = corps.evenement_id
    if (!evenement_id) throw new Error('evenement_id manquant')
    // L'adresse de l'application, pour le lien de consultation (jamais stockée).
    if (typeof corps.base_url === 'string' && /^https:\/\//.test(corps.base_url)) base_url = corps.base_url
  } catch {
    return new Response(JSON.stringify({ erreur: 'Requête invalide' }), { status: 400, headers: JSON_ENTETES })
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: charge, error: erreurCharge } = await supabase.rpc('transmission_dossier', { p_evenement: evenement_id, p_base_url: base_url })
  if (erreurCharge || !charge) {
    return new Response(JSON.stringify({ erreur: 'Dossier introuvable' }), { status: 404, headers: JSON_ENTETES })
  }

  const { data: canaux } = await supabase
    .from('canaux_diffusion')
    .select('*')
    .eq('evenement_id', evenement_id)
    .eq('actif', true)
    .is('deleted_at', null)
    .contains('objets', ['dossier'])

  const resultats = []
  for (const canal of canaux ?? []) {
    let statut = 'echec'
    let code_reponse: number | null = null
    let erreur: string | null = null
    try {
      const entetes: Record<string, string> = { 'Content-Type': 'application/json' }
      if (canal.secret_entete) entetes['X-Diffusion-Secret'] = canal.secret_entete
      const reponse = await fetch(canal.url, { method: 'POST', headers: entetes, body: JSON.stringify(charge) })
      code_reponse = reponse.status
      statut = reponse.ok ? 'ok' : 'echec'
      if (!reponse.ok) erreur = `HTTP ${reponse.status}`
    } catch (e) {
      erreur = e instanceof Error ? e.message : String(e)
    }
    await supabase.from('diffusions').insert({
      evenement_id, alerte_id: null, canal_id: canal.id, statut, code_reponse, erreur,
      objet: 'dossier', reference: `${charge.dossier?.statut} v${charge.dossier?.version}`
    })
    resultats.push({ canal: canal.libelle, statut, code_reponse })
  }

  return new Response(JSON.stringify({ diffuse_vers: resultats.length, resultats }), { status: 200, headers: JSON_ENTETES })
})
