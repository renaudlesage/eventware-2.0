import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { modifierOuRefuser } from './ecriture'

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
  const [commune, setCommune] = useState(evenement.commune ?? '')
  const [communesConnues, setCommunesConnues] = useState([])
  const [modeParcours, setModeParcours] = useState(evenement.mode_parcours ?? 'groupes')
  const [occupeMode, setOccupeMode] = useState(false)
  const [modeEnregistre, setModeEnregistre] = useState(false)
  const [occupe, setOccupe] = useState(false)
  const [occupeProvince, setOccupeProvince] = useState(false)
  const [occupeCommune, setOccupeCommune] = useState(false)
  const [provinceEnregistree, setProvinceEnregistree] = useState(false)
  const [communeEnregistree, setCommuneEnregistree] = useState(false)

  useEffect(() => {
    supabase
      .from('communes')
      .select('nom, province')
      .order('nom')
      .then(({ data }) => setCommunesConnues(data ?? []))
  }, [])

  // La liste se restreint à la province choisie : 261 communes à
  // dérouler, c'est une bibliothèque ; 20 à 80, c'est un choix. Une
  // commune déjà enregistrée reste proposée même si elle n'est pas de
  // la province — pour qu'on la voie, et qu'on corrige l'une ou l'autre.
  const communesProposees = communesConnues.filter(
    (c) => !province || c.province === province || c.nom === commune
  )

  async function enregistrerMode(valeur) {
    setOccupeMode(true)
    setModeParcours(valeur)
    const refus = await modifierOuRefuser('evenements', { mode_parcours: valeur }, { id: evenement.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else {
      onFait()
      setModeEnregistre(true)
      setTimeout(() => setModeEnregistre(false), 2500)
    }
    setOccupeMode(false)
  }

  async function enregistrerCommune() {
    setOccupeCommune(true)
    const refus = await modifierOuRefuser(
      'evenements',
      { commune: commune.trim() || null },
      { id: evenement.id }
    )
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else {
      onFait()
      setCommuneEnregistree(true)
      setTimeout(() => setCommuneEnregistree(false), 2500)
    }
    setOccupeCommune(false)
  }

  async function enregistrerProvince() {
    setOccupeProvince(true)
    const refus = await modifierOuRefuser('evenements', { province: province || null }, { id: evenement.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
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
    const refus = await modifierOuRefuser(
      'evenements',
      { point_0_lat: la, point_0_lon: lo },
      { id: evenement.id }
    )
    if (refus) setMessage({ type: 'erreur', texte: refus })
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

      <label htmlFor="commune" style={{ marginTop: 14 }}>
        Commune — pour résoudre automatiquement la zone de police et la zone de secours
        {province && communesProposees.length > 0 && (
          <span className="aide"> · {communesProposees.length} dans la province</span>
        )}
      </label>
      <div className="saisie-rapide">
        <select
          id="commune"
          value={commune}
          onChange={(e) => setCommune(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">
            {province ? `— commune de la province de ${province} —` : '— toutes les communes —'}
          </option>
          {/* Une commune enregistrée hors bibliothèque (saisie libre
              d'avant) reste sélectionnable, sinon le champ afficherait
              vide alors que la base porte une valeur. */}
          {commune && !communesConnues.some((c) => c.nom === commune) && (
            <option value={commune}>{commune} (hors bibliothèque)</option>
          )}
          {communesProposees.map((c) => (
            <option key={c.nom} value={c.nom}>
              {c.nom}
              {province && c.province !== province ? ` (${c.province})` : ''}
            </option>
          ))}
        </select>
        <button
          disabled={occupeCommune || commune === (evenement.commune ?? '')}
          onClick={enregistrerCommune}
        >
          {communeEnregistree ? 'Enregistré ✓' : 'Enregistrer'}
        </button>
      </div>
      <p className="aide">
        Choisir d'abord la province raccourcit la liste. Si la commune ne figure pas dans la
        bibliothèque, Réglages › Conformité › Référentiels le signale clairement plutôt que de
        laisser croire à une couverture qui n'existe pas.
      </p>

      {/* Un site fermé — festival sur une plaine, fête de village — n'a
          pas de parcours du tout. L'interrupteur existe déjà dans
          Réglages → Dispositif ; ce sélecteur ne doit pas imposer un
          choix que le module rend sans objet. */}
      {evenement.modules?.parcours ? (
          <>
      <label htmlFor="mode-parcours" style={{ marginTop: 14 }}>
          Suivi du parcours {modeEnregistre && <span className="jeton">enregistré ✓</span>}
        </label>
        <select
          id="mode-parcours"
          value={modeParcours}
          disabled={occupeMode}
          onChange={(e) => enregistrerMode(e.target.value)}
        >
          <option value="groupes">Groupes encadrés — on suit qui est où</option>
          <option value="individuels">Individus isolés — on compte les passages</option>
        </select>
        <p className="aide">
          <strong>Groupes encadrés</strong> : des groupes nommés, un accompagnateur joignable,
          un effectif connu. On sait lequel n'a pas pointé depuis trop longtemps.
          <br />
          <strong>Individus isolés</strong> : marche Adeps, rando VTT. Personne ne peut nommer
          six cents marcheurs — on compte les passages à chaque borne, et l'écart entre deux
          bornes dit combien de personnes sont encore sur le tronçon.
        </p>
          </>
      ) : (
        <p className="aide" style={{ marginTop: 14 }}>
          <span className="etiquette">Suivi du parcours</span> Le module Parcours est
          désactivé — rien à régler ici. C'est le cas d'un site fermé : une plaine, une
          salle, une fête de village. Pour l'activer, Réglages → Dispositif → Modules.
        </p>
      )}
    </section>
  )
}
