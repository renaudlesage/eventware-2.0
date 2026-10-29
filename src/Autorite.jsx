import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import { pictoInterieur } from './pictos'
import { COULEUR_CALQUE, calqueDe, useCalques, FiltreCalques } from './calques'
import { FondCarte, ControlesCarte, useFondCarte } from './carte'
import { CouchesPlan } from './couchesPlan'
import Unifilaire from './Unifilaire'
import { estSource } from './reseaux'
import { libelleAgentExtinction, uniteExtinction } from './libelles'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { appliquerIconeEvenement } from './logoPwa'
import MoniteurIrm from './MoniteurIrm'

const REFUS = {
  P0002: "Ce lien ne correspond à aucun accès.",
  P0005: "Cet accès a été révoqué par l'organisateur.",
  P0006: 'Cet accès a expiré.'
}

const RAFRAICHISSEMENT_S = 20

/**
 * Page autorité — refonte du 24/09 (migration 109).
 *
 * Consultée sans compte, sur jeton, par le bourgmestre, le Dir-PC-Ops,
 * la zone de secours ou la police. Modèle : le PC-Ops de BFMF 2026, qui
 * était un outil de travail, pas un tableau de compteurs. Trois onglets,
 * dans l'ordre où on les ouvre en arrivant :
 *
 *   SITUATION     — ce qui se passe : interventions une par une (où,
 *                   quoi, depuis quand, avec quel moyen), recherches,
 *                   public sur le parcours, météo.
 *   INTERVENTION  — comment y aller : accès secours, PRV, voies,
 *                   tronçons et distances de brancardage, ressources en
 *                   eau, DEA, installations à risque.
 *   DOSSIER       — les références : documents, annuaire, plan radio,
 *                   commune et zones.
 *
 * Ce qui sort dépend du niveau du lien, décidé par le coordinateur :
 * « situation » n'a aucun texte libre, « opérationnel » a les
 * descriptions. Aucun des deux n'a le nom ou le contact de l'appelant,
 * le nom d'une personne recherchée ni celui d'un intervenant : ce tri
 * est fait par la fonction serveur, pas ici — la page ne reçoit jamais
 * ce qu'elle ne doit pas montrer.
 *
 * Les blocs statiques (accès, ressources, dossier) restent affichés si
 * la liaison tombe : la dernière réponse reçue est gardée, et le bandeau
 * dit depuis quand elle date.
 */

const NATURE = {
  malaise: 'Malaise',
  blessure: 'Blessure',
  danger: 'Danger',
  materiel: 'Matériel',
  egare: 'Personne égarée',
  autre: 'Autre'
}

const MODULE = {
  securite: 'Sécurité',
  logistique: 'Logistique',
  rh: 'Bénévoles',
  parcours: 'Parcours',
  plan: 'Implantation',
  sos: 'Secours'
}

// L'état de prise en charge, ramené à trois marches communes aux
// signalements et aux missions. Chaque marche porte son mot : la couleur
// seule ne distingue pas ok de chaud.
const PRISE = {
  recu: 'attente',
  a_traiter: 'attente',
  pris_en_charge: 'engage',
  attribuee: 'engage',
  en_cours: 'sur_place'
}
const LIBELLE_PRISE = {
  attente: 'En attente',
  engage: 'Moyen engagé',
  sur_place: 'Sur place'
}

const ELEMENT = {
  point_rencontre_secours: 'Point de rencontre secours',
  prv: 'PRV',
  voie_engins: 'Voie engins',
  pma: 'PMA',
  poste_secours: 'Poste de secours',
  aire_helico: 'Aire hélicoptère',
  point_transfert: 'Point de transfert',
  noria: 'Noria',
  point_rassemblement: 'Point de rassemblement',
  sortie_secours: 'Sortie de secours',
  itineraire_evacuation: 'Itinéraire d’évacuation',
  dea: 'DEA',
  point_eau: 'Point d’eau',
  coupure_gaz: 'Coupure gaz',
  coffret_electrique: 'Coffret électrique',
  foodtruck: 'Foodtruck',
  groupe_electrogene: 'Groupe électrogène',
  stockage_gaz: 'Stockage gaz',
  bar_installation: 'Bar',
  feu: 'Feu'
}

const LIEU = {
  pc_ops: 'PC',
  poste_secours: 'Poste de secours',
  entree: 'Entrée',
  etape: 'Étape',
  point_kilometrique: 'Borne',
  scene: 'Scène',
  parking: 'Parking'
}

const VOIE = {
  chemin_forestier: 'chemin forestier carrossable',
  chemin_non_carrossable: 'chemin non carrossable',
  voirie: 'voirie'
}

const MOYEN = {
  extincteur: 'Extincteurs',
  secouriste: 'Secouristes',
  trousse: 'Trousses de secours',
  dea: 'DEA',
  brancard: 'Brancards',
  ambulance: 'Ambulances'
}

const hhmm = (d) =>
  d ? new Date(d).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '—'

/**
 * (123) La phrase du serveur (projeter_sur_trace) : même forme que
 * libelleSurTrace de geometrie.js, sur l'objet JSON renvoyé.
 */
function libelleSurTrace(p) {
  if (!p || p.km == null) return ''
  const km = `km ${Number(p.km).toFixed(1)}`
  const ecart = Math.round(Number(p.ecart_m ?? 0))
  if (ecart > 300) return `hors trace · ${ecart >= 1000 ? `${(ecart / 1000).toFixed(1)} km` : `${ecart} m`} du ${km}`
  const nom = (l) => l.code || l.nom
  const entre = p.avant && p.apres
    ? `entre ${nom(p.avant)} et ${nom(p.apres)}`
    : p.avant
      ? `après ${nom(p.avant)}`
      : p.apres
        ? `avant ${nom(p.apres)}`
        : null
  return [p.plusieurs ? `${p.trace} ${km}` : km, entre, ecart > 20 ? `${ecart} m de la trace` : null]
    .filter(Boolean)
    .join(' · ')
}

/**
 * (123) La carte de l'autorité était un SVG, pas une carte à tuiles :
 * la page est consultée sur un téléphone de bourgmestre ou dans un
 * véhicule de commandement, souvent sans réseau stable, et un dessin
 * vectoriel de quelques kilo-octets, livré avec la situation, s'affiche
 * toujours — comme la cartographie de BFMF 2026.
 *
 * (147, retour de Ren du 29/10) Le Dir-PC-Ops veut la même carte que
 * les autres écrans : un fond au choix (satellite, plan, IGN…), le
 * plein écran, et le plan d'implantation dessiné par les mêmes couches
 * que la carte du plan. C'est ce que `CarteTuiles` fait ; le dessin
 * vectoriel reste à un clic (« Dessin hors ligne ») pour la voiture
 * sans réseau, et le choix est mémorisé sur l'appareil.
 *
 * Les deux lisent la même situation : la trace, les repères, les accès
 * secours, le plan, et dessus les interventions et recherches en cours.
 */
const centrePlan = (e) => (e.centre?.lat != null ? [e.centre.lat, e.centre.lon] : e.points?.[0])

/**
 * Les objets du plan tels que la fonction serveur les rend (`points`,
 * `centre`), remis dans la forme des elements_plan que couchesPlan.jsx
 * et le schéma unifilaire lisent (`geometrie`, `centre_lat`…).
 */
function objetsPlan(plan) {
  return (plan ?? []).map((e) => ({
    ...e,
    geometrie: e.points ?? [],
    centre_lat: e.centre?.lat ?? null,
    centre_lon: e.centre?.lon ?? null
  }))
}

const PRISE_COULEUR = { attente: 'var(--etat-chaud)', engage: 'var(--etat-veille)', sur_place: 'var(--etat-ok)' }

