import { useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Point 0 — la coordonnée de référence de l'événement.
 *
 * Sert à trois choses : centrer les cartes par défaut, calculer les
 * distances dans le plan d'implantation, et surtout localiser les
 * prévisions météo. Sans lui, la veille météo ne peut tout simplement
 * pas savoir où regarder — d'où son absence silencieuse tant que ce
 * champ n'était encodé nulle part.
 */
const PROVINCES = [
  'Anvers', 'Brabant flamand', 'Brabant wallon', 'Bruxelles-Capitale',
  'Flandre-Occidentale', 'Flandre-Orientale', 'Hainaut', 'Liège',
  'Limbourg', 'Luxembourg', 'Namur'
]

export default function Point0({ evenement, onFait, setMessage }) {
  const [lat, setLat] = useState(evenement.point_0_lat ?? '')
  const [lon, setLon] = useState(evenement.point_0_lon ?? '')
  const [province, setProvince] = useState(evenement.province ?? '')
  const [occupe, setOccupe] = useState(false)
  const [occupeProvince, setOccupeProvince] = useState(false)
  const [provinceEnregistree, setProvinceEnregistree] = useState(false)

  async function enregistrerProvince() {
    setOccupeProvince(true)
    const { error } = await supabase
      .from('evenements')
      .update({ province: province || null })
      .eq('id', evenement.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      onFait()
      setProvinceEnregistree(true)
      setTimeout(() => setProvinceEnregistree(false), 2500)
    }
    setOccupeProvince(false)
  }

  function localiser() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(5))
        setLon(p.coords.longitude.toFixed(5))
      },
      () => setMessage({ type: 'erreur', texte: 'Position indisponible sur cet appareil.' })
    )
  }

  async function enregistrer() {
    const la = Number(lat)
    const lo = Number(lon)
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      setMessage({
        type: 'erreur',
        texte: 'Coordonnées invalides — latitude entre -90 et 90, longitude entre -180 et 180.'
      })
      return
    }
    setOccupe(true)
    const { error } = await supabase
      .from('evenements')
      .update({ point_0_lat: la, point_0_lon: lo })
      .eq('id', evenement.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFait()
    setOccupe(false)
  }

  return (
    <section className="bloc">
      <h2>Point 0</h2>
      <p className="aide">
        La coordonnée de référence de l'événement — centre des cartes, base des distances
        dans le plan d'implantation, et localisation des prévisions de la veille météo.
        Sans elle, la météo ne peut pas savoir où regarder.
      </p>

      <div className="saisie-rapide">
        <input
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          placeholder="Latitude — ex. 50.38212"
          inputMode="decimal"
        />
        <input
          value={lon}
          onChange={(e) => setLon(e.target.value)}
          placeholder="Longitude — ex. 5.61679"
          inputMode="decimal"
        />
        <button className="discret" onClick={localiser}>
          Utiliser ma position
        </button>
      </div>

      <button disabled={occupe || !lat || !lon} onClick={enregistrer}>
        Enregistrer le point 0
      </button>

      <label htmlFor="province" style={{ marginTop: 14 }}>
        Province — pour l'avertissement officiel IRM
      </label>
      <div className="saisie-rapide">
        <select
          id="province"
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">— non renseignée —</option>
          {PROVINCES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          disabled={occupeProvince || province === (evenement.province ?? '')}
          onClick={enregistrerProvince}
        >
          {provinceEnregistree ? 'Enregistré ✓' : 'Enregistrer'}
        </button>
      </div>

      {evenement.point_0_lat && (
        <p className="aide">
          Actuellement :{' '}
          <span className="mono">
            {evenement.point_0_lat}, {evenement.point_0_lon}
          </span>
        </p>
      )}
    </section>
  )
}
