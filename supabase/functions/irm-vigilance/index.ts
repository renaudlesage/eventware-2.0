// =====================================================================
// irm-vigilance
// ---------------------------------------------------------------------
// Relaie l'avertissement météo OFFICIEL belge — l'IRM lui-même n'a pas
// d'API publique gratuite (données par API/FTP sur demande commerciale
// uniquement). Meteoalarm, le portail européen qui agrège les services
// météo nationaux dont l'IRM, expose un flux Atom ouvert et gratuit
// (licence CC BY 4.0) — c'est le pont qu'on utilise.
//
// Appelé côté serveur pour éviter un blocage CORS sur le flux Meteoalarm
// lui-même (qui, lui, ne l'autorise pas), et pour ne faire qu'un seul
// appel externe même si plusieurs personnes consultent l'écran en même
// temps.
//
// Corrigé : cette fonction-ci doit EN REVANCHE explicitement autoriser
// le navigateur à lire SA propre réponse — sans en-têtes CORS, Chrome
// bloque la réponse côté client même quand l'appel serveur réussit.
// C'est ce qui manquait : testé depuis un environnement serveur (donc
// jamais soumis à CORS), le défaut restait invisible tant que ça
// n'avait pas été essayé depuis un vrai navigateur.
//
// Ce que ça NE remplace PAS : la veille à seuils propres à l'événement
// (voir Meteo.jsx). L'avertissement officiel porte sur toute une
// province ; les seuils configurés portent sur le point précis de
// l'événement. Les deux se complètent, aucun ne remplace l'autre.
// =====================================================================

const URL_FLUX = 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-belgium'
const URL_PORTAIL = 'https://meteoalarm.org/en/live/country/belgium'

const RANG: Record<string, number> = { vert: 0, jaune: 1, orange: 2, rouge: 3 }
const COULEUR_VERS_NIVEAU: Record<string, string> = {
  green: 'vert', yellow: 'jaune', orange: 'orange', red: 'rouge'
}

// Lecture seule, donnée publique : ouvert à toute origine plutôt que
// restreint au domaine Vercel, pour rester utilisable même en local
// (StackBlitz) pendant le développement.
const ENTETES_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

function extraireEntre(bloc: string, balise: string): string | null {
  const m = bloc.match(new RegExp(`<${balise}[^>]*>([\\s\\S]*?)<\\/${balise}>`))
  return m ? m[1].trim() : null
}

Deno.serve(async (req) => {
  // Requête préliminaire envoyée automatiquement par le navigateur avant
  // la vraie requête GET — doit recevoir les en-têtes CORS pour que le
  // navigateur autorise la suite.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: ENTETES_CORS })
  }

  const url = new URL(req.url)
  const province = (url.searchParams.get('province') ?? '').trim().toLowerCase()

  let xml: string
  try {
    const reponse = await fetch(URL_FLUX)
    if (!reponse.ok) throw new Error(`Flux inaccessible (HTTP ${reponse.status})`)
    xml = await reponse.text()
  } catch (e) {
    return new Response(
      JSON.stringify({
        erreur: e instanceof Error ? e.message : String(e),
        lien: URL_PORTAIL
      }),
      { status: 502, headers: { ...ENTETES_CORS, 'Content-Type': 'application/json' } }
    )
  }

  const blocsEntree = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []

  const tous = blocsEntree.map((bloc) => {
    const titre = extraireEntre(bloc, 'title') ?? ''
    const mCouleur = titre.match(/^(Green|Yellow|Orange|Red)/i)
    const lienMatch = bloc.match(/<link title="([^"]*)" href="([^"]*)" hreflang="en"\/>/)
    return {
      zone: extraireEntre(bloc, 'cap:areaDesc') ?? lienMatch?.[1] ?? 'Zone inconnue',
      evenement: extraireEntre(bloc, 'cap:event') ?? titre,
      niveau: mCouleur ? COULEUR_VERS_NIVEAU[mCouleur[1].toLowerCase()] : 'vert',
      expire_le: extraireEntre(bloc, 'cap:expires'),
      debut_le: extraireEntre(bloc, 'cap:onset'),
      lien: lienMatch?.[2] ?? URL_PORTAIL
    }
  })

  const pertinents = province
    ? tous.filter((a) => a.zone.toLowerCase().includes(province))
    : tous

  const pire = pertinents.reduce(
    (acc, a) => (RANG[a.niveau] > RANG[acc] ? a.niveau : acc),
    'vert'
  )

  return new Response(
    JSON.stringify({
      province: province || null,
      niveau: pire,
      avertissements: pertinents,
      total_pays: tous.length,
      lien: URL_PORTAIL,
      consulte_le: new Date().toISOString()
    }),
    {
      status: 200,
      headers: {
        ...ENTETES_CORS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600'
      }
    }
  )
})
