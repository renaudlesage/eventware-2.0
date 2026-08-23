import { useState } from 'react'
import { supabase } from './supabaseClient'
import { lireKml, codeDepuis } from './kml'
import { mesurer, simplifier } from './gpx'

/*
 * Destinations possibles pour un calque.
 * Un calque My Maps correspond presque toujours à une catégorie
 * d'objets — « Postes de secours », « Étapes », « Accès pompiers » —
 * d'où l'affectation calque par calque plutôt qu'objet par objet.
 */
const TYPES_LIEU = [
  'etape', 'poste_secours', 'pc_ops', 'scene', 'bar', 'camping',
  'parking', 'entree', 'zone', 'point_kilometrique', 'autre'
]

const CATEGORIES_PLAN = [
  'foodtruck', 'groupe_electrogene', 'stockage_gaz', 'bar_installation', 'feu',
  'extincteur', 'dea', 'point_eau', 'poste_secours', 'coupure_gaz',
  'coffret_electrique', 'sortie_secours', 'cheminement', 'itineraire_evacuation',
  'voie_engins', 'cable', 'tuyau', 'scene', 'bar', 'camping', 'parking',
  'perimetre', 'zone_interdite', 'autre'
]

const RISQUES = new Set([
  'foodtruck', 'groupe_electrogene', 'stockage_gaz', 'bar_installation', 'feu'
])

/** Devine la destination d'un calque d'après son nom. */
function deviner(calque) {
  const n = calque.nom.toLowerCase()
  const surtoutDesLignes =
    calque.objets.filter((o) => o.forme === 'ligne').length > calque.objets.length / 2

  if (surtoutDesLignes && /parcours|trace|circuit|balade|boucle|itin/.test(n))
    return { vers: 'traces' }
  if (/secours|poste|pmi|croix/.test(n)) return { vers: 'lieux', param: 'poste_secours' }
  if (/etape|étape|ravito|ravitaill/.test(n)) return { vers: 'lieux', param: 'etape' }
  if (/pc|qg|command/.test(n)) return { vers: 'lieux', param: 'pc_ops' }
  if (/parking/.test(n)) return { vers: 'lieux', param: 'parking' }
  if (/entree|entrée|acces|accès/.test(n)) return { vers: 'lieux', param: 'entree' }
  if (/borne|km|kilom/.test(n)) return { vers: 'lieux', param: 'point_kilometrique' }
  if (/extincteur/.test(n)) return { vers: 'plan', param: 'extincteur' }
  if (/dea|defibril|défibril/.test(n)) return { vers: 'plan', param: 'dea' }
  if (/eau/.test(n)) return { vers: 'plan', param: 'point_eau' }
  if (/food|frit|bar|buvette/.test(n)) return { vers: 'plan', param: 'foodtruck' }
  if (/gaz/.test(n)) return { vers: 'plan', param: 'stockage_gaz' }
  if (/pompier|engin|voie/.test(n)) return { vers: 'plan', param: 'voie_engins' }
  if (/evac|évac/.test(n)) return { vers: 'plan', param: 'itineraire_evacuation' }
  if (/scene|scène/.test(n)) return { vers: 'lieux', param: 'scene' }
  if (/camping/.test(n)) return { vers: 'lieux', param: 'camping' }
  return { vers: 'lieux', param: 'autre' }
}

