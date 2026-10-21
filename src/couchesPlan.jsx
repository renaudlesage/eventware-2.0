/**
 * Les objets du plan d'implantation, dessinés sur une carte Leaflet
 * exactement comme sur la carte de conception (Implantation.jsx), en
 * lecture seule : zones à l'échelle dans la couleur de leur calque,
 * barrières avec leurs jonctions, câbles et conduites, pictogrammes
 * ISO 7010 à l'échelle quand on la connaît.
 *
 * La carte du plan (PlanImplantation), la carte tactique (Situation,
 * Sécurité) et le banc d'essai s'en servent. La conception garde son
 * propre dessin, qui sait aussi sélectionner, glisser, et montrer les
 * poignées d'un tracé.
 */
import { useEffect, useState } from 'react'
import { Polygon, Polyline, CircleMarker, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import { polygoneObjet, jonctionsLigne } from './geometrie'
import { pictoSvg } from './pictos'
import { libelleAgentExtinction, uniteExtinction } from './libelles'
import { COULEUR_CALQUE, calqueDe } from './calques'

const fr = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d).replace('.', ','))

/** Mètres par pixel au centre de la vue, suivi au zoom : pour les pictos à l'échelle. */
export function useEchelleCarte() {
  const carte = useMap()
  const [mParPx, setMParPx] = useState(null)
  useEffect(() => {
    const mesurer = () => {
      const c = carte.getSize()
      if (!c.x || !c.y) return
      const a = carte.containerPointToLatLng([0, c.y / 2])
      const b = carte.containerPointToLatLng([c.x, c.y / 2])
      setMParPx(carte.distance(a, b) / c.x)
    }
    mesurer()
    carte.on('zoomend moveend resize', mesurer)
    return () => carte.off('zoomend moveend resize', mesurer)
  }, [carte])
  return mParPx
}

function titreObjet(o) {
  let t = o.nom ?? o.code ?? ''
  if (o.agent_extinction) {
    t += ` · ${libelleAgentExtinction(o.agent_extinction)}`
    if (o.capacite_extinction) t += ` ${fr(o.capacite_extinction, 0)} ${uniteExtinction(o.agent_extinction)}`
  }
  if (o.organe_coupure) t += ` · coupure : ${o.organe_coupure}`
  if (o.confirme === false) t += ' · non confirmé sur site'
  return t
}

function ObjetPlan({ o, mParPx }) {
  const couleur = COULEUR_CALQUE[calqueDe(o)] ?? '#5d6874'
  const g = Array.isArray(o.geometrie) ? o.geometrie.filter((p) => Array.isArray(p) && p[0] != null) : []
  const centre = o.centre_lat != null && o.centre_lon != null ? [Number(o.centre_lat), Number(o.centre_lon)] : g[0]
  const pointille = o.confirme ? null : '5 3'
  const titre = titreObjet(o)

  if (o.nature === 'picto' && o.picto && centre) {
    const base = mParPx ? Number(o.largeur_m || 3) / mParPx : 22
    const taille = Math.round(Math.max(12, Math.min(120, base)))
    const icone = L.divIcon({
      className: `impl-picto ${o.confirme ? '' : 'non-confirme'}`,
      html: `<div style="transform:rotate(${Number(o.rotation_deg ?? 0)}deg)">${pictoSvg(o.picto, taille)}</div>`,
      iconSize: [taille, taille],
      iconAnchor: [taille / 2, taille / 2],
      tooltipAnchor: [0, -taille / 2]
    })
    return (
      <Marker position={centre} icon={icone}>
        <Tooltip direction="top" className="etiquette-carte">{titre}</Tooltip>
      </Marker>
    )
  }

  if (o.nature === 'ligne' || o.forme === 'ligne') {
    if (g.length < 2) return null
    if (o.reseau) {
      const c = o.reseau === 'electricite' ? COULEUR_CALQUE.energie : COULEUR_CALQUE.eau
      return (
        <Polyline positions={g} pathOptions={{ color: c, weight: o.reseau === 'electricite' ? 3 : 3.5, dashArray: o.reseau === 'eau' ? '10 6' : o.confirme ? null : '2 6', lineCap: 'round' }}>
          <Tooltip direction="center" className="etiquette-carte">{titre}{o.longueur_m ? ` · ${fr(o.longueur_m, 0)} m` : ''}</Tooltip>
        </Polyline>
      )
    }
    const jonctions = Number(o.largeur_m) > 0 ? jonctionsLigne(g, Number(o.largeur_m)) : []
    return (
      <>
        <Polyline positions={g} pathOptions={{ color: couleur, weight: 3.5, dashArray: o.confirme ? null : '8 5' }}>
          <Tooltip direction="center" className="etiquette-carte">
            {titre}{o.largeur_m ? ` · ${o.quantite ?? jonctions.length} × ${fr(o.largeur_m)} m` : ''}
          </Tooltip>
        </Polyline>
        {jonctions.length <= 400 && jonctions.map((p, i) => (
          <CircleMarker key={i} center={p} radius={2.5} interactive={false} pathOptions={{ color: couleur, fillColor: '#fff', fillOpacity: 1, weight: 1.5 }} />
        ))}
      </>
    )
  }

  // Une zone à l'échelle (centre + dimensions), sinon l'emprise dessinée
  // telle quelle (éléments posés avant la 117, sans dimensions).
  const poly = polygoneObjet(o) ?? (g.length > 2 ? g : null)
  if (poly)
    return (
      <Polygon positions={poly} pathOptions={{ color: couleur, weight: 1.5, fillColor: couleur, fillOpacity: 0.35, dashArray: pointille }}>
        <Tooltip direction="center" className="etiquette-carte">{titre}</Tooltip>
      </Polygon>
    )
  if (centre)
    return (
      <CircleMarker center={centre} radius={o.est_risque ? 6 : 4} pathOptions={{ color: couleur, fillColor: couleur, fillOpacity: 0.8, weight: 1, dashArray: pointille }}>
        <Tooltip className="etiquette-carte">{titre}</Tooltip>
      </CircleMarker>
    )
  return null
}

/**
 * Toutes les couches du plan. `objets` : les elements_plan à dessiner
 * (déjà filtrés par calque par l'appelant) ; `mParPx` : l'échelle, sinon
 * elle est mesurée sur la carte.
 */
export function CouchesPlan({ objets = [], mParPx }) {
  const mesure = useEchelleCarte()
  const echelle = mParPx ?? mesure
  return (
    <>
      {objets.map((o) => (
        <ObjetPlan key={o.id ?? o.code} o={o} mParPx={echelle} />
      ))}
    </>
  )
}
