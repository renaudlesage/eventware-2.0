import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Polygon, CircleMarker, Tooltip, Popup, useMap } from 'react-leaflet'
import { supabase } from './supabaseClient'
import { libelleStatut } from './libelles'

/**
 * La colonne de droite quand l'écran ouvert est Situation (≥ 1440 px).
 *
 * Ailleurs, la colonne de veille porte les alertes, le journal et la
 * météo : c'est ce qu'on veut garder sous les yeux en travaillant dans
 * un module. Sur Situation, c'est de la redite — l'écran les affiche
 * déjà (constat de Ren, 24/09). La colonne montre donc ce que Situation
 * n'a pas :
 *
 *   1. la CARTE TACTIQUE : la trace, le dispositif (secours, risques),
 *      les étapes, et par-dessus ce qui bouge — signalements ouverts,
 *      missions urgentes, MAYDAY, groupes à leur dernier pointage ;
 *   2. À VENIR dans les deux heures : programme et jalons ;
 *   3. les GROUPES dehors, un par un (Situation n'en donne que le
 *      nombre sans nouvelles).
 *
 * Situation.jsx n'est pas touché (retour en arrière du 20/09) : c'est
 * la coquille qui choisit quoi monter dans la colonne.
 */

const RAFRAICHISSEMENT_MS = 20000
const HORIZON_H = 2

const SECOURS = new Set([
  'point_rencontre_secours', 'prv', 'pma', 'aire_helico', 'point_rassemblement',
  'point_transfert', 'noria', 'voie_engins', 'itineraire_evacuation', 'sortie_secours',
  'poste_secours', 'dea', 'point_eau'
])

const NATURE = {
  malaise: 'Malaise', blessure: 'Blessure', danger: 'Danger',
  materiel: 'Matériel', egare: 'Personne égarée', autre: 'Autre'
}

// Leaflet dessine en SVG avec des couleurs littérales : on lit les
// jetons du thème courant plutôt que de figer des codes, pour que la
// carte suive clair / sombre comme le reste.
function jetons() {
  const cs = getComputedStyle(document.documentElement)
  const v = (n, repli) => cs.getPropertyValue(n).trim() || repli
  return {
    chaud: v('--etat-chaud', '#a3341f'),
    veille: v('--etat-veille', '#a86a00'),
    info: v('--etat-info', '#2f6fb0'),
    ok: v('--etat-ok', '#1f6f4f'),
    sourdine: v('--sourdine', '#6b6862'),
    encre: v('--encre', '#1b1b1b'),
    surface: v('--surface', '#ffffff')
  }
}

const hhmm = (d) =>
  new Date(d).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })

