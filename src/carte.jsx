import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'

/**
 * Ce que toutes les cartes de l'app partagent (17/10, retour de Ren).
 *
 *   FONDS_CARTE      — les fonds disponibles ; `natif` : zoom maximal servi
 *                      par la source, au-delà Leaflet agrandit les tuiles.
 *   useFondCarte     — le fond choisi, mémorisé sur le poste.
 *   FondCarte        — les couches de tuiles du fond choisi.
 *   ControlesCarte   — un contrôle Leaflet, dans la carte (en haut à
 *                      droite) : le choix du fond et le plein écran.
 *
 * Le plein écran est fait en CSS (le conteneur passe en position fixe),
 * pas avec l'API Fullscreen : iOS ne la donne pas aux éléments
 * quelconques, et le résultat est le même. Échap ou le bouton pour
 * revenir ; la carte se redimensionne toute seule.
 */

export const FONDS_CARTE = [
  ['satellite', 'Satellite', [{ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri', natif: 19 }]],
  ['hybride', 'Satellite + noms', [
    { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri', natif: 19 },
    { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', attribution: '', natif: 19 }
  ]],
  ['plan', 'Plan (OSM)', [{ url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap', natif: 19 }]],
  ['ign', 'Carte IGN belge', [{ url: 'https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png', attribution: '&copy; IGN-NGI', natif: 17 }]],
  ['topo', 'Topographique', [{ url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenTopoMap', natif: 17 }]],
  ['clair', 'Clair', [{ url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap, &copy; CARTO', natif: 20 }]],
  ['sombre', 'Sombre', [{ url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap, &copy; CARTO', natif: 20 }]],
  ['aucun', 'Aucun (fond de plan seul)', []]
]

/** Le fond choisi pour une carte, mémorisé sous `carte.fond.<cle>`. */
export function useFondCarte(cle, defaut = 'plan') {
  const [fond, setFond] = useState(() => {
    try {
      const v = localStorage.getItem(`carte.fond.${cle}`)
      return FONDS_CARTE.some(([k]) => k === v) ? v : defaut
    } catch {
      return defaut
    }
  })
  useEffect(() => {
    try { localStorage.setItem(`carte.fond.${cle}`, fond) } catch {}
  }, [cle, fond])
  return [fond, setFond]
}

export function FondCarte({ cle }) {
  const couches = FONDS_CARTE.find(([k]) => k === cle)?.[2] ?? FONDS_CARTE[0][2]
  return couches.map((c, i) => <TileLayer key={cle + i} attribution={c.attribution} url={c.url} maxNativeZoom={c.natif} maxZoom={22} />)
}

/**
 * Le contrôle dans la carte. Sans `onPleinEcran`, il gère lui-même le
 * plein écran du conteneur `.carte-conteneur` ; avec, il délègue (le
 * plan d'implantation agrandit tout l'éditeur, catalogue compris).
 */
export function ControlesCarte({ fond, onFond, pleinEcran, onPleinEcran, position = 'topright', sansFond = false }) {
  const carte = useMap()
  const [conteneur, setConteneur] = useState(null)
  const [pleinLocal, setPleinLocal] = useState(false)
  const delegue = typeof onPleinEcran === 'function'
  const plein = delegue ? !!pleinEcran : pleinLocal

  useEffect(() => {
    const ctl = L.control({ position })
    let div
    ctl.onAdd = () => {
      div = L.DomUtil.create('div', 'leaflet-bar carte-controles')
      L.DomEvent.disableClickPropagation(div)
      L.DomEvent.disableScrollPropagation(div)
      setConteneur(div)
      return div
    }
    ctl.addTo(carte)
    return () => {
      ctl.remove()
      setConteneur(null)
    }
  }, [carte, position])

  // Plein écran local : le conteneur de la carte passe en position fixe.
  useEffect(() => {
    if (delegue) return
    const boite = carte.getContainer().parentElement
    if (!boite) return
    boite.classList.toggle('carte-plein', pleinLocal)
    document.body.classList.toggle('carte-plein-corps', pleinLocal)
    carte.invalidateSize()
    const t = setTimeout(() => carte.invalidateSize(), 250)
    if (!pleinLocal) return () => clearTimeout(t)
    const touche = (e) => { if (e.key === 'Escape') setPleinLocal(false) }
    window.addEventListener('keydown', touche)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', touche)
      boite.classList.remove('carte-plein')
      document.body.classList.remove('carte-plein-corps')
    }
  }, [carte, delegue, pleinLocal])

  const basculer = () => (delegue ? onPleinEcran(!plein) : setPleinLocal((v) => !v))

  if (!conteneur) return null
  return createPortal(
    <>
      {!sansFond && onFond && (
        <select className="carte-fond" value={fond} onChange={(e) => onFond(e.target.value)} aria-label="Fond de carte" title="Fond de carte">
          {FONDS_CARTE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )}
      <button type="button" className="carte-plein-bouton" onClick={basculer} aria-label={plein ? 'Réduire la carte' : 'Carte en plein écran'} title={plein ? 'Réduire (Échap)' : 'Plein écran'}>
        {plein ? '✕' : '⛶'}
      </button>
    </>,
    conteneur
  )
}

/** Le libellé d'un fond, pour une légende. */
export function libelleFond(cle) {
  return FONDS_CARTE.find(([k]) => k === cle)?.[1] ?? cle
}

export function useFondsDisponibles() {
  return useMemo(() => FONDS_CARTE.map(([k, l]) => [k, l]), [])
}
