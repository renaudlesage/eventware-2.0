import { useEffect, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, useMap } from 'react-leaflet'
import { FondCarte, ControlesCarte, useFondCarte } from './carte'
import L from 'leaflet'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'
import { jouerAlarme } from './alarme'

/**
 * PC-OPS — les signalements des participants, sur carte et en liste.
 *
 * Lot 1 du comparatif BFMF 2026 (17/10) : l'écran n'affichait ni qui
 * traite, ni les délais, ni le lieu, ni la gravité — pourtant tous en
 * base depuis la 006 — et un SOS y arrivait en silence. Il montre
 * maintenant le cycle horodaté (reçu → pris en charge → clos, avec le
 * nom du traitant et les délais), le lieu nommé, la gravité, l'heure
 * du dernier relevé, et sonne sur un nouveau SOS si l'opérateur a
 * activé le son. Le bouton « → Demande » appelle enfin
 * convertir_signalement_en_mission, qui dormait depuis la 012.
 */

export const TYPES = {
  malaise: 'Malaise',
  blessure: 'Blessure',
  danger: 'Danger',
  materiel: 'Matériel',
  egare: 'Égaré',
  autre: 'Autre'
}

const STATUTS = [
  ['recu', 'Reçu'],
  ['pris_en_charge', 'Pris en charge'],
  ['en_cours', 'En cours'],
  ['clos', 'Clôturé'],
  ['sans_suite', 'Sans suite']
]

export const GRAVITES = [
  ['mineur', 'Mineur'],
  ['modere', 'Modéré'],
  ['grave', 'Grave'],
  ['critique', 'Critique']
]

const PRIORITES = ['P1', 'P2', 'P3']

const COULEURS = {
  recu: '#a3341f',
  pris_en_charge: '#c07000',
  en_cours: '#c07000',
  clos: '#1d5c4f',
  sans_suite: '#6b6862'
}

// Au-delà, la liste a l'air vivante alors qu'elle ne l'est plus : le
// relevé passe en rouge. Trois cycles de rafraîchissement.
const RELEVE_PERIME_MS = 30000

/**
 * Marqueur dessiné en CSS plutôt qu'en image : les icônes par défaut de
 * Leaflet cassent une fois le projet compilé (chemins d'images perdus au
 * bundling). Un divIcon évite le problème et permet de coder le statut
 * par la couleur.
 */
function marqueur(statut) {
  const couleur = COULEURS[statut] ?? '#6b6862'
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:16px;height:16px;border-radius:50%;
           background:${couleur};border:2px solid #fff;
           box-shadow:0 0 0 1px rgba(0,0,0,.35)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  })
}

function Recadrer({ points }) {
  const carte = useMap()
  useEffect(() => {
    if (!points.length) return
    carte.fitBounds(
      points.map((p) => [p.latitude, p.longitude]),
      { padding: [40, 40], maxZoom: 16 }
    )
  }, [points.length])
  return null
}

