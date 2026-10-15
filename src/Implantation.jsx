import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, ImageOverlay, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser, supprimerOuRefuser } from './ecriture'
import { CATEGORIES_PLAN } from './referentielsProduit'
import { polygoneObjet, distancePoints } from './geometrie'

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
 *              plan du terrain en transparence sous la carte.
 * Un objet sélectionné se déplace à la souris (glisser) ou, au doigt,
 * par « Déplacer » puis un clic.
 *
 * Les calques ne sont qu'un filtre d'affichage : chaque objet porte le
 * sien, et un calque masqué ne se sélectionne pas.
 */

export const CALQUES = [
  ['infrastructures', 'Infrastructures', '#7a4fb0'],
  ['restauration', 'Restauration', '#c25a12'],
  ['energie', 'Énergie', '#8a6212'],
  ['eau', 'Eau', '#1f6ba8'],
  ['sanitaires', 'Sanitaires', '#17796f'],
  ['logistique', 'Logistique', '#5d6874'],
  ['securite', 'Sécurité', '#a8324a'],
  ['circulation', 'Circulation', '#3f7a2e']
]
export const COULEUR_CALQUE = Object.fromEntries(CALQUES.map(([k, , c]) => [k, c]))
export const LIBELLE_CALQUE = Object.fromEntries(CALQUES.map(([k, l]) => [k, l]))

const SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')))
const fr = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d).replace('.', ','))

