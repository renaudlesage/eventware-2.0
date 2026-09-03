import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import MoniteurIrm from './MoniteurIrm'

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

/*
 * Niveaux de vigilance — nomenclature IRM (Institut royal
 * météorologique), la même que sur les cartes officielles et que dans
 * la v18 : vert, jaune, orange, rouge. « Jaune » est un avertissement
 * précoce, placé à 80 % du seuil de vigilance — pas une nouvelle
 * mesure, juste un signal plus tôt avec les mêmes données.
 */
const NIVEAUX = { vert: 0, jaune: 1, orange: 2, rouge: 3 }
const LIBELLE_NIVEAU = { vert: 'Vert', jaune: 'Jaune', orange: 'Orange', rouge: 'Rouge' }
const CRITERE_LIBELLE = {
  vent: 'Vent',
  pluie: 'Précipitations',
  chaleur: 'Chaleur',
  froid: 'Froid',
  orage: 'Orage'
}

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
    { niveau: 'vert' }
  )
  const maintenant = evaluees[0]
  const peutAlerter = toutPouvoir || peut?.('alertes', 'creer')

  // Un déclencheur par critère et par heure ; on ne remonte au bandeau
  // que ceux qui atteignent au moins l'alerte (orange) — le jaune reste
  // un avertissement visuel dans la bande horaire, sans texte propre.
  const declencheursAffiches = (pire.declencheurs ?? []).filter((d) => d.niveau !== 'jaune')

  return (
    <section className={`bloc meteo meteo-${pire.niveau}`}>
      <div className="entete-dashboard">
        <h2>Veille météo</h2>
        <div className="ligne-boutons" style={{ marginBottom: 0 }}>
          {/* Badge de vigilance, toujours visible — comme sur les cartes
              IRM : le niveau se voit avant même de lire le texte. */}
          <span className={`badge-vigilance niv-${pire.niveau}`}>
            {LIBELLE_NIVEAU[pire.niveau]}
          </span>
          {peutAlerter && (
            <button className="lien" onClick={() => setReglage(!reglage)}>
              {reglage ? 'Terminé' : 'Seuils'}
            </button>
          )}
        </div>
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

      {declencheursAffiches.length > 0 && (
        <div className={`bandeau-alerte niv-${pire.niveau === 'rouge' ? 'urgence' : 'vigilance'}`}>
          <div className="niv">{LIBELLE_NIVEAU[pire.niveau]}</div>
          <div className="contenu" style={{ width: '100%' }}>
            <strong>{quand(pire.heure)}</strong>
            {/* Une ligne par critère déclenché, chacune avec SA consigne
                — pas un texte générique commun à tous les phénomènes. */}
            {declencheursAffiches.map((d, i) => (
              <div key={i} style={{ marginTop: i === 0 ? 4 : 10 }}>
                <div>
                  <span className={`badge-vigilance niv-${d.niveau}`} style={{ marginRight: 6 }}>
                    {CRITERE_LIBELLE[d.critere]}
                  </span>
                  {d.motif}
                </div>
                {d.consigne ? (
                  <div className="consigne">→ {d.consigne}</div>
                ) : (
                  <div className="consigne aide" style={{ fontStyle: 'italic' }}>
                    Aucune consigne saisie pour {CRITERE_LIBELLE[d.critere].toLowerCase()} —
                    complète-la dans « Seuils ».
                  </div>
                )}
                {peutAlerter && (
                  <div className="ligne-boutons" style={{ marginTop: 6 }}>
                    <button
                      onClick={() =>
                        onAlerte?.({
                          niveau: d.niveau === 'rouge' ? 'urgence' : 'vigilance',
                          titre: `Météo — ${CRITERE_LIBELLE[d.critere]} : ${d.motif} vers ${quand(pire.heure)}`,
                          message: d.motif,
                          consigne: d.consigne || 'Aucune consigne saisie pour ce critère.'
                        })
                      }
                    >
                      Diffuser l'alerte — {CRITERE_LIBELLE[d.critere]}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}


      <MoniteurIrm province={evenement.province} />

      {maintenant && (
        <div className="grille-paves" style={{ marginBottom: 14 }}>
          <div className="pave">
            <div className="pave-titre">Rafales</div>
            <div className={`grand ${maintenant.niveau !== 'vert' ? 'alerte-texte' : ''}`}>
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
          <div className="pave-titre">Prochaines 24 heures — rafales (km/h) et °C</div>
          <div className="bandes-meteo">
            {evaluees.slice(0, 24).map((h, i) => (
              <div
                key={i}
                className={`bande niv-${h.niveau}`}
                title={`${quand(h.heure)} — rafales ${Math.round(h.rafale)} km/h, ${Math.round(h.temp)} °C, ${h.pluie} mm/h`}
              >
                {/* « h » suffixe l'heure pour ne jamais la confondre avec
                    une valeur — 14h ne se lit pas comme un chiffre brut. */}
                <span className="bande-heure mono">
                  {new Date(h.heure).getHours().toString().padStart(2, '0')}h
                </span>
                <span className="bande-valeur mono">{Math.round(h.rafale)}</span>
                <span className="bande-temp mono">{Math.round(h.temp)}°</span>
                {/* La pluie se lit comme une présence, pas comme un
                    nombre : la goutte suffit dès qu'il pleut, et
                    l'absence de goutte suffit quand il ne pleut pas —
                    inutile d'imprimer 0.0 sur seize colonnes sèches. */}
                <span className="bande-pluie">
                  {h.pluie > 0 ? '💧'.repeat(h.pluie >= 4 ? 2 : 1) : ''}
                </span>
              </div>
            ))}
          </div>
          <p className="aide">
            La goutte indique une pluie prévue, doublée si elle dépasse 4 mm/h. Aucune
            surveillance ne tourne en arrière-plan : cet écran ne prévient que celui qui le
            regarde.
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

/**
 * Évalue une heure de prévision, critère par critère.
 *
 * Retourne un tableau de déclencheurs — pas un niveau unique aplati —
 * pour que chaque phénomène garde sa propre consigne. Le jaune reste
 * purement visuel (avertissement précoce) : aucune consigne n'est
 * attachée à ce palier, seuls l'alerte (orange) et l'alarme (rouge)
 * en portent une, saisie par critère.
 */
function evaluer(h, s) {
  const declencheurs = []
  const c = s.consignes ?? {}

  function ajouter(critere, niveau, motif, cleConsigne) {
    declencheurs.push({ critere, niveau, motif, consigne: c[cleConsigne] || null })
  }

  if (h.rafale >= s.rafale_critique_kmh) {
    ajouter('vent', 'rouge', `rafales ${Math.round(h.rafale)} km/h`, 'vent_alarme')
  } else if (h.rafale >= s.rafale_vigilance_kmh) {
    ajouter('vent', 'orange', `rafales ${Math.round(h.rafale)} km/h`, 'vent_alerte')
  } else if (h.rafale >= s.rafale_vigilance_kmh * 0.8) {
    ajouter('vent', 'jaune', `rafales ${Math.round(h.rafale)} km/h`, null)
  }

  if (h.pluie >= Number(s.pluie_critique_mm)) {
    ajouter('pluie', 'rouge', `pluie ${h.pluie} mm/h`, 'pluie_alarme')
  } else if (h.pluie >= Number(s.pluie_vigilance_mm)) {
    ajouter('pluie', 'orange', `pluie ${h.pluie} mm/h`, 'pluie_alerte')
  } else if (h.pluie >= Number(s.pluie_vigilance_mm) * 0.8) {
    ajouter('pluie', 'jaune', `pluie ${h.pluie} mm/h`, null)
  }

  if (h.temp >= s.temp_max_vigilance) {
    ajouter('chaleur', 'orange', `${Math.round(h.temp)} °C`, 'chaleur_alerte')
  }
  if (h.temp <= s.temp_min_vigilance) {
    ajouter('froid', 'orange', `${Math.round(h.temp)} °C`, 'froid_alerte')
  }

  // Codes Open-Meteo 95 à 99 : orage, avec ou sans grêle
  if (s.alerte_orage && h.code >= 95) {
    ajouter('orage', 'rouge', 'orage annoncé', 'orage_alarme')
  }

  const niveau = declencheurs.reduce(
    (pire, d) => (NIVEAUX[d.niveau] > NIVEAUX[pire] ? d.niveau : pire),
    'vert'
  )

  return { niveau, declencheurs }
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
  const [f, setF] = useState({ ...seuils, consignes: seuils.consignes ?? {} })
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

  const consigne = (cle, libelle, placeholder) => (
    <div key={cle}>
      <label htmlFor={cle}>{libelle}</label>
      <input
        id={cle}
        value={f.consignes[cle] ?? ''}
        onChange={(e) => setF({ ...f, consignes: { ...f.consignes, [cle]: e.target.value } })}
        placeholder={placeholder}
      />
    </div>
  )

  return (
    <div className="formulaire">
      <div className="pave-titre">Vent</div>
      {nombre('rafale_vigilance_kmh', "Alerte à partir de", 'km/h')}
      {consigne('vent_alerte', "Consigne à l'alerte", 'Sécuriser bâches et structures légères')}
      {nombre('rafale_critique_kmh', "Alarme à partir de", 'km/h')}
      {consigne('vent_alarme', "Consigne à l'alarme", 'Évacuer les structures légères')}

      <div className="pave-titre" style={{ marginTop: 14 }}>Précipitations</div>
      {nombre('pluie_vigilance_mm', 'Alerte', 'mm/h')}
      {consigne('pluie_alerte', "Consigne à l'alerte", 'Vérifier écoulements et bâchage')}
      {nombre('pluie_critique_mm', 'Alarme', 'mm/h')}
      {consigne('pluie_alarme', "Consigne à l'alarme", "Ouvrir les points de mise à l'abri")}

      <div className="pave-titre" style={{ marginTop: 14 }}>Chaleur</div>
      {nombre('temp_max_vigilance', 'Alerte à partir de', '°C')}
      {consigne('chaleur_alerte', 'Consigne', "Points d'eau visibles, ombre, rappels réguliers")}

      <div className="pave-titre" style={{ marginTop: 14 }}>Froid</div>
      {nombre('temp_min_vigilance', 'Alerte en dessous de', '°C')}
      {consigne('froid_alerte', 'Consigne', 'Points de réchauffement, surveiller les plus exposés')}

      <div className="pave-titre" style={{ marginTop: 14 }}>Orage</div>
      <p className="aide" style={{ marginTop: -4 }}>
        Détecté automatiquement (codes Open-Meteo 95 à 99) — pas de seuil à régler, seule la
        consigne se prépare à l'avance.
      </p>
      {consigne('orage_alarme', 'Consigne', "Interrompre les activités en hauteur, mise à l'abri")}

      <button disabled={occupe} onClick={enregistrer} style={{ marginTop: 8 }}>
        Enregistrer les seuils
      </button>
      <p className="aide">
        Chaque critère garde sa propre consigne : la conduite à tenir face à un orage n'est
        pas celle d'une canicule. Les valeurs de seuil livrées sont des points de départ
        issus des pratiques de montage de structures temporaires — elles ne remplacent ni
        les prescriptions du fabricant de ton chapiteau, ni l'avis de la zone de secours.
      </p>
    </div>
  )
}
