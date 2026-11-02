// =====================================================================
// reception-commune
// ---------------------------------------------------------------------
// Le récepteur des messages que la commune (Crisiware,
// `envoyer_emission_evenement`) adresse à un événement. Déployée SANS
// vérification de JWT : la commune n'a pas de compte Eventware. Ce qui
// l'authentifie, c'est l'en-tête secret de sa liaison (Réglages ›
// Partage › Liaison commune), vérifié en base par
// `recevoir_message_commune` (migration 158), qui tient aussi
// l'idempotence (une référence déjà reçue ne crée rien) et les
// invariants de l'exercice conjoint.
//
// Cette fonction ne fait que relayer : elle retrouve l'événement par
// `evenement.jeton_public`, transmet les en-têtes « X-… » (jamais
// stockés, jamais journalisés) et la charge, puis traduit le résultat
// en code HTTP. Tourne avec la clé de service.
//
// Charge attendue (contrat Crisiware → Eventware) :
//   { "source": "crisiware", "commune": "…",
//     "evenement": { "nom": "…", "jeton_public": "…" },
//     "incident": { "type": "…", "phase": "…" } | null,
//     "alerte": { "reference": "uuid", "niveau": "information|vigilance|urgence|evacuation",
//                 "titre": "…", "message": "…", "consigne": "…", "emise_le": "ISO 8601" },
//     "exercice": { "code": "…" }   // seulement pour un exercice conjoint
//   }
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

const JSON_ENTETES = { 'Content-Type': 'application/json' }
const CODES: Record<string, number> = {
  recu: 200, doublon: 200,
  secret_absent: 401, secret_faux: 401, liaison_inactive: 401, exercice_refuse: 403,
  evenement_inconnu: 404, charge_invalide: 400
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ erreur: 'Méthode non autorisée' }), { status: 405, headers: JSON_ENTETES })
  }

  let charge: Record<string, unknown> = {}
  try {
    charge = await req.json()
    if (!charge || typeof charge !== 'object') throw new Error('corps vide')
  } catch {
    return new Response(JSON.stringify({ erreur: 'Charge invalide : JSON attendu' }), { status: 400, headers: JSON_ENTETES })
  }

  // Les en-têtes « X-… » seulement, en minuscules : la base y cherche celui de la liaison.
  const entetes: Record<string, string> = {}
  req.headers.forEach((valeur, nom) => {
    const n = nom.toLowerCase()
    if (n.startsWith('x-') && n !== 'x-client-info') entetes[n] = valeur
  })

  const evenement = (charge.evenement ?? {}) as Record<string, unknown>
  const jeton = typeof evenement.jeton_public === 'string' && /^[0-9a-f-]{36}$/i.test(evenement.jeton_public)
    ? evenement.jeton_public
    : null

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await supabase.rpc('recevoir_message_commune', {
    p_jeton_public: jeton,
    p_entetes: entetes,
    p_charge: charge
  })

  if (error) {
    console.error('recevoir_message_commune', error.message)
    return new Response(JSON.stringify({ erreur: 'Réception impossible' }), { status: 500, headers: JSON_ENTETES })
  }

  const resultat = data as { statut: string; motif?: string; reference?: string }
  const code = CODES[resultat.motif ?? resultat.statut] ?? 400
  const corps = resultat.statut === 'refuse'
    ? { statut: 'refuse', motif: resultat.motif }
    : { statut: resultat.statut, reference: resultat.reference }
  return new Response(JSON.stringify(corps), { status: code, headers: JSON_ENTETES })
})