function ilYa(d, maintenant) {
  const min = Math.max(0, Math.round((maintenant - new Date(d)) / 60000))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

export default function ColonneSituation({ evenement, palier, onAller }) {
  const [fond, setFond] = useState(null) // ce qui ne bouge pas : trace, plan, lieux
  const [vif, setVif] = useState(null) // ce qui bouge
  const [maintenant, setMaintenant] = useState(() => new Date())

  useEffect(() => {
    let vivant = true
    Promise.all([
      supabase.from('traces').select('id, nom, couleur, points').eq('evenement_id', evenement.id),
      supabase
        .from('elements_plan')
        .select('id, code, nom, forme, categorie, geometrie, est_risque, confirme, organe_coupure')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null),
      supabase
        .from('lieux')
        .select('id, code, nom, type, latitude, longitude, pk_km')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
    ]).then(([t, e, l]) => {
      if (!vivant) return
      setFond({ traces: t.data ?? [], elements: e.data ?? [], lieux: l.data ?? [] })
    })
    return () => {
      vivant = false
    }
  }, [evenement.id])

  useEffect(() => {
    let vivant = true
    async function charger() {
      const maint = new Date()
      const horizon = new Date(maint.getTime() + HORIZON_H * 3600000)
      const [s, m, md, g, p, j] = await Promise.all([
        supabase
          .from('signalements')
          .select('id, reference, type, gravite, statut, latitude, longitude, lieu_id, emis_le')
          .eq('evenement_id', evenement.id)
          .is('deleted_at', null)
          .in('statut', ['recu', 'pris_en_charge', 'en_cours']),
        supabase
          .from('missions')
          .select('id, reference, titre, priorite, statut, latitude, longitude, lieu_id')
          .eq('evenement_id', evenement.id)
          .is('deleted_at', null)
          .in('priorite', ['P1', 'P2'])
          .not('statut', 'in', '("resolue","annulee")'),
        supabase
          .from('maydays')
          .select('id, reference, latitude, longitude, statut, emis_le')
          .eq('evenement_id', evenement.id)
          .in('statut', ['emis', 'accuse', 'en_cours']),
        supabase
          .from('groupes')
          .select('id, code, nom, effectif_prevu, effectif_reel, statut, dernier_lieu_id, dernier_passage, depart_reel')
          .eq('evenement_id', evenement.id)
          .is('deleted_at', null)
          .in('statut', ['parti', 'en_cours']),
        supabase
          .from('programme')
          .select('id, titre, debut, lieu_libre, lieu_id')
          .eq('evenement_id', evenement.id)
          .is('deleted_at', null)
          .gte('debut', maint.toISOString())
          .lte('debut', horizon.toISOString())
          .order('debut'),
        supabase
          .from('jalons')
          .select('id, libelle, echeance, statut, critique')
          .eq('evenement_id', evenement.id)
          .is('deleted_at', null)
          .in('statut', ['a_venir', 'en_cours'])
          .lte('echeance', horizon.toISOString())
          .order('echeance')
      ])
      if (!vivant) return
      setVif({
        signalements: s.data ?? [],
        missions: m.data ?? [],
        maydays: md.data ?? [],
        groupes: g.data ?? [],
        programme: p.data ?? [],
        jalons: j.data ?? []
      })
      setMaintenant(maint)
    }
    charger()
    const t = setInterval(charger, RAFRAICHISSEMENT_MS)
    return () => {
      vivant = false
      clearInterval(t)
    }
  }, [evenement.id])

  const lieux = useMemo(
    () => Object.fromEntries((fond?.lieux ?? []).map((l) => [l.id, l])),
    [fond]
  )

  return (
    <>
      <section>
        <div className="entete-dashboard">
          <h2>Carte tactique</h2>
          <button className="lien" onClick={() => onAller?.('plan')}>
            Plan →
          </button>
        </div>
        {!fond ? (
          <p className="vide">Chargement…</p>
        ) : (
          <CarteTactique
            evenement={evenement}
            fond={fond}
            vif={vif}
            lieux={lieux}
            hauteur={palier === 'mur' ? 440 : 380}
          />
        )}
      </section>

      <AVenir vif={vif} lieux={lieux} />

      <Groupes vif={vif} lieux={lieux} maintenant={maintenant} onAller={onAller} />
    </>
  )
}

function position(objet, lieux) {
  if (objet.latitude != null && objet.longitude != null) return [objet.latitude, objet.longitude]
  const l = lieux[objet.lieu_id ?? objet.dernier_lieu_id]
  return l?.latitude != null ? [l.latitude, l.longitude] : null
}