/** Tout ce qui a une position dans la situation : l'emprise de la carte. */
function pointsSituation({ traces, reperes, acces, interventions, recherches, lignes, zones, pictos }) {
  return [
    ...traces.flatMap((t) => t.points),
    ...reperes.map((r) => [r.position.lat, r.position.lon]),
    ...interventions.map((i) => [i.position.lat, i.position.lon]),
    ...acces.map((e) => [e.position.lat, e.position.lon]),
    ...recherches.map((r) => [r.position.lat, r.position.lon]),
    ...lignes.flatMap((e) => e.points),
    ...zones.flatMap((e) => e.points),
    ...pictos.map(centrePlan)
  ].filter((p) => p && p[0] != null && p[1] != null)
}

function Carte({ s }) {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem('autorite.carte') === 'dessin' ? 'dessin' : 'tuiles' } catch { return 'tuiles' }
  })
  useEffect(() => {
    try { localStorage.setItem('autorite.carte', mode) } catch {}
  }, [mode])

  const traces = (s.traces ?? []).filter((t) => (t.points ?? []).length > 1)
  const reperes = (s.reperes ?? []).filter((r) => r.position)
  const interventions = (s.interventions ?? []).filter((i) => i.position)
  const recherches = (s.recherches ?? []).filter((r) => r.position)
  // Le plan d'implantation (127) : un site sans parcours — un festival —
  // n'a ni tracé ni lieu, mais un plan avec ses accès, ses extincteurs,
  // ses hydrants. Sans lui, la carte restait vide sur BFMF 2026.
  // Les mêmes calques, couleurs et cases à cocher que la conception (21/10).
  const [calques, basculerCalque] = useCalques()
  const plan = s.plan ?? []
  // (29/10, retour de Ren) Un accès secours posé en pictogramme sur le
  // plan (sortie, sens d'évacuation, PRV, accès engins) est déjà dessiné
  // par le plan, avec son picto : on ne lui ajoute ni marqueur ni
  // libellé permanent, qui doublaient tout. Son nom reste au survol.
  const codesPictos = new Set(plan.filter((e) => e.nature === 'picto' && e.picto).map((e) => e.code))
  const acces = (s.acces_secours ?? []).filter((e) => e.position && !codesPictos.has(e.code))
  const planVisible = plan.filter((e) => calques.has(calqueDe(e)))
  const lignes = planVisible.filter((e) => e.nature === 'ligne' && (e.points ?? []).length > 1)
  const zones = planVisible.filter((e) => e.nature === 'objet' && (e.points ?? []).length > 2)
  const pictos = planVisible.filter((e) => e.nature === 'picto' && e.picto && centrePlan(e))
  const couches = { traces, reperes, acces, interventions, recherches, lignes, zones, pictos }
  const pts = pointsSituation(couches)

  return (
    <section className="bloc">
      <div className="carte-autorite-tete">
        <h2>Carte</h2>
        <div className="onglets onglets-carte-autorite" role="tablist" aria-label="Mode de la carte">
          {[['tuiles', 'Carte'], ['dessin', 'Dessin hors ligne']].map(([k, lib]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} className={`module ${mode === k ? 'actif' : ''}`} onClick={() => setMode(k)}>
              {lib}
            </button>
          ))}
        </div>
      </div>
      {pts.length === 0 ? (
        <p className="vide">
          Rien à dessiner : ni tracé, ni lieu positionné, ni objet sur le plan
          d'implantation. La carte apparaît dès que le PC en pose.
        </p>
      ) : (
        <>
          {plan.length > 0 && <FiltreCalques objets={plan} visibles={calques} onBasculer={basculerCalque} />}
          {mode === 'tuiles'
            ? <CarteTuiles couches={couches} planVisible={planVisible} pts={pts} />
            : <CarteSvg couches={couches} pts={pts} />}
          <ul className="legende-carte">
            <li><span className="puce-carte puce-chaud" /> en attente</li>
            <li><span className="puce-carte puce-veille" /> moyen engagé</li>
            <li><span className="puce-carte puce-ok" /> sur place</li>
            <li><span className="puce-carte puce-repere" /> étape, PC, poste</li>
            <li><span className="carre-carte" /> accès secours</li>
            {plan.length > 0 && <li><span className="trait-carte" /> plan d'implantation dans la couleur de son calque ; pointillé : non confirmé sur site</li>}
          </ul>
          <p className="aide">
            {mode === 'tuiles'
              ? 'Le fond de carte et le plein écran se choisissent en haut à droite de la carte ; « Dessin hors ligne » montre le même contenu sans fond, lisible sans réseau.'
              : 'Dessin livré avec la situation, lisible sans réseau.'}{' '}
            Le « Localiser » de chaque intervention ouvre la position dans l'application de cartes du téléphone.
          </p>
        </>
      )}
    </section>
  )
}

/** Cadre la carte sur l'emprise de la situation, une fois : ensuite l'autorité navigue. */
function CadrerAutorite({ pts }) {
  const carte = useMap()
  useEffect(() => {
    if (pts.length === 1) carte.setView(pts[0], 17)
    else if (pts.length) carte.fitBounds(pts, { padding: [24, 24], maxZoom: 18 })
  }, [carte, pts.length])
  return null
}

/**
 * (147) La carte à tuiles : fond choisi (mémorisé sous `autorite`),
 * plein écran, plan d'implantation par couchesPlan.jsx, et par-dessus
 * ce que le dessin vectoriel montrait déjà.
 */
function CarteTuiles({ couches, planVisible, pts }) {
  const [fond, setFond] = useFondCarte('autorite', 'plan')
  const objets = useMemo(() => objetsPlan(planVisible), [planVisible])
  const { traces, reperes, acces, interventions, recherches } = couches
  return (
    <div className="carte-conteneur carte-autorite">
      <MapContainer center={pts[0]} zoom={16} scrollWheelZoom>
        <FondCarte cle={fond} />
        <ControlesCarte fond={fond} onFond={setFond} />
        <CouchesPlan objets={objets} />
        {traces.map((t, k) => (
          <Polyline key={'t' + k} positions={t.points} pathOptions={{ color: t.couleur || '#1f6ba8', weight: 4, opacity: 0.8, lineJoin: 'round' }}>
            <Tooltip direction="center" className="etiquette-carte">{t.nom}{t.distance_km ? ` · ${Number(t.distance_km).toFixed(1)} km` : ''}</Tooltip>
          </Polyline>
        ))}
        {acces.map((e, k) => (
          <CircleMarker key={'a' + k} center={[e.position.lat, e.position.lon]} radius={6}
            pathOptions={{ color: '#fff', weight: 1.5, fillColor: e.confirme === false ? '#9aa3ad' : '#1f6f4f', fillOpacity: 1 }}>
            <Tooltip direction="right" permanent className="etiquette-carte etiquette-acces">{e.nom || e.code}</Tooltip>
          </CircleMarker>
        ))}
        {reperes.map((p, k) => (
          <CircleMarker key={'r' + k} center={[p.position.lat, p.position.lon]} radius={5}
            pathOptions={{ color: '#10151b', weight: 2, fillColor: '#fff', fillOpacity: 1 }}>
            <Tooltip direction="top" permanent className="etiquette-carte etiquette-repere">{p.nom || p.code}</Tooltip>
          </CircleMarker>
        ))}
        {recherches.map((rc, k) => (
          <CircleMarker key={'q' + k} center={[rc.position.lat, rc.position.lon]} radius={12}
            pathOptions={{ color: '#a86a00', weight: 3, dashArray: '4 3', fill: false }}>
            <Tooltip direction="bottom" permanent className="etiquette-carte">recherche</Tooltip>
          </CircleMarker>
        ))}
        {interventions.map((i, k) => {
          const etat = PRISE[i.statut] ?? 'attente'
          const grave = i.gravite === 'critique' || i.gravite === 'grave' || i.priorite === 'P1'
          return (
            <CircleMarker key={'i' + k} center={[i.position.lat, i.position.lon]} radius={grave ? 10 : 7}
              className={`intervention-carte etat-${etat}`}
              pathOptions={{ color: '#fff', weight: 2, fillColor: { attente: '#b3311d', engage: '#a86a00', sur_place: '#1f6f4f' }[etat], fillOpacity: 1 }}>
              <Tooltip direction="right" permanent className="etiquette-carte etiquette-intervention">{i.reference}</Tooltip>
            </CircleMarker>
          )
        })}
        <CadrerAutorite pts={pts} />
      </MapContainer>
    </div>
  )
}

