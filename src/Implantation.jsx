import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Polygon, Polyline, CircleMarker, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser, supprimerOuRefuser } from './ecriture'
import { CATEGORIES_PLAN } from './referentielsProduit'
import { polygoneObjet, surfaceObjet, distancePoints, longueurLigne, jonctionsLigne, nombreModules, milieuLigne, translaterLigne, contientPoint, coinsRectangle, versLocal } from './geometrie'
import { pictoSvg } from './pictos'
import { dxfVersImage, dwgVersDxf, estDxf, estDwg, CONSEIL_DWG } from './dxfFond'
import { FONDS_CARTE, FondCarte, ControlesCarte, useFondCarte } from './carte'
import { estDistributeur, courant, chuteTension, arbreElectrique } from './reseaux'
import { AGENTS_EXTINCTION, libelleAgentExtinction, uniteExtinction } from './libelles'
import { CALQUES, COULEUR_CALQUE, LIBELLE_CALQUE } from './calques'

/**
 * Conception de l'implantation à l'échelle (migration 115, 15/10).
 *
 * On prend un équipement dans le catalogue, on le pose sur la carte, on
 * le tourne, on le redimensionne : il occupe sa vraie emprise au sol.
 * Les objets sont des `elements_plan` comme les autres — la tournée de
 * reconnaissance, la vue secours, la page autorité et le dossier de
 * sécurité les voient sans rien savoir du catalogue.
 *
 * Trois gestes sur la carte, et un seul à la fois (`mode`) :
 *   poser    — un équipement choisi dans le catalogue, au clic ;
 *   mesurer  — deux clics, une distance ;
 *   caler    — deux clics (coin nord-ouest puis sud-est) pour poser un
 *              plan du terrain en transparence sous la carte ; ensuite
 *              (27/10) il se tourne et se met à l'échelle depuis le
 *              panneau Fonds de plan (rotation, largeur, hauteur en m).
 *   tracer   — une ligne de barrières (117) : clic après clic, double-clic
 *              ou « Terminer » pour la fermer ; la base en déduit le
 *              nombre de modules.
 * Un objet sélectionné se déplace à la souris (glisser) ou, au doigt,
 * par « Déplacer » puis un clic. Les pictogrammes de sécurité (117) sont
 * des points dessinés à taille fixe, qui se glissent comme des marqueurs.
 *
 * Depuis le 19/10 (retour de Ren), une barre d'OUTILS explicite, comme
 * dans un logiciel de dessin : la flèche sélectionne (et glisse), la
 * main ne fait que déplacer la carte — au doigt, on ne sélectionne plus
 * un chapiteau en voulant faire défiler —, le lien relie deux objets
 * (`liens_plan`, 126 : « ce bar dépend de ce groupe »), la règle mesure.
 * Choisir un équipement du catalogue reste un outil comme un autre.
 *
 * Un tracé sélectionné (barrières, câble, conduite) montre ses sommets :
 * on les glisse, on en insère un en cliquant le point intermédiaire, on en
 * retire un par double-clic ou depuis le panneau. Avant (Ren, 19/10), il
 * fallait retirer la ligne et la retracer pour déplacer un seul coin.
 *
 * Les calques ne sont qu'un filtre d'affichage : chaque objet porte le
 * sien, et un calque masqué ne se sélectionne pas.
 */

// Les calques vivent dans calques.jsx (21/10) : toutes les cartes les
// partagent, avec le même filtre à cocher. Réexportés pour les bilans.
export { CALQUES, COULEUR_CALQUE, LIBELLE_CALQUE }

// Fonds de carte : partagés par toutes les cartes de l'app (carte.jsx).
export { FONDS_CARTE }

const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')))
// Ordre de dessin : emprises, puis tracés, puis pictogrammes (marqueurs, de toute façon au-dessus).
const rangDessin = (o) => (o.nature === 'picto' ? 2 : o.nature === 'ligne' ? 1 : 0)
const fr = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d).replace('.', ','))

/**
 * (27/10) Un fond de plan qui tourne. Leaflet ne sait poser une image
 * que dans un rectangle nord-sud ; ici l'image est posée par ses trois
 * coins (nord-ouest, nord-est, sud-ouest) : on la place au premier, on
 * la dimensionne sur les deux vecteurs, on la tourne de l'angle du
 * bord nord. Repris du principe de Leaflet.ImageOverlay.Rotated, sans
 * le cisaillement : nos coins forment toujours un rectangle.
 */
const ImageTournee = L.ImageOverlay.extend({
  initialize(url, coins, options) {
    this._url = url
    this._poserCoins(coins)
    L.setOptions(this, options)
  },
  _poserCoins(coins) {
    this._no = L.latLng(coins.no)
    this._ne = L.latLng(coins.ne)
    this._so = L.latLng(coins.so)
    this._bounds = L.latLngBounds([this._no, this._ne, this._so])
  },
  /** Nouveaux coins sans recréer la couche : l'aperçu d'un glisser ou d'un réglage. */
  setCoins(coins) {
    this._poserCoins(coins)
    this._reset()
    return this
  },
  /** Glisser le fond à la souris (ou au doigt) : la carte ne bouge pas, le fond si. */
  setDeplacable(onDeplacer) {
    this._onDeplacer = onDeplacer
    const img = this._image
    if (!img) return this
    img.style.cursor = onDeplacer ? 'move' : ''
    img.style.pointerEvents = onDeplacer ? 'auto' : 'none'
    L.DomEvent.off(img, 'mousedown touchstart', this._debutGlisser, this)
    if (onDeplacer) L.DomEvent.on(img, 'mousedown touchstart', this._debutGlisser, this)
    return this
  },
  onAdd(map) {
    L.ImageOverlay.prototype.onAdd.call(this, map)
    if (this._onDeplacer) this.setDeplacable(this._onDeplacer)
  },
  _debutGlisser(e) {
    if (e.type === 'mousedown' && e.button !== 0) return
    L.DomEvent.stop(e)
    this._map.dragging.disable()
    const p = e.touches ? e.touches[0] : e
    this._depart = this._map.mouseEventToLatLng(p)
    this._courant = this._depart
    L.DomEvent.on(document, 'mousemove touchmove', this._glisser, this)
    L.DomEvent.on(document, 'mouseup touchend touchcancel', this._finGlisser, this)
  },
  _glisser(e) {
    const p = e.touches ? e.touches[0] : e
    if (!p) return
    this._courant = this._map.mouseEventToLatLng(p)
    this._onDeplacer?.(this._courant.lat - this._depart.lat, this._courant.lng - this._depart.lng, false)
  },
  _finGlisser() {
    L.DomEvent.off(document, 'mousemove touchmove', this._glisser, this)
    L.DomEvent.off(document, 'mouseup touchend touchcancel', this._finGlisser, this)
    this._map.dragging.enable()
    this._onDeplacer?.(this._courant.lat - this._depart.lat, this._courant.lng - this._depart.lng, true)
  },
  _poser(point, scale) {
    const img = this._image
    const no = point ?? this._map.latLngToLayerPoint(this._no)
    L.DomUtil.setTransform(img, no, scale)
    img.style.transformOrigin = '0 0'
    img.style.transform += ` rotate(${this._angle()}rad)`
  },
  _angle() {
    const pNo = this._map.latLngToLayerPoint(this._no)
    const pNe = this._map.latLngToLayerPoint(this._ne)
    return Math.atan2(pNe.y - pNo.y, pNe.x - pNo.x)
  },
  _reset() {
    if (!this._image || !this._map) return
    const pNo = this._map.latLngToLayerPoint(this._no)
    const pNe = this._map.latLngToLayerPoint(this._ne)
    const pSo = this._map.latLngToLayerPoint(this._so)
    this._image.style.width = `${pNe.distanceTo(pNo)}px`
    this._image.style.height = `${pSo.distanceTo(pNo)}px`
    this._poser(pNo)
  },
  _animateZoom(e) {
    if (!this._image || !this._map) return
    const no = this._map._latLngToNewLayerPoint(this._no, e.zoom, e.center)
    this._poser(no, this._map.getZoomScale(e.zoom))
  }
})