function CarteTactique({ evenement, fond, vif, lieux, hauteur }) {
  const c = useMemo(jetons, [])
  const repli = evenement.point_0_lat ? [evenement.point_0_lat, evenement.point_0_lon] : [50.38212, 5.61679]

  const signalements = (vif?.signalements ?? [])
    .map((s) => ({ ...s, pos: position(s, lieux) }))
    .filter((s) => s.pos)
  const missions = (vif?.missions ?? [])
    .map((m) => ({ ...m, pos: position(m, lieux) }))
    .filter((m) => m.pos)
  const maydays = (vif?.maydays ?? []).filter((m) => m.latitude != null)
  const groupes = (vif?.groupes ?? [])
    .map((g) => ({ ...g, pos: position(g, lieux) }))
    .filter((g) => g.pos)
  const reperes = fond.lieux.filter(
    (l) => l.latitude != null && ['etape', 'pc_ops', 'poste_secours', 'entree'].includes(l.type)
  )
  // Le dispositif fixe : secours et risques seulement. Les extincteurs,
  // câbles et bars rendent la carte illisible à cette taille.
  const elements = fond.elements.filter(
    (e) => Array.isArray(e.geometrie) && e.geometrie.length && (e.est_risque || SECOURS.has(e.categorie))
  )

  const nonGeolocalises =
    (vif?.signalements ?? []).length - signalements.length +
    ((vif?.missions ?? []).length - missions.length)

  return (
    <>
      <div className="carte-conteneur carte-tactique" style={{ height: hauteur }}>
        <MapContainer center={repli} zoom={14} zoomSnap={0.25} scrollWheelZoom={false}>
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {fond.traces.map((t) =>
            (t.points ?? []).length > 1 ? (
              <Polyline
                key={t.id}
                positions={t.points.map((p) => [p[0], p[1]])}
                pathOptions={{ color: t.couleur || c.info, weight: 4, opacity: 0.7 }}
              >
                <Tooltip sticky>{t.nom}</Tooltip>
              </Polyline>
            ) : null
          )}

          {elements.map((e) => {
            const couleur = e.est_risque ? c.chaud : e.confirme ? c.ok : c.sourdine
            const g = e.geometrie
            if (e.forme === 'zone' && g.length > 2)
              return (
                <Polygon key={e.id} positions={g} pathOptions={{ color: couleur, weight: 2, fillOpacity: 0.1 }}>
                  <Tooltip>{e.nom}</Tooltip>
                </Polygon>
              )
            if (e.forme === 'ligne' && g.length > 1)
              return (
                <Polyline key={e.id} positions={g} pathOptions={{ color: couleur, weight: 3, dashArray: '6 4' }}>
                  <Tooltip>{e.nom}</Tooltip>
                </Polyline>
              )
            return (
              <CircleMarker
                key={e.id}
                center={g[0]}
                radius={e.est_risque ? 6 : 4}
                pathOptions={{ color: couleur, fillColor: couleur, fillOpacity: 0.8, weight: 1 }}
              >
                <Tooltip>
                  {e.nom}
                  {e.organe_coupure ? ` — coupure : ${e.organe_coupure}` : ''}
                </Tooltip>
              </CircleMarker>
            )
          })}

          {reperes.map((l) => (
            <CircleMarker
              key={l.id}
              center={[l.latitude, l.longitude]}
              radius={5}
              pathOptions={{ color: c.encre, fillColor: c.surface, fillOpacity: 1, weight: 2 }}
            >
              <Tooltip permanent direction="top" offset={[0, -6]} className="etiquette-carte">
                {l.code || l.nom}
              </Tooltip>
            </CircleMarker>
          ))}

          {groupes.map((g) => (
            <CircleMarker
              key={g.id}
              center={g.pos}
              radius={9}
              pathOptions={{ color: c.info, fillColor: c.info, fillOpacity: 0.35, weight: 2 }}
            >
              <Tooltip>
                {g.nom || g.code} · {g.effectif_reel ?? g.effectif_prevu ?? '?'} pers.
              </Tooltip>
            </CircleMarker>
          ))}

          {missions.map((m) => (
            <CircleMarker
              key={m.id}
              center={m.pos}
              radius={7}
              pathOptions={{ color: c.veille, fillColor: c.veille, fillOpacity: 0.9, weight: 2 }}
            >
              <Popup>
                <strong>{m.reference}</strong> · {m.priorite}
                <br />
                {m.titre}
                <br />
                {libelleStatut(m.statut)}
              </Popup>
            </CircleMarker>
          ))}

          {signalements.map((s) => (
            <CircleMarker
              key={s.id}
              center={s.pos}
              radius={s.gravite === 'critique' || s.gravite === 'grave' ? 10 : 8}
              pathOptions={{ color: c.chaud, fillColor: c.chaud, fillOpacity: 0.9, weight: 3 }}
            >
              <Popup>
                <strong>{s.reference}</strong> · {NATURE[s.type] ?? s.type}
                {s.gravite ? ` · ${s.gravite}` : ''}
                <br />
                {libelleStatut(s.statut)} depuis {hhmm(s.emis_le)}
              </Popup>
            </CircleMarker>
          ))}

          {maydays.map((m) => (
            <CircleMarker
              key={m.id}
              center={[m.latitude, m.longitude]}
              radius={12}
              pathOptions={{ color: c.chaud, fillColor: c.surface, fillOpacity: 1, weight: 4 }}
            >
              <Tooltip permanent direction="right">
                {m.reference}
              </Tooltip>
            </CircleMarker>
          ))}

          <Cadrer fond={fond} repli={repli} />
        </MapContainer>
      </div>
      <ul className="legende-carte">
        <li><span className="puce-carte puce-chaud" /> signalement ouvert</li>
        <li><span className="puce-carte puce-veille" /> mission P1 / P2</li>
        <li><span className="puce-carte puce-info" /> groupe (dernier pointage)</li>
        <li><span className="puce-carte puce-repere" /> étape, PC, poste</li>
        <li><span className="trait-risque" /> risque · <span className="trait-ok" /> dispositif confirmé</li>
      </ul>
      {nonGeolocalises > 0 && (
        <p className="aide">
          <span className="mono">{nonGeolocalises}</span> signalement(s) ou mission(s) sans position
          — absents de la carte, présents dans la colonne Sécurité.
        </p>
      )}
    </>
  )
}

