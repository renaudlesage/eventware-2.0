import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from './supabaseClient'

const TYPES = {
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

const COULEURS = {
  recu: '#a3341f',
  pris_en_charge: '#c07000',
  en_cours: '#c07000',
  clos: '#1d5c4f',
  sans_suite: '#6b6862'
}

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

export default function PcOps({ evenement }) {
  const [signalements, setSignalements] = useState([])
  const [erreur, setErreur] = useState(null)
  const [masquerClos, setMasquerClos] = useState(true)
  const minuteur = useRef(null)

  async function charger() {
    const { data, error } = await supabase
      .from('signalements')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('recu_le', { ascending: false })
    if (error) setErreur(error.message)
    else setSignalements(data ?? [])
  }

  useEffect(() => {
    charger()
    minuteur.current = setInterval(charger, 10000)
    return () => clearInterval(minuteur.current)
  }, [evenement.id])

  async function changerStatut(id, statut) {
    const { error } = await supabase.from('signalements').update({ statut }).eq('id', id)
    if (error) setErreur(error.message)
    else charger()
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

  return (
    <div className="pcops dom-orange">
      <h2>
        Signalements participants
        {ouverts > 0 && <span className="jeton alerte-jeton">{ouverts} ouvert(s)</span>}
      </h2>

      {erreur && <div className="message erreur">{erreur}</div>}

      <p className="aide">
        Lien à diffuser aux participants (QR code, affichage, dossard) :<br />
        <span className="identifiant">{lienParticipant}</span>
      </p>

      {geolocalises.length > 0 && (
        <div className="carte-conteneur">
          <MapContainer center={centre} zoom={14} scrollWheelZoom={false}>
            <TileLayer
              attribution='&copy; OpenStreetMap'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
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
        visibles.map((s) => (
          <div className="carte" key={s.id}>
            <div className="titre">
              <span className="mono">{s.reference}</span> — {TYPES[s.type] ?? s.type}
            </div>
            {s.description && <p style={{ margin: '4px 0' }}>{s.description}</p>}
            <div className="meta">
              <span>{new Date(s.recu_le).toLocaleTimeString('fr-BE')}</span>
              {s.emis_le && ecartFile(s) > 1 && (
                <span title="temps passé en file d'attente hors réseau">
                  émis {ecartFile(s)} min plus tôt
                </span>
              )}
              {s.contact && <span>{s.contact}</span>}
              {s.latitude ? (
                <span>
                  {s.latitude.toFixed(5)} · {s.longitude.toFixed(5)} (±
                  {Math.round(s.precision_m ?? 0)} m)
                </span>
              ) : (
                <span>sans position</span>
              )}
            </div>
            <div className="ligne-boutons" style={{ marginTop: 10 }}>
              <select
                value={s.statut}
                onChange={(e) => changerStatut(s.id, e.target.value)}
                style={{ width: 'auto', marginBottom: 0 }}
              >
                {STATUTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
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
          </div>
        ))
      )}
    </div>
  )
}

function ecartFile(s) {
  return Math.round((new Date(s.recu_le) - new Date(s.emis_le)) / 60000)
}
