// =====================================================================
// notifier
// ---------------------------------------------------------------------
// Envoie une notification poussée (Web Push) aux appareils abonnés
// (migration 170). Appelée par l'application juste après un geste, avec
// le JWT de l'appelant :
//
//   { type: 'alerte',         id: <alerte> }      → tous les membres actifs de l'événement
//   { type: 'mission',        id: <mission> }     → le membre à qui elle est attribuée, sinon son équipe
//   { type: 'demande_statut', id: <mission> }     → celui qui a posé la demande
//   { type: 'reponse_vocal',  id: <message> }     → l'auteur du message vocal
//   { type: 'rappel_creneau', id: <créneau> }     → les membres affectés au créneau
//
//   GET                                           → { cle_publique } pour s'abonner
//
// L'appelant doit pouvoir LIRE l'objet (RLS, avec son propre jeton) :
// on ne notifie pas pour un objet qu'on ne voit pas. Il doit aussi en
// être l'auteur de la DERNIÈRE MODIFICATION, il y a moins d'un quart
// d'heure (colonnes de traçabilité, posées par la base) : la
// notification suit un geste, elle ne se rejoue pas à volonté, et un
// simple lecteur ne peut pas faire sonner les téléphones des autres. Les destinataires
// et leurs abonnements sont ensuite lus avec la clé de service. Le texte
// de la notification est composé ici, à partir de la base — jamais reçu
// de l'appelant : personne ne peut faire dire n'importe quoi au serveur.
//
// Secrets : VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY (obligatoires) ;
// VAPID_SUBJECT (mailto: ou https:) est facultatif, l'adresse de
// l'application sert par défaut. Sans les deux clés, la fonction
// répond 503 et l'application se passe de notifications.
// Un abonnement que le service de push déclare disparu (404, 410) est
// retiré ; les autres échecs sont comptés.
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const ENTETES_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}
const JSON_ENTETES = { ...ENTETES_CORS, 'Content-Type': 'application/json' }
const reponse = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: JSON_ENTETES })

type Notification = { evenement: string; utilisateurs: string[]; titre: string; corps: string; url: string; etiquette: string; urgent?: boolean; preference: string }

const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
// Le geste que la notification accompagne : fait par l'appelant, à l'instant.
const FRAICHEUR_MS = 15 * 60 * 1000
const vientDe = (o: { updated_by?: string | null; updated_at?: string | null }, appelant: string) =>
  o.updated_by === appelant && !!o.updated_at && Date.now() - new Date(o.updated_at).getTime() < FRAICHEUR_MS
const PAS_LE_GESTE = { erreur: 'Seul l’auteur du geste, juste après l’avoir fait, déclenche la notification' }