export default function PcOps({ evenement, peut, toutPouvoir }) {
  const [signalements, setSignalements] = useState([])
  const [demandes, setDemandes] = useState({}) // signalement_id → demande créée
  const [membres, setMembres] = useState({}) // user_id → nom affiché
  const [lieux, setLieux] = useState({}) // lieu_id → nom
  const [equipes, setEquipes] = useState([])
  const [fondCarte, setFondCarte] = useFondCarte('pcops')
  const [erreur, setErreur] = useState(null)
  const [retour, setRetour] = useState(null)
  const [masquerClos, setMasquerClos] = useState(true)
  const [maj, setMaj] = useState(null)
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const [sonActif, setSonActif] = useState(false)
  // Conversion en demande : le signalement en cours de conversion et
  // ce qu'on a choisi pour lui (priorité, équipe).
  const [conversion, setConversion] = useState(null)
  const minuteur = useRef(null)
  const recusAvantRef = useRef(null)

  // Sans ces droits, le select de statut et le bouton de conversion
  // n'ont aucune chance d'aboutir : autant ne pas les montrer.
  const peutSos = toutPouvoir || peut?.('sos', 'modifier')
  // La conversion crée une demande ET passe le signalement en pris en
  // charge : il faut les deux droits, sinon la RPC échoue à mi-chemin.
  const peutDemande = toutPouvoir || (peut?.('missions', 'creer') && peut?.('sos', 'modifier'))

  async function charger() {
    const [sig, dem] = await Promise.all([
      supabase
        .from('signalements')
        .select('*')
        .eq('evenement_id', evenement.id)
        .order('recu_le', { ascending: false }),
      // Les demandes nées d'un signalement : pour dire « → demande
      // SEC-012 · en cours » plutôt que de proposer une deuxième
      // conversion.
      supabase
        .from('missions')
        .select('id, reference, statut, signalement_id')
        .eq('evenement_id', evenement.id)
        .not('signalement_id', 'is', null)
        .is('deleted_at', null)
    ])
    if (sig.error) {
      setErreur(texteErreur(sig.error))
      return
    }
    const lignes = sig.data ?? []
    // Alarme : seulement si le nombre de signalements encore « reçus »
    // (pas pris en charge) vient de MONTER. Une prise en charge le fait
    // baisser et ne sonne pas.
    const recus = lignes.filter((s) => s.statut === 'recu').length
    if (sonActif && recusAvantRef.current != null && recus > recusAvantRef.current) jouerAlarme()
    recusAvantRef.current = recus

    setSignalements(lignes)
    if (!dem.error) {
      setDemandes(Object.fromEntries((dem.data ?? []).map((d) => [d.signalement_id, d])))
    }
    setMaj(Date.now())
    setErreur(null)
  }

  // Référentiels : chargés une fois — un nom de lieu ou de traitant ne
  // change pas toutes les dix secondes.
  async function chargerReferentiels() {
    const [m, l, e] = await Promise.all([
      supabase.from('membres_evenement').select('user_id, nom_affiche').eq('evenement_id', evenement.id),
      supabase.from('lieux').select('id, nom').eq('evenement_id', evenement.id).is('deleted_at', null),
      supabase.from('equipes').select('id, code, nom').eq('evenement_id', evenement.id).is('deleted_at', null).order('code')
    ])
    setMembres(Object.fromEntries((m.data ?? []).map((x) => [x.user_id, x.nom_affiche])))
    setLieux(Object.fromEntries((l.data ?? []).map((x) => [x.id, x.nom])))
    setEquipes(e.data ?? [])
  }

  useEffect(() => {
    chargerReferentiels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  useEffect(() => {
    charger()
    minuteur.current = setInterval(charger, 10000)
    return () => clearInterval(minuteur.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id, sonActif])

  // L'horloge qui juge la fraîcheur du relevé.
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  async function modifier(id, champs, libelle) {
    const refus = await modifierOuRefuser('signalements', champs, { id })
    if (refus) setErreur(refus)
    else {
      if (libelle) setRetour({ type: 'ok', texte: libelle })
      charger()
    }
  }

  async function convertir() {
    const { signalement: s, priorite, equipe } = conversion
    const { data, error } = await supabase.rpc('convertir_signalement_en_mission', {
      p_signalement: s.id,
      p_module: 'securite',
      p_priorite: priorite,
      p_equipe: equipe || null
    })
    if (error) {
      setRetour({ type: 'erreur', texte: `${s.reference} : ${texteErreur(error)}` })
      return
    }
    setConversion(null)
    setRetour({
      type: 'ok',
      texte: `${s.reference} → demande ${data?.reference ?? ''} créée${equipe ? ', attribuée' : ''} ; signalement pris en charge.`
    })
    charger()
  }

  const visibles = masquerClos
    ? signalements.filter((s) => !['clos', 'sans_suite'].includes(s.statut))
    : signalements

  const geolocalises = visibles.filter((s) => s.latitude && s.longitude)

  const centre = geolocalises.length
    ? [geolocalises[0].latitude, geolocalises[0].longitude]
    : evenement.point_0_lat
      ? [evenement.point_0_lat, evenement.point_0_lon]
      : [50.38212, 5.61679]

  const ouverts = signalements.filter((s) =>
    ['recu', 'pris_en_charge', 'en_cours'].includes(s.statut)
  ).length

  const lienParticipant = `${window.location.origin}${window.location.pathname}?sos=${evenement.jeton_public}`
  const relevePerime = maj != null && maintenant - maj > RELEVE_PERIME_MS

  return (
    <div className="pcops dom-orange">
      <div className="entete-dashboard">
        <h2>
          Signalements participants
          {ouverts > 0 && <span className="jeton alerte-jeton">{ouverts} ouvert(s)</span>}
        </h2>
        <div className="ligne-boutons" style={{ marginBottom: 0 }}>
          <button
            className={sonActif ? '' : 'discret'}
            onClick={() => setSonActif(!sonActif)}
            title="Alarme sonore à chaque nouveau signalement reçu"
          >
            {sonActif ? '🔔 Son ON' : '🔕 Son OFF'}
          </button>
          <span className={`compte releve ${relevePerime ? 'perime' : ''}`} title="heure du dernier relevé">
            {maj
              ? `relevé ${new Date(maj).toLocaleTimeString('fr-BE')}${relevePerime ? ' · périmé' : ''}`
              : 'relevé en attente'}
          </span>
        </div>
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}
      {retour && (
        <div className={`message ${retour.type === 'erreur' ? 'erreur' : ''}`} role="status">
          {retour.texte}
          <button className="lien" style={{ marginLeft: 10 }} onClick={() => setRetour(null)}>
            OK
          </button>
        </div>
      )}

      <p className="aide">
        Lien à diffuser aux participants (QR code, affichage, dossard) :<br />
        <span className="identifiant">{lienParticipant}</span>
      </p>

      {geolocalises.length > 0 && (
        <div className="carte-conteneur">
          <MapContainer center={centre} zoom={14} scrollWheelZoom={false}>
            <FondCarte cle={fondCarte} />
            <ControlesCarte fond={fondCarte} onFond={setFondCarte} />
            <Recadrer points={geolocalises} />
            {geolocalises.map((s) => (
              <Marker
                key={s.id}
                position={[s.latitude, s.longitude]}
                icon={marqueur(s.statut)}
              >
                <Popup>
                  <strong>{s.reference}</strong> — {TYPES[s.type] ?? s.type}
                  <br />
                  {s.description}
                  <br />
                  <span className="mono">
                    précision ±{Math.round(s.precision_m ?? 0)} m
                  </span>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}

      <div className="ligne-boutons" style={{ margin: '12px 0' }}>
        <button className="discret" onClick={() => setMasquerClos(!masquerClos)}>
          {masquerClos ? 'Afficher les clôturés' : 'Masquer les clôturés'}
        </button>
        <button className="discret" onClick={charger}>
          Rafraîchir
        </button>
      </div>

      {visibles.length === 0 ? (
        <p className="vide">Aucun signalement en cours.</p>
      ) : (
        visibles.map((s) => {
          const demande = demandes[s.id]
          const enConversion = conversion?.signalement.id === s.id
          return (
            <div className={`carte ${s.statut === 'recu' ? 'urgent' : ''}`} key={s.id}>
              <div className="titre">
                <span className="mono">{s.reference}</span> — {TYPES[s.type] ?? s.type}
                {s.gravite && <span className={`jeton grav-${s.gravite}`}>{libelleGravite(s.gravite)}</span>}
              </div>
              {s.description && <p style={{ margin: '4px 0' }}>{s.description}</p>}
              <div className="meta">
                {s.emis_le && ecartFile(s) > 1 && (
                  <span title="temps passé en file d'attente hors réseau">
                    émis {ecartFile(s)} min plus tôt
                  </span>
                )}
                {s.contact && (
                  <a href={`tel:${s.contact.replace(/\s/g, '')}`} className="lien-externe">
                    {s.contact}
                  </a>
                )}
                {s.lieu_id && lieux[s.lieu_id] && <span>{lieux[s.lieu_id]}</span>}
                {s.latitude ? (
                  <span>
                    {s.latitude.toFixed(5)} · {s.longitude.toFixed(5)} (±
                    {Math.round(s.precision_m ?? 0)} m)
                  </span>
                ) : (
                  <span>sans position</span>
                )}
              </div>
              {/* Le cycle, tel qu'il s'est réellement passé : les
                  horodatages sont posés par le déclencheur
                  statut_signalement, le traitant est auth.uid() au
                  dernier changement de statut. */}
              <div className="cycle mono">
                <span>reçu {hms(s.recu_le)}</span>
                {s.pris_en_charge_le && (
                  <span>
                    · pris en charge {hm(s.pris_en_charge_le)} (+{delai(s.recu_le, s.pris_en_charge_le)})
                    {s.traite_par && membres[s.traite_par] ? ` par ${membres[s.traite_par]}` : ''}
                  </span>
                )}
                {s.en_route_le && <span>· moyen en route {hm(s.en_route_le)}</span>}
                {s.arrive_le && <span>· sur place {hm(s.arrive_le)} (+{delai(s.recu_le, s.arrive_le)})</span>}
                {s.clos_le && (
                  <span>· {s.statut === 'sans_suite' ? 'sans suite' : 'clos'} {hm(s.clos_le)} (+{delai(s.recu_le, s.clos_le)})</span>
                )}
                {!s.pris_en_charge_le && !s.clos_le && s.statut === 'recu' && (
                  <span className="attente">· en attente depuis {delai(s.recu_le, maintenant)}</span>
                )}
                {demande && (
                  <span>
                    · demande <strong>{demande.reference}</strong>
                  </span>
                )}
              </div>
              {s.commentaire && <p className="aide" style={{ margin: '4px 0' }}>{s.commentaire}</p>}
              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                {peutSos ? (
                  <>
                    {/* (122) Le cycle en boutons successifs, comme la
                        volante de BFMF : chaque geste est un fait
                        horodaté, pas un choix dans une liste. */}
                    {s.statut === 'recu' && (
                      <button onClick={() => modifier(s.id, { statut: 'pris_en_charge' }, `${s.reference} pris en charge`)}>
                        Prendre en charge
                      </button>
                    )}
                    {s.statut === 'pris_en_charge' && !s.en_route_le && (
                      <button onClick={() => modifier(s.id, { en_route_le: new Date().toISOString() }, `${s.reference} : moyen en route`)}>
                        Moyen en route
                      </button>
                    )}
                    {s.statut === 'pris_en_charge' && s.en_route_le && (
                      <button onClick={() => modifier(s.id, { statut: 'en_cours' }, `${s.reference} : sur place`)}>
                        Sur place
                      </button>
                    )}
                    {!['clos', 'sans_suite'].includes(s.statut) && (
                      <>
                        <button className="discret cloturer" onClick={() => modifier(s.id, { statut: 'clos' }, `${s.reference} clôturé`)}>
                          Clôturer
                        </button>
                        <button className="discret" onClick={() => modifier(s.id, { statut: 'sans_suite' }, `${s.reference} classé sans suite`)}>
                          Sans suite
                        </button>
                      </>
                    )}
                    {['clos', 'sans_suite'].includes(s.statut) && (
                      <button className="discret" onClick={() => modifier(s.id, { statut: 'pris_en_charge' }, `${s.reference} rouvert`)}>
                        Rouvrir
                      </button>
                    )}
                    <select
                      value={s.gravite ?? ''}
                      onChange={(e) => modifier(s.id, { gravite: e.target.value || null })}
                      style={{ width: 'auto', marginBottom: 0 }}
                      aria-label="Gravité"
                    >
                      <option value="">— gravité —</option>
                      {GRAVITES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="jeton">{STATUTS.find(([v]) => v === s.statut)?.[1] ?? s.statut}</span>
                )}
                {peutDemande && !demande && !enConversion && !['clos', 'sans_suite'].includes(s.statut) && (
                  <button
                    className="discret"
                    onClick={() => setConversion({ signalement: s, priorite: 'P2', equipe: '' })}
                    title="Créer une demande sécurité à partir de ce signalement et le passer en pris en charge"
                  >
                    → Demande
                  </button>
                )}
                {s.latitude && (
                  <a
                    className="lien-externe"
                    href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Itinéraire
                  </a>
                )}
              </div>
              {enConversion && (
                <div className="ligne-boutons conversion" style={{ marginTop: 8 }}>
                  <select
                    value={conversion.priorite}
                    onChange={(e) => setConversion({ ...conversion, priorite: e.target.value })}
                    style={{ width: 'auto', marginBottom: 0 }}
                    aria-label="Priorité de la demande"
                  >
                    {PRIORITES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <select
                    value={conversion.equipe}
                    onChange={(e) => setConversion({ ...conversion, equipe: e.target.value })}
                    style={{ width: 'auto', marginBottom: 0 }}
                    aria-label="Équipe"
                  >
                    <option value="">— équipe (plus tard) —</option>
                    {equipes.map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.code} · {eq.nom}
                      </option>
                    ))}
                  </select>
                  <button onClick={convertir}>Créer la demande</button>
                  <button className="discret" onClick={() => setConversion(null)}>
                    Annuler
                  </button>
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

export function libelleGravite(g) {
  return GRAVITES.find(([v]) => v === g)?.[1] ?? g
}

function ecartFile(s) {
  return Math.round((new Date(s.recu_le) - new Date(s.emis_le)) / 60000)
}

function hms(iso) {
  return new Date(iso).toLocaleTimeString('fr-BE')
}

function hm(iso) {
  return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}

/** Délai lisible entre deux instants : « 4 min », « 1 h 12 ». */
function delai(depuis, jusqua) {
  const min = Math.max(0, Math.round((new Date(jusqua) - new Date(depuis)) / 60000))
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}
