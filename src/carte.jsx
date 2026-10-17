import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  TUILE_MANQUANTE, MAX_TUILES_ZONE, ZOOM_MIN_ZONE,
  tuilesDeZone, preparerZone, etatReserve, tuilesDuFond, viderReserve, libelleReserve
} from './tuiles'

/**
 * Ce que toutes les cartes de l'app partagent (17/10, retour de Ren).
 *
 *   FONDS_CARTE      — les fonds disponibles ; `natif` : zoom maximal servi
 *                      par la source, au-delà Leaflet agrandit les tuiles.
 *   useFondCarte     — le fond choisi, mémorisé sur le poste.
 *   FondCarte        — les couches de tuiles du fond choisi.
 *   ControlesCarte   — un contrôle Leaflet, dans la carte (en haut à
 *                      droite) : le choix du fond, la réserve hors
 *                      ligne (⬇, voir tuiles.js) et le plein écran.
 *
 * `reserve` sur un fond : 'zone' si le fournisseur admet qu'on
 * télécharge d'avance une emprise (IGN belge, données ouvertes),
 * 'vues' si seules les tuiles déjà affichées peuvent être gardées
 * (OpenStreetMap l'exige en toutes lettres, les autres aussi ou à
 * peu près). Les attributions sont celles que chaque fournisseur
 * demande — OSM veut « contributors », pas seulement le nom.
 *
 * Le plein écran est fait en CSS (le conteneur passe en position fixe),
 * pas avec l'API Fullscreen : iOS ne la donne pas aux éléments
 * quelconques, et le résultat est le même. Échap ou le bouton pour
 * revenir ; la carte se redimensionne toute seule.
 */