function CarteSvg({ couches, pts }) {
  const { traces, reperes, acces, interventions, recherches, lignes, zones, pictos } = couches

  const lats = pts.map((p) => Number(p[0]))
  const lons = pts.map((p) => Number(p[1]))
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 111320
  let minX = Math.min(...lons) * kx
  let maxX = Math.max(...lons) * kx
  let minY = Math.min(...lats) * ky
  let maxY = Math.max(...lats) * ky
  // Un seul point, ou une emprise minuscule : on garantit 150 m de côté,
  // sinon le dessin devient une loupe sur un extincteur.
  const MIN_M = 150
  if (maxX - minX < MIN_M) {
    const c = (minX + maxX) / 2
    minX = c - MIN_M / 2
    maxX = c + MIN_M / 2
  }
  if (maxY - minY < MIN_M) {
    const c = (minY + maxY) / 2
    minY = c - MIN_M / 2
    maxY = c + MIN_M / 2
  }
  const marge = Math.max(60, (maxX - minX) * 0.06, (maxY - minY) * 0.06)
  const L = maxX - minX + 2 * marge
  const H = maxY - minY + 2 * marge
  // Le nord en haut : y grandit vers le sud dans le SVG.
  const X = (lon) => Number(lon) * kx - minX + marge
  const Y = (lat) => maxY - Number(lat) * ky + marge
  // Les tailles sont en mètres-terrain : on les ramène en pixels par
  // l'échelle du dessin (largeur rendue ≈ 100 % du bloc).
  const echelle = Math.max(L, H) / 720
  const r = (px) => px * echelle
  const police = r(12)

  return (
      <svg className="carte-svg" viewBox={`0 0 ${L} ${H}`} role="img" aria-label="Carte du site, du parcours et des interventions">
        <rect x="0" y="0" width={L} height={H} fill="var(--surface)" />
        {zones.map((e, k) => {
          const couleur = COULEUR_CALQUE[calqueDe(e)] ?? '#5d6874'
          const c = centrePlan(e)
          return (
            <g key={'z' + k} className="carte-zone">
              <polygon
                points={e.points.map((p) => `${X(p[1])},${Y(p[0])}`).join(' ')}
                fill={couleur}
                fillOpacity={0.35}
                stroke={couleur}
                strokeWidth={r(1.5)}
                strokeDasharray={e.confirme ? undefined : `${r(5)} ${r(3)}`}
                strokeLinejoin="round"
              />
              {(e.accueil_public || e.est_risque) && c && (
                <text x={X(c[1])} y={Y(c[0]) + r(4)} fontSize={r(10)} textAnchor="middle" fill="var(--sourdine)">
                  {e.code}
                </text>
              )}
            </g>
          )
        })}
        {lignes.map((e, k) => (
          <polyline
            key={'l' + k}
            className="carte-ligne"
            points={e.points.map((p) => `${X(p[1])},${Y(p[0])}`).join(' ')}
            fill="none"
            stroke={COULEUR_CALQUE[calqueDe(e)] ?? '#5d6874'}
            strokeWidth={r(3)}
            strokeDasharray={e.categorie === 'point_eau' ? `${r(10)} ${r(6)}` : e.confirme ? undefined : `${r(8)} ${r(5)}`}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.9"
          />
        ))}
        {traces.map((t, k) => (
          <polyline
            key={k}
            points={t.points.map((p) => `${X(p[1])},${Y(p[0])}`).join(' ')}
            fill="none"
            stroke={t.couleur || 'var(--etat-info)'}
            strokeWidth={r(4)}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.8"
          />
        ))}
        {acces.map((e, k) => (
          <g key={'a' + k}>
            <rect x={X(e.position.lon) - r(5)} y={Y(e.position.lat) - r(5)} width={r(10)} height={r(10)}
              fill={e.confirme === false ? 'var(--sourdine)' : 'var(--etat-ok)'} stroke="var(--surface)" strokeWidth={r(1.5)} />
            <text x={X(e.position.lon) + r(8)} y={Y(e.position.lat) + r(4)} fontSize={police} fill="var(--sourdine)">
              {e.nom || e.code}
            </text>
          </g>
        ))}
        {reperes.map((p, k) => (
          <g key={'r' + k}>
            <circle cx={X(p.position.lon)} cy={Y(p.position.lat)} r={r(5)} fill="var(--surface)" stroke="var(--encre)" strokeWidth={r(2)} />
            <text x={X(p.position.lon)} y={Y(p.position.lat) - r(8)} fontSize={police} textAnchor="middle" fill="var(--encre)" fontFamily="var(--mono)">
              {p.nom || p.code}
            </text>
          </g>
        ))}
        {pictos.map((e, k) => {
          const c = centrePlan(e)
          const t = r(18)
          return (
            <g key={'p' + k} className="carte-picto" transform={`rotate(${Number(e.rotation_deg ?? 0)} ${X(c[1])} ${Y(c[0])})`}
              opacity={e.confirme === false ? 0.55 : 1}>
              <title>
                {e.nom}
                {e.agent_extinction ? ` — ${libelleAgentExtinction(e.agent_extinction)}${e.capacite_extinction ? ` ${Number(e.capacite_extinction)} ${uniteExtinction(e.agent_extinction)}` : ''}` : ''}
              </title>
              <svg x={X(c[1]) - t / 2} y={Y(c[0]) - t / 2} width={t} height={t} viewBox="0 0 100 100"
                dangerouslySetInnerHTML={{ __html: pictoInterieur(e.picto) }} />
            </g>
          )
        })}
        {recherches.map((rc, k) => (
          <g key={'q' + k}>
            <circle cx={X(rc.position.lon)} cy={Y(rc.position.lat)} r={r(12)} fill="none" stroke="var(--etat-veille)" strokeWidth={r(3)} strokeDasharray={`${r(4)} ${r(3)}`} />
            <text x={X(rc.position.lon)} y={Y(rc.position.lat) + r(26)} fontSize={police} textAnchor="middle" fill="var(--etat-veille)">
              recherche
            </text>
          </g>
        ))}
        {interventions.map((i, k) => {
          const etat = PRISE[i.statut] ?? 'attente'
          const grave = i.gravite === 'critique' || i.gravite === 'grave' || i.priorite === 'P1'
          return (
            <g key={'i' + k}>
              <circle cx={X(i.position.lon)} cy={Y(i.position.lat)} r={r(grave ? 10 : 7)}
                fill={PRISE_COULEUR[etat]} stroke="var(--surface)" strokeWidth={r(2)} />
              <text x={X(i.position.lon) + r(12)} y={Y(i.position.lat) + r(4)} fontSize={police} fill="var(--encre)" fontWeight="600">
                {i.reference}
              </text>
            </g>
          )
        })}
      </svg>
  )
}

function depuis(d, maintenant) {
  if (!d) return null
  const min = Math.max(0, Math.round((maintenant - new Date(d)) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} h ${String(min % 60).padStart(2, '0')}`
}

function Gps({ position, libelle = 'Localiser' }) {
  if (!position?.lat) return null
  const q = `${position.lat},${position.lon}`
  return (
    <a
      className="lien-externe"
      href={`https://www.google.com/maps?q=${q}`}
      target="_blank"
      rel="noreferrer"
      title={q}
    >
      {libelle} <span className="mono">{Number(position.lat).toFixed(5)}, {Number(position.lon).toFixed(5)}</span>
    </a>
  )
}