const NIVEAUX: Record<string, string> = { information: 'Information', vigilance: 'Vigilance', urgence: 'URGENCE', evacuation: 'ÉVACUATION' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ENTETES_CORS })

  const publique = Deno.env.get('VAPID_PUBLIC_KEY')
  const privee = Deno.env.get('VAPID_PRIVATE_KEY')
  // Le « sujet » dit aux services de push qui contacter en cas d'abus : par défaut, l'adresse de l'application.
  const sujet = Deno.env.get('VAPID_SUBJECT') ?? 'https://eventware-2-0.vercel.app'
  if (!publique || !privee) return reponse({ erreur: 'Notifications non configurées sur ce serveur' }, 503)

  if (req.method === 'GET') return reponse({ cle_publique: publique })
  if (req.method !== 'POST') return new Response('Méthode non autorisée', { status: 405, headers: ENTETES_CORS })

  let type: string
  let id: string
  try {
    const corps = await req.json()
    type = corps.type
    id = corps.id
    if (!type || !id) throw new Error('type ou id manquant')
  } catch {
    return reponse({ erreur: 'Requête invalide' }, 400)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const autorisation = req.headers.get('Authorization') ?? ''
  const appelant = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: autorisation } } })
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: moi } = await appelant.auth.getUser()
  const appelantId = moi?.user?.id
  if (!appelantId) return reponse({ erreur: 'Connexion requise' }, 401)

  // --- Composer la notification à partir de l'objet, lu avec les droits de l'appelant.
  let n: Notification | null = null

  if (type === 'alerte') {
    const { data: a } = await appelant.from('alertes').select('id, evenement_id, niveau, titre, message, consigne, active, updated_by, updated_at').eq('id', id).maybeSingle()
    if (!a || !a.active) return reponse({ erreur: 'Alerte introuvable ou levée' }, 404)
    if (!vientDe(a, appelantId)) return reponse(PAS_LE_GESTE, 403)
    const { data: membres } = await service.from('membres_evenement').select('user_id').eq('evenement_id', a.evenement_id).eq('actif', true).is('deleted_at', null)
    n = {
      evenement: a.evenement_id,
      utilisateurs: (membres ?? []).map((m) => m.user_id),
      titre: `${NIVEAUX[a.niveau] ?? 'Alerte'} : ${a.titre}`,
      corps: a.consigne ? `→ ${a.consigne}` : (a.message ?? 'Ouvre Eventware.'),
      url: '#accueil',
      etiquette: `alerte-${a.id}`,
      urgent: a.niveau === 'urgence' || a.niveau === 'evacuation',
      preference: 'alertes'
    }
  } else if (type === 'mission' || type === 'demande_statut') {
    const { data: m } = await appelant.from('missions').select('id, evenement_id, reference, titre, statut, priorite, module, membre_id, equipe_id, lieu_id, created_by, updated_by, updated_at').eq('id', id).maybeSingle()
    if (!m) return reponse({ erreur: 'Demande introuvable ou inaccessible' }, 404)
    if (!vientDe(m, appelantId)) return reponse(PAS_LE_GESTE, 403)
    const { data: lieu } = m.lieu_id ? await service.from('lieux').select('nom').eq('id', m.lieu_id).maybeSingle() : { data: null }
    if (type === 'mission') {
      let cibles: string[] = []
      if (m.membre_id) {
        const { data: mb } = await service.from('membres_evenement').select('user_id').eq('id', m.membre_id).maybeSingle()
        if (mb) cibles = [mb.user_id]
      } else if (m.equipe_id) {
        const { data: mbs } = await service.from('membres_evenement').select('user_id').eq('evenement_id', m.evenement_id).eq('equipe_id', m.equipe_id).eq('actif', true).is('deleted_at', null)
        cibles = (mbs ?? []).map((x) => x.user_id)
      }
      n = {
        evenement: m.evenement_id,
        utilisateurs: cibles,
        titre: `${m.priorite === 'P1' ? 'URGENT · ' : ''}${m.reference} pour ${m.membre_id ? 'toi' : 'ton équipe'}`,
        corps: `${m.titre}${lieu?.nom ? ` · ${lieu.nom}` : ''}`,
        url: '#accueil',
        etiquette: `mission-${m.id}`,
        urgent: m.priorite === 'P1',
        preference: 'missions'
      }
    } else {
      const LIBELLES: Record<string, string> = { attribuee: 'est prise en charge', en_cours: 'est en cours', resolue: 'est résolue', annulee: 'a été annulée' }
      if (!m.created_by || !LIBELLES[m.statut]) return reponse({ envoyees: 0 })
      n = {
        evenement: m.evenement_id,
        utilisateurs: [m.created_by],
        titre: `Ta demande ${m.reference} ${LIBELLES[m.statut]}`,
        corps: m.titre,
        url: '#accueil',
        etiquette: `demande-${m.id}`,
        preference: 'demandes'
      }
    }
  } else if (type === 'reponse_vocal') {
    const { data: v } = await appelant.from('messages_vocaux').select('id, evenement_id, membre_id, reponse, updated_by, updated_at').eq('id', id).maybeSingle()
    if (!v || !v.reponse) return reponse({ erreur: 'Message introuvable ou sans réponse' }, 404)
    if (!vientDe(v, appelantId)) return reponse(PAS_LE_GESTE, 403)
    const { data: mb } = await service.from('membres_evenement').select('user_id').eq('id', v.membre_id).maybeSingle()
    n = {
      evenement: v.evenement_id,
      utilisateurs: mb ? [mb.user_id] : [],
      titre: 'Le QG t’a répondu',
      corps: v.reponse.slice(0, 180),
      url: '#accueil',
      etiquette: `vocal-${v.id}`,
      preference: 'reponses'
    }
  } else if (type === 'rappel_creneau') {
    const { data: c } = await appelant.from('creneaux').select('id, evenement_id, poste, debut, fin, consignes, rappel, lieu_id, updated_by, updated_at').eq('id', id).maybeSingle()
    if (!c) return reponse({ erreur: 'Créneau introuvable ou inaccessible' }, 404)
    if (!c.rappel) return reponse({ envoyees: 0 })
    if (!vientDe(c, appelantId)) return reponse(PAS_LE_GESTE, 403)
    const { data: lieu } = c.lieu_id ? await service.from('lieux').select('nom').eq('id', c.lieu_id).maybeSingle() : { data: null }
    const { data: aff } = await service.from('affectations').select('membre_id').eq('creneau_id', c.id).is('deleted_at', null).in('statut', ['propose', 'confirme'])
    const ids = (aff ?? []).map((a) => a.membre_id).filter(Boolean)
    const { data: mbs } = ids.length ? await service.from('membres_evenement').select('user_id').in('id', ids) : { data: [] }
    n = {
      evenement: c.evenement_id,
      utilisateurs: (mbs ?? []).map((x) => x.user_id),
      titre: `Rappel : ${c.poste} à ${heure(c.debut)}`,
      corps: [c.rappel, lieu?.nom, `jusqu’à ${heure(c.fin)}`].filter(Boolean).join(' · ').slice(0, 180),
      url: '#accueil',
      etiquette: `creneau-${c.id}`,
      preference: 'rappels'
    }
  } else {
    return reponse({ erreur: 'Type inconnu' }, 400)
  }

  // On ne se notifie pas soi-même, sauf pour un rappel (le coordinateur peut être affecté).
  const destinataires = [...new Set(n.utilisateurs)].filter((u) => u && (type === 'rappel_creneau' || u !== appelantId))
  if (!destinataires.length) return reponse({ envoyees: 0, destinataires: 0 })

  const { data: abonnements } = await service.from('abonnements_push').select('id, endpoint, p256dh, auth, preferences, echecs').in('user_id', destinataires)
  const actifs = (abonnements ?? []).filter((a) => (a.preferences ?? {})[n!.preference] !== false)
  if (!actifs.length) return reponse({ envoyees: 0, destinataires: destinataires.length })

  // Des clés mal recopiées : on le dit, plutôt qu'une erreur 500 muette.
  try {
    webpush.setVapidDetails(sujet, publique, privee)
  } catch (e) {
    return reponse({ erreur: `Clés VAPID invalides : ${(e as Error)?.message ?? e}` }, 503)
  }
  const { data: ev } = await service.from('evenements').select('nom').eq('id', n.evenement).maybeSingle()
  const charge = JSON.stringify({ titre: n.titre, corps: n.corps, url: n.url, etiquette: n.etiquette, urgent: !!n.urgent, evenement: ev?.nom ?? null, evenement_id: n.evenement })

  let envoyees = 0
  const disparus: string[] = []
  const rates: string[] = []
  await Promise.all(actifs.map(async (a) => {
    try {
      await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, charge, { TTL: n!.urgent ? 3600 : 1800, urgency: n!.urgent ? 'high' : 'normal' })
      envoyees++
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode
      if (code === 404 || code === 410) disparus.push(a.id)
      else rates.push(a.id)
    }
  }))
  if (disparus.length) await service.from('abonnements_push').delete().in('id', disparus)
  if (envoyees) await service.from('abonnements_push').update({ dernier_envoi: new Date().toISOString(), echecs: 0 }).in('id', actifs.filter((a) => !disparus.includes(a.id) && !rates.includes(a.id)).map((a) => a.id))
  for (const idRate of rates) {
    const a = actifs.find((x) => x.id === idRate)
    await service.from('abonnements_push').update({ echecs: (a?.echecs ?? 0) + 1 }).eq('id', idRate)
  }

  return reponse({ envoyees, destinataires: destinataires.length, retires: disparus.length, echecs: rates.length })
})
