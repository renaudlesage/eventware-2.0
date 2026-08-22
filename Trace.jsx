import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet'
import { supabase } from './supabaseClient'
import { lireTrace, mesurer, simplifier, profil } from './gpx'

export default function Trace({ evenement, setMessage }) {
  const [traces, setTraces] = useState([])
  const [active, setActive] = useState(null)
  const [lieux, setLieux] = useState([])
  const [apercu, setApercu] = useState(null)
  const [nom, setNom] = useState('')
  const [code, setCode] = useState('')
  const [occupe, setOccupe] = useState(false)

  async function charger() {
    const [t, l] = await Promise.all([
      supabase.from('traces').select('*').eq('evenement_id', evenement.id).order('nom'),
      supabase
        .from('lieux')
        .select('id, code, nom, latitude, longitude, pk_km, type')
        .eq('evenement_id', evenement.id)
    ])
    if (t.error) setMessage({ type: 'erreur', texte: t.error.message })
    else {
      setTraces(t.data ?? [])
      setActive((a) => a ?? t.data?.[0] ?? null)
    }
    setLieux((l.data ?? []).filter((x) => x.latitude && x.longitude))
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function lireFichier(fichier) {
    setMessage(null)
    try {
      const texte = await fichier.text()
      const bruts = lireTrace(texte)
      const points = simplifier(bruts)
      const mesures = mesurer(points)
      setApercu({ points, mesures, brut: bruts.length, source: fichier.name })
      if (!nom) setNom(fichier.name.replace(/\.(gpx|kml)$/i, ''))
      if (!code) setCode('TRC')
    } catch (e) {
      setMessage({ type: 'erreur', texte: e.message })
      setApercu(null)
    }
  }

  async function enregistrer() {
    setOccupe(true)
    const { error } = await supabase.from('traces').insert({
      evenement_id: evenement.id,
      code: code.trim(),
      nom: nom.trim(),
      points: apercu.points,
      distance_km: apercu.mesures.distance_km,
      denivele_pos: apercu.mesures.denivele_pos,
      denivele_neg: apercu.mesures.denivele_neg,
      source: apercu.source,
      origine: 'import'
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setApercu(null)
      setNom('')
      setCode('')
      charger()
    }
    setOccupe(false)
  }

  const affichee = apercu
    ? { points: apercu.points, nom: 'Aperçu', ...apercu.mesures }
    : active
      ? {
          points: active.points ?? [],
          nom: active.nom,
          distance_km: active.distance_km,
          denivele_pos: active.denivele_pos,
          denivele_neg: active.denivele_neg
        }
      : null

  return (
    <>
      {traces.length > 0 && (
        <div className="ligne-boutons" style={{ marginBottom: 12 }}>
          {traces.map((t) => (
            <button
              key={t.id}
              className={`module ${active?.id === t.id && !apercu ? 'actif' : ''}`}
              onClick={() => {
                setApercu(null)
                setActive(t)
              }}
            >
              {t.nom}
            </button>
          ))}
        </div>
      )}

      <label htmlFor="gpx">Importer une trace GPX ou KML</label>
      <input
        id="gpx"
        type="file"
        accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml"
        onChange={(e) => e.target.files?.[0] && lireFichier(e.target.files[0])}
      />

      {apercu && (
        <div className="formulaire">
          <div className="compteurs">
            <span>
              Distance <strong>{apercu.mesures.distance_km} km</strong>
            </span>
            <span>
              D+ <strong>{apercu.mesures.denivele_pos} m</strong>
            </span>
            <span>
              D− <strong>{apercu.mesures.denivele_neg} m</strong>
            </span>
            <span>
              Points <strong>{apercu.points.length}</strong> / {apercu.brut}
            </span>
          </div>
          {!apercu.mesures.avec_altitude && (
            <div className="message erreur">
              Ce fichier ne contient pas d'altitude : les dénivelés seront nuls.
            </div>
          )}
          <div className="saisie-rapide">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code"
              style={{ flex: '0 1 100px' }}
            />
            <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom" />
            <button disabled={occupe || !code.trim() || !nom.trim()} onClick={enregistrer}>
              Enregistrer
            </button>
            <button className="discret" onClick={() => setApercu(null)}>
              Annuler
            </button>
          </div>
          <p className="aide">
            Les dénivelés sont calculés avec un filtre de 3 m : l'altitude GPS oscille au
            repos, et sommer les écarts bruts double ou triple le D+. Compare avec la valeur
            que tu connais avant d'enregistrer.
          </p>
        </div>
      )}

      {affichee && affichee.points.length > 0 && (
        <>
          <div className="compteurs">
            <span>{affichee.nom}</span>
            <span>
              <strong>{affichee.distance_km}</strong> km
            </span>
            <span>
              D+ <strong>{affichee.denivele_pos}</strong>
            </span>
            <span>
              D− <strong>{affichee.denivele_neg}</strong>
            </span>
          </div>

          <div className="carte-conteneur" style={{ height: 340 }}>
            <MapContainer center={affichee.points[0].slice(0, 2)} zoom={13}>
              <TileLayer
                attribution="&copy; OpenStreetMap"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Polyline
                positions={affichee.points.map((p) => [p[0], p[1]])}
                pathOptions={{ color: '#1d5c4f', weight: 4 }}
              />
              {lieux.map((l) => (
                <CircleMarker
                  key={l.id}
                  center={[l.latitude, l.longitude]}
                  radius={5}
                  pathOptions={{ color: '#16191c', fillColor: '#fff', fillOpacity: 1 }}
                >
                  <Popup>
                    <strong>{l.nom}</strong>
                    {l.pk_km != null && <> — PK {l.pk_km}</>}
                  </Popup>
                </CircleMarker>
              ))}
              <Cadrer points={affichee.points} />
            </MapContainer>
          </div>

          <Profil points={affichee.points} />
        </>
      )}

      {!affichee && <p className="vide">Aucune trace. Importe un GPX ou un KML.</p>}
    </>
  )
}

function Cadrer({ points }) {
  const carte = useMap()
  useEffect(() => {
    if (points.length) {
      carte.fitBounds(
        points.map((p) => [p[0], p[1]]),
        { padding: [25, 25] }
      )
    }
  }, [points])
  return null
}

/* ------------------------------------------------------------------ */
/* Profil altimétrique                                                 */
/* ------------------------------------------------------------------ */

function Profil({ points }) {
  const serie = useMemo(() => profil(points), [points])
  if (serie.length < 2) return null

  const L = 700
  const H = 130
  const marge = 26

  const dMax = serie[serie.length - 1][0]
  const alts = serie.map((s) => s[1])
  const aMin = Math.floor(Math.min(...alts) / 10) * 10
  const aMax = Math.ceil(Math.max(...alts) / 10) * 10
  const plage = aMax - aMin || 1

  const x = (d) => marge + (d / dMax) * (L - marge * 2)
  const y = (a) => H - marge - ((a - aMin) / plage) * (H - marge * 2)

  const ligne = serie.map((s) => `${x(s[0]).toFixed(1)},${y(s[1]).toFixed(1)}`).join(' ')
  const aire = `${x(0)},${H - marge} ${ligne} ${x(dMax)},${H - marge}`

  return (
    <div className="profil">
      <div className="pave-titre">Profil altimétrique</div>
      <svg viewBox={`0 0 ${L} ${H}`} preserveAspectRatio="none" className="svg-profil">
        <polygon points={aire} fill="var(--actif)" opacity="0.12" />
        <polyline points={ligne} fill="none" stroke="var(--actif)" strokeWidth="1.6" />
        <line
          x1={marge}
          y1={H - marge}
          x2={L - marge}
          y2={H - marge}
          stroke="var(--trait)"
        />
        <text x={marge} y={H - 8} className="axe">
          0 km
        </text>
        <text x={L - marge} y={H - 8} textAnchor="end" className="axe">
          {dMax.toFixed(1)} km
        </text>
        <text x={marge} y={14} className="axe">
          {aMax} m
        </text>
        <text x={marge} y={H - marge - 3} className="axe">
          {aMin} m
        </text>
      </svg>
    </div>
  )
}
