import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Polygon, CircleMarker, Popup, useMap } from 'react-leaflet'
import { supabase } from './supabaseClient'

const CATEGORIES = [
  ['foodtruck', 'Foodtruck', 'point', true],
  ['groupe_electrogene', 'Groupe électrogène', 'point', true],
  ['stockage_gaz', 'Stockage gaz', 'point', true],
  ['bar_installation', 'Bar', 'point', true],
  ['feu', 'Feu / brasero', 'point', true],
  ['extincteur', 'Extincteur', 'point', false],
  ['dea', 'DEA', 'point', false],
  ['point_eau', "Point d'eau", 'point', false],
  ['poste_secours', 'Poste de secours', 'point', false],
  ['coupure_gaz', 'Coupure gaz', 'point', false],
  ['coffret_electrique', 'Coffret électrique', 'point', false],
  ['sortie_secours', 'Sortie de secours', 'point', false],
  ['cheminement', 'Cheminement', 'ligne', false],
  ['itineraire_evacuation', "Itinéraire d'évacuation", 'ligne', false],
  ['voie_engins', 'Voie engins', 'ligne', false],
  ['cable', 'Câble', 'ligne', false],
  ['tuyau', 'Tuyau', 'ligne', false],
  ['scene', 'Scène', 'zone', false],
  ['bar', 'Zone bar', 'zone', false],
  ['camping', 'Camping', 'zone', false],
  ['parking', 'Parking', 'zone', false],
  ['perimetre', 'Périmètre', 'zone', false],
  ['zone_interdite', 'Zone interdite', 'zone', false],
  ['autre', 'Autre', 'point', false]
]

const libelleCat = (c) => CATEGORIES.find((x) => x[0] === c)?.[1] ?? c

const COULEUR = (e) =>
  e.est_risque ? '#a3341f' : e.confirme ? '#1d5c4f' : '#6b6862'