function FondTourne({ url, coins, opacite, onDeplacer }) {
  const carte = useMap()
  const couche = useRef(null)
  const cle = JSON.stringify(coins)
  // La couche vit tant que l'image est la même ; coins, opacité et
  // glisser se règlent dessus sans la recréer (un glisser en cours ne
  // doit pas perdre ses écouteurs à chaque aperçu).
  useEffect(() => {
    const c = new ImageTournee(url, coins, { opacity: opacite, interactive: true })
    couche.current = c
    c.addTo(carte)
    return () => { c.remove(); couche.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carte, url])
  useEffect(() => { couche.current?.setCoins(coins) }, [cle]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { couche.current?.setOpacity(opacite) }, [opacite])
  useEffect(() => { couche.current?.setDeplacable(onDeplacer ?? null) }, [onDeplacer])
  return null
}

/** Les trois coins décalés d'un même vecteur (lat, lon). */
function coinsDecales(coins, dLat, dLon) {
  const d = ([a, b]) => [a + dLat, b + dLon]
  return { no: d(coins.no), ne: d(coins.ne), so: d(coins.so) }
}

/** Centre, largeur, hauteur (m) et rotation (°, sens horaire) d'un fond, depuis ses trois coins. */
export function mesuresFond(coins) {
  const centre = [(coins.ne[0] + coins.so[0]) / 2, (coins.ne[1] + coins.so[1]) / 2]
  const v = versLocal(coins.ne, coins.no)
  return {
    centre,
    largeur: distancePoints(coins.no, coins.ne),
    hauteur: distancePoints(coins.no, coins.so),
    rotation: (-Math.atan2(v.y, v.x) * 180) / Math.PI
  }
}
/** Les trois coins d'un fond depuis ses mesures (l'inverse de mesuresFond). */
export function coinsFond({ centre, largeur, hauteur, rotation }) {
  const c = coinsRectangle(centre, largeur, hauteur, rotation)
  return { no: c[0], ne: c[1], so: c[3] }
}

export default function Implantation({ evenement, elements, onRecharger, peutCreer, peutModifier, setMessage }) {
  const [catalogue, setCatalogue] = useState([])
  const [fonds, setFonds] = useState([])
  const [urls, setUrls] = useState({})
  const [calquesVisibles, setCalquesVisibles] = useState(() => new Set(CALQUES.map(([k]) => k)))
  const [existantsVisibles, setExistantsVisibles] = useState(true)
  const [fondCarte, setFondCarte] = useFondCarte('implantation', 'satellite')
  const [plein, setPlein] = useState(false)
  const [selection, setSelection] = useState(null)
  // (27/10) Les noms des emprises superposées sous le dernier clic, quand il y en a plusieurs.
  const [pile, setPile] = useState(null)
  const [mode, setMode] = useState(null) // {type:'poser', fiche} | {type:'tracer', fiche, points} | {type:'mesurer', points} | {type:'caler', fond, points} | {type:'deplacer'}
  const [recherche, setRecherche] = useState('')
  // (27/10) Largeur du catalogue, réglable à la souris et mémorisée sur
  // le poste : à 230 px, les libellés longs se coupaient.
  const [largeurCatalogue, setLargeurCatalogue] = useState(() => {
    const v = Number(localStorage.getItem('implantation.catalogue.largeur'))
    return v >= 180 && v <= 600 ? v : 230
  })
  function redimensionnerCatalogue(e) {
    e.preventDefault()
    const x0 = e.clientX
    const l0 = largeurCatalogue
    const bouge = (m) => setLargeurCatalogue(Math.min(600, Math.max(180, l0 + m.clientX - x0)))
    const fin = () => {
      window.removeEventListener('pointermove', bouge)
      window.removeEventListener('pointerup', fin)
      setLargeurCatalogue((l) => { localStorage.setItem('implantation.catalogue.largeur', String(l)); return l })
    }
    window.addEventListener('pointermove', bouge)
    window.addEventListener('pointerup', fin)
  }
  const [filtreCalque, setFiltreCalque] = useState('')
  const [brouillon, setBrouillon] = useState(null) // objet en cours de déplacement (centre provisoire)
  const [apercuFond, setApercuFond] = useState(null) // {id, coins} : un fond qu'on tourne ou redimensionne, avant l'écriture
  // Le double-clic de fin de tracé arrive avant que les gestionnaires de
  // la carte aient vu le dernier clic : on lit le mode courant, pas celui
  // du rendu qui a attaché le gestionnaire.
  const modeCourant = useRef(mode)
  modeCourant.current = mode
  const [echelle, setEchelle] = useState(null) // mètres par centimètre de papier, à l'échelle affichée
  const [liens, setLiens] = useState([]) // liens_plan de l'événement (126)
  const [sommet, setSommet] = useState(null) // index du sommet actif du tracé sélectionné

  const objets = useMemo(() => elements.filter((e) => e.centre_lat != null && e.largeur_m), [elements])
  const existants = useMemo(() => elements.filter((e) => e.centre_lat == null && (e.geometrie ?? []).length), [elements])
  const selectionne = objets.find((o) => o.id === selection) ?? null

  async function chargerCatalogue() {
    const { data, error } = await supabase.from('catalogue_equipements').select('*').order('ordre').order('libelle')
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setCatalogue(data ?? [])
  }

  async function chargerFonds() {
    const { data } = await supabase.from('fonds_plan').select('*').eq('evenement_id', evenement.id).order('created_at')
    const liste = data ?? []
    setFonds(liste)
    // Compartiment privé : une URL signée par fond, valable une heure.
    const entrees = await Promise.all(
      liste.map(async (f) => {
        const { data: s } = await supabase.storage.from('plans').createSignedUrl(f.chemin, 3600)
        return [f.id, s?.signedUrl]
      })
    )
    setUrls(Object.fromEntries(entrees))
  }

  async function chargerLiens() {
    const { data } = await supabase.from('liens_plan').select('*').eq('evenement_id', evenement.id)
    setLiens(data ?? [])
  }

  useEffect(() => {
    chargerCatalogue()
    chargerFonds()
    chargerLiens()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  /* ---- liens entre objets (126) -------------------------------------- */

  async function lier(deId, versId, nature = 'lie') {
    if (!deId || !versId || deId === versId) return
    const { error } = await supabase.from('liens_plan').insert({ evenement_id: evenement.id, de_id: deId, vers_id: versId, nature })
    // 23505 : déjà liés — ce n'est pas une erreur, c'est déjà fait.
    if (error && error.code !== '23505') setMessage({ type: 'erreur', texte: texteErreur(error) })
    chargerLiens()
  }

  async function modifierLien(id, champs) {
    const refus = await modifierOuRefuser('liens_plan', champs, { id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else chargerLiens()
  }

  async function delier(id) {
    const { error } = await supabase.from('liens_plan').delete().eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else chargerLiens()
  }

  // (27/10) Suppr ou Retour arrière retire l'objet sélectionné, hors d'un
  // champ de saisie, après confirmation — le bouton Retirer des propriétés
  // était au bout d'un long panneau.
  useEffect(() => {
    if (!selectionne || !peutModifier) return
    const touche = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const cible = e.target
      if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA' || cible.tagName === 'SELECT' || cible.isContentEditable)) return
      e.preventDefault()
      if (window.confirm(`Retirer « ${selectionne.nom} » du plan ?`)) retirer(selectionne)
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionne?.id, peutModifier])

  // Plein écran : Échap pour en sortir, et la page ne défile plus derrière.
  useEffect(() => {
    if (!plein) return
    const touche = (e) => { if (e.key === 'Escape') setPlein(false) }
    window.addEventListener('keydown', touche)
    document.body.classList.add('impl-plein-corps')
    return () => {
      window.removeEventListener('keydown', touche)
      document.body.classList.remove('impl-plein-corps')
    }
  }, [plein])

  /* ---- écritures ------------------------------------------------- */

  function champsGeometrie(o) {
    if (o.nature === 'ligne') {
      // Le tracé est la vérité ; longueur et nombre de modules en découlent.
      const pts = o.geometrie ?? []
      const total = longueurLigne(pts)
      return { geometrie: pts, forme: 'ligne', longueur_m: Math.max(0.1, Math.round(total * 100) / 100), quantite: o.reseau ? null : nombreModules(total, Number(o.largeur_m)) }
    }
    if (o.nature === 'picto') return { geometrie: [[Number(o.centre_lat), Number(o.centre_lon)]], forme: 'point' }
    const poly = polygoneObjet(o)
    return poly ? { geometrie: poly, forme: 'zone' } : {}
  }

  /** Les champs d'un déplacement vers `latlng`, selon la nature de l'objet. */
  function champsDeplacement(o, latlng) {
    if (o.nature === 'ligne') return { centre_lat: latlng.lat, centre_lon: latlng.lng, geometrie: translaterLigne(o.geometrie ?? [], [latlng.lat, latlng.lng]) }
    return { centre_lat: latlng.lat, centre_lon: latlng.lng }
  }

  async function poser(fiche, latlng) {
    const o = {
      evenement_id: evenement.id,
      code: '',
      nom: fiche.libelle,
      categorie: fiche.categorie,
      est_risque: fiche.est_risque,
      catalogue_id: fiche.id,
      calque: fiche.calque,
      forme_echelle: fiche.forme,
      nature: fiche.nature ?? 'objet',
      picto: fiche.picto ?? null,
      ...champsReseauFiche(fiche),
      centre_lat: latlng.lat,
      centre_lon: latlng.lng,
      largeur_m: fiche.largeur_m,
      longueur_m: fiche.longueur_m,
      hauteur_m: fiche.hauteur_m,
      rotation_deg: 0,
      puissance_kw: fiche.puissance_kw,
      production_kva: fiche.production_kva,
      besoin_eau: fiche.besoin_eau,
      source_eau: fiche.source_eau,
      accueil_public: fiche.accueil_public,
      distance_securite_m: fiche.distance_securite_m,
      description: fiche.description,
      // (126) Un extincteur du catalogue arrive avec son agent et sa
      // capacité ; un point d'eau avec son débit.
      agent_extinction: fiche.agent_extinction ?? null,
      capacite_extinction: fiche.capacite_extinction ?? null,
      debit_l_min: fiche.debit_l_min ?? null,
      confirme: false,
      origine: 'humain'
    }
    const { data, error } = await supabase.from('elements_plan').insert({ ...o, ...champsGeometrie(o) }).select('id').single()
    if (error) {
      setMessage({ type: 'erreur', texte: texteErreur(error) })
      return
    }
    setSelection(data.id)
    onRecharger()
  }

  async function poserLigne(fiche, points, bouts = {}) {
    if (points.length < 2) return
    const milieu = milieuLigne(points)
    const reseau = fiche.reseau ?? null
    const o = {
      reseau,
      de_id: reseau ? bouts.de ?? null : null,
      vers_id: reseau ? bouts.vers ?? null : null,
      tension_v: fiche.tension_v ?? null,
      phases: fiche.phases ?? null,
      calibre_a: fiche.calibre_a ?? null,
      section_mm2: fiche.section_mm2 ?? null,
      type_cable: fiche.type_cable ?? null,
      diametre_mm: fiche.diametre_mm ?? null,
      evenement_id: evenement.id,
      code: '',
      nom: fiche.libelle,
      categorie: fiche.categorie,
      est_risque: fiche.est_risque,
      catalogue_id: fiche.id,
      calque: fiche.calque,
      forme_echelle: fiche.forme,
      nature: 'ligne',
      centre_lat: milieu[0],
      centre_lon: milieu[1],
      largeur_m: fiche.largeur_m, // longueur d'un module
      hauteur_m: fiche.hauteur_m,
      rotation_deg: 0,
      distance_securite_m: fiche.distance_securite_m,
      description: fiche.description,
      fournisseur: null,
      geometrie: points,
      confirme: false,
      origine: 'humain'
    }
    const { data, error } = await supabase.from('elements_plan').insert({ ...o, ...champsGeometrie(o) }).select('id').single()
    if (error) {
      setMessage({ type: 'erreur', texte: texteErreur(error) })
      return
    }
    // Un câble tracé jusqu'à un objet le raccorde ; une conduite aussi.
    if (reseau && bouts.de && bouts.vers && bouts.de !== bouts.vers) {
      const champ = reseau === 'electricite' ? 'alimente_par' : 'raccord_eau'
      const refus = await modifierOuRefuser('elements_plan', { [champ]: bouts.de }, { id: bouts.vers })
      if (refus) setMessage({ type: 'erreur', texte: refus })
    }
    setSelection(data.id)
    onRecharger()
  }

  /** Les objets posés depuis le catalogue portent aussi leurs caractéristiques réseau. */
  function champsReseauFiche(fiche) {
    return {
      tension_v: fiche.tension_v ?? null,
      phases: fiche.phases ?? null,
      calibre_a: fiche.calibre_a ?? null,
      differentiel_ma: fiche.differentiel_ma ?? null,
      ip: fiche.ip ?? null,
      diametre_mm: fiche.diametre_mm ?? null
    }
  }

  /** Changer un bout d'un câble ou d'une conduite raccorde l'objet d'arrivée. */
  async function raccorder(ligne, champs) {
    const de = champs.de_id !== undefined ? champs.de_id : ligne.de_id
    const vers = champs.vers_id !== undefined ? champs.vers_id : ligne.vers_id
    const refus = await modifierOuRefuser('elements_plan', champs, { id: ligne.id })
    if (refus) {
      setMessage({ type: 'erreur', texte: refus })
      return
    }
    if (de && vers && de !== vers) {
      const champ = ligne.reseau === 'electricite' ? 'alimente_par' : 'raccord_eau'
      const r2 = await modifierOuRefuser('elements_plan', { [champ]: de }, { id: vers })
      if (r2) setMessage({ type: 'erreur', texte: r2 })
    }
    onRecharger()
  }

  /** Un tracé retouché : le centre suit, la longueur et le nombre de modules se recalculent. */
  function modifierTrace(o, points) {
    if (points.length < 2) return
    const milieu = milieuLigne(points)
    modifier(o, { geometrie: points, centre_lat: milieu[0], centre_lon: milieu[1] })
  }

  function retirerSommet(o, i) {
    const pts = o.geometrie ?? []
    if (pts.length <= 2) return
    setSommet(null)
    modifierTrace(o, pts.filter((_, k) => k !== i))
  }

  async function modifier(o, champs) {
    const fusion = { ...o, ...champs }
    const refus = await modifierOuRefuser('elements_plan', { ...champs, ...champsGeometrie(fusion) }, { id: o.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else onRecharger()
  }

  async function dupliquer(o) {
    const { id, code, created_at, updated_at, created_by, updated_by, confirme_le, confirme_par, ecart_constate, ...reste } = o
    const centre = { lat: Number(o.centre_lat) + 0.00005, lng: Number(o.centre_lon) + 0.00008 }
    const copie = {
      ...reste,
      code: '',
      ...champsDeplacement(o, centre),
      confirme: false
    }
    const { data, error } = await supabase.from('elements_plan').insert({ ...copie, ...champsGeometrie(copie) }).select('id').single()
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setSelection(data.id)
      onRecharger()
    }
  }

  async function retirer(o) {
    const refus = await supprimerOuRefuser('elements_plan', o.id)
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else {
      setSelection(null)
      onRecharger()
    }
  }

  /* ---- gestes carte ------------------------------------------------ */

  function clicCarte(latlng) {
    if (mode?.type === 'deplacer-fond') return
    if (!mode) {
      setSelection(null)
      return
    }
    // La main ne fait que déplacer la carte ; le lien attend un objet.
    if (mode.type === 'main') return
    if (mode.type === 'lier') {
      setMode({ type: 'lier', de: null })
      return
    }
    if (mode.type === 'poser') {
      poser(mode.fiche, latlng)
      // On garde le mode : poser dix extincteurs ne demande pas dix allers-retours.
      return
    }
    if (mode.type === 'tracer') {
      const points = mode.points ?? []
      const dernier = points[points.length - 1]
      // Le double-clic envoie deux clics au même endroit : un seul point.
      if (dernier && distancePoints(dernier, [latlng.lat, latlng.lng]) < 0.3) return
      setMode({ ...mode, points: [...points, [latlng.lat, latlng.lng]] })
      return
    }
    if (mode.type === 'deplacer' && selectionne) {
      modifier(selectionne, champsDeplacement(selectionne, latlng))
      setMode(null)
      return
    }
    if (mode.type === 'mesurer') {
      const points = [...(mode.points ?? []), [latlng.lat, latlng.lng]].slice(-2)
      setMode({ type: 'mesurer', points })
      return
    }
    if (mode.type === 'caler') {
      const points = [...(mode.points ?? []), [latlng.lat, latlng.lng]]
      if (points.length < 2) {
        setMode({ ...mode, points })
        return
      }
      const [no, se] = points
      const coins = { no: [no[0], no[1]], ne: [no[0], se[1]], so: [se[0], no[1]] }
      modifierFond(mode.fond, { coins })
      setMode(null)
    }
  }

  function finDeplacement(o, latlng) {
    setBrouillon(null)
    modifier(o, champsDeplacement(o, latlng))
  }

  function terminerTrace() {
    const m = modeCourant.current
    if (m?.type !== 'tracer') return
    const points = m.points ?? []
    if (points.length >= 2) poserLigne(m.fiche, points, { de: m.de, vers: m.vers })
    // On garde la barrière (ou le câble) en main : un périmètre se trace en
    // plusieurs lignes, un réseau en plusieurs câbles.
    setMode({ type: 'tracer', fiche: m.fiche, points: [] })
  }

  /** En tracé de câble ou de conduite, cliquer un objet y accroche la ligne. */
  function accrocher(o, latlng) {
    const m = modeCourant.current
    if (m?.type !== 'tracer') return
    // Un câble ou une barrière cliqués pendant un tracé : si un objet est
    // dessous (les câbles partent du centre des objets), c'est lui qu'on
    // vise ; sinon, simple point de passage.
    if (o.nature === 'ligne' || o.nature === 'picto') {
      const p = latlng ? [latlng.lat, latlng.lng] : null
      const dessous = p && m.fiche.reseau ? objets.find((x) => x.nature !== 'ligne' && x.nature !== 'picto' && contientPoint(polygoneObjet(x), p)) : null
      if (dessous) return accrocher(dessous, latlng)
      if (latlng) clicCarte(latlng)
      return
    }
    if (!m.fiche.reseau) {
      if (latlng) clicCarte(latlng)
      return
    }
    const p = [Number(o.centre_lat), Number(o.centre_lon)]
    const points = m.points ?? []
    if (!points.length) {
      setMode({ ...m, points: [p], de: o.id })
      return
    }
    // Le second objet ferme le câble.
    const dernier = points[points.length - 1]
    const pts = dernier && distancePoints(dernier, p) < 0.3 ? points : [...points, p]
    if (pts.length >= 2) poserLigne(m.fiche, pts, { de: m.de, vers: o.id })
    setMode({ type: 'tracer', fiche: m.fiche, points: [] })
  }

  function choisirFiche(f) {
    if (f.nature === 'ligne') setMode({ type: 'tracer', fiche: f, points: [] })
    else setMode({ type: 'poser', fiche: f })
  }

  /** L'objet tel qu'il s'affiche pendant un glisser (centre provisoire). */
  function avecBrouillon(o) {
    if (brouillon?.id !== o.id) return o
    return { ...o, ...champsDeplacement(o, brouillon) }
  }

  /* ---- fonds -------------------------------------------------------- */

  async function ajouterFond(fichier) {
    if (!fichier) return
    // (27/10) Un DXF est converti en PNG ici, et arrive avec ses mesures.
    // Un DWG passe d'abord par le serveur, qui en fait un DXF.
    let contenu = fichier
    let nom = fichier.name
    let mesures = null
    let dessin = fichier
    if (estDwg(fichier)) {
      setMessage({ type: 'info', texte: 'Conversion du DWG sur le serveur…' })
      try {
        dessin = await dwgVersDxf(fichier, evenement.id, supabase.storage.from('plans'))
      } catch (e) {
        setMessage({ type: 'erreur', texte: `${texteErreur(e)} ${CONSEIL_DWG}` })
        return
      }
    }
    if (estDxf(dessin)) {
      try {
        mesures = await dxfVersImage(dessin)
        contenu = mesures.blob
        nom = dessin.name.replace(/\.dxf$/i, '.png')
        window.__banc?.dxf?.(mesures)
      } catch (e) {
        setMessage({ type: 'erreur', texte: texteErreur(e) })
        return
      }
    }
    const chemin = `${evenement.id}/${Date.now()}-${nom.replace(/[^A-Za-z0-9._-]/g, '_')}`
    const { error: e1 } = await supabase.storage.from('plans').upload(chemin, contenu, { upsert: true, contentType: mesures ? 'image/png' : fichier.type || undefined })
    if (e1) {
      setMessage({ type: 'erreur', texte: texteErreur(e1) })
      return
    }
    // Posé autour du Point 0 (ou du premier objet) : une image, à caler
    // ensuite ; un DXF, déjà à l'échelle, à déplacer seulement.
    const c = centreParDefaut(evenement, objets)
    const d = 0.001
    const coins = mesures
      ? coinsFond({ centre: c, largeur: mesures.largeurM, hauteur: mesures.hauteurM, rotation: 0 })
      : { no: [c[0] + d, c[1] - d], ne: [c[0] + d, c[1] + d], so: [c[0] - d, c[1] - d] }
    const { data, error } = await supabase
      .from('fonds_plan')
      .insert({ evenement_id: evenement.id, nom: fichier.name, chemin, coins })
      .select('id')
      .single()
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      await chargerFonds()
      if (mesures) {
        setMessage({ type: 'info', texte: `${estDwg(fichier) ? 'DWG' : 'DXF'} converti : ${mesures.entites} entités, ${fr(mesures.largeurM)} × ${fr(mesures.hauteurM)} m (unité du dessin : ${mesures.unite}). Il est à l\u2019échelle : glisse-le en place, tourne-le si besoin.` })
        setMode({ type: 'deplacer-fond', fond: data.id })
      } else {
        setMode({ type: 'caler', fond: data.id, points: [] })
      }
    }
  }

  async function modifierFond(id, champs) {
    const refus = await modifierOuRefuser('fonds_plan', champs, { id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else chargerFonds()
  }

  // (27/10) Glisser un fond sur la carte : l'aperçu suit la souris, la
  // base n'est écrite qu'au relâchement. Les coins gardent rotation et
  // taille, seul le vecteur change. Une fonction par fond, mémorisée,
  // pour que la couche garde le même écouteur d'un rendu à l'autre.
  const glissersFonds = useRef({})
  function deplacerFond(f) {
    const cle = f.id + '|' + JSON.stringify(f.coins)
    if (glissersFonds.current[f.id]?.cle !== cle) {
      glissersFonds.current[f.id] = {
        cle,
        fn: (dLat, dLon, fin) => {
          const coins = coinsDecales(f.coins, dLat, dLon)
          if (fin) {
            setApercuFond(null)
            if (Math.abs(dLat) + Math.abs(dLon) > 1e-7) modifierFond(f.id, { coins })
          } else setApercuFond({ id: f.id, coins })
        }
      }
    }
    return glissersFonds.current[f.id].fn
  }

  async function retirerFond(f) {
    await supabase.storage.from('plans').remove([f.chemin])
    const { error } = await supabase.from('fonds_plan').delete().eq('id', f.id)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else chargerFonds()
  }

  function imprimer() {
    // Seule la carte, pleine page, avec sa légende ; le reste du poste est
    // masqué par la feuille de style d'impression (body.impression-plan).
    document.body.classList.add('impression-plan')
    window.dispatchEvent(new Event('resize'))
    setTimeout(() => {
      window.print()
      setTimeout(() => {
        document.body.classList.remove('impression-plan')
        window.dispatchEvent(new Event('resize'))
      }, 300)
    }, 400)
  }

  /* ---- rendu -------------------------------------------------------- */

  const fiches = catalogue.filter(
    (f) =>
      (!filtreCalque || f.calque === filtreCalque) &&
      (!recherche || `${f.libelle} ${f.code}`.toLowerCase().includes(recherche.toLowerCase()))
  )
  // (27/10) Dessinées de la plus grande à la plus petite emprise, pour
  // qu'une table dans un chapiteau reste cliquable ; les tracés et les
  // pictogrammes après, comme avant.
  const visibles = objets.filter((o) => calquesVisibles.has(o.calque ?? 'infrastructures'))
    .map((o, i) => [o, i])
    .sort(([a, i], [b, j]) => (rangDessin(a) - rangDessin(b)) || (surfaceObjet(b) - surfaceObjet(a)) || (i - j))
    .map(([o]) => o)
  const mesure = mode?.type === 'mesurer' && mode.points?.length === 2 ? distancePoints(mode.points[0], mode.points[1]) : null
  const trace = mode?.type === 'tracer' && mode.points?.length ? { longueur: longueurLigne(mode.points), n: nombreModules(longueurLigne(mode.points), Number(mode.fiche.largeur_m)) } : null
  // Mètres par pixel à l'écran, pour dessiner les pictogrammes à l'échelle.
  const mParPx = echelle ? echelle / 37.8 : null

  function basculerCalque(k) {
    setCalquesVisibles((s) => {
      const n = new Set(s)
      n.has(k) ? n.delete(k) : n.add(k)
      return n
    })
  }

  return (
    <div className={`implantation mode-${mode?.type ?? 'libre'} ${plein ? 'impl-plein' : ''}`}>
      <div className="impl-barre">
        <div className="ligne-boutons impl-outils" role="toolbar" aria-label="Outils">
          {[
            ['selection', '⬉', 'Sélection — clique un objet pour le régler, glisse-le pour le déplacer', !mode],
            ['main', '✋', 'Main — déplace la carte sans toucher aux objets', mode?.type === 'main'],
            ['lier', '🔗', 'Lier — clique un objet, puis un autre', mode?.type === 'lier'],
            ['mesurer', '📏', 'Mesurer — deux clics, une distance', mode?.type === 'mesurer']
          ].map(([k, icone, titre, actif]) => (
            <button
              key={k}
              className={`impl-outil ${actif ? 'actif' : 'discret'}`}
              title={titre}
              aria-label={titre}
              aria-pressed={actif}
              onClick={() => setMode(k === 'selection' ? null : k === 'mesurer' ? { type: 'mesurer', points: [] } : k === 'lier' ? { type: 'lier', de: null } : { type: 'main' })}
            >
              <span aria-hidden="true">{icone}</span>
              <span className="impl-outil-nom">{{ selection: 'Sélection', main: 'Main', lier: 'Lier', mesurer: 'Mesurer' }[k]}</span>
            </button>
          ))}
          <button className="discret" onClick={imprimer}>Imprimer le plan</button>
          {mode?.type === 'tracer' && (mode.points?.length ?? 0) >= 2 && (
            <button onClick={terminerTrace}>Terminer la ligne</button>
          )}
          {mode?.type === 'deplacer-fond' && <button onClick={() => setMode(null)}>Terminer le déplacement</button>}
          {mode && mode.type !== 'main' && mode.type !== 'lier' && mode.type !== 'mesurer' && mode.type !== 'deplacer-fond' && (
            <button className="discret" onClick={() => setMode(null)}>
              Annuler {mode.type === 'poser' || mode.type === 'tracer' ? `(${mode.fiche.libelle})` : ''}
            </button>
          )}
        </div>
        <div className="impl-calques">
          {CALQUES.map(([k, l, c]) => (
            <label key={k} className={`impl-calque ${calquesVisibles.has(k) ? '' : 'masque'}`} style={{ '--c': c }}>
              <input type="checkbox" checked={calquesVisibles.has(k)} onChange={() => basculerCalque(k)} />
              <span className="impl-pastille" />
              {l}
              <span className="mono">{objets.filter((o) => (o.calque ?? 'infrastructures') === k).length}</span>
            </label>
          ))}
          <label className={`impl-calque ${existantsVisibles ? '' : 'masque'}`} style={{ '--c': '#9aa3ad' }}>
            <input type="checkbox" checked={existantsVisibles} onChange={() => setExistantsVisibles((v) => !v)} />
            <span className="impl-pastille" />
            Éléments du plan (non dimensionnés)
            <span className="mono">{existants.length}</span>
          </label>
        </div>
      </div>

      <p className="aide impl-consigne">
        {mode?.type === 'poser' && (mode.fiche.nature === 'picto'
          ? `Clique sur la carte pour poser le pictogramme « ${mode.fiche.libelle} ». Encore un clic, encore un.`
          : `Clique sur la carte pour poser « ${mode.fiche.libelle} » (${fr(mode.fiche.largeur_m)} × ${fr(mode.fiche.longueur_m)} m). Encore un clic, encore un.`)}
        {mode?.type === 'tracer' && !mode.fiche.reseau && (trace
          ? `${trace.n} × ${mode.fiche.libelle} sur ${fr(trace.longueur, 1)} m. Clique pour prolonger, double-clic sur le dernier point ou « Terminer la ligne » pour poser.`
          : `Clique les points du tracé de « ${mode.fiche.libelle} » (modules de ${fr(mode.fiche.largeur_m)} m).`)}
        {mode?.type === 'tracer' && mode.fiche.reseau && (mode.points?.length
          ? `${mode.fiche.libelle} depuis « ${objets.find((x) => x.id === mode.de)?.nom ?? 'un point'} » : ${fr(trace?.longueur ?? 0, 1)} m. Clique le parcours, puis l'objet d'arrivée pour le raccorder.`
          : `Clique l'objet de départ (${mode.fiche.reseau === 'electricite' ? 'groupe, raccordement, coffret' : 'point d’eau, répartiteur'}) de « ${mode.fiche.libelle} », puis le parcours, puis l'objet d'arrivée.`)}
        {mode?.type === 'mesurer' && (mesure != null ? `Distance : ${fr(mesure, 1)} m. Clique pour mesurer à nouveau.` : 'Clique deux points sur la carte.')}
        {mode?.type === 'caler' && (mode.points?.length ? 'Puis le coin SUD-EST du plan.' : 'Clique le coin NORD-OUEST du plan sur la carte.')}
        {mode?.type === 'deplacer' && 'Clique sur la carte, là où doit aller l’objet sélectionné.'}
        {mode?.type === 'main' && 'Main : la carte se déplace, les objets ne réagissent pas. Reprends la flèche pour sélectionner.'}
        {mode?.type === 'lier' && (mode.de
          ? `Lier « ${objets.find((x) => x.id === mode.de)?.nom ?? '…'} » à… clique le second objet (clic dans le vide : annuler).`
          : 'Lier : clique le premier objet, puis le second. Le lien se règle (nature, note) dans les propriétés de l’un ou l’autre.')}
        {mode?.type === 'deplacer-fond' && 'Déplacer le fond : clique dessus et glisse-le sur la carte, autant de fois qu\u2019il faut ; « Terminer » quand il est en place.'}
        {!mode && 'Flèche : clique un objet pour le régler à droite, glisse-le pour le déplacer. Ou choisis un équipement dans le catalogue et pose-le.'}
      </p>

      <div className="impl-corps" style={{ '--impl-catalogue': `${largeurCatalogue}px` }}>
        <aside className="impl-catalogue">
          <div className="impl-poignee" onPointerDown={redimensionnerCatalogue} title="Tire pour élargir le catalogue" aria-hidden="true" />
          <h3 className="prc-titre">Catalogue</h3>
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Chercher…" aria-label="Chercher dans le catalogue" />
          <select value={filtreCalque} onChange={(e) => setFiltreCalque(e.target.value)} aria-label="Calque">
            <option value="">Tous les calques</option>
            {CALQUES.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <div className="impl-fiches">
            {fiches.map((f) => (
              <button
                key={f.id}
                className={`impl-fiche ${mode?.type === 'poser' && mode.fiche.id === f.id ? 'actif' : ''}`}
                style={{ '--c': COULEUR_CALQUE[f.calque] }}
                disabled={!peutCreer}
                onClick={() => choisirFiche(f)}
                title={f.description ?? ''}
              >
                {f.nature === 'picto' ? (
                  <span className="impl-fiche-picto" dangerouslySetInnerHTML={{ __html: pictoSvg(f.picto, 18) }} />
                ) : (
                  <span className="impl-pastille" />
                )}
                <span className="impl-fiche-nom" title={f.description ? `${f.libelle} — ${f.description}` : f.libelle}>{f.libelle}{f.organisation_id ? ' ·' : ''}</span>
                <span className="mono impl-fiche-dim">
                  {f.reseau ? (f.reseau === 'electricite' ? `câble · ${fr(f.calibre_a, 0)} A` : `conduite · Ø ${fr(f.diametre_mm, 0)}`) : f.agent_extinction ? `${fr(f.capacite_extinction, 0)} ${uniteExtinction(f.agent_extinction)}` : f.nature === 'ligne' ? `ligne · ${fr(f.largeur_m)} m` : f.nature === 'picto' ? 'picto' : `${fr(f.largeur_m)} × ${fr(f.longueur_m)}`}
                </span>
              </button>
            ))}
            {fiches.length === 0 && <p className="aide">Rien dans ce calque.</p>}
          </div>
          {!peutCreer && <p className="aide">Lecture seule : tu n'as pas le droit de créer dans le plan.</p>}
        </aside>

        <div className="carte-conteneur impl-carte">
          <MapContainer center={centreParDefaut(evenement, objets)} zoom={18} maxZoom={22} scrollWheelZoom className={fondCarte === 'aucun' ? 'fond-blanc' : ''}>
            <FondCarte cle={fondCarte} />
            <ControlesCarte fond={fondCarte} onFond={setFondCarte} pleinEcran={plein} onPleinEcran={setPlein} />
            {fonds.filter((f) => f.visible && urls[f.id]).map((f) => (
              <FondTourne key={f.id} url={urls[f.id]} coins={apercuFond?.id === f.id ? apercuFond.coins : f.coins} opacite={Number(f.opacite)}
                onDeplacer={peutModifier && mode?.type === 'deplacer-fond' && mode.fond === f.id ? deplacerFond(f) : null} />
            ))}
            {existantsVisibles && existants.map((e) => <Existant key={e.id} e={e} />)}
            {visibles.map((o) => (
              <Objet
                key={o.id}
                o={avecBrouillon(o)}
                selectionne={o.id === selection}
                mParPx={mParPx}
                peutModifier={peutModifier}
                onSelection={(latlng) => {
                  if (mode?.type === 'tracer') {
                    accrocher(o, latlng)
                    return
                  }
                  if (mode?.type === 'main' || mode?.type === 'poser' || mode?.type === 'caler') return
                  // Un clic sur des emprises superposées : la plus petite
                  // d'abord, puis, clic après clic au même endroit, celles
                  // de dessous. Sans ça, l'objet sous un autre était hors
                  // d'atteinte.
                  let cible = o
                  if (!mode && latlng && o.nature !== 'ligne' && o.nature !== 'picto') {
                    const p = [latlng.lat, latlng.lng]
                    const pile = visibles.filter((x) => x.nature !== 'ligne' && x.nature !== 'picto' && contientPoint(polygoneObjet(avecBrouillon(x)), p))
                      .sort((a, b) => surfaceObjet(a) - surfaceObjet(b))
                    if (pile.length > 1) {
                      const i = pile.findIndex((x) => x.id === selection)
                      cible = pile[i >= 0 ? (i + 1) % pile.length : 0]
                      setPile(pile.map((x) => x.nom))
                    } else setPile(null)
                  } else setPile(null)
                  if (cible.id !== selection) setSommet(null)
                  if (mode?.type === 'lier') {
                    // Premier clic : l'objet de départ ; second : on lie, et
                    // on garde l'outil en main pour enchaîner.
                    if (!mode.de) setMode({ type: 'lier', de: o.id })
                    else {
                      lier(mode.de, o.id)
                      setMode({ type: 'lier', de: null })
                    }
                    setSelection(o.id)
                    return
                  }
                  setSelection(cible.id)
                }}
                onGlisser={(latlng) => setBrouillon({ id: o.id, ...latlng })}
                onDeposer={(latlng) => finDeplacement(o, latlng)}
                sommet={o.id === selection ? sommet : null}
                onSommet={setSommet}
                onGeometrie={(pts) => modifierTrace(o, pts)}
                onRetirerSommet={(i) => retirerSommet(o, i)}
              />
            ))}
            {/* (126) Les liens libres : un trait pointillé de centre à centre. */}
            {liens.map((l) => {
              const a = objets.find((x) => x.id === l.de_id)
              const b = objets.find((x) => x.id === l.vers_id)
              if (!a || !b || !calquesVisibles.has(a.calque ?? 'infrastructures') || !calquesVisibles.has(b.calque ?? 'infrastructures')) return null
              const actif = selection === l.de_id || selection === l.vers_id
              return (
                <Polyline
                  key={l.id}
                  positions={[[Number(a.centre_lat), Number(a.centre_lon)], [Number(b.centre_lat), Number(b.centre_lon)]]}
                  pathOptions={{ color: actif ? '#10151b' : '#5d6874', weight: actif ? 2.5 : 1.5, dashArray: '3 5', opacity: 0.9 }}
                  interactive={false}
                >
                  <Tooltip direction="center" className="etiquette-carte" permanent={actif}>
                    {LIBELLE_LIEN[l.nature] ?? l.nature}{l.note ? ` · ${l.note}` : ''}
                  </Tooltip>
                </Polyline>
              )
            })}
            {mode?.type === 'mesurer' && mode.points?.length > 0 && (
              <>
                {mode.points.map((p, i) => <CircleMarker key={i} center={p} radius={4} pathOptions={{ color: '#10151b', fillColor: '#fff', fillOpacity: 1 }} />)}
                {mode.points.length === 2 && (
                  <Polyline positions={mode.points} pathOptions={{ color: '#10151b', dashArray: '6 4', weight: 2 }}>
                    <Tooltip permanent direction="center" className="etiquette-carte">{fr(mesure, 1)} m</Tooltip>
                  </Polyline>
                )}
              </>
            )}
            {mode?.type === 'caler' && mode.points?.map((p, i) => <CircleMarker key={i} center={p} radius={5} pathOptions={{ color: '#b3311d' }} />)}
            {mode?.type === 'tracer' && mode.points?.length > 0 && (
              <>
                {mode.points.length > 1 && <Polyline positions={mode.points} pathOptions={{ color: COULEUR_CALQUE[mode.fiche.calque] ?? '#10151b', weight: 3, dashArray: '8 5' }} interactive={false} />}
                {!mode.fiche.reseau && jonctionsLigne(mode.points, Number(mode.fiche.largeur_m)).map((p, i) => <CircleMarker key={i} center={p} radius={2.5} interactive={false} pathOptions={{ color: '#10151b', fillColor: '#fff', fillOpacity: 1, weight: 1 }} />)}
                <CircleMarker center={mode.points[mode.points.length - 1]} radius={5} interactive={false} pathOptions={{ color: '#10151b', fillColor: '#fff', fillOpacity: 1 }}>
                  {trace && <Tooltip permanent direction="right" offset={[6, 0]} className="etiquette-carte">{mode.fiche.reseau ? `${fr(trace.longueur, 1)} m` : `${trace.n} × ${fr(trace.longueur, 1)} m`}</Tooltip>}
                </CircleMarker>
              </>
            )}
            <Gestes onClic={clicCarte} onDoubleClic={mode?.type === 'tracer' ? terminerTrace : null} curseur={mode?.type === 'main' ? 'grab' : mode ? 'crosshair' : ''} />
            <Redimension />
            <Echelle onEchelle={setEchelle} />
            <Cadrage objets={objets} point0={evenement.point_0_lat != null && evenement.point_0_lon != null ? [Number(evenement.point_0_lat), Number(evenement.point_0_lon)] : null} />
          </MapContainer>
          <div className="impl-legende">
            <strong>{evenement.nom}</strong>
            {CALQUES.filter(([k]) => calquesVisibles.has(k) && objets.some((o) => (o.calque ?? 'infrastructures') === k)).map(([k, l, c]) => (
              <span key={k} className="impl-legende-item"><span className="impl-pastille" style={{ '--c': c }} />{l}</span>
            ))}
            {objets.some((o) => o.nature === 'picto' && calquesVisibles.has(o.calque ?? 'securite')) && <span className="impl-legende-item">Pictogrammes : signalisation de sécurité</span>}
            {echelle && <span className="mono">1 cm ≈ {fr(echelle, echelle < 10 ? 1 : 0)} m</span>}
            <span className="sourdine">Objets en pointillé : non confirmés sur site</span>
          </div>
        </div>

        <aside className="impl-proprietes">
          {selectionne ? (
            <Proprietes
              o={selectionne}
              objets={objets}
              liens={liens.filter((l) => l.de_id === selectionne.id || l.vers_id === selectionne.id)}
              peutModifier={peutModifier}
              peutCreer={peutCreer}
              onFermer={() => { setSelection(null); setSommet(null) }}
              sommet={sommet}
              onRetirerSommet={(i) => retirerSommet(selectionne, i)}
              onLier={(versId, nature) => lier(selectionne.id, versId, nature)}
              onModifierLien={modifierLien}
              onDelier={delier}
              onModifier={(champs) => modifier(selectionne, champs)}
              onRaccorder={(champs) => raccorder(selectionne, champs)}
              onDeplacer={() => setMode({ type: 'deplacer' })}
              onDupliquer={() => dupliquer(selectionne)}
              onRetirer={() => retirer(selectionne)}
              pile={pile}
            />
          ) : (
            <Fonds
              fonds={fonds}
              peutCreer={peutCreer}
              peutModifier={peutModifier}
              onAjouter={ajouterFond}
              onCaler={(f) => setMode({ type: 'caler', fond: f.id, points: [] })}
              onDeplacerFond={(f) => setMode(f ? { type: 'deplacer-fond', fond: f.id } : null)}
              deplace={mode?.type === 'deplacer-fond' ? mode.fond : null}
              onModifier={(id, champs) => { setApercuFond(null); modifierFond(id, champs) }}
              onApercu={(id, coins) => setApercuFond(coins ? { id, coins } : null)}
              onRetirer={retirerFond}
              urls={urls}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

// (27/10) Le point 0 d'abord : c'est la référence de l'événement, la carte
// s'ouvre dessus, zoomée. Sans point 0, le premier objet ; sans rien, Ferrières.
function centreParDefaut(evenement, objets) {
  if (evenement.point_0_lat != null && evenement.point_0_lon != null) return [Number(evenement.point_0_lat), Number(evenement.point_0_lon)]
  if (objets.length) return [Number(objets[0].centre_lat), Number(objets[0].centre_lon)]
  return [50.38212, 5.61679]
}

/* ------------------------------------------------------------------ */
/* Couches de la carte                                                 */

function Gestes({ onClic, onDoubleClic, curseur }) {
  const carte = useMapEvents({
    click(e) {
      onClic(e.latlng)
    },
    dblclick(e) {
      if (onDoubleClic) {
        L.DomEvent.stop(e)
        onDoubleClic()
      }
    }
  })
  useEffect(() => {
    carte.getContainer().style.cursor = curseur
  }, [carte, curseur])
  // Pendant un tracé, le double-clic termine la ligne : il ne zoome plus.
  useEffect(() => {
    if (onDoubleClic) carte.doubleClickZoom.disable()
    else carte.doubleClickZoom.enable()
  }, [carte, onDoubleClic])
  return null
}

/** La carte suit la taille de son conteneur (plein écran, colonnes qui bougent). */
function Redimension() {
  const carte = useMap()
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(() => carte.invalidateSize())
    obs.observe(carte.getContainer())
    return () => obs.disconnect()
  }, [carte])
  return null
}

function Echelle({ onEchelle }) {
  const carte = useMap()
  useEffect(() => {
    const ctl = L.control.scale({ imperial: false, maxWidth: 160 }).addTo(carte)
    // 1 cm de papier = 37,8 px à 96 dpi ; mètres par pixel au centre de la vue.
    const mesurer = () => {
      const c = carte.getSize()
      const a = carte.containerPointToLatLng([0, c.y / 2])
      const b = carte.containerPointToLatLng([c.x, c.y / 2])
      const mParPx = carte.distance(a, b) / c.x
      onEchelle?.(mParPx * 37.8)
    }
    mesurer()
    carte.on('zoomend moveend resize', mesurer)
    return () => {
      carte.off('zoomend moveend resize', mesurer)
      ctl.remove()
    }
  }, [carte, onEchelle])
  return null
}

// À l'ouverture : centrée et zoomée sur le point 0 quand il existe (27/10 :
// avant, la carte s'ajustait à tous les objets, et un plan étalé s'ouvrait
// vu de très haut) ; sinon ajustée aux objets.
function Cadrage({ objets, point0 }) {
  const carte = useMap()
  const fait = useRef(false)
  useEffect(() => {
    if (fait.current) return
    // Un conteneur sans taille (onglet masqué, feuille de style pas encore
    // là) fait boucler Leaflet dans fitBounds : on attend d'être visible.
    const taille = carte.getSize()
    if (!taille.x || !taille.y) return
    if (point0) {
      carte.setView(point0, 18)
      fait.current = true
      return
    }
    if (!objets.length) return
    const pts = objets.flatMap((o) => polygoneObjet(o) ?? [])
    if (pts.length) {
      carte.fitBounds(pts, { padding: [40, 40], maxZoom: 19 })
      fait.current = true
    }
  }, [carte, objets, point0])
  return null
}

function Existant({ e }) {
  const g = e.geometrie
  const style = { color: '#9aa3ad', weight: 1.5, dashArray: '4 3', fillOpacity: 0.1 }
  if (e.forme === 'zone' && g.length > 2) return <Polygon positions={g} pathOptions={style}><Tooltip>{e.nom}</Tooltip></Polygon>
  if (e.forme === 'ligne' && g.length > 1) return <Polyline positions={g} pathOptions={{ ...style, weight: 2 }}><Tooltip>{e.nom}</Tooltip></Polyline>
  return <CircleMarker center={g[0]} radius={4} pathOptions={{ ...style, fillOpacity: 0.6 }}><Tooltip>{e.nom}</Tooltip></CircleMarker>
}

function Objet({ o, selectionne, mParPx, peutModifier, onSelection, onGlisser, onDeposer, sommet, onSommet, onGeometrie, onRetirerSommet }) {
  const carte = useMap()
  const couleur = COULEUR_CALQUE[o.calque] ?? '#5d6874'
  const glisse = useRef(null)
  const couche = useRef(null)
  const centre = [Number(o.centre_lat), Number(o.centre_lon)]
  const poly = o.nature === 'ligne' ? null : polygoneObjet(o)
  // Pendant qu'on glisse un sommet, le tracé suit la poignée : `apercu`
  // est la version provisoire, écrite à la dépose seulement.
  const [apercu, setApercu] = useState(null)
  useEffect(() => setApercu(null), [o.geometrie])
  const trace = o.nature === 'ligne' ? apercu ?? o.geometrie ?? [] : null
  const editable = !!(trace && selectionne && peutModifier && onGeometrie)

  // Glisser à la souris : on coupe le déplacement de la carte le temps du
  // geste, et on écrit à la dépose seulement.
  function debut(e) {
    if (!peutModifier || !selectionne) return
    const ev = e.originalEvent
    if (ev?.button != null && ev.button !== 0) return
    carte.dragging.disable()
    const origine = e.latlng
    const depart = { lat: centre[0], lng: centre[1] }
    glisse.current = { origine, depart }
    const bouge = (m) => {
      if (!glisse.current) return
      onGlisser({ lat: depart.lat + (m.latlng.lat - origine.lat), lng: depart.lng + (m.latlng.lng - origine.lng) })
    }
    const fin = (m) => {
      carte.off('mousemove', bouge)
      carte.off('mouseup', fin)
      carte.dragging.enable()
      if (!glisse.current) return
      glisse.current = null
      const d = { lat: depart.lat + (m.latlng.lat - origine.lat), lng: depart.lng + (m.latlng.lng - origine.lng) }
      if (Math.abs(d.lat - depart.lat) > 1e-7 || Math.abs(d.lng - depart.lng) > 1e-7) onDeposer(d)
    }
    carte.on('mousemove', bouge)
    carte.on('mouseup', fin)
  }

  // L'étiquette d'un tracé ou d'une emprise est posée par Leaflet à
  // l'ouverture, et n'en bouge plus toute seule : quand l'objet se
  // déplace, se tourne ou se redimensionne, on la ramène au centre.
  // (Et react-leaflet ne réapplique pas `permanent` après coup : la clé
  // du Tooltip change avec la sélection pour le recréer.)
  const cle = JSON.stringify(poly ?? trace)
  useEffect(() => {
    const l = couche.current
    const t = l?.getTooltip?.()
    if (!l || !t || !t.isOpen?.()) return
    t.setLatLng(trace ? milieuLigne(trace) : l.getCenter())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, selectionne])

  const evenements = {
    click(e) {
      // Sinon le clic remonte à la carte, qui désélectionne aussitôt.
      // L'événement LEAFLET, pas le DOM : c'est lui qui porte le drapeau
      // que la carte consulte avant de propager.
      L.DomEvent.stopPropagation(e)
      onSelection(e.latlng)
    },
    mousedown: debut
  }

  if (o.nature === 'picto') {
    // À l'échelle : `largeur_m` est la taille du panneau sur le plan. Borné
    // pour rester cliquable de loin et ne pas couvrir la carte de près.
    const base = mParPx ? Number(o.largeur_m || 3) / mParPx : 30
    const taille = Math.round(Math.max(12, Math.min(120, base)) * (selectionne ? 1.2 : 1))
    const icone = L.divIcon({
      className: `impl-picto ${selectionne ? 'actif' : ''} ${o.confirme ? '' : 'non-confirme'}`,
      html: `<div style="transform:rotate(${Number(o.rotation_deg ?? 0)}deg)">${pictoSvg(o.picto, taille)}</div>`,
      iconSize: [taille, taille],
      iconAnchor: [taille / 2, taille / 2],
      tooltipAnchor: [0, -taille / 2]
    })
    return (
      <Marker
        position={centre}
        icon={icone}
        draggable={!!(peutModifier && selectionne)}
        eventHandlers={{
          click(e) {
            L.DomEvent.stopPropagation(e)
            onSelection(e.latlng)
          },
          dragend(e) {
            const p = e.target.getLatLng()
            onDeposer({ lat: p.lat, lng: p.lng })
          }
        }}
      >
        <Tooltip key={selectionne ? "fixe" : "survol"} direction="top" permanent={selectionne} className="etiquette-carte">
          {o.nom}{o.agent_extinction ? ` · ${libelleAgentExtinction(o.agent_extinction)}${o.capacite_extinction ? ` ${fr(o.capacite_extinction, 0)} ${uniteExtinction(o.agent_extinction)}` : ''}` : ''}
        </Tooltip>
      </Marker>
    )
  }

  // Les poignées d'un tracé sélectionné : un sommet se glisse (double-clic
  // : retiré), un point intermédiaire se clique pour insérer un sommet.
  function poignees() {
    if (!editable) return null
    const base = apercu ?? o.geometrie ?? []
    return (
      <>
        {base.map((p, i) => (
          <Marker
            key={`s${i}-${base.length}`}
            position={p}
            draggable
            zIndexOffset={1000}
            icon={L.divIcon({ className: `impl-sommet ${sommet === i ? 'actif' : ''}`, iconSize: [14, 14], iconAnchor: [7, 7] })}
            eventHandlers={{
              click(e) {
                L.DomEvent.stopPropagation(e)
                onSommet?.(i)
              },
              dblclick(e) {
                L.DomEvent.stopPropagation(e)
                onRetirerSommet?.(i)
              },
              dragstart() {
                onSommet?.(i)
              },
              drag(e) {
                const q = e.target.getLatLng()
                setApercu(base.map((x, k) => (k === i ? [q.lat, q.lng] : x)))
              },
              dragend(e) {
                const q = e.target.getLatLng()
                onGeometrie(base.map((x, k) => (k === i ? [q.lat, q.lng] : x)))
              }
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} className="etiquette-carte">point {i + 1} / {base.length} — glisser ; double-clic : retirer</Tooltip>
          </Marker>
        ))}
        {base.slice(1).map((p, i) => {
          const a = base[i]
          const m = [(a[0] + p[0]) / 2, (a[1] + p[1]) / 2]
          return (
            <Marker
              key={`m${i}-${base.length}`}
              position={m}
              zIndexOffset={900}
              icon={L.divIcon({ className: 'impl-milieu', iconSize: [10, 10], iconAnchor: [5, 5] })}
              eventHandlers={{
                click(e) {
                  L.DomEvent.stopPropagation(e)
                  const pts = [...base.slice(0, i + 1), m, ...base.slice(i + 1)]
                  onSommet?.(i + 1)
                  onGeometrie(pts)
                }
              }}
            >
              <Tooltip direction="top" offset={[0, -6]} className="etiquette-carte">cliquer : ajouter un point</Tooltip>
            </Marker>
          )
        })}
      </>
    )
  }

  if (trace && o.reseau) {
    if (trace.length < 2) return null
    const c = o.reseau === 'electricite' ? COULEUR_CALQUE.energie : COULEUR_CALQUE.eau
    return (
      <>
        <Polyline
          ref={couche}
          positions={trace}
          pathOptions={{ color: selectionne ? '#10151b' : c, weight: selectionne ? 5 : o.reseau === 'electricite' ? 3 : 3.5, dashArray: o.reseau === 'eau' ? '10 6' : o.confirme ? null : '2 6', lineCap: 'round' }}
          eventHandlers={evenements}
        >
          <Tooltip key={selectionne ? 'fixe' : 'survol'} direction="center" permanent={selectionne} className="etiquette-carte">
            {o.nom} · {fr(o.longueur_m, 0)} m
          </Tooltip>
        </Polyline>
        {poignees()}
      </>
    )
  }

  if (trace) {
    if (trace.length < 2) return null
    // (139) Une voie d'accès secours : une chaussée, pas une file de
    // modules. Trait rouge large, pas de jonctions ; le bilan de sécurité
    // vérifie ses 4 m de passage.
    if (o.categorie === 'voie_engins') {
      return (
        <>
          <Polyline
            ref={couche}
            positions={trace}
            pathOptions={{ color: selectionne ? '#10151b' : '#c8102e', weight: selectionne ? 9 : 7, opacity: 0.85, dashArray: o.confirme ? null : '14 10', lineCap: 'round' }}
            eventHandlers={evenements}
          >
            <Tooltip key={selectionne ? 'fixe' : 'survol'} direction="center" permanent={selectionne} className="etiquette-carte">
              {o.nom} · {fr(o.longueur_m, 0)} m{o.largeur_m ? ` · ${fr(o.largeur_m)} m de large` : ''}
            </Tooltip>
          </Polyline>
          {poignees()}
        </>
      )
    }
    const jonctions = jonctionsLigne(trace, Number(o.largeur_m))
    return (
      <>
        <Polyline
          ref={couche}
          positions={trace}
          pathOptions={{ color: selectionne ? '#10151b' : couleur, weight: selectionne ? 5 : 3.5, dashArray: o.confirme ? null : '8 5' }}
          eventHandlers={evenements}
        >
          <Tooltip key={selectionne ? "fixe" : "survol"} direction="center" permanent={selectionne} className="etiquette-carte">
            {o.nom} · {o.quantite ?? jonctions.length} × {fr(o.largeur_m)} m
          </Tooltip>
        </Polyline>
        {jonctions.map((p, i) => (
          <CircleMarker key={i} center={p} radius={2.5} interactive={false} pathOptions={{ color: couleur, fillColor: '#fff', fillOpacity: 1, weight: 1.5 }} />
        ))}
        {poignees()}
      </>
    )
  }

  if (!poly) return null
  return (
    <Polygon
      ref={couche}
      positions={poly}
      pathOptions={{
        color: selectionne ? '#10151b' : couleur,
        weight: selectionne ? 3 : 1.5,
        fillColor: couleur,
        fillOpacity: selectionne ? 0.55 : 0.35,
        dashArray: o.confirme ? null : '5 3'
      }}
      eventHandlers={evenements}
    >
      <Tooltip key={selectionne ? "fixe" : "survol"} direction="center" permanent={selectionne} className="etiquette-carte">
        {o.nom}
      </Tooltip>
    </Polygon>
  )
}

/* ------------------------------------------------------------------ */
/* Panneau de propriétés                                               */

const NATURES_LIEN = [
  ['lie', 'lié à'],
  ['alimente', 'alimente'],
  ['dessert', 'dessert'],
  ['fait_partie', 'fait partie de'],
  ['acces', 'accès vers']
]
const LIBELLE_LIEN = Object.fromEntries(NATURES_LIEN)

function Proprietes({ o, objets, liens = [], peutModifier, peutCreer, onFermer, onLier, onModifierLien, onDelier, onModifier, onRaccorder, onDeplacer, onDupliquer, onRetirer, sommet, onRetirerSommet, pile }) {
  const [f, setF] = useState(() => depuis(o))
  const [nouveauLien, setNouveauLien] = useState({ vers: '', nature: 'lie' })
  useEffect(() => setF(depuis(o)), [o])

  function depuis(x) {
    return {
      nom: x.nom ?? '',
      calque: x.calque ?? 'infrastructures',
      categorie: x.categorie ?? 'autre',
      largeur_m: x.largeur_m ?? '',
      longueur_m: x.longueur_m ?? '',
      hauteur_m: x.hauteur_m ?? '',
      rotation_deg: x.rotation_deg ?? 0,
      puissance_kw: x.puissance_kw ?? 0,
      production_kva: x.production_kva ?? 0,
      alimente_par: x.alimente_par ?? '',
      besoin_eau: !!x.besoin_eau,
      source_eau: !!x.source_eau,
      raccord_eau: x.raccord_eau ?? '',
      accueil_public: !!x.accueil_public,
      distance_securite_m: x.distance_securite_m ?? 0,
      est_risque: !!x.est_risque,
      fournisseur: x.fournisseur ?? '',
      description: x.description ?? '',
      tension_v: x.tension_v ?? '',
      phases: x.phases ?? '',
      calibre_a: x.calibre_a ?? '',
      differentiel_ma: x.differentiel_ma ?? '',
      ip: x.ip ?? '',
      terre: !!x.terre,
      section_mm2: x.section_mm2 ?? '',
      type_cable: x.type_cable ?? '',
      diametre_mm: x.diametre_mm ?? '',
      de_id: x.de_id ?? '',
      vers_id: x.vers_id ?? '',
      agent_extinction: x.agent_extinction ?? '',
      capacite_extinction: x.capacite_extinction ?? '',
      debit_l_min: x.debit_l_min ?? ''
    }
  }
  const extincteur = o.categorie === 'extincteur'

  const lecture = !peutModifier
  const ligne = o.nature === 'ligne' && !o.reseau
  const cable = o.nature === 'ligne' && o.reseau === 'electricite'
  const conduite = o.nature === 'ligne' && o.reseau === 'eau'
  const picto = o.nature === 'picto'
  const solides = objets.filter((x) => x.nature !== 'ligne' && x.nature !== 'picto')
  const generateurs = solides.filter((x) => estDistributeur(x) && x.id !== o.id)
  const sources = solides.filter((x) => x.source_eau && x.id !== o.id)
  const electrique = !ligne && !picto && !conduite && (cable || o.calque === 'energie' || estDistributeur(o) || Number(o.puissance_kw) > 0)
  // Pour un câble : ce qu'il transporte, d'après l'objet d'arrivée.
  const arrivee = cable || conduite ? solides.find((x) => x.id === o.vers_id) : null
  // Ce que le câble transporte : tout ce qui pend sous l'objet d'arrivée (un coffret compte ses départs).
  const kwArrivee = cable && arrivee ? (arbreElectrique(objets).noeuds.get(arrivee.id)?.kwTotal ?? (Number(arrivee.puissance_kw) || 0)) : 0
  const iCable = cable && arrivee ? courant(kwArrivee, Number(o.tension_v) || 400, Number(o.phases) || 3) : 0
  const chute = cable ? chuteTension(Number(o.longueur_m), Number(o.section_mm2), iCable, Number(o.tension_v) || 400, Number(o.phases) || 3) : 0

  function envoyer(champ, valeur) {
    setF((v) => ({ ...v, [champ]: valeur }))
  }
  function valider(champ, transforme = (v) => v) {
    const v = transforme(f[champ])
    if (v !== (o[champ] ?? (typeof v === 'number' ? 0 : '')) && !(v === '' && o[champ] == null)) onModifier({ [champ]: v })
  }
  function tourner(delta) {
    const r = ((Number(f.rotation_deg) + delta) % 360 + 360) % 360
    setF((v) => ({ ...v, rotation_deg: r }))
    onModifier({ rotation_deg: r })
  }

  return (
    <div className="impl-props">
      <div className="impl-props-tete">
        <span className="prc-jeton">{o.code}</span>
        <span className={`prc-jeton ${o.confirme ? '' : 'veille'}`}>{o.confirme ? 'confirmé sur site' : 'non confirmé'}</span>
        <button className="lien impl-props-fermer" onClick={onFermer} aria-label="Désélectionner" title="Désélectionner (retour aux fonds de plan)">✕</button>
      </div>
      {pile && pile.length > 1 && (
        <p className="aide impl-pile" style={{ margin: 0 }}>
          {pile.length} emprises superposées ici ({pile.join(', ')}) : un clic de plus au même endroit passe à celle de dessous.
        </p>
      )}
      {peutModifier && (
        <div className="ligne-boutons impl-actions">
          <button className="discret" onClick={onDeplacer}>Déplacer</button>
          {peutCreer && <button className="discret" onClick={onDupliquer}>Dupliquer</button>}
          <button className="discret danger-texte" onClick={() => { if (window.confirm(`Retirer « ${o.nom} » du plan ?`)) onRetirer() }}>Retirer</button>
          <span className="aide" style={{ margin: 0 }}>ou touche Suppr</span>
        </div>
      )}
      <label>
        Nom
        <input value={f.nom} disabled={lecture} onChange={(e) => envoyer('nom', e.target.value)} onBlur={() => valider('nom')} />
      </label>
      <div className="impl-deux">
        <label>
          Calque
          <select value={f.calque} disabled={lecture} onChange={(e) => { envoyer('calque', e.target.value); onModifier({ calque: e.target.value }) }}>
            {CALQUES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>
          Catégorie du plan
          <select value={f.categorie} disabled={lecture} onChange={(e) => { envoyer('categorie', e.target.value); onModifier({ categorie: e.target.value }) }}>
            {CATEGORIES_PLAN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      {cable || conduite ? (
        <>
          <div className="impl-deux">
            <label>
              De
              <select value={f.de_id} disabled={lecture} onChange={(e) => { envoyer('de_id', e.target.value); onRaccorder({ de_id: e.target.value || null }) }}>
                <option value="">— non raccordé —</option>
                {(cable ? generateurs : sources).map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
              </select>
            </label>
            <label>
              Vers
              <select value={f.vers_id} disabled={lecture} onChange={(e) => { envoyer('vers_id', e.target.value); onRaccorder({ vers_id: e.target.value || null }) }}>
                <option value="">— non raccordé —</option>
                {solides.filter((x) => x.id !== o.de_id).map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
              </select>
            </label>
          </div>
          {cable && (
            <>
              <div className="impl-trois">
                <label>
                  Type
                  <input value={f.type_cable} disabled={lecture} onChange={(e) => envoyer('type_cable', e.target.value)} onBlur={() => valider('type_cable')} placeholder="H07RN-F" />
                </label>
                <label>
                  Section (mm²)
                  <input type="number" step="0.5" min="0.5" value={f.section_mm2} disabled={lecture} onChange={(e) => envoyer('section_mm2', e.target.value)} onBlur={() => valider('section_mm2', num)} />
                </label>
                <label>
                  Admissible (A)
                  <input type="number" step="1" min="1" value={f.calibre_a} disabled={lecture} onChange={(e) => envoyer('calibre_a', e.target.value)} onBlur={() => valider('calibre_a', num)} />
                </label>
              </div>
              <div className="impl-trois">
                <label>
                  Tension
                  <select value={f.tension_v} disabled={lecture} onChange={(e) => { envoyer('tension_v', e.target.value); onModifier({ tension_v: num(e.target.value) }) }}>
                    <option value="">—</option><option value="230">230 V</option><option value="400">400 V</option>
                  </select>
                </label>
                <label>
                  Phases
                  <select value={f.phases} disabled={lecture} onChange={(e) => { envoyer('phases', e.target.value); onModifier({ phases: num(e.target.value) }) }}>
                    <option value="">—</option><option value="1">mono</option><option value="3">tri</option>
                  </select>
                </label>
                <label>
                  Longueur (m)
                  <input value={fr(o.longueur_m, 1)} disabled />
                </label>
              </div>
              <p className="aide">
                {arrivee ? `${arrivee.nom} : ${fr(kwArrivee, 1)} kW → ${fr(iCable, 0)} A, chute de tension ${fr(chute, 1)} % sur ${fr(o.longueur_m, 0)} m` : 'Raccorde l’arrivée pour calculer courant et chute de tension.'}
                {iCable > Number(o.calibre_a) && Number(o.calibre_a) > 0 ? ' — câble sous-dimensionné' : ''}
              </p>
            </>
          )}
          {conduite && (
            <div className="impl-deux">
              <label>
                Diamètre (mm)
                <input type="number" step="1" min="1" value={f.diametre_mm} disabled={lecture} onChange={(e) => envoyer('diametre_mm', e.target.value)} onBlur={() => valider('diametre_mm', num)} />
              </label>
              <label>
                Longueur (m)
                <input value={fr(o.longueur_m, 1)} disabled />
              </label>
            </div>
          )}
        </>
      ) : ligne ? (
        <div className="impl-trois">
          <label>
            Module (m)
            <input type="number" step="0.1" min="0.1" value={f.largeur_m} disabled={lecture} onChange={(e) => envoyer('largeur_m', e.target.value)} onBlur={() => valider('largeur_m', num)} />
          </label>
          <label>
            Longueur (m)
            <input type="number" value={fr(o.longueur_m, 1)} disabled />
          </label>
          <label>
            Barrières
            <input type="number" value={o.quantite ?? 0} disabled />
          </label>
        </div>
      ) : picto ? (
        <div className="impl-deux">
          <label>
            Taille au plan (m)
            <input type="number" step="0.5" min="0.5" value={f.largeur_m} disabled={lecture} onChange={(e) => envoyer('largeur_m', e.target.value)} onBlur={() => valider('largeur_m', num)} />
          </label>
        </div>
      ) : (
        <div className="impl-trois">
          <label>
            {o.forme_echelle === 'cercle' ? 'Diamètre (m)' : 'Largeur (m)'}
            <input type="number" step="0.1" min="0.1" value={f.largeur_m} disabled={lecture} onChange={(e) => envoyer('largeur_m', e.target.value)} onBlur={() => valider('largeur_m', num)} />
          </label>
          {o.forme_echelle !== 'cercle' && (
            <label>
              Longueur (m)
              <input type="number" step="0.1" min="0.1" value={f.longueur_m} disabled={lecture} onChange={(e) => envoyer('longueur_m', e.target.value)} onBlur={() => valider('longueur_m', num)} />
            </label>
          )}
          <label>
            Hauteur (m)
            <input type="number" step="0.1" min="0" value={f.hauteur_m} disabled={lecture} onChange={(e) => envoyer('hauteur_m', e.target.value)} onBlur={() => valider('hauteur_m', num)} />
          </label>
        </div>
      )}
      {extincteur && (
        <>
          <h4 className="prc-titre">Extincteur</h4>
          <div className="impl-deux">
            <label>
              Agent d'extinction
              <select value={f.agent_extinction} disabled={lecture} onChange={(e) => { envoyer('agent_extinction', e.target.value); onModifier({ agent_extinction: e.target.value || null }) }}>
                <option value="">—</option>
                {AGENTS_EXTINCTION.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label>
              Capacité ({uniteExtinction(f.agent_extinction)})
              <input type="number" step="0.5" min="0.5" value={f.capacite_extinction} disabled={lecture} onChange={(e) => envoyer('capacite_extinction', e.target.value)} onBlur={() => valider('capacite_extinction', num)} />
            </label>
          </div>
          <p className="aide">
            Poudre ABC pour les chapiteaux et bars, CO₂ près des coffrets et régies, classe F aux friteuses. Le dossier de sécurité et la
            page autorité comptent les extincteurs par agent.
          </p>
        </>
      )}
      {(ligne || cable || conduite) && (
        <div className="impl-sommets">
          <p className="aide" style={{ margin: 0 }}>
            Tracé : glisse un sommet pour le déplacer, clique un point intermédiaire pour en ajouter un, double-clic sur un sommet pour le
            retirer. La ligne entière se déplace en la glissant (ou « Déplacer »).{ligne ? ' Le dernier module peut être plus court.' : ''}
          </p>
          {sommet != null && !lecture && (o.geometrie ?? []).length > 2 && (
            <button className="discret danger-texte" onClick={() => onRetirerSommet?.(sommet)}>
              Retirer le point {sommet + 1} / {(o.geometrie ?? []).length}
            </button>
          )}
        </div>
      )}
      {picto && <p className="aide">Pictogramme dessiné à l'échelle du plan (entre 12 et 120 px à l’écran). La rotation oriente les flèches.</p>}
      {(o.forme_echelle !== 'cercle' || picto) && !ligne && !cable && !conduite && (
        <div className="impl-rotation">
          <span className="cadran-libelle">Rotation</span>
          <input type="range" min="0" max="359" value={Number(f.rotation_deg)} disabled={lecture} onChange={(e) => envoyer('rotation_deg', Number(e.target.value))} onMouseUp={() => valider('rotation_deg', Number)} onTouchEnd={() => valider('rotation_deg', Number)} onKeyUp={() => valider('rotation_deg', Number)} />
          <span className="mono">{Math.round(Number(f.rotation_deg))}°</span>
          <button className="discret" disabled={lecture} onClick={() => tourner(-15)} aria-label="Tourner de 15° vers la gauche">↺ 15°</button>
          <button className="discret" disabled={lecture} onClick={() => tourner(15)} aria-label="Tourner de 15° vers la droite">↻ 15°</button>
          <button className="discret" disabled={lecture} onClick={() => tourner(90)} aria-label="Tourner de 90°">90°</button>
        </div>
      )}

      {electrique && !cable && (
        <>
          <h4 className="prc-titre">Électricité</h4>
          <div className="impl-trois">
            <label>
              Tension
              <select value={f.tension_v} disabled={lecture} onChange={(e) => { envoyer('tension_v', e.target.value); onModifier({ tension_v: num(e.target.value) }) }}>
                <option value="">—</option><option value="230">230 V</option><option value="400">400 V</option>
              </select>
            </label>
            <label>
              Phases
              <select value={f.phases} disabled={lecture} onChange={(e) => { envoyer('phases', e.target.value); onModifier({ phases: num(e.target.value) }) }}>
                <option value="">—</option><option value="1">mono</option><option value="3">tri</option>
              </select>
            </label>
            <label>
              Protection (A)
              <input type="number" step="1" min="0" value={f.calibre_a} disabled={lecture} onChange={(e) => envoyer('calibre_a', e.target.value)} onBlur={() => valider('calibre_a', num)} />
            </label>
          </div>
          <div className="impl-trois">
            <label>
              Différentiel
              <select value={f.differentiel_ma} disabled={lecture} onChange={(e) => { envoyer('differentiel_ma', e.target.value); onModifier({ differentiel_ma: num(e.target.value) }) }}>
                <option value="">—</option><option value="30">30 mA</option><option value="100">100 mA</option><option value="300">300 mA</option><option value="500">500 mA</option>
              </select>
            </label>
            <label>
              Degré IP
              <input value={f.ip} disabled={lecture} onChange={(e) => envoyer('ip', e.target.value)} onBlur={() => valider('ip')} placeholder="IP44" />
            </label>
            {Number(f.production_kva) > 0 && (
              <label className="case-a-cocher" style={{ alignSelf: 'end' }}>
                <input type="checkbox" checked={f.terre} disabled={lecture} onChange={(e) => { envoyer('terre', e.target.checked); onModifier({ terre: e.target.checked }) }} />
                Terre vérifiée
              </label>
            )}
          </div>
        </>
      )}
      {!ligne && !picto && !cable && !conduite && (<>
      <h4 className="prc-titre">Énergie</h4>
      <div className="impl-deux">
        <label>
          Consomme (kW)
          <input type="number" step="0.1" min="0" value={f.puissance_kw} disabled={lecture} onChange={(e) => envoyer('puissance_kw', e.target.value)} onBlur={() => valider('puissance_kw', (v) => Number(v) || 0)} />
        </label>
        <label>
          Produit (kVA)
          <input type="number" step="1" min="0" value={f.production_kva} disabled={lecture} onChange={(e) => envoyer('production_kva', e.target.value)} onBlur={() => valider('production_kva', (v) => Number(v) || 0)} />
        </label>
      </div>
      {(Number(f.puissance_kw) > 0 || (estDistributeur(o) && !Number(o.production_kva))) && (
        <label>
          Alimenté par
          <select value={f.alimente_par} disabled={lecture} onChange={(e) => { envoyer('alimente_par', e.target.value); onModifier({ alimente_par: e.target.value || null }) }}>
            <option value="">— non raccordé —</option>
            {generateurs.map((g) => <option key={g.id} value={g.id}>{g.nom}{Number(g.production_kva) > 0 ? ` (${fr(g.production_kva, 0)} kVA)` : g.calibre_a ? ` (${fr(g.calibre_a, 0)} A)` : ''}</option>)}
          </select>
        </label>
      )}

      <h4 className="prc-titre">Eau</h4>
      <div className="impl-cases">
        <label className="case-a-cocher"><input type="checkbox" checked={f.besoin_eau} disabled={lecture} onChange={(e) => { envoyer('besoin_eau', e.target.checked); onModifier({ besoin_eau: e.target.checked }) }} />Besoin d'eau</label>
        <label className="case-a-cocher"><input type="checkbox" checked={f.source_eau} disabled={lecture} onChange={(e) => { envoyer('source_eau', e.target.checked); onModifier({ source_eau: e.target.checked }) }} />Point d'eau</label>
      </div>
      {(f.besoin_eau || f.source_eau) && (
        <label>
          {f.source_eau ? 'Débit fourni (l/min)' : 'Débit demandé (l/min)'}
          <input type="number" step="1" min="0" value={f.debit_l_min} disabled={lecture} onChange={(e) => envoyer('debit_l_min', e.target.value)} onBlur={() => valider('debit_l_min', num)} placeholder={f.source_eau ? 'ex. 30 pour un robinet 3/4"' : 'ex. 6 pour un évier'} />
        </label>
      )}
      {f.besoin_eau && (
        <label>
          Raccordé à
          <select value={f.raccord_eau} disabled={lecture} onChange={(e) => { envoyer('raccord_eau', e.target.value); onModifier({ raccord_eau: e.target.value || null }) }}>
            <option value="">— non raccordé —</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
          </select>
        </label>
      )}
      </>)}

      {!cable && !conduite && (<>
      <h4 className="prc-titre">Sécurité</h4>
      <div className="impl-cases">
        <label className="case-a-cocher"><input type="checkbox" checked={f.accueil_public} disabled={lecture} onChange={(e) => { envoyer('accueil_public', e.target.checked); onModifier({ accueil_public: e.target.checked }) }} />Reçoit du public</label>
        <label className="case-a-cocher"><input type="checkbox" checked={f.est_risque} disabled={lecture} onChange={(e) => { envoyer('est_risque', e.target.checked); onModifier({ est_risque: e.target.checked }) }} />Installation à risque</label>
      </div>
      <label>
        Distance de sécurité (m) — vis-à-vis du public et des toiles
        <input type="number" step="0.5" min="0" value={f.distance_securite_m} disabled={lecture} onChange={(e) => envoyer('distance_securite_m', e.target.value)} onBlur={() => valider('distance_securite_m', (v) => Number(v) || 0)} />
      </label>
      </>)}

      {/* (126) Les liens libres : ce que cet objet a à voir avec un autre. */}
      <h4 className="prc-titre">Liens</h4>
      {liens.length === 0 && <p className="aide" style={{ margin: 0 }}>Aucun lien. Outil « Lier » sur la carte, ou ci-dessous.</p>}
      {liens.map((l) => {
        const sortant = l.de_id === o.id
        const autre = objets.find((x) => x.id === (sortant ? l.vers_id : l.de_id))
        return (
          <div key={l.id} className="impl-lien">
            <select value={l.nature} disabled={lecture} onChange={(e) => onModifierLien(l.id, { nature: e.target.value })} aria-label="Nature du lien">
              {NATURES_LIEN.map(([v, lib]) => <option key={v} value={v}>{sortant ? lib : `← ${lib}`}</option>)}
            </select>
            <span className="impl-lien-autre">{autre?.nom ?? '(objet retiré)'}</span>
            <input key={`${l.id}-${l.note ?? ''}`} defaultValue={l.note ?? ''} disabled={lecture} placeholder="note" aria-label="Note du lien" onBlur={(e) => { if ((e.target.value || null) !== (l.note ?? null)) onModifierLien(l.id, { note: e.target.value || null }) }} />
            {!lecture && <button className="lien danger-texte" onClick={() => onDelier(l.id)} aria-label="Retirer le lien">✕</button>}
          </div>
        )
      })}
      {!lecture && (
        <div className="impl-lien impl-lien-nouveau">
          <select value={nouveauLien.nature} onChange={(e) => setNouveauLien({ ...nouveauLien, nature: e.target.value })} aria-label="Nature du nouveau lien">
            {NATURES_LIEN.map(([v, lib]) => <option key={v} value={v}>{lib}</option>)}
          </select>
          <select value={nouveauLien.vers} onChange={(e) => setNouveauLien({ ...nouveauLien, vers: e.target.value })} aria-label="Objet à lier">
            <option value="">— un objet —</option>
            {objets.filter((x) => x.id !== o.id && x.nature !== 'ligne').map((x) => <option key={x.id} value={x.id}>{x.nom}{x.code ? ` (${x.code})` : ''}</option>)}
          </select>
          <button className="discret" disabled={!nouveauLien.vers} onClick={() => { onLier(nouveauLien.vers, nouveauLien.nature); setNouveauLien({ vers: '', nature: 'lie' }) }}>Lier</button>
        </div>
      )}

      <h4 className="prc-titre">Métré</h4>
      <label>
        Fournisseur
        <input value={f.fournisseur} disabled={lecture} onChange={(e) => envoyer('fournisseur', e.target.value)} onBlur={() => valider('fournisseur')} placeholder="Loueur, prestataire…" />
      </label>
      <label>
        Note
        <textarea rows={2} value={f.description} disabled={lecture} onChange={(e) => envoyer('description', e.target.value)} onBlur={() => valider('description')} />
      </label>

    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Fonds de plan                                                       */

/**
 * (27/10) Orienter et mettre à l'échelle un fond : rotation en degrés,
 * largeur et hauteur en mètres, proportions gardées par défaut (et
 * reprises de l'image elle-même sur demande). L'aperçu suit le geste ;
 * la base n'est écrite qu'au relâchement.
 */
function ReglagesFond({ fond, url, onApercu, onModifier }) {
  const base = mesuresFond(fond.coins)
  const [v, setV] = useState(() => ({ largeur: base.largeur.toFixed(1), hauteur: base.hauteur.toFixed(1), rotation: base.rotation.toFixed(1) }))
  const [proportions, setProportions] = useState(true)
  useEffect(() => {
    const m = mesuresFond(fond.coins)
    setV({ largeur: m.largeur.toFixed(1), hauteur: m.hauteur.toFixed(1), rotation: m.rotation.toFixed(1) })
  }, [fond.coins, fond.updated_at])

  const coinsDe = (x) => coinsFond({ centre: base.centre, largeur: Number(x.largeur) || base.largeur, hauteur: Number(x.hauteur) || base.hauteur, rotation: Number(x.rotation) || 0 })
  function changer(champ, valeur) {
    let n = { ...v, [champ]: valeur }
    if (proportions && (champ === 'largeur' || champ === 'hauteur') && Number(valeur) > 0 && base.largeur > 0 && base.hauteur > 0) {
      const ratio = base.hauteur / base.largeur
      n = champ === 'largeur' ? { ...n, hauteur: (Number(valeur) * ratio).toFixed(1) } : { ...n, largeur: (Number(valeur) / ratio).toFixed(1) }
    }
    setV(n)
    onApercu(fond.id, coinsDe(n))
  }
  function ecrire() {
    onModifier(fond.id, { coins: coinsDe(v) })
  }
  function proportionsImage() {
    if (!url) return
    const img = new Image()
    img.onload = () => {
      if (!img.naturalWidth) return
      const n = { ...v, hauteur: ((Number(v.largeur) || base.largeur) * img.naturalHeight / img.naturalWidth).toFixed(1) }
      setV(n)
      onModifier(fond.id, { coins: coinsDe(n) })
    }
    img.src = url
  }

  return (
    <div className="impl-fond-reglages">
      <label>
        Rotation {v.rotation}°
        <input type="range" min="-180" max="180" step="0.5" value={v.rotation} onChange={(e) => changer('rotation', e.target.value)} onMouseUp={ecrire} onTouchEnd={ecrire} onKeyUp={(e) => ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && ecrire()} />
      </label>
      <div className="impl-fond-dims">
        <label>Largeur (m)<input type="number" step="0.1" min="0.1" value={v.largeur} onChange={(e) => changer('largeur', e.target.value)} onBlur={ecrire} /></label>
        <label>Hauteur (m)<input type="number" step="0.1" min="0.1" value={v.hauteur} onChange={(e) => changer('hauteur', e.target.value)} onBlur={ecrire} /></label>
      </div>
      <div className="ligne-boutons">
        <label className="case-a-cocher" style={{ margin: 0 }}>
          <input type="checkbox" checked={proportions} onChange={(e) => setProportions(e.target.checked)} /> garder les proportions
        </label>
        <button className="lien" onClick={proportionsImage} disabled={!url} title="Reprend le rapport largeur / hauteur de l'image envoyée">proportions de l'image</button>
      </div>
    </div>
  )
}

function Fonds({ fonds, peutCreer, peutModifier, onAjouter, onCaler, onDeplacerFond, deplace, onModifier, onApercu, onRetirer, urls = {} }) {
  return (
    <div className="impl-fonds">
      <h3 className="prc-titre">Fonds de plan</h3>
      <p className="aide">
        Une image du terrain (plan du propriétaire, relevé, croquis) posée en transparence sous
        la carte. Après l'envoi, clique son coin nord-ouest puis son coin sud-est sur la carte ;
        puis « Déplacer » pour la glisser à la souris, et tourne-la et règle sa taille en mètres ci-dessous.
        Un DXF ou un DWG (export de tout logiciel de dessin) arrive déjà à l'échelle : il n'y a qu'à le placer.
        Le DWG passe par le serveur, compte quelques secondes.
      </p>
      {fonds.map((f) => (
        <div key={f.id} className="impl-fond">
          <div className="impl-fond-tete">
            <strong>{f.nom}</strong>
            {peutModifier && (
              <label className="case-a-cocher">
                <input type="checkbox" checked={f.visible} onChange={(e) => onModifier(f.id, { visible: e.target.checked })} />
                visible
              </label>
            )}
          </div>
          {peutModifier && (
            <>
              <label>
                Opacité
                <input type="range" min="0.1" max="1" step="0.1" defaultValue={f.opacite} onMouseUp={(e) => onModifier(f.id, { opacite: Number(e.target.value) })} onTouchEnd={(e) => onModifier(f.id, { opacite: Number(e.target.value) })} />
              </label>
              <ReglagesFond fond={f} url={urls[f.id]} onApercu={onApercu} onModifier={onModifier} />
              <div className="ligne-boutons">
                <button className={deplace === f.id ? '' : 'discret'} onClick={() => onDeplacerFond(deplace === f.id ? null : f)}>{deplace === f.id ? 'Terminer le déplacement' : 'Déplacer'}</button>
                <button className="discret" onClick={() => onCaler(f)}>Recaler</button>
                <button className="discret danger-texte" onClick={() => { if (window.confirm(`Retirer le fond « ${f.nom} » ?`)) onRetirer(f) }}>Retirer</button>
              </div>
            </>
          )}
        </div>
      ))}
      {peutCreer && (
        <label className="impl-envoi">
          Ajouter un fond (PNG, JPG, DXF, DWG)
          <input type="file" accept="image/png,image/jpeg,image/webp,.dxf,.dwg,application/dxf,image/vnd.dxf" onChange={(e) => { onAjouter(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      )}
      {!fonds.length && !peutCreer && <p className="aide">Aucun fond.</p>}
    </div>
  )
}