export default function Autorite({ jeton }) {
  const [s, setS] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [liaison, setLiaison] = useState(true)
  const [maj, setMaj] = useState(null)
  const [maintenant, setMaintenant] = useState(() => new Date())
  const [vue, setVue] = useState('situation')

  async function charger() {
    const { data, error } = await supabase.rpc('situation_autorite', { p_jeton: jeton })
    if (error) {
      // Un refus (révoqué, expiré, inconnu) remplace la page ; une panne
      // de réseau, non : on garde la dernière situation, marquée.
      if (REFUS[error.code]) setErreur(REFUS[error.code])
      else if (!s) setErreur(texteErreur(error))
      setLiaison(false)
    } else {
      setS(data)
      setMaj(new Date())
      setErreur(null)
      setLiaison(true)
    }
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, RAFRAICHISSEMENT_S * 1000)
    const h = setInterval(() => setMaintenant(new Date()), 30000)
    return () => {
      clearInterval(t)
      clearInterval(h)
    }
  }, [jeton])

  useEffect(() => {
    if (s) appliquerIconeEvenement(s.evenement?.nom, s.evenement?.logo_url)
  }, [s?.evenement?.logo_url])

  if (erreur && !s)
    return (
      <div className="autorite">
        <div className="message erreur">{erreur}</div>
        <p className="aide">Rapproche-toi de l'organisateur pour obtenir un lien valable.</p>
      </div>
    )

  if (!s) return <div className="autorite"><p className="vide">Chargement…</p></div>

  const ev = s.evenement ?? {}
  const a = s.activite ?? {}
  const interventions = s.interventions ?? []
  const recherches = s.recherches ?? []
  const operationnel = s.destinataire?.niveau === 'operationnel'

  // Le niveau général, comme au PC-Ops 2026 : ce qu'on lit en premier.
  const graves = interventions.filter(
    (i) => i.gravite === 'critique' || i.gravite === 'grave' || i.priorite === 'P1'
  ).length
  const urgenceAlerte = (s.alertes ?? []).some((al) => al.niveau === 'urgence' || al.niveau === 'evacuation')
  // (125) Une étape à 90 % de sa capacité met le niveau en vigilance :
  // c'est le seuil de BFMF, et c'est là qu'on freine les départs.
  const etapeChargee = (s.reperes ?? []).some(
    (r) => r.type === 'etape' && r.capacite > 0 && (r.charge ?? 0) >= 0.9 * r.capacite
  )
  const niveau =
    graves > 0 || urgenceAlerte || recherches.length > 0 || a.maydays_en_cours > 0
      ? 'alerte'
      : interventions.length > 0 || (s.alertes ?? []).length > 0 || s.public?.groupes_sans_nouvelles > 0 || etapeChargee
        ? 'vigilance'
        : 'normal'

  return (
    <div className="autorite">
      <header className="bandeau">
        <div className="bandeau-titre">
          {ev.logo_url && <img src={ev.logo_url} alt="" className="logo-participant" />}
          <div>
            <h1>{ev.nom}</h1>
            <p className="acces-role">
              {s.destinataire?.libelle}
              {s.destinataire?.organisation ? ` · ${s.destinataire.organisation}` : ''}
              {' · '}
              <span className="mono">{operationnel ? 'vue opérationnelle' : 'vue de situation'}</span>
            </p>
          </div>
        </div>
        <div className="etat-droite">
          <span className={`niveau-autorite niveau-${niveau}`}>
            {{ normal: 'Normal', vigilance: 'Vigilance', alerte: 'Alerte' }[niveau]}
          </span>
          <span className="compte">
            {ev.phase} · {hhmm(maintenant)}
          </span>
        </div>
      </header>

      {!liaison && (
        <div className="message erreur">
          Liaison interrompue — situation relevée à {hhmm(maj)}, peut-être dépassée.
        </div>
      )}
      {erreur && s && <div className="message erreur">{erreur}</div>}

      {/* Bandeaux permanents : une mise à l'abri ou une recherche doit se
          voir quel que soit l'onglet ouvert. */}
      {(s.alertes ?? []).map((al, i) => (
        <div className={`bandeau-alerte niv-${al.niveau}`} key={i}>
          <div className="niv">{al.niveau}</div>
          <div className="contenu">
            <strong>{al.titre}</strong>
            {al.message && <div className="msg">{al.message}</div>}
            {al.consigne && <div className="consigne">→ {al.consigne}</div>}
            <div className="meta">
              <span>émise à {hhmm(al.emise_le)}</span>
              {/* (122) Combien de postes ont lu, jamais lesquels. */}
              {al.membres_actifs != null && (
                <span>lue par {al.accuses ?? 0} / {al.membres_actifs} postes</span>
              )}
              {al.acquittee_le && <span>prise en compte par le PC à {hhmm(al.acquittee_le)}</span>}
            </div>
          </div>
        </div>
      ))}

      {recherches.map((r) => (
        <div className="bandeau-alerte niv-vigilance" key={r.reference}>
          <div className="niv">recherche</div>
          <div className="contenu">
            <strong>Recherche de personne en cours</strong>
            <span className="mono"> · depuis {depuis(r.depuis, maintenant)}</span>
            <div className="msg">
              Dernier lieu connu : {r.dernier_lieu || 'non précisé'}
              {r.sur_trace ? (
                <span className="mono"> · {libelleSurTrace(r.sur_trace)}</span>
              ) : (
                r.pk_km != null && <span className="mono"> · km {Number(r.pk_km).toFixed(1)}</span>
              )}
              {r.vu_a && <> · vue vers {hhmm(r.vu_a)}</>}
            </div>
            {operationnel && (r.age_approx != null || r.signalement) && (
              <div className="msg">
                {r.age_approx != null && <>Âge approximatif : {r.age_approx} ans. </>}
                {r.signalement && <>Signalement : {r.signalement}</>}
              </div>
            )}
            <div className="consigne">
              → Regroupement : {r.point_regroupement || 'voir le PC'} · gestion par le PC de l'organisateur
            </div>
            <div className="meta">
              <span>{r.reference}</span>
              <Gps position={r.position} />
            </div>
          </div>
        </div>
      ))}

      {/* (124) Qui appeler, où se retrouver : en tête, sous les bandeaux,
          quel que soit l'onglet. C'est la première chose qu'un
          Dir-PC-Ops cherche en arrivant. */}
      <Interlocuteurs s={s} />

      <div className="onglets onglets-autorite" role="tablist">
        {[
          ['situation', 'Situation'],
          ['intervention', 'Intervention'],
          ['dossier', 'Dossier']
        ].map(([k, lib]) => (
          <button
            key={k}
            role="tab"
            aria-selected={vue === k}
            className={`module ${vue === k ? 'actif' : ''}`}
            onClick={() => setVue(k)}
          >
            {lib}
          </button>
        ))}
      </div>

      {vue === 'situation' && <Situation s={s} maintenant={maintenant} operationnel={operationnel} />}
      {vue === 'intervention' && <Intervention s={s} />}
      {vue === 'dossier' && <Dossier s={s} />}

      <p className="aide">
        Consultation en lecture seule, rafraîchie toutes les {RAFRAICHISSEMENT_S} secondes
        {maj && <> (dernière à {maj.toLocaleTimeString('fr-BE')})</>}. Ce lien est personnel,
        révocable, et chaque consultation est enregistrée. L'engagement des moyens de
        l'organisateur reste à son poste de commandement.
      </p>
    </div>
  )
}

/* ================================================================== */
/* SITUATION                                                           */
/* ================================================================== */

