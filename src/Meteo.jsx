import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Veille météo.
 *
 * Le principe vient de la fiche STD-05 : le seuil de décision se fixe à
 * froid, avant que le phénomène arrive. L'écran ne fait que confronter
 * la prévision aux seuils écrits et proposer la consigne décidée
 * d'avance.
 *
 * Ce qu'il ne fait PAS, et c'est délibéré : déclencher l'alerte tout
 * seul. Aucune tâche de fond ne tourne — si personne ne regarde, rien ne
 * se passe. Une alerte automatique donnerait l'illusion inverse, ce qui
 * serait pire que pas d'alerte du tout.
 *
 * Source : Open-Meteo, sans clé ni compte. Nécessite du réseau.
 */

const NIVEAUX = { nominal: 0, vigilance: 1, critique: 2 }

export default function Meteo({ evenement, peut, toutPouvoir, onAlerte }) {
  const [seuils, setSeuils] = useState(null)
  const [previsions, setPrevisions] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [reglage, setReglage] = useState(false)

  const lat = evenement.point_0_lat
  const lon = evenement.point_0_lon

  async function chargerSeuils() {
    const { data } = await supabase
      .from('veille_meteo')
      .select('*')
      .eq('evenement_id', evenement.id)
      .maybeSingle()
    setSeuils(data)
  }

  async function chargerMeteo() {
    if (!lat || !lon) return
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        '&hourly=temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,weather_code' +
        '&forecast_days=2&timezone=auto'
      const r = await fetch(url)
      if (!r.ok) throw new Error('Service météo indisponible')
      const d = await r.json()
      setPrevisions(d.hourly)
      setErreur(null)
    } catch (e) {
      setErreur(e.message)
    }
  }

  useEffect(() => {
    chargerSeuils()
  }, [evenement.id])

  useEffect(() => {
    chargerMeteo()
    const t = setInterval(chargerMeteo, 15 * 60 * 1000)
    return () => clearInterval(t)
  }, [lat, lon])

  if (!lat || !lon) {
    return (
      <section className="bloc">
        <h2>Veille météo</h2>
        <p className="vide">
          Le point 0 de l'événement n'a pas de coordonnées. Sans lui, aucune prévision
          locale n'est possible.
        </p>
      </section>
    )
  }

  if (!seuils) return null

  const heures = extraire(previsions)
  const evaluees = heures.map((h) => ({ ...h, ...evaluer(h, seuils) }))
  const pire = evaluees.reduce(
    (acc, h) => (NIVEAUX[h.niveau] > NIVEAUX[acc.niveau] ? h : acc),
    { niveau: 'nominal' }
  )
  const maintenant = evaluees[0]
  const peutAlerter = toutPouvoir || peut?.('alertes', 'creer')

  return (
    <section className={`bloc meteo meteo-${pire.niveau}`}>
      <div className="entete-dashboard">
        <h2>Veille météo</h2>
        {peutAlerter && (
          <button className="lien" onClick={() => setReglage(!reglage)}>
            {reglage ? 'Terminé' : 'Seuils'}
          </button>
        )}
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}

      {reglage && (
        <ReglageSeuils
          seuils={seuils}
          evenementId={evenement.id}
          onFait={() => {
            setReglage(false)
            chargerSeuils()
          }}
        />
      )}

      {pire.niveau !== 'nominal' && (
        <div className={`bandeau-alerte niv-${pire.niveau === 'critique' ? 'urgence' : 'vigilance'}`}>
          <div className="niv">{pire.niveau}</div>
          <div className="contenu">
            <strong>
              {pire.motifs.join(' · ')} — {quand(pire.heure)}
            </strong>
            <div className="consigne">
              →{' '}
              {pire.niveau === 'critique'
                ? seuils.consigne_critique
                : seuils.consigne_vigilance}
            </div>
            {peutAlerter && (
              <div className="ligne-boutons" style={{ marginTop: 8 }}>
                <button
                  onClick={() =>
                    onAlerte?.({
                      niveau: pire.niveau === 'critique' ? 'urgence' : 'vigilance',
                      titre: `Météo — ${pire.motifs.join(', ')} vers ${quand(pire.heure)}`,
                      message: `Rafales ${Math.round(pire.rafale)} km/h, ${pire.pluie} mm/h, ${Math.round(pire.temp)} °C`,
                      consigne:
                        pire.niveau === 'critique'
                          ? seuils.consigne_critique
                          : seuils.consigne_vigilance
                    })
                  }
                >
                  Diffuser l'alerte
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {maintenant && (
        <div className="grille-paves" style={{ marginBottom: 14 }}>
          <div className="pave">
            <div className="pave-titre">Rafales</div>
            <div className={`grand ${maintenant.niveau !== 'nominal' ? 'alerte-texte' : ''}`}>
              {Math.round(maintenant.rafale)}
            </div>
            <div className="detail-metrique">
              <span>km/h · vigilance à {seuils.rafale_vigilance_kmh}</span>
            </div>
          </div>
          <div className="pave">
            <div className="pave-titre">Précipitations</div>
            <div className="grand">{maintenant.pluie}</div>
            <div className="detail-metrique">
              <span>mm/h</span>
            </div>
          </div>
          <div className="pave">
            <div className="pave-titre">Température</div>
            <div className="grand">{Math.round(maintenant.temp)}</div>
            <div className="detail-metrique">
              <span>°C</span>
            </div>
          </div>
        </div>
      )}

      {evaluees.length > 0 && (
        <>
          <div className="pave-titre">Prochaines 24 heures</div>
          <div className="bandes-meteo">
            {evaluees.slice(0, 24).map((h, i) => (
              <div
                key={i}
                className={`bande niv-${h.niveau}`}
                title={`${quand(h.heure)} — rafales ${Math.round(h.rafale)} km/h, ${h.pluie} mm/h`}
              >
                <span className="bande-heure mono">
                  {new Date(h.heure).getHours().toString().padStart(2, '0')}
                </span>
                <span className="bande-valeur mono">{Math.round(h.rafale)}</span>
              </div>
            ))}
          </div>
          <p className="aide">
            Rafales en km/h, heure par heure. Aucune surveillance ne tourne en arrière-plan :
            cet écran ne prévient que celui qui le regarde.
          </p>
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

function extraire(h) {
  if (!h?.time) return []
  const maintenant = Date.now() - 30 * 60 * 1000
  return h.time
    .map((t, i) => ({
      heure: t,
      temp: h.temperature_2m?.[i] ?? 0,
      pluie: h.precipitation?.[i] ?? 0,
      vent: h.wind_speed_10m?.[i] ?? 0,
      rafale: h.wind_gusts_10m?.[i] ?? 0,
      code: h.weather_code?.[i] ?? 0
    }))
    .filter((x) => new Date(x.heure).getTime() >= maintenant)
    .slice(0, 36)
}

function evaluer(h, s) {
  const motifs = []
  let niveau = 'nominal'

  const monter = (n) => {
    if (NIVEAUX[n] > NIVEAUX[niveau]) niveau = n
  }

  if (h.rafale >= s.rafale_critique_kmh) {
    motifs.push(`rafales ${Math.round(h.rafale)} km/h`)
    monter('critique')
  } else if (h.rafale >= s.rafale_vigilance_kmh) {
    motifs.push(`rafales ${Math.round(h.rafale)} km/h`)
    monter('vigilance')
  }

  if (h.pluie >= Number(s.pluie_critique_mm)) {
    motifs.push(`pluie ${h.pluie} mm/h`)
    monter('critique')
  } else if (h.pluie >= Number(s.pluie_vigilance_mm)) {
    motifs.push(`pluie ${h.pluie} mm/h`)
    monter('vigilance')
  }

  if (h.temp >= s.temp_max_vigilance) {
    motifs.push(`${Math.round(h.temp)} °C`)
    monter('vigilance')
  }
  if (h.temp <= s.temp_min_vigilance) {
    motifs.push(`${Math.round(h.temp)} °C`)
    monter('vigilance')
  }

  // Codes Open-Meteo 95 à 99 : orage, avec ou sans grêle
  if (s.alerte_orage && h.code >= 95) {
    motifs.push('orage annoncé')
    monter('critique')
  }

  return { niveau, motifs }
}

function quand(iso) {
  const d = new Date(iso)
  const dans = Math.round((d - Date.now()) / 3600000)
  const heure = d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
  if (dans <= 0) return 'maintenant'
  if (dans < 24) return `${heure} (dans ${dans} h)`
  return d.toLocaleString('fr-BE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

function ReglageSeuils({ seuils, evenementId, onFait }) {
  const [f, setF] = useState(seuils)
  const [occupe, setOccupe] = useState(false)

  async function enregistrer() {
    setOccupe(true)
    const { evenement_id, created_at, updated_at, created_by, updated_by, ...champs } = f
    await supabase.from('veille_meteo').update(champs).eq('evenement_id', evenementId)
    setOccupe(false)
    onFait()
  }

  const nombre = (clef, libelle, unite) => (
    <div key={clef}>
      <label htmlFor={clef}>
        {libelle} {unite && <span className="mono">({unite})</span>}
      </label>
      <input
        id={clef}
        type="number"
        value={f[clef] ?? ''}
        onChange={(e) => setF({ ...f, [clef]: e.target.value })}
      />
    </div>
  )

  return (
    <div className="formulaire">
      <div className="pave-titre">Vent</div>
      {nombre('rafale_vigilance_kmh', 'Vigilance à partir de', 'km/h')}
      {nombre('rafale_critique_kmh', 'Critique à partir de', 'km/h')}

      <div className="pave-titre" style={{ marginTop: 12 }}>Précipitations</div>
      {nombre('pluie_vigilance_mm', 'Vigilance', 'mm/h')}
      {nombre('pluie_critique_mm', 'Critique', 'mm/h')}

      <div className="pave-titre" style={{ marginTop: 12 }}>Températures</div>
      {nombre('temp_max_vigilance', 'Chaleur', '°C')}
      {nombre('temp_min_vigilance', 'Froid', '°C')}

      <div className="pave-titre" style={{ marginTop: 12 }}>Consignes</div>
      <label htmlFor="cv">Au franchissement de la vigilance</label>
      <input
        id="cv"
        value={f.consigne_vigilance ?? ''}
        onChange={(e) => setF({ ...f, consigne_vigilance: e.target.value })}
      />
      <label htmlFor="cc">Au franchissement du seuil critique</label>
      <input
        id="cc"
        value={f.consigne_critique ?? ''}
        onChange={(e) => setF({ ...f, consigne_critique: e.target.value })}
      />

      <button disabled={occupe} onClick={enregistrer}>
        Enregistrer les seuils
      </button>
      <p className="aide">
        Les valeurs livrées sont des points de départ issus des pratiques de montage de
        structures temporaires. Elles ne remplacent ni les prescriptions du fabricant de ton
        chapiteau, ni l'avis de la zone de secours.
      </p>
    </div>
  )
}