const ESRI = 'Source : Esri, Maxar, Earthstar Geographics, GIS User Community'
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export const FONDS_CARTE = [
  ['satellite', 'Satellite', [{ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: `&copy; Esri — ${ESRI}`, natif: 19 }], 'vues'],
  ['hybride', 'Satellite + noms', [
    { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: `&copy; Esri — ${ESRI}`, natif: 19 },
    { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', attribution: '', natif: 19 }
  ], 'vues'],
  // Sans sous-domaine {s} : OSM a retiré a/b/c de sa politique, un seul
  // hôte, et un User-Agent identifiable — celui du navigateur suffit.
  ['plan', 'Plan (OSM)', [{ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM, natif: 19 }], 'vues'],
  ['ign', 'Carte IGN belge', [{ url: 'https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png', attribution: '&copy; <a href="https://www.ngi.be/website/fr/cartoweb-be/">IGN-NGI</a> CartoWeb.be', natif: 17 }], 'zone'],
  ['topo', 'Topographique', [{ url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: `${OSM}, SRTM · &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`, natif: 17 }], 'vues'],
  ['clair', 'Clair', [{ url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: `${OSM}, &copy; <a href="https://carto.com/attributions">CARTO</a>`, natif: 20 }], 'vues'],
  ['sombre', 'Sombre', [{ url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: `${OSM}, &copy; <a href="https://carto.com/attributions">CARTO</a>`, natif: 20 }], 'vues'],
  ['aucun', 'Aucun (fond de plan seul)', [], null]
]

/** Le fond (entrée de FONDS_CARTE) d'une clé. */
export function fondCarte(cle) {
  return FONDS_CARTE.find(([k]) => k === cle) ?? FONDS_CARTE[0]
}

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
  const couches = fondCarte(cle)[2]
  // errorTileUrl : hors réseau, une tuile absente de la réserve dit
  // « pas en réserve » au lieu d'un carré gris.
  return couches.map((c, i) => (
    <TileLayer key={cle + i} attribution={c.attribution} url={c.url} maxNativeZoom={c.natif} maxZoom={22} errorTileUrl={TUILE_MANQUANTE} />
  ))
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
  const [reserveOuverte, setReserveOuverte] = useState(false)

  if (!conteneur) return null
  return createPortal(
    <>
      {!sansFond && onFond && (
        <select className="carte-fond" value={fond} onChange={(e) => onFond(e.target.value)} aria-label="Fond de carte" title="Fond de carte">
          {FONDS_CARTE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )}
      {!sansFond && fondCarte(fond)[3] && (
        <button type="button" className={`carte-plein-bouton ${reserveOuverte ? 'actif' : ''}`} onClick={() => setReserveOuverte((v) => !v)} aria-label="Carte hors ligne" title="Carte hors ligne (réserve de tuiles)">
          ⬇
        </button>
      )}
      <button type="button" className="carte-plein-bouton" onClick={basculer} aria-label={plein ? 'Réduire la carte' : 'Carte en plein écran'} title={plein ? 'Réduire (Échap)' : 'Plein écran'}>
        {plein ? '✕' : '⛶'}
      </button>
      {reserveOuverte && <PanneauReserve carte={carte} fond={fond} onFermer={() => setReserveOuverte(false)} />}
    </>,
    conteneur
  )
}

/**
 * Le panneau « carte hors ligne », sous le contrôle. Il dit ce qu'il y
 * a en réserve, et — sur le seul fond qui le permet — prépare la zone
 * visible. Pas de choix de zone ni de zooms : ce que l'opérateur voit
 * à l'écran, du zoom 12 au zoom natif du fond (16 au plus), c'est la
 * zone ; s'il veut plus, il dézoome et recommence. Trois mille tuiles
 * au plus par préparation : au-delà, on dit de zoomer. La carte IGN
 * à ces zooms, pour un parcours de 20 km, c'est de l'ordre de mille
 * tuiles et vingt mégaoctets.
 */
function PanneauReserve({ carte, fond, onFermer }) {
  const [etat, setEtat] = useState(null)
  const [progres, setProgres] = useState(null) // { fait, total }
  const [resultat, setResultat] = useState(null)
  const [annulation, setAnnulation] = useState(null)
  const [nbZone, setNbZone] = useState(0)
  const [, , couches, reserve] = fondCarte(fond)
  const zMax = Math.min(16, ...couches.map((c) => c.natif ?? 16))

  const rafraichir = () => etatReserve().then(setEtat)
  useEffect(() => {
    rafraichir()
  }, [fond])

  // Le compte de la zone visible suit la carte, pour que le bouton dise
  // combien avant qu'on clique.
  useEffect(() => {
    const compter = () => setNbZone(tuilesDeZone(carte.getBounds(), ZOOM_MIN_ZONE, zMax).length)
    compter()
    carte.on('moveend zoomend', compter)
    return () => carte.off('moveend zoomend', compter)
  }, [carte, zMax])

  async function preparer() {
    const ctl = new AbortController()
    setAnnulation(ctl)
    setResultat(null)
    setProgres({ fait: 0, total: nbZone })
    const r = await preparerZone(couches, tuilesDeZone(carte.getBounds(), ZOOM_MIN_ZONE, zMax), {
      signal: ctl.signal,
      onProgres: (fait, total) => setProgres({ fait, total })
    })
    setAnnulation(null)
    setProgres(null)
    setResultat(ctl.signal.aborted ? { ...r, interrompu: true } : r)
    rafraichir()
  }

  async function vider() {
    if (!window.confirm('Vider la réserve de tuiles de ce poste ? La carte redemandera tout au réseau.')) return
    await viderReserve()
    setResultat(null)
    rafraichir()
  }

  const duFond = etat ? tuilesDuFond(etat, couches) : 0
  const trop = nbZone > MAX_TUILES_ZONE

  return (
    <div className="carte-reserve" onClick={(e) => e.stopPropagation()}>
      <div className="carte-reserve-tete">
        <strong>Carte hors ligne</strong>
        <button type="button" className="lien" onClick={onFermer} aria-label="Fermer">✕</button>
      </div>
      {etat?.indisponible ? (
        <p className="aide">Ce navigateur n'a pas de réserve (navigation privée ou contexte non sécurisé).</p>
      ) : (
        <p className="aide">
          En réserve sur ce poste : {etat ? libelleReserve(etat.total) : '…'}
          {etat && duFond > 0 && <> — dont {duFond.toLocaleString('fr-BE')} pour ce fond</>}.
          <br />
          Tout ce que tu regardes reste disponible trente jours sans réseau.
        </p>
      )}
      {reserve === 'zone' ? (
        progres ? (
          <>
            <progress value={progres.fait} max={progres.total} />
            <p className="aide">
              {progres.fait} / {progres.total} tuiles…{' '}
              <button type="button" className="lien" onClick={() => annulation?.abort()}>interrompre</button>
            </p>
          </>
        ) : (
          <>
            <button type="button" className="discret" disabled={trop || nbZone === 0} onClick={preparer}>
              Préparer la zone visible (zoom {ZOOM_MIN_ZONE} → {zMax}, {nbZone.toLocaleString('fr-BE')} tuiles)
            </button>
            {trop && <p className="aide alerte-texte">Trop de tuiles d'un coup : zoome sur la zone de l'événement, puis recommence.</p>}
            {resultat && (
              <p className={`aide ${resultat.sansCors ? 'alerte-texte' : ''}`}>
                {resultat.sansCors
                  ? 'Ce fournisseur ne répond pas en CORS : rien n\u2019a pu être mis en réserve.'
                  : `${resultat.interrompu ? 'Interrompu : ' : 'Zone préparée : '}${resultat.faites} tuiles${resultat.echecs ? `, ${resultat.echecs} en échec` : ''}.`}
              </p>
            )}
          </>
        )
      ) : (
        <p className="aide">
          Ce fournisseur n'autorise pas le téléchargement anticipé d'une zone : pour la garder, parcours-la à l'écran,
          aux zooms que tu utiliseras. La carte IGN belge, elle, se prépare d'un clic.
        </p>
      )}
      {etat?.total > 0 && (
        <p className="aide" style={{ marginBottom: 0 }}>
          <button type="button" className="lien" onClick={vider}>Vider la réserve</button>
        </p>
      )}
    </div>
  )
}

/** Le libellé d'un fond, pour une légende. */
export function libelleFond(cle) {
  return FONDS_CARTE.find(([k]) => k === cle)?.[1] ?? cle
}

export function useFondsDisponibles() {
  return useMemo(() => FONDS_CARTE.map(([k, l]) => [k, l]), [])
}