export default function Implantation({ evenement, elements, onRecharger, peutCreer, peutModifier, setMessage }) {
  const [catalogue, setCatalogue] = useState([])
  const [fonds, setFonds] = useState([])
  const [urls, setUrls] = useState({})
  const [calquesVisibles, setCalquesVisibles] = useState(() => new Set(CALQUES.map(([k]) => k)))
  const [existantsVisibles, setExistantsVisibles] = useState(true)
  const [fondCarte, setFondCarte] = useState('satellite')
  const [selection, setSelection] = useState(null)
  const [mode, setMode] = useState(null) // {type:'poser', fiche} | {type:'mesurer', points} | {type:'caler', fond, points} | {type:'deplacer'}
  const [recherche, setRecherche] = useState('')
  const [filtreCalque, setFiltreCalque] = useState('')
  const [brouillon, setBrouillon] = useState(null) // objet en cours de déplacement (centre provisoire)
  const [echelle, setEchelle] = useState(null) // mètres par centimètre de papier, à l'échelle affichée

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

  useEffect(() => {
    chargerCatalogue()
    chargerFonds()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  /* ---- écritures ------------------------------------------------- */

  function champsGeometrie(o) {
    const poly = polygoneObjet(o)
    return poly ? { geometrie: poly, forme: 'zone' } : {}
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

  async function modifier(o, champs) {
    const fusion = { ...o, ...champs }
    const refus = await modifierOuRefuser('elements_plan', { ...champs, ...champsGeometrie(fusion) }, { id: o.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else onRecharger()
  }

  async function dupliquer(o) {
    const { id, code, created_at, updated_at, created_by, updated_by, confirme_le, confirme_par, ecart_constate, ...reste } = o
    const copie = {
      ...reste,
      code: '',
      centre_lat: Number(o.centre_lat) + 0.00005,
      centre_lon: Number(o.centre_lon) + 0.00008,
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
    if (!mode) {
      setSelection(null)
      return
    }
    if (mode.type === 'poser') {
      poser(mode.fiche, latlng)
      // On garde le mode : poser dix barrières ne demande pas dix allers-retours.
      return
    }
    if (mode.type === 'deplacer' && selectionne) {
      modifier(selectionne, { centre_lat: latlng.lat, centre_lon: latlng.lng })
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
    modifier(o, { centre_lat: latlng.lat, centre_lon: latlng.lng })
  }

  /* ---- fonds -------------------------------------------------------- */

  async function ajouterFond(fichier) {
    if (!fichier) return
    const chemin = `${evenement.id}/${Date.now()}-${fichier.name.replace(/[^A-Za-z0-9._-]/g, '_')}`
    const { error: e1 } = await supabase.storage.from('plans').upload(chemin, fichier, { upsert: true })
    if (e1) {
      setMessage({ type: 'erreur', texte: texteErreur(e1) })
      return
    }
    // Posé d'abord autour du Point 0 (ou du premier objet), à caler ensuite.
    const c = centreParDefaut(evenement, objets)
    const d = 0.001
    const { data, error } = await supabase
      .from('fonds_plan')
      .insert({ evenement_id: evenement.id, nom: fichier.name, chemin, coins: { no: [c[0] + d, c[1] - d], ne: [c[0] + d, c[1] + d], so: [c[0] - d, c[1] - d] } })
      .select('id')
      .single()
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      await chargerFonds()
      setMode({ type: 'caler', fond: data.id, points: [] })
    }
  }

  async function modifierFond(id, champs) {
    const refus = await modifierOuRefuser('fonds_plan', champs, { id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else chargerFonds()
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
  const visibles = objets.filter((o) => calquesVisibles.has(o.calque ?? 'infrastructures'))
  const mesure = mode?.type === 'mesurer' && mode.points?.length === 2 ? distancePoints(mode.points[0], mode.points[1]) : null

  function basculerCalque(k) {
    setCalquesVisibles((s) => {
      const n = new Set(s)
      n.has(k) ? n.delete(k) : n.add(k)
      return n
    })
  }

  return (
    <div className={`implantation mode-${mode?.type ?? 'libre'}`}>
      <div className="impl-barre">
        <div className="ligne-boutons">
          <button className={fondCarte === 'satellite' ? '' : 'discret'} onClick={() => setFondCarte('satellite')}>Satellite</button>
          <button className={fondCarte === 'plan' ? '' : 'discret'} onClick={() => setFondCarte('plan')}>Plan</button>
          <button className={mode?.type === 'mesurer' ? '' : 'discret'} onClick={() => setMode(mode?.type === 'mesurer' ? null : { type: 'mesurer', points: [] })}>
            Mesurer
          </button>
          <button className="discret" onClick={imprimer}>Imprimer le plan</button>
          {mode && (
            <button className="discret" onClick={() => setMode(null)}>
              Annuler {mode.type === 'poser' ? `(${mode.fiche.libelle})` : ''}
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
        {mode?.type === 'poser' && `Clique sur la carte pour poser « ${mode.fiche.libelle} » (${fr(mode.fiche.largeur_m)} × ${fr(mode.fiche.longueur_m)} m). Encore un clic, encore un.`}
        {mode?.type === 'mesurer' && (mesure != null ? `Distance : ${fr(mesure, 1)} m. Clique pour mesurer à nouveau.` : 'Clique deux points sur la carte.')}
        {mode?.type === 'caler' && (mode.points?.length ? 'Puis le coin SUD-EST du plan.' : 'Clique le coin NORD-OUEST du plan sur la carte.')}
        {mode?.type === 'deplacer' && 'Clique sur la carte, là où doit aller l’objet sélectionné.'}
        {!mode && 'Choisis un équipement dans le catalogue et pose-le. Sélectionne un objet pour le régler ; glisse-le pour le déplacer.'}
      </p>

      <div className="impl-corps">
        <aside className="impl-catalogue">
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
                onClick={() => setMode({ type: 'poser', fiche: f })}
                title={f.description ?? ''}
              >
                <span className="impl-pastille" />
                <span className="impl-fiche-nom">{f.libelle}{f.organisation_id ? ' ·' : ''}</span>
                <span className="mono impl-fiche-dim">{fr(f.largeur_m)} × {fr(f.longueur_m)}</span>
              </button>
            ))}
            {fiches.length === 0 && <p className="aide">Rien dans ce calque.</p>}
          </div>
          {!peutCreer && <p className="aide">Lecture seule : tu n'as pas le droit de créer dans le plan.</p>}
        </aside>

        <div className="carte-conteneur impl-carte">
          <MapContainer center={centreParDefaut(evenement, objets)} zoom={18} maxZoom={22} scrollWheelZoom>
            {fondCarte === 'satellite' ? (
              <TileLayer attribution="&copy; Esri" url={SATELLITE} maxNativeZoom={19} maxZoom={22} />
            ) : (
              <TileLayer attribution="&copy; OpenStreetMap" url={OSM} maxNativeZoom={19} maxZoom={22} />
            )}
            {fonds.filter((f) => f.visible && urls[f.id]).map((f) => (
              <ImageOverlay key={f.id + f.updated_at} url={urls[f.id]} bounds={[[f.coins.so[0], f.coins.no[1]], [f.coins.no[0], f.coins.ne[1]]]} opacity={Number(f.opacite)} />
            ))}
            {existantsVisibles && existants.map((e) => <Existant key={e.id} e={e} />)}
            {visibles.map((o) => (
              <Objet
                key={o.id}
                o={brouillon?.id === o.id ? { ...o, centre_lat: brouillon.lat, centre_lon: brouillon.lng } : o}
                selectionne={o.id === selection}
                peutModifier={peutModifier}
                onSelection={() => {
                  if (mode?.type === 'poser' || mode?.type === 'caler') return
                  setSelection(o.id)
                }}
                onGlisser={(latlng) => setBrouillon({ id: o.id, ...latlng })}
                onDeposer={(latlng) => finDeplacement(o, latlng)}
              />
            ))}
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
            <Gestes onClic={clicCarte} curseur={mode ? 'crosshair' : ''} />
            <Echelle onEchelle={setEchelle} />
            <Cadrage objets={objets} />
          </MapContainer>
          <div className="impl-legende">
            <strong>{evenement.nom}</strong>
            {CALQUES.filter(([k]) => calquesVisibles.has(k) && objets.some((o) => (o.calque ?? 'infrastructures') === k)).map(([k, l, c]) => (
              <span key={k} className="impl-legende-item"><span className="impl-pastille" style={{ '--c': c }} />{l}</span>
            ))}
            {echelle && <span className="mono">1 cm ≈ {fr(echelle, echelle < 10 ? 1 : 0)} m</span>}
            <span className="sourdine">Objets en pointillé : non confirmés sur site</span>
          </div>
        </div>

        <aside className="impl-proprietes">
          {selectionne ? (
            <Proprietes
              o={selectionne}
              objets={objets}
              peutModifier={peutModifier}
              peutCreer={peutCreer}
              onModifier={(champs) => modifier(selectionne, champs)}
              onDeplacer={() => setMode({ type: 'deplacer' })}
              onDupliquer={() => dupliquer(selectionne)}
              onRetirer={() => retirer(selectionne)}
            />
          ) : (
            <Fonds
              fonds={fonds}
              peutCreer={peutCreer}
              peutModifier={peutModifier}
              onAjouter={ajouterFond}
              onCaler={(f) => setMode({ type: 'caler', fond: f.id, points: [] })}
              onModifier={modifierFond}
              onRetirer={retirerFond}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

function centreParDefaut(evenement, objets) {
  if (objets.length) return [Number(objets[0].centre_lat), Number(objets[0].centre_lon)]
  if (evenement.point_0_lat) return [evenement.point_0_lat, evenement.point_0_lon]
  return [50.38212, 5.61679]
}

/* ------------------------------------------------------------------ */
/* Couches de la carte                                                 */

function Gestes({ onClic, curseur }) {
  const carte = useMapEvents({
    click(e) {
      onClic(e.latlng)
    }
  })
  useEffect(() => {
    carte.getContainer().style.cursor = curseur
  }, [carte, curseur])
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

function Cadrage({ objets }) {
  const carte = useMap()
  const fait = useRef(false)
  useEffect(() => {
    if (fait.current || !objets.length) return
    const pts = objets.flatMap((o) => polygoneObjet(o) ?? [])
    if (pts.length) {
      carte.fitBounds(pts, { padding: [40, 40], maxZoom: 19 })
      fait.current = true
    }
  }, [carte, objets])
  return null
}

function Existant({ e }) {
  const g = e.geometrie
  const style = { color: '#9aa3ad', weight: 1.5, dashArray: '4 3', fillOpacity: 0.1 }
  if (e.forme === 'zone' && g.length > 2) return <Polygon positions={g} pathOptions={style}><Tooltip>{e.nom}</Tooltip></Polygon>
  if (e.forme === 'ligne' && g.length > 1) return <Polyline positions={g} pathOptions={{ ...style, weight: 2 }}><Tooltip>{e.nom}</Tooltip></Polyline>
  return <CircleMarker center={g[0]} radius={4} pathOptions={{ ...style, fillOpacity: 0.6 }}><Tooltip>{e.nom}</Tooltip></CircleMarker>
}

function Objet({ o, selectionne, peutModifier, onSelection, onGlisser, onDeposer }) {
  const carte = useMap()
  const poly = polygoneObjet(o)
  const couleur = COULEUR_CALQUE[o.calque] ?? '#5d6874'
  const glisse = useRef(null)

  // Glisser à la souris : on coupe le déplacement de la carte le temps du
  // geste, et on écrit à la dépose seulement.
  function debut(e) {
    if (!peutModifier || !selectionne) return
    const ev = e.originalEvent
    if (ev?.button != null && ev.button !== 0) return
    carte.dragging.disable()
    const origine = e.latlng
    const centre = { lat: Number(o.centre_lat), lng: Number(o.centre_lon) }
    glisse.current = { origine, centre }
    const bouge = (m) => {
      if (!glisse.current) return
      onGlisser({ lat: centre.lat + (m.latlng.lat - origine.lat), lng: centre.lng + (m.latlng.lng - origine.lng) })
    }
    const fin = (m) => {
      carte.off('mousemove', bouge)
      carte.off('mouseup', fin)
      carte.dragging.enable()
      if (!glisse.current) return
      glisse.current = null
      const d = { lat: centre.lat + (m.latlng.lat - origine.lat), lng: centre.lng + (m.latlng.lng - origine.lng) }
      if (Math.abs(d.lat - centre.lat) > 1e-7 || Math.abs(d.lng - centre.lng) > 1e-7) onDeposer(d)
    }
    carte.on('mousemove', bouge)
    carte.on('mouseup', fin)
  }

  if (!poly) return null
  return (
    <Polygon
      positions={poly}
      pathOptions={{
        color: selectionne ? '#10151b' : couleur,
        weight: selectionne ? 3 : 1.5,
        fillColor: couleur,
        fillOpacity: selectionne ? 0.55 : 0.35,
        dashArray: o.confirme ? null : '5 3'
      }}
      eventHandlers={{
        click(e) {
          // Sinon le clic remonte à la carte, qui désélectionne aussitôt.
          // L'événement LEAFLET, pas le DOM : c'est lui qui porte le drapeau
          // que la carte consulte avant de propager.
          L.DomEvent.stopPropagation(e)
          onSelection()
        },
        mousedown: debut
      }}
    >
      <Tooltip direction="center" permanent={selectionne} className="etiquette-carte">
        {o.nom}
      </Tooltip>
    </Polygon>
  )
}

/* ------------------------------------------------------------------ */
/* Panneau de propriétés                                               */

function Proprietes({ o, objets, peutModifier, peutCreer, onModifier, onDeplacer, onDupliquer, onRetirer }) {
  const [f, setF] = useState(() => depuis(o))
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
      description: x.description ?? ''
    }
  }

  const lecture = !peutModifier
  const generateurs = objets.filter((x) => Number(x.production_kva) > 0 && x.id !== o.id)
  const sources = objets.filter((x) => x.source_eau && x.id !== o.id)

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
      </div>
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
      {o.forme_echelle !== 'cercle' && (
        <div className="impl-rotation">
          <span className="cadran-libelle">Rotation</span>
          <input type="range" min="0" max="359" value={Number(f.rotation_deg)} disabled={lecture} onChange={(e) => envoyer('rotation_deg', Number(e.target.value))} onMouseUp={() => valider('rotation_deg', Number)} onTouchEnd={() => valider('rotation_deg', Number)} onKeyUp={() => valider('rotation_deg', Number)} />
          <span className="mono">{Math.round(Number(f.rotation_deg))}°</span>
          <button className="discret" disabled={lecture} onClick={() => tourner(-15)} aria-label="Tourner de 15° vers la gauche">↺ 15°</button>
          <button className="discret" disabled={lecture} onClick={() => tourner(15)} aria-label="Tourner de 15° vers la droite">↻ 15°</button>
          <button className="discret" disabled={lecture} onClick={() => tourner(90)} aria-label="Tourner de 90°">90°</button>
        </div>
      )}

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
      {Number(f.puissance_kw) > 0 && (
        <label>
          Alimenté par
          <select value={f.alimente_par} disabled={lecture} onChange={(e) => { envoyer('alimente_par', e.target.value); onModifier({ alimente_par: e.target.value || null }) }}>
            <option value="">— non raccordé —</option>
            {generateurs.map((g) => <option key={g.id} value={g.id}>{g.nom} ({fr(g.production_kva, 0)} kVA)</option>)}
          </select>
        </label>
      )}

      <h4 className="prc-titre">Eau</h4>
      <div className="impl-cases">
        <label className="case-a-cocher"><input type="checkbox" checked={f.besoin_eau} disabled={lecture} onChange={(e) => { envoyer('besoin_eau', e.target.checked); onModifier({ besoin_eau: e.target.checked }) }} />Besoin d'eau</label>
        <label className="case-a-cocher"><input type="checkbox" checked={f.source_eau} disabled={lecture} onChange={(e) => { envoyer('source_eau', e.target.checked); onModifier({ source_eau: e.target.checked }) }} />Point d'eau</label>
      </div>
      {f.besoin_eau && (
        <label>
          Raccordé à
          <select value={f.raccord_eau} disabled={lecture} onChange={(e) => { envoyer('raccord_eau', e.target.value); onModifier({ raccord_eau: e.target.value || null }) }}>
            <option value="">— non raccordé —</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
          </select>
        </label>
      )}

      <h4 className="prc-titre">Sécurité</h4>
      <div className="impl-cases">
        <label className="case-a-cocher"><input type="checkbox" checked={f.accueil_public} disabled={lecture} onChange={(e) => { envoyer('accueil_public', e.target.checked); onModifier({ accueil_public: e.target.checked }) }} />Reçoit du public</label>
        <label className="case-a-cocher"><input type="checkbox" checked={f.est_risque} disabled={lecture} onChange={(e) => { envoyer('est_risque', e.target.checked); onModifier({ est_risque: e.target.checked }) }} />Installation à risque</label>
      </div>
      <label>
        Distance de sécurité (m) — vis-à-vis du public et des toiles
        <input type="number" step="0.5" min="0" value={f.distance_securite_m} disabled={lecture} onChange={(e) => envoyer('distance_securite_m', e.target.value)} onBlur={() => valider('distance_securite_m', (v) => Number(v) || 0)} />
      </label>

      <h4 className="prc-titre">Métré</h4>
      <label>
        Fournisseur
        <input value={f.fournisseur} disabled={lecture} onChange={(e) => envoyer('fournisseur', e.target.value)} onBlur={() => valider('fournisseur')} placeholder="Loueur, prestataire…" />
      </label>
      <label>
        Note
        <textarea rows={2} value={f.description} disabled={lecture} onChange={(e) => envoyer('description', e.target.value)} onBlur={() => valider('description')} />
      </label>

      {peutModifier && (
        <div className="ligne-boutons impl-actions">
          <button className="discret" onClick={onDeplacer}>Déplacer</button>
          {peutCreer && <button className="discret" onClick={onDupliquer}>Dupliquer</button>}
          <button className="discret danger-texte" onClick={() => { if (window.confirm(`Retirer « ${o.nom} » du plan ?`)) onRetirer() }}>Retirer</button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Fonds de plan                                                       */

function Fonds({ fonds, peutCreer, peutModifier, onAjouter, onCaler, onModifier, onRetirer }) {
  return (
    <div className="impl-fonds">
      <h3 className="prc-titre">Fonds de plan</h3>
      <p className="aide">
        Une image du terrain (plan du propriétaire, relevé, croquis) posée en transparence sous
        la carte. Après l'envoi, clique son coin nord-ouest puis son coin sud-est sur la carte.
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
              <div className="ligne-boutons">
                <button className="discret" onClick={() => onCaler(f)}>Recaler</button>
                <button className="discret danger-texte" onClick={() => { if (window.confirm(`Retirer le fond « ${f.nom} » ?`)) onRetirer(f) }}>Retirer</button>
              </div>
            </>
          )}
        </div>
      ))}
      {peutCreer && (
        <label className="impl-envoi">
          Ajouter un fond (PNG, JPG)
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { onAjouter(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      )}
      {!fonds.length && !peutCreer && <p className="aide">Aucun fond.</p>}
    </div>
  )
}