function Interlocuteurs({ s }) {
  const liste = s.interlocuteurs ?? []
  // (147, retour de Ren du 29/10) Tous les points de rencontre, pas le
  // premier : un festival en a deux, une balade en ajoute le long du
  // parcours. Chacun avec son code et son adresse (144), c'est ce que
  // les engins tapent dans le GPS.
  const rencontres = (s.acces_secours ?? []).filter((e) => e.categorie === 'point_rencontre_secours')
  if (liste.length === 0 && rencontres.length === 0) return null
  return (
    <div className="interlocuteurs">
      {liste.map((c, i) => (
        <div className="carte" key={i}>
          <div className="pave-titre">{c.role === 'suppleant' ? 'Suppléant' : 'Interlocuteur au PC'}</div>
          <div className="titre">{c.nom}</div>
          <div className="meta">
            {c.fonction && <span>{c.fonction}</span>}
            {c.organisation && <span>{c.organisation}</span>}
          </div>
          {c.telephone && (
            <a className="lien-externe mono" href={`tel:${c.telephone.replace(/\s/g, '')}`}>
              {c.telephone}
            </a>
          )}
        </div>
      ))}
      {rencontres.map((rencontre, i) => (
        <div className="carte carte-prv" key={rencontre.code ?? i}>
          <div className="pave-titre">
            Point de rencontre secours{rencontres.length > 1 ? ` ${i + 1} / ${rencontres.length}` : ''}
          </div>
          <div className="titre">
            {rencontre.nom}
            {rencontre.code && <span className="mono sourdine"> {rencontre.code}</span>}
            {rencontre.confirme === false && <span className="jeton alerte-texte">non confirmé sur site</span>}
          </div>
          {rencontre.adresse && <div className="meta secours-adresse"><span>{rencontre.adresse}</span></div>}
          {rencontre.description && <div className="meta"><span>{rencontre.description}</span></div>}
          <Gps position={rencontre.position} />
        </div>
      ))}
    </div>
  )
}

