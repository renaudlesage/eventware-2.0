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
 * Ce qu'il ne fait PAS, et c'est délibéré : DIFFUSER une alerte tout
 * seul — cette décision reste un geste humain, bouton « Diffuser
 * l'alerte » à l'appui. Ce qu'il fait en revanche automatiquement :
 * CONSIGNER un franchissement de seuil dans la main courante, dès
 * qu'il est détecté. Ce n'est pas la même chose — un constat écrit
 * n'engage personne à agir, une alerte diffusée le fait. Le premier
 * peut être automatique sans mentir sur ce qu'il affirme ; le second
 * ne le peut pas.
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

export default function Meteo({ evenement, membre, peut, toutPouvoir, onAlerte, compact }) {
  const [seuils, setSeuils] = useState(null)
  const [previsions, setPrevisions] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [reglage, setReglage] = useState(false)
  // Sur la Situation, dense par nature, on démarre replié : le badge et
  // la ligne courante suffisent la plupart du temps. Ailleurs, ouvert
  // d'emblée.
  const [detailsOuverts, setDetailsOuverts] = useState(!compact)

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

  const heures = extraire(previsions)
  const evaluees = heures.map((h) => ({ ...h, ...evaluer(h, seuils ?? {}) }))
  const pire = evaluees.reduce(
    (acc, h) => (NIVEAUX[h.niveau] > NIVEAUX[acc.niveau] ? h : acc),
    { niveau: 'vert' }
  )
  const declencheursAffiches = (pire.declencheurs ?? []).filter((d) => d.niveau !== 'jaune')

  // Consigne automatique dans la main courante — pas de bouton, pas
  // d'oubli possible. Distincte de la diffusion d'alerte, qui reste un
  // choix humain juste en dessous. Une clé stable par critère+niveau
  // évite de relancer l'effet à chaque re-rendu sans changement réel.
  const cleDeclencheurs = declencheursAffiches.map((d) => `${d.critere}:${d.niveau}`).join(',')

  useEffect(() => {
    if (!seuils || declencheursAffiches.length === 0) return
    let vivant = true

    async function consigner() {
      for (const d of declencheursAffiches) {
        const cle = `${d.critere}:${d.niveau}`
        const depuis = new Date(Date.now() - 3 * 3600000).toISOString()
        const { data: dejaConsigne } = await supabase
          .from('journal')
          .select('id')
          .eq('evenement_id', evenement.id)
          .eq('objet_type', 'veille_meteo')
          .eq('objet_ref', cle)
          .gte('horodatage', depuis)
          .limit(1)
          .maybeSingle()

        if (!vivant || dejaConsigne) continue

        await supabase.rpc('journaliser', {
          p_evenement: evenement.id,
          p_module: 'meteo',
          p_categorie: 'veille',
          p_texte: `Seuil ${LIBELLE_NIVEAU[d.niveau].toLowerCase()} franchi — ${CRITERE_LIBELLE[d.critere]} : ${d.motif}`,
          p_importance: d.niveau === 'rouge' ? 'majeur' : 'notable',
          p_objet_type: 'veille_meteo',
          p_objet_id: null,
          p_objet_ref: cle
        })
      }
    }

    consigner()
    return () => {
      vivant = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleDeclencheurs, seuils, evenement.id])

  if (!lat || !lon) {
    if (compact) return null
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

  const maintenant = evaluees[0]
  const peutAlerter = toutPouvoir || peut?.('alertes', 'creer')

  return (
    <section className={`bloc meteo meteo-${pire.niveau} ${compact ? 'meteo-compact' : ''}`}>
      <div className="entete-dashboard">
        <h2>Veille météo</h2>
        <div className="ligne-boutons" style={{ marginBottom: 0 }}>
          {/* Badge de vigilance, toujours visible — comme sur les cartes
              IRM : le niveau se voit avant même de lire le texte. */}
          <span className={`badge-vigilance niv-${pire.niveau}`}>
            {LIBELLE_NIVEAU[pire.niveau]}
          </span>
          <button className="lien" onClick={() => setDetailsOuverts(!detailsOuverts)}>
            {detailsOuverts ? 'Réduire' : 'Détails'}
          </button>
          {peutAlerter && detailsOuverts && (
            <button className="lien" onClick={() => setReglage(!reglage)}>
              {reglage ? 'Terminé' : 'Seuils'}
            </button>
          )}
        </div>
      </div>

      {/* Résumé d'une ligne, visible même replié — pour ne rien perdre
          en fermant les détails, juste le volume. */}
      {!detailsOuverts && maintenant && (
        <p className="meteo-resume">
          {Math.round(maintenant.rafale)} km/h · {Math.round(maintenant.temp)}°C
          {maintenant.pluie > 0 ? ` · pluie ${maintenant.pluie} mm/h` : ' · sec'}
        </p>
      )}

      {erreur && <div className="message erreur">{erreur}</div>}

      {detailsOuverts && reglage && (
        <ReglageSeuils
          seuils={seuils}
          evenementId={evenement.id}
          onFait={() => {
            setReglage(false)
            chargerSeuils()
          }}
        />
      )}

      {/* Le bandeau d'alerte reste visible que l'écran soit replié ou
          non — ce n'est pas un détail qu'on masque, c'est ce qui
          compte le plus. */}
      {declencheursAffiches.length > 0 && (
        <div className={`bandeau-alerte niv-${pire.niveau === 'rouge' ? 'urgence' : 'vigilance'}`}>
          <div className="niv">{LIBELLE_NIVEAU[pire.niveau]}</div>
          <div className="contenu" style={{ width: '100%' }}>
            <strong>{quand(pire.heure)}</strong>
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
            <p className="aide" style={{ marginTop: 6, marginBottom: 0 }}>
              Déjà consigné dans la main courante. Diffuser une alerte reste un choix
              séparé — un franchissement de seuil ne prévient personne tout seul.
            </p>
          </div>
        </div>
      )}

      {detailsOuverts && (
        <>
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
                    <span className="bande-heure mono">
                      {new Date(h.heure).getHours().toString().padStart(2, '0')}h
                    </span>
                    <span className="bande-valeur mono">{Math.round(h.rafale)}</span>
                    <span className="bande-temp mono">{Math.round(h.temp)}°</span>
                    <span className="bande-pluie">
                      {h.pluie > 0 ? '💧'.repeat(h.pluie >= 4 ? 2 : 1) : ''}
                    </span>
                  </div>
                ))}
              </div>
              <p className="aide">
                La goutte indique une pluie prévue, doublée si elle dépasse 4 mm/h. Aucune
                surveillance ne tourne en arrière-plan : cet écran ne prévient que celui
                qui le regarde.
              </p>
            </>
          )}
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

  if (s.rafale_critique_kmh != null && h.rafale >= s.rafale_critique_kmh) {
    ajouter('vent', 'rouge', `rafales ${Math.round(h.rafale)} km/h`, 'vent_alarme')
  } else if (s.rafale_vigilance_kmh != null && h.rafale >= s.rafale_vigilance_kmh) {
    ajouter('vent', 'orange', `rafales ${Math.round(h.rafale)} km/h`, 'vent_alerte')
  } else if (s.rafale_vigilance_kmh != null && h.rafale >= s.rafale_vigilance_kmh * 0.8) {
    ajouter('vent', 'jaune', `rafales ${Math.round(h.rafale)} km/h`, null)
  }

  if (s.pluie_critique_mm != null && h.pluie >= Number(s.pluie_critique_mm)) {
    ajouter('pluie', 'rouge', `pluie ${h.pluie} mm/h`, 'pluie_alarme')
  } else if (s.pluie_vigilance_mm != null && h.pluie >= Number(s.pluie_vigilance_mm)) {
    ajouter('pluie', 'orange', `pluie ${h.pluie} mm/h`, 'pluie_alerte')
  } else if (s.pluie_vigilance_mm != null && h.pluie >= Number(s.pluie_vigilance_mm) * 0.8) {
    ajouter('pluie', 'jaune', `pluie ${h.pluie} mm/h`, null)
  }

  if (s.temp_max_vigilance != null && h.temp >= s.temp_max_vigilance) {
    ajouter('chaleur', 'orange', `${Math.round(h.temp)} °C`, 'chaleur_alerte')
  }
  if (s.temp_min_vigilance != null && h.temp <= s.temp_min_vigilance) {
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