export default function ImportKml({ evenement, setMessage }) {
  const [lecture, setLecture] = useState(null)
  const [affectations, setAffectations] = useState({})
  const [bilan, setBilan] = useState(null)
  const [occupe, setOccupe] = useState(false)

  async function lire(fichier) {
    setBilan(null)
    setMessage(null)
    try {
      const r = lireKml(await fichier.text())
      setLecture(r)
      const a = {}
      r.calques.forEach((c, i) => {
        a[i] = deviner(c)
      })
      setAffectations(a)
    } catch (e) {
      setMessage({ type: 'erreur', texte: e.message })
      setLecture(null)
    }
  }

  async function importer() {
    setOccupe(true)
    setMessage(null)
    const res = { lieux: 0, plan: 0, traces: 0, ignores: 0, rejets: 0 }

    try {
      // Codes déjà pris, pour ne jamais écraser l'existant
      const [l, p, t] = await Promise.all([
        supabase.from('lieux').select('code').eq('evenement_id', evenement.id),
        supabase.from('elements_plan').select('code').eq('evenement_id', evenement.id),
        supabase.from('traces').select('code').eq('evenement_id', evenement.id)
      ])
      const prisLieux = new Set((l.data ?? []).map((x) => x.code))
      const prisPlan = new Set((p.data ?? []).map((x) => x.code))
      const prisTraces = new Set((t.data ?? []).map((x) => x.code))

      for (const [i, calque] of lecture.calques.entries()) {
        const a = affectations[i]
        if (!a || a.vers === 'ignorer') {
          res.ignores += calque.objets.length
          continue
        }

        if (a.vers === 'lieux') {
          const lignes = calque.objets
            .filter((o) => o.points.length)
            .map((o) => ({
              evenement_id: evenement.id,
              code: codeDepuis(o.nom, null, prisLieux),
              nom: o.nom,
              type: a.param,
              latitude: o.points[0][0],
              longitude: o.points[0][1],
              altitude_m: Number.isFinite(o.points[0][2]) ? o.points[0][2] : null,
              description: descriptionComplete(o),
              origine: 'import'
            }))
          if (lignes.length) {
            const { error } = await supabase.from('lieux').insert(lignes)
            if (error) throw error
            res.lieux += lignes.length
          }
        }

        if (a.vers === 'plan') {
          const lignes = calque.objets
            .filter((o) => o.points.length)
            .map((o) => ({
              evenement_id: evenement.id,
              code: codeDepuis(o.nom, null, prisPlan),
              nom: o.nom,
              forme: o.forme,
              categorie: a.param,
              geometrie: o.points.map((x) => [x[0], x[1]]),
              est_risque: RISQUES.has(a.param),
              description: descriptionComplete(o),
              // Un objet venu du plan n'est pas constaté sur site :
              // il devra passer par la tournée de reconnaissance.
              confirme: false,
              origine: 'import'
            }))
          if (lignes.length) {
            const { error } = await supabase.from('elements_plan').insert(lignes)
            if (error) throw error
            res.plan += lignes.length
          }
        }

        if (a.vers === 'traces') {
          for (const o of calque.objets.filter((x) => x.forme === 'ligne')) {
            const points = simplifier(o.points)
            const m = mesurer(points)
            const { error } = await supabase.from('traces').insert({
              evenement_id: evenement.id,
              code: codeDepuis(o.nom, 'TRC', prisTraces),
              nom: o.nom,
              points,
              distance_km: m.distance_km,
              denivele_pos: m.denivele_pos,
              denivele_neg: m.denivele_neg,
              source: lecture.titre ?? 'KML',
              origine: 'import'
            })
            if (error) throw error
            res.traces++
          }
        }
      }

      setBilan(res)
      setLecture(null)
    } catch (e) {
      setMessage({ type: 'erreur', texte: e.message ?? String(e) })
    }
    setOccupe(false)
  }

  return (
    <section className="bloc">
      <h2>Import cartographique</h2>
      <p className="aide">
        Charge le KML exporté de Google My Maps. Les calques, les noms, les descriptions et
        les champs personnalisés sont repris — pas seulement le tracé. Si ton export est un
        KMZ, décompresse-le d'abord : c'est une archive contenant le KML.
      </p>

      {bilan && (
        <div className="message">
          {bilan.lieux} lieu(x) · {bilan.plan} élément(s) de plan · {bilan.traces} trace(s)
          · {bilan.ignores} ignoré(s)
        </div>
      )}

      <input
        type="file"
        accept=".kml,application/vnd.google-earth.kml+xml"
        onChange={(e) => e.target.files?.[0] && lire(e.target.files[0])}
      />

      {lecture && (
        <>
          <div className="compteurs">
            {lecture.titre && <span>{lecture.titre}</span>}
            <span>
              Calques <strong>{lecture.calques.length}</strong>
            </span>
            <span>
              Objets <strong>{lecture.total}</strong>
            </span>
          </div>

          {lecture.calques.map((c, i) => {
            const a = affectations[i] ?? { vers: 'ignorer' }
            const formes = c.objets.reduce((acc, o) => {
              acc[o.forme] = (acc[o.forme] ?? 0) + 1
              return acc
            }, {})
            return (
              <div className="carte" key={i}>
                <div className="titre">{c.nom}</div>
                <div className="meta">
                  <span>{c.objets.length} objet(s)</span>
                  {Object.entries(formes).map(([f, n]) => (
                    <span key={f}>
                      {n} {f}
                    </span>
                  ))}
                  {c.objets.some((o) => Object.keys(o.champs).length > 0) && (
                    <span>champs personnalisés</span>
                  )}
                </div>

                <div className="ligne-boutons" style={{ marginTop: 10 }}>
                  <select
                    value={a.vers}
                    onChange={(e) =>
                      setAffectations({
                        ...affectations,
                        [i]:
                          e.target.value === 'lieux'
                            ? { vers: 'lieux', param: 'autre' }
                            : e.target.value === 'plan'
                              ? { vers: 'plan', param: 'autre' }
                              : { vers: e.target.value }
                      })
                    }
                    style={{ width: 'auto', marginBottom: 0 }}
                  >
                    <option value="lieux">→ Lieux</option>
                    <option value="plan">→ Plan d'implantation</option>
                    <option value="traces">→ Traces</option>
                    <option value="ignorer">Ignorer</option>
                  </select>

                  {a.vers === 'lieux' && (
                    <select
                      value={a.param}
                      onChange={(e) =>
                        setAffectations({
                          ...affectations,
                          [i]: { vers: 'lieux', param: e.target.value }
                        })
                      }
                      style={{ width: 'auto', marginBottom: 0 }}
                    >
                      {TYPES_LIEU.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  )}

                  {a.vers === 'plan' && (
                    <select
                      value={a.param}
                      onChange={(e) =>
                        setAffectations({
                          ...affectations,
                          [i]: { vers: 'plan', param: e.target.value }
                        })
                      }
                      style={{ width: 'auto', marginBottom: 0 }}
                    >
                      {CATEGORIES_PLAN.map((t) => (
                        <option key={t}>
                          {t}
                          {RISQUES.has(t) ? ' ⚠' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <details style={{ marginTop: 8 }}>
                  <summary className="aide" style={{ cursor: 'pointer' }}>
                    Voir les objets
                  </summary>
                  <ul className="liste-pave" style={{ marginTop: 6 }}>
                    {c.objets.slice(0, 12).map((o, j) => (
                      <li key={j}>
                        {o.nom}
                        {o.description && (
                          <span className="mono"> · {o.description.slice(0, 60)}</span>
                        )}
                      </li>
                    ))}
                    {c.objets.length > 12 && (
                      <li className="mono">… {c.objets.length - 12} autre(s)</li>
                    )}
                  </ul>
                </details>
              </div>
            )
          })}

          <div className="ligne-boutons" style={{ marginTop: 12 }}>
            <button disabled={occupe} onClick={importer}>
              Importer
            </button>
            <button className="discret" disabled={occupe} onClick={() => setLecture(null)}>
              Annuler
            </button>
          </div>
          <p className="aide">
            Rien n'est écrasé : les codes déjà pris sont contournés par suffixe. Les objets
            envoyés vers le plan arrivent <strong>non confirmés</strong> — ils devront
            passer par la tournée de reconnaissance, parce qu'un plan dessiné en mai ne dit
            pas où les choses sont réellement le vendredi.
          </p>
        </>
      )}
    </section>
  )
}

/** Description + champs personnalisés, réunis en un seul texte lisible. */
function descriptionComplete(o) {
  const morceaux = []
  if (o.description) morceaux.push(o.description)
  for (const [k, v] of Object.entries(o.champs)) morceaux.push(`${k} : ${v}`)
  return morceaux.length ? morceaux.join('\n') : null
}
