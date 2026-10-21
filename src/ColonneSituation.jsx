import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Polyline, Polygon, CircleMarker, Marker, Tooltip, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useCalques, FiltreCalques, calqueDe } from './calques'
import { CouchesPlan } from './couchesPlan'
import { FondCarte, ControlesCarte, useFondCarte } from './carte'
import { supabase } from './supabaseClient'
import { libelleStatut } from './libelles'
import { situerSurTrace, libelleSurTrace } from './geometrie'

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

/**
 * Les données de la carte tactique, partagées avec PC-OPS (lot 2 du
 * comparatif BFMF 2026) : le fond (trace, plan, lieux), chargé une
 * fois, et ce qui bouge, rafraîchi toutes les vingt secondes.
 */
export function useTactique(evenement) {
  const [fond, setFond] = useState(null) // ce qui ne bouge pas : trace, plan, lieux
  const [vif, setVif] = useState(null) // ce qui bouge
  const [maintenant, setMaintenant] = useState(() => new Date())

  useEffect(() => {
    let vivant = true
    Promise.all([
      supabase.from('traces').select('id, nom, couleur, points').eq('evenement_id', evenement.id),
      supabase
        .from('elements_plan')
        .select('id, code, nom, forme, forme_echelle, nature, picto, calque, categorie, geometrie, centre_lat, centre_lon, largeur_m, longueur_m, rotation_deg, reseau, quantite, est_risque, confirme, organe_coupure, agent_extinction, capacite_extinction')
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

  return { fond, vif, lieux, maintenant }
}

export default function ColonneSituation({ evenement, palier, onAller }) {
  const { fond, vif, lieux, maintenant } = useTactique(evenement)

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

      <Radio evenement={evenement} onAller={onAller} />
    </>
  )
}

/**
 * Le plan radio, sous la main du PC (lot 2 du comparatif BFMF 2026) :
 * le canal d'urgence en tête, et combien de postes sont en main sur
 * chaque canal. La colonne de veille ne le montrait qu'au mur
 * (≥ 2200 px) ; sur l'écran projeté il manquait.
 */
export function Radio({ evenement, onAller }) {
  const [radio, setRadio] = useState(null)

  useEffect(() => {
    let vivant = true
    async function charger() {
      const [c, p] = await Promise.all([
        supabase
          .from('canaux_radio')
          .select('id, numero, libelle, usage_prevu, canal_urgence')
          .eq('evenement_id', evenement.id)
          .eq('actif', true)
          .is('deleted_at', null)
          .order('ordre'),
        supabase
          .from('attributions')
          .select('id, code, canal_id')
          .eq('evenement_id', evenement.id)
          .eq('nature', 'radio')
          .is('deleted_at', null)
          .is('rendu_le', null)
      ])
      if (!vivant) return
      setRadio({ canaux: c.data ?? [], postes: p.data ?? [] })
    }
    charger()
    const t = setInterval(charger, 60000)
    return () => {
      vivant = false
      clearInterval(t)
    }
  }, [evenement.id])

  if (!radio || radio.canaux.length === 0) return null
  const urgence = radio.canaux.filter((c) => c.canal_urgence)
  const courants = radio.canaux.filter((c) => !c.canal_urgence)

  return (
    <section>
      <div className="entete-dashboard">
        <h2>Radio</h2>
        <button className="lien" onClick={() => onAller?.('logistique')}>
          Matrice →
        </button>
      </div>
      <table className="apercu plan-radio">
        <tbody>
          {[...urgence, ...courants].map((c) => (
            <tr key={c.id} className={c.canal_urgence ? 'canal-urgence' : ''}>
              <td className="mono">{c.numero}</td>
              <td>
                {c.libelle}
                {c.canal_urgence && <span className="jeton alerte-jeton">urgence</span>}
                {c.usage_prevu && <span className="sourdine"> · {c.usage_prevu}</span>}
              </td>
              <td className="mono">{radio.postes.filter((p) => p.canal_id === c.id).length} poste(s)</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="aide">
        {radio.postes.length} poste(s) radio en main.
        {urgence.length === 0 && ' Aucun canal réservé aux urgences — à régler dans la matrice radio.'}
      </p>
    </section>
  )
}

function position(objet, lieux) {
  if (objet.latitude != null && objet.longitude != null) return [objet.latitude, objet.longitude]
  const l = lieux[objet.lieu_id ?? objet.dernier_lieu_id]
  return l?.latitude != null ? [l.latitude, l.longitude] : null
}

export function CarteTactique({ evenement, fond, vif, lieux, hauteur }) {
  const c = useMemo(jetons, [])
  // (123) « km 3,2 · entre E2 et E3 » dans chaque bulle : la carte
  // montre, la projection dit — c'est ce qu'on annonce à la radio.
  const situer = (pos) => libelleSurTrace(situerSurTrace(fond.traces, fond.lieux, pos[0], pos[1]))
  const [fondCarte, setFondCarte] = useFondCarte('situation')
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
  // (21/10) Tout le plan d'implantation, dessiné comme sur la carte de
  // conception, avec ses calques à cocher — Ren : « les cartes doivent
  // toutes s'afficher comme celle de conception ». Avant : secours et
  // risques seuls, en ronds gris.
  const [calques, basculerCalque] = useCalques()
  const objetsPlan = fond.elements.filter((e) => Array.isArray(e.geometrie) && e.geometrie.length && calques.has(calqueDe(e)))

  const nonGeolocalises =
    (vif?.signalements ?? []).length - signalements.length +
    ((vif?.missions ?? []).length - missions.length)

  return (
    <>
      <FiltreCalques objets={fond.elements} visibles={calques} onBasculer={basculerCalque} />
      <div className="carte-conteneur carte-tactique" style={{ height: hauteur }}>
        <MapContainer center={repli} zoom={14} zoomSnap={0.25} scrollWheelZoom={false}>
          <FondCarte cle={fondCarte} />
          <ControlesCarte fond={fondCarte} onFond={setFondCarte} />
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

          <CouchesPlan objets={objetsPlan} />

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
                {situer(m.pos) && (
                  <>
                    <br />
                    <span className="sur-trace">{situer(m.pos)}</span>
                  </>
                )}
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
                {situer(s.pos) && (
                  <>
                    <br />
                    <span className="sur-trace">{situer(s.pos)}</span>
                  </>
                )}
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
                {situer([m.latitude, m.longitude]) && ` · ${situer([m.latitude, m.longitude])}`}
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
        {objetsPlan.length > 0 && <li>plan d'implantation dans la couleur de son calque · pointillé : non confirmé sur site</li>}
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