// Cadre une fois sur le fond, pas à chaque rafraîchissement : la carte
// ne doit pas sauter sous la souris de celui qui la regarde. On cadre
// sur le PARCOURS et les lieux de l'événement, pas sur tout le plan : un
// seul élément importé loin du site (une citerne à 30 km dans le KML de
// Rando VTT) dézoomerait la carte jusqu'à la rendre inutile.
function Cadrer({ fond, repli }) {
  const carte = useMap()
  useEffect(() => {
    const valide = (p) => Array.isArray(p) && p[0] != null && p[1] != null
    const site = [
      ...fond.traces.filter((t) => (t.points ?? []).length > 1).flatMap((t) => t.points.map((p) => [p[0], p[1]])),
      ...fond.lieux.filter((l) => l.latitude != null).map((l) => [l.latitude, l.longitude])
    ].filter(valide)
    const pts = site.length > 1
      ? site
      : fond.elements.flatMap((e) => (Array.isArray(e.geometrie) ? e.geometrie : [])).filter(valide)
    if (pts.length > 1) carte.fitBounds(pts, { padding: [20, 20], maxZoom: 16 })
    else carte.setView(repli, 15)
  }, [fond])
  return null
}

function AVenir({ vif, lieux }) {
  if (!vif) return null
  const items = [
    ...vif.programme.map((p) => ({
      id: 'p' + p.id,
      quand: p.debut,
      texte: p.titre,
      lieu: lieux[p.lieu_id]?.nom ?? p.lieu_libre,
      genre: 'programme'
    })),
    ...vif.jalons.map((j) => ({
      id: 'j' + j.id,
      quand: j.echeance,
      texte: j.libelle,
      genre: 'jalon',
      retard: new Date(j.echeance) < new Date(),
      critique: j.critique
    }))
  ].sort((a, b) => new Date(a.quand) - new Date(b.quand))

  return (
    <section>
      <h2>Dans les {HORIZON_H} heures</h2>
      {items.length === 0 ? (
        <p className="vide">Rien au programme ni en échéance.</p>
      ) : (
        <ul className="chrono a-venir">
          {items.slice(0, 8).map((i) => (
            <li key={i.id} className={i.retard ? 'imp-majeur' : ''}>
              <span className="heure">{hhmm(i.quand)}</span>
              <span className="corps">
                {i.texte}
                {i.lieu && <span className="mono"> · {i.lieu}</span>}
                {i.genre === 'jalon' && (
                  <span className={`jeton ${i.retard ? 'alerte-texte' : ''}`}>
                    {i.retard ? 'jalon en retard' : i.critique ? 'jalon critique' : 'jalon'}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Groupes({ vif, lieux, maintenant, onAller }) {
  if (!vif || vif.groupes.length === 0) return null
  const lignes = vif.groupes
    .map((g) => {
      const vu = g.dernier_passage ?? g.depart_reel
      const min = vu ? (maintenant - new Date(vu)) / 60000 : Infinity
      return { ...g, vu, sansNouvelles: min > 45, lieu: lieux[g.dernier_lieu_id] }
    })
    .sort((a, b) => (b.sansNouvelles - a.sansNouvelles) || ((a.lieu?.pk_km ?? 0) - (b.lieu?.pk_km ?? 0)))

  return (
    <section>
      <div className="entete-dashboard">
        <h2>Groupes dehors</h2>
        <button className="lien" onClick={() => onAller?.('parcours')}>
          Parcours →
        </button>
      </div>
      <table className="apercu groupes-dehors">
        <tbody>
          {lignes.map((g) => (
            <tr key={g.id} className={g.sansNouvelles ? 'rejete' : ''}>
              <td>
                {g.nom || g.code}
                {g.sansNouvelles && <span className="jeton alerte-texte">sans nouvelles</span>}
              </td>
              <td className="mono">{g.effectif_reel ?? g.effectif_prevu ?? '—'}</td>
              <td>
                {g.lieu?.code ?? g.lieu?.nom ?? '—'}
                {g.lieu?.pk_km != null && <span className="mono"> km {Number(g.lieu.pk_km).toFixed(1)}</span>}
              </td>
              <td className="mono">{g.vu ? ilYa(g.vu, maintenant) : 'jamais'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