export default function PlanImplantation({ evenement, membre }) {
  const [elements, setElements] = useState([])
  const [message, setMessage] = useState(null)
  const [vue, setVue] = useState('tournee')
  const [position, setPosition] = useState(null)
  const [edite, setEdite] = useState(null)

  async function charger() {
    const { data, error } = await supabase
      .from('elements_plan')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('code')
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setElements(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setPosition({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          precision: p.coords.accuracy
        }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  async function maj(id, champs) {
    const { error, count } = await supabase
      .from('elements_plan')
      .update(champs, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Modification refusée.' })
    else charger()
  }

  async function confirmerIci(e) {
    const champs = { confirme: true, confirme_par: membre.id }
    if (position) {
      champs.geometrie = [[position.lat, position.lon]]
      champs.precision_m = position.precision
    }
    await maj(e.id, champs)
  }

  const aConfirmer = elements.filter((e) => !e.confirme)
  const risques = elements.filter((e) => e.est_risque)
  const localises = elements.filter((e) => (e.geometrie ?? []).length > 0)

  return (
    <div className="bloc securite dom-prune">
      <h2>Plan d'implantation</h2>

      <div className="onglets">
        {[
          ['tournee', `Tournée (${aConfirmer.length})`],
          ['carte', 'Carte'],
          ['risques', `Risques (${risques.length})`],
          ['ajout', 'Ajouter']
        ].map(([k, l]) => (
          <button
            key={k}
            className={`module ${vue === k ? 'actif' : ''}`}
            onClick={() => setVue(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      <div className="geo">
        {position ? (
          <>
            Position : <span className="mono">{position.lat.toFixed(5)} · {position.lon.toFixed(5)}</span>{' '}
            — précision ±{Math.round(position.precision)} m
            {position.precision > 15 && (
              <>
                <br />
                <span className="alerte-texte">
                  Précision insuffisante pour affirmer une distance. Corrige le point sur la
                  carte après l'avoir posé.
                </span>
              </>
            )}
          </>
        ) : (
          "Position indisponible — les éléments posés n'auront pas de coordonnées."
        )}
      </div>

      {vue === 'tournee' && (
        <>
          {aConfirmer.length === 0 ? (
            <p className="vide">Tout est confirmé sur site.</p>
          ) : (
            aConfirmer.map((e) => (
              <div className={`carte ${e.est_risque ? 'urgent' : ''}`} key={e.id}>
                <div className="titre">
                  <span className="mono">{e.code}</span> — {e.nom}
                </div>
                <div className="meta">
                  <span>{libelleCat(e.categorie)}</span>
                  <span>{e.forme}</span>
                  {e.est_risque && <span className="alerte-texte">à risque</span>}
                  {(e.geometrie ?? []).length === 0 && <span>sans position</span>}
                </div>
                <div className="ligne-boutons" style={{ marginTop: 10 }}>
                  <button onClick={() => confirmerIci(e)}>
                    Confirmer ici {position ? '(GPS)' : ''}
                  </button>
                  <button className="discret" onClick={() => setEdite(edite === e.id ? null : e.id)}>
                    Détail
                  </button>
                </div>
                {edite === e.id && <FicheRisque element={e} onMaj={maj} />}
              </div>
            ))
          )}
          <p className="aide">
            Passe devant chaque implantation, confirme ou crée. Le risque naît de
            l'implantation constatée, pas de la liste des exposants.
          </p>
        </>
      )}

      {vue === 'carte' && (
        <Carte elements={localises} evenement={evenement} position={position} />
      )}

      {vue === 'risques' && (
        <>
          <div className="ligne-boutons" style={{ marginBottom: 12 }}>
            <button className="discret" onClick={() => window.print()}>
              Imprimer / PDF
            </button>
          </div>
          <div className="imprimable">
            <h3 className="titre-impression">
              {evenement.nom} — installations à risque
            </h3>
            {risques.length === 0 ? (
              <p className="vide">Aucune installation à risque déclarée.</p>
            ) : (
              risques.map((e) => (
                <div className="carte" key={e.id}>
                  <div className="titre">
                    <span className="mono">{e.code}</span> — {e.nom}
                    {!e.confirme && <span className="jeton alerte-texte"> non confirmé</span>}
                  </div>
                  <div className="meta">
                    <span>{libelleCat(e.categorie)}</span>
                    {(e.geometrie ?? [])[0] && (
                      <span className="mono">
                        {e.geometrie[0][0].toFixed(5)} · {e.geometrie[0][1].toFixed(5)}
                        {e.precision_m && ` (±${Math.round(e.precision_m)} m)`}
                      </span>
                    )}
                    {e.responsable && <span>{e.responsable}</span>}
                    {e.contact && <span className="mono">{e.contact}</span>}
                  </div>
                  <dl className="fiche">
                    {e.mesures_maitrise && (
                      <>
                        <dt>Mesures de maîtrise</dt>
                        <dd>{e.mesures_maitrise}</dd>
                      </>
                    )}
                    {e.organe_coupure && (
                      <>
                        <dt>Organe de coupure</dt>
                        <dd>{e.organe_coupure}</dd>
                      </>
                    )}
                    {e.moyens_proximite && (
                      <>
                        <dt>Moyens à proximité</dt>
                        <dd>{e.moyens_proximite}</dd>
                      </>
                    )}
                    {e.ecart_constate && (
                      <>
                        <dt>Écart constaté</dt>
                        <dd className="alerte-texte">{e.ecart_constate}</dd>
                      </>
                    )}
                  </dl>
                </div>
              ))
            )}
          </div>
          <p className="aide">
            Cette liste est ce qu'on tend aux pompiers. Où couper, quoi éteindre, qui
            appeler — dans cet ordre.
          </p>
        </>
      )}

      {vue === 'ajout' && (
        <Ajout
          evenement={evenement}
          position={position}
          onFait={() => {
            setVue('tournee')
            charger()
          }}
          setMessage={setMessage}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function FicheRisque({ element, onMaj }) {
  const [f, setF] = useState({
    mesures_maitrise: element.mesures_maitrise ?? '',
    organe_coupure: element.organe_coupure ?? '',
    moyens_proximite: element.moyens_proximite ?? '',
    responsable: element.responsable ?? '',
    contact: element.contact ?? '',
    ecart_constate: element.ecart_constate ?? ''
  })

  return (
    <div className="formulaire">
      {[
        ['mesures_maitrise', 'Mesures de maîtrise'],
        ['organe_coupure', 'Organe de coupure — où couper'],
        ['moyens_proximite', 'Moyens de secours à proximité'],
        ['responsable', 'Responsable joignable'],
        ['contact', 'Téléphone'],
        ['ecart_constate', 'Écart avec le plan prévu']
      ].map(([k, l]) => (
        <div key={k}>
          <label htmlFor={element.id + k}>{l}</label>
          <input
            id={element.id + k}
            value={f[k]}
            onChange={(e) => setF({ ...f, [k]: e.target.value })}
          />
        </div>
      ))}
      <button onClick={() => onMaj(element.id, f)}>Enregistrer</button>
    </div>
  )
}

function Ajout({ evenement, position, onFait, setMessage }) {
  const [f, setF] = useState({ code: '', nom: '', categorie: 'foodtruck' })
  const cat = CATEGORIES.find((c) => c[0] === f.categorie)

  async function creer() {
    if (!f.code.trim() || !f.nom.trim()) return
    const { error } = await supabase.from('elements_plan').insert({
      evenement_id: evenement.id,
      code: f.code.trim(),
      nom: f.nom.trim(),
      categorie: f.categorie,
      forme: cat?.[2] ?? 'point',
      est_risque: cat?.[3] ?? false,
      geometrie: position ? [[position.lat, position.lon]] : [],
      precision_m: position?.precision ?? null,
      confirme: !!position
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFait()
  }

  return (
    <div className="formulaire">
      <label htmlFor="cat">Nature</label>
      <select
        id="cat"
        value={f.categorie}
        onChange={(e) => setF({ ...f, categorie: e.target.value })}
      >
        {CATEGORIES.map(([v, l, forme, risque]) => (
          <option key={v} value={v}>
            {l} {risque ? '⚠' : ''}
          </option>
        ))}
      </select>
      <div className="saisie-rapide">
        <input
          value={f.code}
          onChange={(e) => setF({ ...f, code: e.target.value })}
          placeholder="Code"
          style={{ flex: '0 1 110px' }}
        />
        <input
          value={f.nom}
          onChange={(e) => setF({ ...f, nom: e.target.value })}
          placeholder="Nom"
        />
      </div>
      <button className="bouton-terrain" disabled={!f.code.trim() || !f.nom.trim()} onClick={creer}>
        Poser ici
      </button>
      <p className="aide">
        {cat?.[2] === 'point'
          ? "L'élément est posé à ta position actuelle."
          : `Forme « ${cat?.[2]} » : le premier point est posé ici, les suivants s'ajoutent en repassant.`}
        {cat?.[3] && ' Cette nature est marquée à risque : complète sa fiche depuis la tournée.'}
      </p>
    </div>
  )
}

function Carte({ elements, evenement, position }) {
  const centre =
    elements[0]?.geometrie?.[0] ??
    (evenement.point_0_lat ? [evenement.point_0_lat, evenement.point_0_lon] : [50.38212, 5.61679])

  if (!elements.length) return <p className="vide">Aucun élément localisé.</p>

  return (
    <div className="carte-conteneur" style={{ height: 380 }}>
      <MapContainer center={centre} zoom={17}>
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {elements.map((e) => {
          const g = e.geometrie
          const couleur = COULEUR(e)
          if (e.forme === 'point' || g.length === 1) {
            return (
              <CircleMarker
                key={e.id}
                center={g[0]}
                radius={e.est_risque ? 9 : 6}
                pathOptions={{ color: couleur, fillColor: couleur, fillOpacity: 0.75 }}
              >
                <Popup>
                  <strong>{e.code}</strong> — {e.nom}
                  <br />
                  {libelleCat(e.categorie)}
                  {e.organe_coupure && (
                    <>
                      <br />
                      Coupure : {e.organe_coupure}
                    </>
                  )}
                </Popup>
              </CircleMarker>
            )
          }
          if (e.forme === 'zone') {
            return (
              <Polygon key={e.id} positions={g} pathOptions={{ color: couleur, weight: 2 }}>
                <Popup>{e.nom}</Popup>
              </Polygon>
            )
          }
          return (
            <Polyline key={e.id} positions={g} pathOptions={{ color: couleur, weight: 3 }}>
              <Popup>{e.nom}</Popup>
            </Polyline>
          )
        })}
        {position && (
          <CircleMarker
            center={[position.lat, position.lon]}
            radius={5}
            pathOptions={{ color: '#1d5c4f', fillColor: '#fff', fillOpacity: 1 }}
          />
        )}
        <Cadrer elements={elements} />
      </MapContainer>
    </div>
  )
}

function Cadrer({ elements }) {
  const carte = useMap()
  useEffect(() => {
    const pts = elements.flatMap((e) => e.geometrie ?? [])
    if (pts.length) carte.fitBounds(pts, { padding: [30, 30], maxZoom: 18 })
  }, [elements.length])
  return null
}