function Situation({ s, maintenant, operationnel }) {
  const [tri, setTri] = useState('gravite')
  const a = s.activite ?? {}
  const p = s.public ?? {}
  const ev = s.evenement ?? {}
  const interventions = s.interventions ?? []

  const parEtat = { attente: 0, engage: 0, sur_place: 0 }
  interventions.forEach((i) => {
    parEtat[PRISE[i.statut] ?? 'attente'] += 1
  })

  const triees = useMemo(() => {
    const l = [...interventions]
    if (tri === 'recent') l.sort((x, y) => (y.heure ?? '').localeCompare(x.heure ?? ''))
    else if (tri === 'ancien') l.sort((x, y) => (x.heure ?? '').localeCompare(y.heure ?? ''))
    return l // 'gravite' : l'ordre du serveur (gravité, puis récent)
  }, [interventions, tri])

  const parcours = ev.geometrie === 'parcours' || ev.geometrie === 'hybride'

  return (
    <>
      <section className="bloc">
        <div className="grille-paves">
          <div className="pave">
            <div className="pave-titre">Interventions en cours</div>
            <div className={`grand ${parEtat.attente > 0 ? 'alerte-texte' : ''}`}>{interventions.length}</div>
            <div className={`detail-metrique ${parEtat.attente > 0 ? 'alerte-texte' : ''}`}>
              <span>en attente de moyen</span>
              <strong>{parEtat.attente}</strong>
            </div>
            <div className="detail-metrique">
              <span>moyen engagé</span>
              <strong>{parEtat.engage}</strong>
            </div>
            <div className="detail-metrique">
              <span>sur place</span>
              <strong>{parEtat.sur_place}</strong>
            </div>
          </div>
          <div className="pave">
            <div className="pave-titre">Public</div>
            <div className="grand">{p.jauge ?? '—'}</div>
            <div className="detail-metrique">
              <span>présents estimés (comptage)</span>
            </div>
            {(ev.frequentation_min || ev.frequentation_max) && (
              <div className="detail-metrique">
                <span>attendus</span>
                <strong>
                  {ev.frequentation_min ?? '?'}–{ev.frequentation_max ?? '?'}
                </strong>
              </div>
            )}
          </div>
          {parcours && (
            <div className="pave">
              <div className="pave-titre">Sur le parcours</div>
              <div className="grand">{p.sur_parcours ?? 0}</div>
              <div className="detail-metrique">
                <span>en attente de départ</span>
                <strong>{p.attente ?? 0}</strong>
              </div>
              <div className="detail-metrique">
                <span>rentrés</span>
                <strong>{p.arrives ?? 0}</strong>
              </div>
              <div className={`detail-metrique ${p.groupes_sans_nouvelles > 0 ? 'alerte-texte' : ''}`}>
                <span>groupes sans nouvelles &gt; 45 min</span>
                <strong>{p.groupes_sans_nouvelles ?? 0}</strong>
              </div>
            </div>
          )}
          {/* Le fait, jamais la personne (106) : qui et où restent au PC. */}
          {a.maydays_en_cours > 0 && (
            <div className="pave">
              <div className="pave-titre">Intervenant en difficulté</div>
              <div className="grand alerte-texte">{a.maydays_en_cours}</div>
              <div className="detail-metrique">
                <span>MAYDAY en cours, pris en charge par le PC</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <Carte s={s} />

      <section className="bloc">
        <h2>Interventions en cours</h2>
        {interventions.length === 0 ? (
          <p className="vide">Aucune intervention en cours.</p>
        ) : (
          <>
            <div className="ligne-boutons tri-autorite">
              <span className="etiquette">Trier</span>
              {[
                ['gravite', 'Gravité'],
                ['recent', 'Plus récent'],
                ['ancien', 'Plus ancien']
              ].map(([k, lib]) => (
                <button key={k} className={`module ${tri === k ? 'actif' : ''}`} onClick={() => setTri(k)}>
                  {lib}
                </button>
              ))}
            </div>
            {triees.map((i) => (
              <Ligne key={`${i.source}-${i.reference}`} i={i} maintenant={maintenant} />
            ))}
          </>
        )}
        <p className="aide">
          Signalements ouverts, et missions de l'organisateur qui comptent pour les secours
          (priorité 1 ou 2, ou bloquantes).
          {operationnel
            ? " L'identité et le numéro de la personne qui appelle restent au PC."
            : " Vue de situation : la nature, le lieu et l'état, sans la description — le PC la donne sur demande."}
        </p>
      </section>

      {parcours && <Parcours s={s} maintenant={maintenant} />}

      <Meteo s={s} />
    </>
  )
}

function Ligne({ i, maintenant }) {
  const etat = PRISE[i.statut] ?? 'attente'
  const nature =
    i.source === 'signalement'
      ? NATURE[i.nature] ?? i.nature
      : `Mission ${MODULE[i.nature] ?? i.nature ?? ''}`.trim()
  const grav = i.source === 'signalement' ? i.gravite : i.priorite
  return (
    <div className={`carte intervention prise-${etat}`}>
      <div className="intervention-tete">
        <span className="mono">{hhmm(i.heure)}</span>
        <strong>{nature}</strong>
        {grav && (
          <span className={`jeton ${i.gravite === 'critique' || i.gravite === 'grave' || i.priorite === 'P1' ? 'alerte-texte' : ''}`}>
            {grav}
          </span>
        )}
        {i.bloquant && <span className="jeton alerte-texte">bloquant</span>}
        <span className={`jeton prise prise-${etat}`}>{LIBELLE_PRISE[etat]}</span>
      </div>
      {i.titre && <div className="intervention-texte">{i.titre}</div>}
      {i.description && <div className="intervention-texte">« {i.description} »</div>}
      <div className="meta">
        <span>{i.lieu || 'lieu non précisé'}</span>
        {i.pk_km != null && !i.sur_trace && <span>km {Number(i.pk_km).toFixed(1)}</span>}
        {/* (123) « km 3,2 · entre E2 et E3 · 40 m de la trace » : la
            même phrase que le PC, calculée par le serveur. */}
        {i.sur_trace && <span className="sur-trace">{libelleSurTrace(i.sur_trace)}</span>}
        {i.doublons > 0 && <span>{i.doublons + 1} signalements groupés</span>}
        <span>depuis {depuis(i.depuis ?? i.heure, maintenant)}</span>
        {/* (122) Des faits horodatés derrière « Moyen engagé » et
            « Sur place », pas seulement un statut choisi. */}
        {i.en_route_le && <span>engagé {hhmm(i.en_route_le)}</span>}
        {i.arrive_le && <span>sur place {hhmm(i.arrive_le)}</span>}
        <span>{i.reference}</span>
        <Gps position={i.position} />
      </div>
    </div>
  )
}

function Parcours({ s, maintenant }) {
  const groupes = s.public?.groupes ?? []
  const etapes = (s.reperes ?? []).filter((r) => r.type === 'etape' || r.type === 'pc_ops')
  const interv = (s.interventions ?? []).filter((i) => i.pk_km != null)
  const kms = [
    ...etapes.map((r) => r.pk_km),
    ...groupes.map((g) => g.pk_km),
    ...interv.map((i) => i.pk_km)
  ].filter((k) => k != null)
  const long = Math.max(1, ...kms.map(Number))
  const pos = (km) => `${Math.min(100, (Number(km) / long) * 100)}%`

  if (etapes.length === 0 && groupes.length === 0) return null

  return (
    <section className="bloc">
      <h2>Parcours</h2>
      <div className="frise" aria-hidden="true">
        <div className="frise-ligne" />
        {etapes.map((r) => (
          <div className="frise-repere" key={r.code} style={{ left: pos(r.pk_km ?? 0) }}>
            <span className="frise-point" />
            <span className="frise-lib">{r.code}</span>
          </div>
        ))}
        {groupes
          .filter((g) => g.pk_km != null)
          .map((g) => (
            <div
              className={`frise-groupe ${g.sans_nouvelles ? 'sans-nouvelles' : ''}`}
              key={g.code}
              style={{ left: pos(g.pk_km) }}
            >
              {g.effectif}
            </div>
          ))}
        {interv.map((i) => (
          <div className="frise-interv" key={i.reference} style={{ left: pos(i.pk_km) }}>
            ▲
          </div>
        ))}
      </div>

      {etapes.some((r) => r.type === 'etape') && (
        <div className="grille-paves">
          {etapes
            .filter((r) => r.type === 'etape')
            .map((r) => (
              <div className="pave" key={r.code}>
                <div className="pave-titre">
                  {r.nom}
                  {r.pk_km != null && ` · km ${Number(r.pk_km).toFixed(1)}`}
                </div>
                <div className={`grand ${r.capacite && (r.charge ?? 0) >= r.capacite ? 'alerte-texte' : ''}`}>
                  {r.charge ?? 0}
                  {r.capacite != null && <span className="sur-capacite"> / {r.capacite}</span>}
                </div>
                <div className="detail-metrique">
                  <span>
                    personnes dont c'est le dernier pointage
                    {r.capacite != null && (r.charge ?? 0) >= r.capacite && ' — capacité atteinte'}
                  </span>
                </div>
              </div>
            ))}
        </div>
      )}

      {groupes.length > 0 && (
        <table className="apercu tableau-autorite">
          <thead>
            <tr>
              <th>Groupe</th>
              <th>Effectif</th>
              <th>Dernier lieu</th>
              <th>Vu</th>
            </tr>
          </thead>
          <tbody>
            {groupes.map((g) => (
              <tr key={g.code} className={g.sans_nouvelles ? 'rejete' : ''}>
                <td>
                  {g.nom || g.code}
                  {g.sans_nouvelles && <span className="jeton alerte-texte">sans nouvelles</span>}
                </td>
                <td className="mono">{g.effectif}</td>
                <td>
                  {g.dernier_lieu || '—'}
                  {g.pk_km != null && <span className="mono"> · km {Number(g.pk_km).toFixed(1)}</span>}
                </td>
                <td className="mono">
                  {g.dernier_passage ? `il y a ${depuis(g.dernier_passage, maintenant)}` : 'jamais pointé'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/**
 * Deux sources côte à côte, comme dans l'écran Météo interne : la veille
 * à seuils du PC sur le point de l'événement, et l'avertissement officiel
 * IRM de la province. Plus le relevé du moment (Open-Meteo), sans clé.
 */
// Open-Meteo actualise son « current » toutes les quinze minutes :
// inutile d'appeler plus souvent, dangereux de ne jamais rappeler — le
// relevé restait figé à l'ouverture de la page, sous un pied qui
// promettait vingt secondes (comparatif BFMF 2026, lot 1).
const RAFRAICHISSEMENT_METEO_MS = 15 * 60 * 1000

function Meteo({ s }) {
  const ev = s.evenement ?? {}
  const criteres = s.meteo?.criteres ?? []
  const [obs, setObs] = useState(null)
  const [releve, setReleve] = useState(null)
  const [pannePuis, setPannePuis] = useState(null)

  useEffect(() => {
    const p = ev.point_0
    if (!p?.lat) return
    let vivant = true
    function charger() {
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
          '&current=temperature_2m,wind_gusts_10m,precipitation' +
          '&daily=sunrise,sunset&timezone=Europe%2FBrussels&forecast_days=1'
      )
        .then((r) => r.json())
        .then((d) => {
          if (!vivant) return
          setObs(d)
          setReleve(new Date())
          setPannePuis(null)
        })
        .catch(() => {
          if (!vivant) return
          // Le dernier relevé reste affiché, daté ; seule la panne est
          // nouvelle.
          setPannePuis((x) => x ?? new Date())
          setObs((o) => o ?? { erreur: true })
        })
    }
    charger()
    const t = setInterval(charger, RAFRAICHISSEMENT_METEO_MS)
    return () => {
      vivant = false
      clearInterval(t)
    }
  }, [ev.point_0?.lat, ev.point_0?.lon])

  const c = obs?.current
  const jour = obs?.daily
  const heureSeule = (iso) => (iso ? iso.slice(11, 16) : '—')
  const heure = (d) => d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })

  return (
    <section className="bloc">
      <h2>Météo</h2>
      <div className="grille-paves">
        <div className="pave">
          <div className="pave-titre">Relevé au point 0</div>
          {!ev.point_0?.lat ? (
            <p className="vide">Point 0 non renseigné.</p>
          ) : obs?.erreur ? (
            <p className="vide">Relevé indisponible.</p>
          ) : !c ? (
            <p className="vide">Chargement…</p>
          ) : (
            <>
              <div className="detail-metrique">
                <span>température</span>
                <strong>{c.temperature_2m} °C</strong>
              </div>
              <div className="detail-metrique">
                <span>rafales</span>
                <strong>{c.wind_gusts_10m} km/h</strong>
              </div>
              <div className="detail-metrique">
                <span>pluie</span>
                <strong>{c.precipitation} mm</strong>
              </div>
              <div className="detail-metrique">
                <span>lever · coucher</span>
                <strong>
                  {heureSeule(jour?.sunrise?.[0])} · {heureSeule(jour?.sunset?.[0])}
                </strong>
              </div>
              <p className={`aide ${pannePuis ? 'alerte-texte' : ''}`} style={{ margin: '6px 0 0' }}>
                {pannePuis
                  ? `Relevé indisponible depuis ${heure(pannePuis)}${releve ? ` — dernier relevé ${heure(releve)}` : ''}.`
                  : releve
                    ? `Relevé ${heure(releve)} (Open-Meteo, actualisé toutes les 15 min).`
                    : ''}
              </p>
            </>
          )}
        </div>
        <div className="pave">
          <div className="pave-titre">Veille de l'organisateur</div>
          {criteres.length === 0 ? (
            <p className="vide">Veille à seuils non active.</p>
          ) : (
            criteres.map((k) => (
              <div
                className={`detail-metrique ${k.niveau !== 'vert' ? 'alerte-texte' : ''}`}
                key={k.critere}
              >
                <span>{k.critere}</span>
                <strong>{k.niveau}</strong>
              </div>
            ))
          )}
          {s.meteo?.seuils && (
            <div className="detail-metrique">
              <span>seuils rafales (vigilance · critique)</span>
              <strong>
                {s.meteo.seuils.rafale_vigilance_kmh} · {s.meteo.seuils.rafale_critique_kmh} km/h
              </strong>
            </div>
          )}
        </div>
      </div>
      <MoniteurIrm province={ev.province} />
    </section>
  )
}

/* ================================================================== */
/* INTERVENTION                                                        */
/* ================================================================== */

function Intervention({ s }) {
  const [sous, setSous] = useState('acces')
  return (
    <>
      <div className="onglets" role="tablist">
        {[
          ['acces', 'Accès & secours'],
          ['parcours', 'Parcours & brancardage'],
          ['ressources', 'Ressources'],
          ['site', 'Site & public']
        ].map(([k, lib]) => (
          <button
            key={k}
            role="tab"
            aria-selected={sous === k}
            className={`module ${sous === k ? 'actif' : ''}`}
            onClick={() => setSous(k)}
          >
            {lib}
          </button>
        ))}
      </div>
      {sous === 'acces' && <Acces s={s} />}
      {sous === 'parcours' && <Brancardage s={s} />}
      {sous === 'ressources' && <Ressources s={s} />}
      {sous === 'site' && <Site s={s} />}
    </>
  )
}

function Element({ e }) {
  return (
    <div className="carte">
      <div className="titre">
        {e.nom}
        {e.confirme === false && <span className="jeton alerte-texte">non confirmé sur site</span>}
      </div>
      <div className="meta">
        <span>{ELEMENT[e.categorie] ?? e.categorie}</span>
        {e.code && <span>{e.code}</span>}
        <Gps position={e.position} />
      </div>
      {/* (144/147) L'adresse postale, pour les engins qui naviguent à l'adresse. */}
      {e.adresse && <div className="meta secours-adresse"><span>{e.adresse}</span></div>}
      {e.description && <p className="aide">{e.description}</p>}
    </div>
  )
}

function Acces({ s }) {
  const acces = s.acces_secours ?? []
  const pc = (s.reperes ?? []).filter((r) => r.type === 'pc_ops' || r.type === 'poste_secours' || r.type === 'entree')
  return (
    <>
      <section className="bloc">
        <h2>Accès secours et commandement</h2>
        {acces.length === 0 ? (
          <p className="vide">
            Aucun point de rencontre, PRV ni voie engins n'est encore posé sur le plan
            d'implantation — le demander au PC.
          </p>
        ) : (
          acces.map((e) => <Element key={e.code ?? e.nom} e={e} />)
        )}
      </section>
      {pc.length > 0 && (
        <section className="bloc">
          <h2>PC, postes et entrées</h2>
          {pc.map((r) => (
            <div className="carte" key={r.code}>
              <div className="titre">{r.nom}</div>
              <div className="meta">
                <span>{LIEU[r.type] ?? r.type}</span>
                {r.pk_km != null && <span>km {Number(r.pk_km).toFixed(1)}</span>}
                <Gps position={r.position} />
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

function Brancardage({ s }) {
  const segments = s.segments ?? []
  const bornes = (s.reperes ?? []).filter((r) => r.pk_km != null)
  return (
    <>
      <section className="bloc">
        <h2>Tronçons — brancardage</h2>
        <p className="aide">
          Pour chaque tronçon : longueur, nature du chemin, et distance maximale de portage à
          pied. C'est elle qui dimensionne l'équipe de brancardage, pas la longueur totale.
        </p>
        {segments.length === 0 ? (
          <p className="vide">Aucun tronçon décrit.</p>
        ) : (
          segments.map((t, k) => {
            const m = t.brancardage_max_m ?? 0
            const niveau = m >= 400 ? 'difficile' : m >= 250 ? 'modere' : 'aise'
            return (
              <div className={`carte troncon troncon-${niveau}`} key={k}>
                <div className="titre">
                  {t.libelle || `${t.depart ?? '?'} → ${t.arrivee ?? '?'}`}
                  <span className={`jeton ${niveau === 'difficile' ? 'alerte-texte' : ''}`}>
                    {{ difficile: 'portage long', modere: 'portage modéré', aise: 'accès aisé' }[niveau]}
                    {t.brancardage_max_m != null && ` · ${t.brancardage_max_m} m`}
                  </span>
                </div>
                <div className="meta">
                  {(t.depart || t.arrivee) && (
                    <span>
                      {t.depart ? `${t.depart} → ${t.arrivee ?? '?'}` : `jusqu’à ${t.arrivee}`}
                    </span>
                  )}
                  {t.distance_m != null && <span>{t.distance_m} m</span>}
                </div>
                {(t.composition ?? []).length > 0 && (
                  <p className="aide">
                    {t.composition
                      .filter((c) => c.distance_m)
                      .map((c) => `${c.distance_m} m de ${VOIE[c.type] ?? c.type}`)
                      .join(', ')}
                  </p>
                )}
              </div>
            )
          })
        )}
        <p className="aide">« Portage long » : 400 m ou plus — équipe de brancardage renforcée.</p>
      </section>
      {bornes.length > 0 && (
        <section className="bloc">
          <h2>Repères kilométriques</h2>
          <table className="apercu tableau-autorite">
            <tbody>
              {bornes.map((r) => (
                <tr key={r.code}>
                  <td className="mono">km {Number(r.pk_km).toFixed(1)}</td>
                  <td>{r.nom}</td>
                  <td>
                    <Gps position={r.position} libelle="Carte" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="aide">
            Une intervention annoncée « au km 3,2 » se situe entre les repères qui l'encadrent.
          </p>
        </section>
      )}
    </>
  )
}

function Ressources({ s }) {
  const r = s.ressources ?? {}
  const elements = r.elements ?? []
  const dea = elements.filter((e) => e.categorie === 'dea')
  const eau = elements.filter((e) => e.categorie === 'point_eau')
  const coupures = elements.filter((e) => e.categorie === 'coupure_gaz' || e.categorie === 'coffret_electrique')
  return (
    <>
      <section className="bloc">
        <h2>Moyens de l'organisateur</h2>
        {(r.moyens ?? []).length === 0 && !r.extincteurs ? (
          <p className="vide">Moyens de premiers secours non renseignés.</p>
        ) : (
          <div className="grille-paves">
            {(r.moyens ?? []).map((m) => (
              <div className="pave" key={m.type}>
                <div className="pave-titre">{MOYEN[m.type] ?? m.type}</div>
                <div className="grand">{m.quantite}</div>
                {m.commentaire && <div className="detail-metrique"><span>{m.commentaire}</span></div>}
              </div>
            ))}
            {r.extincteurs > 0 && (
              <div className="pave">
                <div className="pave-titre">Extincteurs posés au plan</div>
                <div className="grand">{r.extincteurs}</div>
              </div>
            )}
          </div>
        )}
      </section>
      {dea.length > 0 && (
        <section className="bloc">
          <h2>Défibrillateurs (DEA)</h2>
          {dea.map((e) => <Element key={e.code} e={e} />)}
        </section>
      )}
      <section className="bloc">
        <h2>Ressources en eau</h2>
        {eau.length === 0 ? (
          <p className="vide">Aucun point d'eau posé au plan.</p>
        ) : (
          <table className="apercu tableau-autorite">
            <tbody>
              {eau.map((e) => (
                <tr key={e.code}>
                  <td>
                    {e.nom}
                    {e.description && <div className="aide">{e.description}</div>}
                  </td>
                  <td className="mono">{e.code}</td>
                  <td>
                    <Gps position={e.position} libelle="Carte" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {coupures.length > 0 && (
        <section className="bloc">
          <h2>Coupures</h2>
          {coupures.map((e) => <Element key={e.code} e={e} />)}
        </section>
      )}
    </>
  )
}

function Site({ s }) {
  const ev = s.evenement ?? {}
  const risques = s.installations_risque ?? []
  const programme = s.programme ?? []
  const jour = (d) =>
    new Date(d).toLocaleString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <>
      <section className="bloc">
        <h2>Installations à risque</h2>
        {risques.length === 0 ? (
          <p className="vide">Aucune installation à risque déclarée.</p>
        ) : (
          risques.map((r, i) => (
            <div className="carte" key={i}>
              <div className="titre">
                {r.nom}
                {!r.confirme && <span className="jeton alerte-texte">non confirmé sur site</span>}
              </div>
              <div className="meta">
                <span>{ELEMENT[r.categorie] ?? r.categorie}</span>
                <Gps position={r.latitude ? { lat: r.latitude, lon: r.longitude } : null} />
              </div>
              <dl className="fiche">
                {r.organe_coupure && (
                  <>
                    <dt>Où couper</dt>
                    <dd>
                      <strong>{r.organe_coupure}</strong>
                    </dd>
                  </>
                )}
                {r.moyens_proximite && (
                  <>
                    <dt>Moyens à proximité</dt>
                    <dd>{r.moyens_proximite}</dd>
                  </>
                )}
                {r.mesures_maitrise && (
                  <>
                    <dt>Mesures de maîtrise</dt>
                    <dd>{r.mesures_maitrise}</dd>
                  </>
                )}
                {r.description && (
                  <>
                    <dt>Description</dt>
                    <dd>{r.description}</dd>
                  </>
                )}
              </dl>
            </div>
          ))
        )}
      </section>
      <section className="bloc">
        <h2>Horaires et fréquentation</h2>
        {(ev.frequentation_min || ev.frequentation_max) && (
          <p>
            Fréquentation attendue :{' '}
            <span className="mono">
              {ev.frequentation_min ?? '?'}–{ev.frequentation_max ?? '?'}
            </span>{' '}
            personnes.
          </p>
        )}
        {programme.length === 0 ? (
          <p className="vide">Programme non renseigné.</p>
        ) : (
          <table className="apercu tableau-autorite">
            <tbody>
              {programme.map((p, i) => (
                <tr key={i}>
                  <td className="mono">{jour(p.debut)}</td>
                  <td>
                    {p.titre}
                    {p.duree_min && <span className="mono"> · {p.duree_min} min</span>}
                  </td>
                  <td>{p.lieu ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

/* ================================================================== */
/* DOSSIER                                                             */
/* ================================================================== */

function Dossier({ s }) {
  const ev = s.evenement ?? {}
  const docs = s.documents ?? []
  const contacts = s.contacts ?? []
  const radio = s.radio ?? []
  const date = (d) => (d ? new Date(d).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : null)
  // (147) Le schéma unifilaire du site, généré depuis le plan comme dans
  // les bilans de conception : la zone de secours veut savoir d'où vient
  // le courant et où couper. Seulement s'il y a une source tracée.
  const objets = useMemo(() => objetsPlan(s.plan), [s.plan])
  const aReseau = objets.some(estSource)
  return (
    <>
      <section className="bloc">
        <h2>Événement</h2>
        <dl className="fiche">
          {(ev.date_debut || ev.date_fin) && (
            <>
              <dt>Dates</dt>
              <dd>
                {date(ev.date_debut)}
                {ev.date_fin && ev.date_fin !== ev.date_debut && ` → ${date(ev.date_fin)}`}
              </dd>
            </>
          )}
          {ev.commune && (
            <>
              <dt>Commune</dt>
              <dd>
                {ev.commune}
                {ev.province && ` (${ev.province})`}
              </dd>
            </>
          )}
          {ev.zone_secours && (
            <>
              <dt>Zone de secours</dt>
              <dd>{ev.zone_secours}</dd>
            </>
          )}
          {ev.zone_police && (
            <>
              <dt>Zone de police</dt>
              <dd>{ev.zone_police}</dd>
            </>
          )}
          {ev.point_0?.lat && (
            <>
              <dt>Point 0</dt>
              <dd>
                <Gps position={ev.point_0} />
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className="bloc">
        <h2>Documents de référence</h2>
        {docs.length === 0 ? (
          <p className="vide">Aucun document partagé par l'organisateur.</p>
        ) : (
          docs.map((d, i) => (
            <a className="carte carte-lien" key={i} href={d.url} target="_blank" rel="noopener noreferrer">
              <div className="titre">{d.titre} ↗</div>
              {d.description && <div className="aide">{d.description}</div>}
            </a>
          ))
        )}
        <p className="aide">Réservés aux autorités et disciplines — ne pas rediffuser.</p>
      </section>

      <section className="bloc bloc-unifilaire">
        <h2>Schéma unifilaire</h2>
        {aReseau ? (
          <>
            <Unifilaire objets={objets} evenement={ev} reseau="electricite" />
            <p className="aide">
              Généré depuis le plan d'implantation de l'organisateur, tel qu'il est tracé aujourd'hui ; les organes de
              coupure sont dans Intervention › Site &amp; public.
            </p>
          </>
        ) : (
          <p className="vide">
            Aucune source électrique (groupe, raccordement réseau) n'est tracée sur le plan d'implantation :
            pas de schéma à montrer.
          </p>
        )}
      </section>

      <section className="bloc">
        <h2>Annuaire</h2>
        <a className="carte carte-lien urgence-appel" href="tel:112">
          <div className="titre">Urgence vitale — 112</div>
        </a>
        {contacts.length === 0 ? (
          <p className="vide">Aucun contact désigné par l'organisateur.</p>
        ) : (
          contacts.map((c, i) => (
            <div className="carte" key={i}>
              <div className="titre">{c.nom}</div>
              <div className="meta">
                {c.fonction && <span>{c.fonction}</span>}
                {c.organisation && <span>{c.organisation}</span>}
                {c.disponibilite && <span>{c.disponibilite}</span>}
              </div>
              <div className="ligne-boutons" style={{ marginTop: 6 }}>
                {c.telephone && (
                  <a className="lien-externe mono" href={`tel:${c.telephone.replace(/\s/g, '')}`}>
                    {c.telephone}
                  </a>
                )}
                {c.email && (
                  <a className="lien-externe" href={`mailto:${c.email}`}>
                    {c.email}
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      <section className="bloc">
        <h2>Plan radio</h2>
        {radio.length === 0 ? (
          <p className="vide">Plan radio non renseigné.</p>
        ) : (
          <table className="apercu tableau-autorite">
            <tbody>
              {radio.map((c, i) => (
                <tr key={i} className={c.urgence ? 'rejete' : ''}>
                  <td className="mono">
                    {c.numero}
                    {c.urgence && <span className="jeton alerte-texte">urgence</span>}
                  </td>
                  <td>
                    {c.libelle}
                    {c.usage && <div className="aide">{c.usage}</div>}
                  </td>
                  <td className="mono">
                    {c.frequence_mhz ? `${c.frequence_mhz} MHz` : ''}
                    {c.sous_ton ? ` · ${c.sous_ton}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bloc">
        <h2>Doctrine</h2>
        <ol className="liste-pave">
          <li>112 d'abord pour toute urgence vitale, puis information du PC de l'organisateur.</li>
          <li>Les applications complètent la radio, elles ne la remplacent jamais.</li>
          <li>Cette vue est en lecture seule : l'engagement des moyens de l'organisateur reste à son PC.</li>
          <li>L'organisateur garde la direction de son dispositif jusqu'à la prise en charge par les disciplines.</li>
        </ol>
      </section>
    </>
  )
}
