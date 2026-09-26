import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { ecrireOuEmpiler } from './fileEcritures'
import { libelleStatut } from './libelles'
import { detecterDoublons } from './doublons'
import { texteErreur } from './erreurs'
import { MODULES_SAISIE } from './Journal'

/**
 * Demandes (missions), leur formulaire et leur fil de commentaires,
 * sortis de Securite.jsx au lot 12 (26/09), sans changement de
 * comportement. Aussi utilisé par Logistique ; `etatDe` par Dashboard.
 */

// Modules vers lesquels une demande peut réellement être déplacée : ceux
// qui ont un écran de demandes pour l'accueillir. « Sanitaire » n'en a
// pas encore — l'y envoyer la rendrait invisible partout, exactement le
// défaut que ce garde-fou existe pour empêcher. À rouvrir le jour où
// l'écran Sanitaire affichera ses propres demandes.
const MODULES_DEMANDE = [
  ['securite', 'Sécurité'],
  ['logistique', 'Logistique']
]


/* ================================================================== */
/* Missions                                                            */
/* ================================================================== */

const STATUTS_MISSION = [
  ['a_traiter', 'À traiter'],
  ['attribuee', 'Attribuée'],
  ['en_cours', 'En cours'],
  ['resolue', 'Résolue'],
  ['annulee', 'Annulée']
]

const PRIORITES = ['P1', 'P2', 'P3', 'P4']

function emetteurDe(mission, membres) {
  const m = membres.find((x) => x.user_id === mission.created_by)
  return m?.nom_affiche ? `signalée par ${m.nom_affiche}` : 'émetteur inconnu'
}

export function Missions({ evenement, membre, peut, toutPouvoir, setMessage, module = 'securite', libelle = 'Demandes' }) {
  const [missions, setMissions] = useState([])
  // Créer, attribuer, déplacer une demande : `missions:creer`, le droit
  // d'encadrement (policies missions_creation et 105). Qui ne l'a pas
  // lit la liste ; ses propres missions, il les fait avancer depuis
  // Mon terrain. L'écran Sécurité s'ouvrant à tout membre depuis la
  // campagne du 20/09, ces commandes ne peuvent plus être affichées à
  // tout le monde.
  const peutEncadrer = toutPouvoir || peut?.('missions', 'creer')
  const [equipes, setEquipes] = useState([])
  const [lieux, setLieux] = useState([])
  const [membres, setMembres] = useState([])
  const [filtre, setFiltre] = useState('tout')
  const [ouvert, setOuvert] = useState(null)
  const [creer, setCreer] = useState(null) // null | 'normal' | 'urgent'

  async function charger() {
    const [m, e, l, mb] = await Promise.all([
      supabase
        .from('missions')
        .select('*')
        .eq('evenement_id', evenement.id)
        .eq('module', module)
        .order('created_at', { ascending: false }),
      supabase.from('equipes').select('id, code, nom').eq('evenement_id', evenement.id),
      supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenement.id).is('deleted_at', null),
      supabase.from('membres_evenement').select('user_id, nom_affiche').eq('evenement_id', evenement.id)
    ])
    if (m.error) setMessage({ type: 'erreur', texte: texteErreur(m.error) })
    else setMissions(m.data ?? [])
    setEquipes(e.data ?? [])
    setLieux(l.data ?? [])
    setMembres(mb.data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id, module])

  async function modifier(id, champs) {
    // On tente, et c'est l'échec qui décide : `navigator.onLine` ne dit
    // pas si le réseau fonctionne, seulement si une interface est
    // active — un wifi de camping sans route vers Internet se déclare
    // en ligne. Si l'écriture ne passe pas, elle part en file et la vue
    // avance quand même : sur le terrain on change un statut en
    // marchant, et la barre du haut dit ce qui reste à envoyer.
    const cible = missions.find((m) => m.id === id)
    const r = await ecrireOuEmpiler({
      nature: 'update',
      table: 'missions',
      id,
      champs,
      libelle: `${cible?.reference ?? 'Mission'} — ${Object.keys(champs).join(', ')}`
    })

    if (r.statut === 'enfile') {
      return setMessage({
        type: 'info',
        texte: 'Réseau indisponible : la modification partira au retour du signal.'
      })
    }
    if (r.statut === 'refus') {
      return setMessage({
        type: 'erreur',
        texte: r.message === 'Écriture refusée'
          ? 'Modification refusée : droits insuffisants.'
          : r.message
      })
    }
    {
      // Changer le module fait sortir la demande de cet écran : sans le
      // dire, elle semble disparaître. On nomme sa nouvelle destination.
      if (champs.module && champs.module !== module) {
        const cible = MODULES_SAISIE.find(([v]) => v === champs.module)?.[1] ?? champs.module
        setMessage({ type: 'info', texte: `Demande déplacée vers ${cible} — elle n'apparaît plus ici.` })
      }
      charger()
    }
  }

  const compteurs = {
    a_traiter: missions.filter((m) => m.statut === 'a_traiter').length,
    attribuee: missions.filter((m) => m.statut === 'attribuee').length,
    en_cours: missions.filter((m) => m.statut === 'en_cours').length,
    p1: missions.filter((m) => m.priorite === 'P1' && !['resolue', 'annulee'].includes(m.statut))
      .length
  }

  const FILTRES = [
    ['tout', 'Tous', missions.length],
    ['a_traiter', 'À traiter', compteurs.a_traiter],
    ['attribuee', 'Attribuées', compteurs.attribuee],
    ['en_cours', 'En cours', compteurs.en_cours],
    ['resolue', 'Résolues', missions.filter((m) => m.statut === 'resolue').length]
  ]

  const visibles = filtre === 'tout' ? missions : missions.filter((m) => m.statut === filtre)

  return (
    <>
      <div className="compteurs-carres">
        <CompteurCarre libelle="À traiter" v={compteurs.a_traiter} etat="attente" />
        <CompteurCarre libelle="Attribuées" v={compteurs.attribuee} etat="cours" />
        <CompteurCarre libelle="En cours" v={compteurs.en_cours} etat="cours2" />
        <CompteurCarre libelle="Urgentes (P1)" v={compteurs.p1} etat="urgent" />
      </div>

      <div className="pastilles-filtre">
        {FILTRES.map(([v, l, n]) => (
          <button
            key={v}
            className={`pastille ${filtre === v ? 'actif' : ''}`}
            onClick={() => setFiltre(v)}
          >
            {l} <span className="pastille-n">({n})</span>
          </button>
        ))}
      </div>

      <div className="actions-missions">
        <button className="discret" onClick={() => exporterMissions(missions, module)}>
          Export CSV
        </button>
        {peutEncadrer && (
          <>
            <button
              className="action-creer"
              onClick={() => setCreer(creer === 'normal' ? null : 'normal')}
            >
              + Nouvelle demande
            </button>
            <button
              className="action-urgente"
              onClick={() => setCreer(creer === 'urgent' ? null : 'urgent')}
            >
              ⚠ Demande urgente
            </button>
          </>
        )}
      </div>

      {peutEncadrer && creer && (
        <FormDemande
          mode={creer}
          evenement={evenement}
          membre={membre}
          module={module}
          libelle={libelle}
          lieux={lieux}
          setMessage={setMessage}
          onFait={() => {
            setCreer(null)
            charger()
          }}
          onAnnuler={() => setCreer(null)}
        />
      )}

      {visibles.length === 0 ? (
        <p className="vide">Rien ici.</p>
      ) : (
        visibles.map((m) => {
          const deplie = ouvert === m.id
          return (
            <div className="ligne-mission" key={m.id}>
              <button
                className="ligne-mission-resume"
                onClick={() => setOuvert(deplie ? null : m.id)}
              >
                <span className={`point-etat point-${etatDe(m)}`} />
                <span className="ligne-mission-ref mono">{m.reference}</span>
                <span className="ligne-mission-titre">{m.titre}</span>
                <span className="ligne-mission-chevron">{deplie ? '︿' : '›'}</span>
              </button>

              {deplie && (
                <div className="ligne-mission-detail">
                  {m.description && <p style={{ margin: '2px 0 8px' }}>{m.description}</p>}
                  <div className="meta">
                    {m.signalement_id && <span>issue d'un signalement</span>}
                    {m.delai_reel_min != null && <span>{m.delai_reel_min} min</span>}
                    {m.latitude && (
                      <span className="mono">
                        {m.latitude.toFixed(4)} · {m.longitude.toFixed(4)}
                      </span>
                    )}
                  </div>

                  {/* Horodatage et émetteur — demande explicite du terrain
                      dans le REX BFMF 2026 : les deux existaient déjà en
                      base, jamais montrés à l'écran. */}
                  <p className="aide" style={{ margin: '6px 0' }}>
                    {emetteurDe(m, membres)} · créée{' '}
                    {new Date(m.created_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
                    {m.attribuee_le && ` · attribuée ${new Date(m.attribuee_le).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`}
                    {m.demarree_le && ` · démarrée ${new Date(m.demarree_le).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`}
                    {m.resolue_le && ` · résolue ${new Date(m.resolue_le).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`}
                  </p>

                  <FilCommentaires
                    mission={m}
                    membre={membre}
                    membres={membres}
                    setMessage={setMessage}
                  />

                  {peutEncadrer ? (
                  <div className="ligne-boutons" style={{ marginTop: 10 }}>
                    <select
                      value={m.statut}
                      onChange={(e) => modifier(m.id, { statut: e.target.value })}
                      style={{ width: 'auto', marginBottom: 0 }}
                    >
                      {STATUTS_MISSION.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <select
                      value={m.equipe_id ?? ''}
                      onChange={(e) => modifier(m.id, { equipe_id: e.target.value || null })}
                      style={{ width: 'auto', marginBottom: 0 }}
                    >
                      <option value="">— équipe —</option>
                      {equipes.map((eq) => (
                        <option key={eq.id} value={eq.id}>
                          {eq.code}
                        </option>
                      ))}
                    </select>
                    <select
                      value={m.module}
                      onChange={(e) => modifier(m.id, { module: e.target.value })}
                      style={{ width: 'auto', marginBottom: 0 }}
                    >
                      {MODULES_DEMANDE.map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    {(m.equipe_id || m.statut === 'attribuee') && (
                      <button
                        className="discret"
                        onClick={() => modifier(m.id, { equipe_id: null, statut: 'a_traiter' })}
                      >
                        Annuler l'attribution
                      </button>
                    )}
                  </div>
                  ) : (
                  <div className="meta" style={{ marginTop: 8 }}>
                    <span>{libelleStatut(m.statut)}</span>
                    {m.equipe_id && (
                      <span>équipe {equipes.find((eq) => eq.id === m.equipe_id)?.code ?? ''}</span>
                    )}
                  </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </>
  )
}

const NATURES_URGENTES = [
  ['bloquante_generale', 'Situation bloquante générale'],
  ['secours_necessaire', 'Besoin de secours'],
  ['probleme_securite', 'Problème de sécurité'],
  ['panne_critique', 'Panne critique'],
  ['autre', 'Autre urgence']
]

const DELAIS_SOUHAITES = [
  ['dans_heure', "Dans l'heure"],
  ['avant_fin_journee', 'Avant la fin de journée'],
  ['demain', 'Demain'],
  ['sans_urgence', 'Sans urgence particulière']
]

const LIBELLE_ROLE = {
  coordinateur: 'Coordinateur',
  admin: 'Admin',
  chef_equipe: "Chef d'équipe",
  benevole: 'Bénévole',
  observateur: 'Observateur'
}

function echeanceDepuisDelai(delai) {
  const maintenant = new Date()
  if (delai === 'dans_heure') return new Date(maintenant.getTime() + 3600000).toISOString()
  if (delai === 'avant_fin_journee') {
    const fin = new Date(maintenant)
    fin.setHours(23, 59, 0, 0)
    return fin.toISOString()
  }
  if (delai === 'demain') {
    const demain = new Date(maintenant)
    demain.setDate(demain.getDate() + 1)
    demain.setHours(12, 0, 0, 0)
    return demain.toISOString()
  }
  return null
}

/**
 * Demande urgente ou normale — deux formulaires distincts, repris de
 * BFMF2026, pas une variante habillée différemment. L'urgente capte la
 * position GPS toute seule et demande qui est concerné ; la normale
 * demande un délai souhaité et affiche qui signale, en lecture seule,
 * parce que c'est toujours celui qui est connecté.
 */
function FormDemande({ mode, evenement, membre, module, libelle, lieux, setMessage, onFait, onAnnuler }) {
  const urgent = mode === 'urgent'
  const [natureUrgente, setNatureUrgente] = useState(NATURES_URGENTES[0][0])
  const [types, setTypes] = useState([])
  const [typeId, setTypeId] = useState('')
  const [precision, setPrecision] = useState('')
  const [lieuId, setLieuId] = useState('')
  const [quiConcerne, setQuiConcerne] = useState('')
  const [descriptif, setDescriptif] = useState('')
  const [delaiSouhaite, setDelaiSouhaite] = useState('dans_heure')
  const [bloquant, setBloquant] = useState(false)
  const [position, setPosition] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [doublons, setDoublons] = useState([])
  const [ignorerDoublons, setIgnorerDoublons] = useState(false)

  useEffect(() => {
    if (urgent) return
    supabase
      .from('types_mission')
      .select('*')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .then(({ data }) => setTypes(data ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urgent])

  useEffect(() => {
    if (!urgent || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (p) => setPosition({ lat: p.coords.latitude, lon: p.coords.longitude, precision: Math.round(p.coords.accuracy) }),
      () => {} // silencieux : la position reste facultative, la localisation par lieu suffit
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urgent])

  // À la saisie, pas après coup — REX BFMF 2026 point 9 : deux missions
  // identiques pour le même seau de jetons à 21 minutes d'intervalle,
  // jamais rapprochées. Comparaison simple par mots partagés, pas un
  // modèle de langage — elle attrape les cas grossiers, pas tous les
  // doublons possibles. Un avertissement à ignorer d'un clic, jamais
  // un blocage : le coût d'un faux positif reste faible, celui d'un
  // blocage à tort ne l'est pas.
  async function verifierDoublons() {
    if (urgent || !precision.trim()) {
      setDoublons([])
      return
    }
    const { data } = await supabase
      .from('missions')
      .select('id, titre, lieu_id, created_at, membre:membre_id(nom_affiche)')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50)
    const candidats = (data ?? []).map((m) => ({
      id: m.id,
      texte: m.titre,
      lieu_id: m.lieu_id,
      cree_le: m.created_at,
      auteur: m.membre?.nom_affiche
    }))
    setDoublons(detecterDoublons({ texte: precision, lieuId: lieuId || null, candidats }))
    setIgnorerDoublons(false)
  }

  const typeChoisi = types.find((t) => t.id === typeId)

  const pret = urgent
    ? descriptif.trim().length >= 5
    : !!typeId && (doublons.length === 0 || ignorerDoublons)

  async function creer() {
    setOccupe(true)
    const titre = urgent
      ? NATURES_URGENTES.find((n) => n[0] === natureUrgente)[1]
      : typeChoisi.libelle + (precision.trim() ? ` — ${precision.trim()}` : '')
    const { error } = await supabase.from('missions').insert({
      evenement_id: evenement.id,
      module,
      phase: evenement.phase,
      titre,
      // La catégorie « sécurité » impose sa priorité — ce n'est pas
      // une suggestion qu'on pourrait rétrograder au clic suivant.
      // C'est exactement le flag qui manquait au REX : sans lui, P1
      // ne voulait plus rien dire (35 % des missions classées P1,
      // aucun écart de délai mesurable avec P2).
      priorite: urgent ? 'P1' : typeChoisi.priorite,
      type_id: urgent ? null : typeId,
      lieu_id: lieuId || null,
      latitude: urgent ? position?.lat ?? null : null,
      longitude: urgent ? position?.lon ?? null : null,
      qui_concerne: urgent ? quiConcerne.trim() || null : null,
      description: urgent ? descriptif.trim() : null,
      bloquant: urgent ? false : bloquant,
      echeance: urgent ? null : echeanceDepuisDelai(delaiSouhaite)
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else onFait()
    setOccupe(false)
  }

  return (
    <div className="formulaire">
      <div className="pave-titre" style={{ marginTop: 0 }}>
        {urgent ? `Demande urgente — ${libelle}` : `Nouvelle demande — ${libelle}`}
      </div>
      {urgent ? (
        <>
          <p className="aide" style={{ marginTop: 0 }}>
            Pour un besoin d'appui (renfort, matériel, panne), traité <strong>en priorité P1</strong> au
            QG. Pour une <strong>urgence vitale</strong>, utilisez le bouton SOS ou le 112.
          </p>

          <label htmlFor="nature-urgente">Nature de l'alerte *</label>
          <select id="nature-urgente" value={natureUrgente} onChange={(e) => setNatureUrgente(e.target.value)}>
            {NATURES_URGENTES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>

          <label htmlFor="lieu-urgente">Localisation *</label>
          <select id="lieu-urgente" value={lieuId} onChange={(e) => setLieuId(e.target.value)}>
            <option value="">— choisir un lieu du dispositif —</option>
            {lieux.map((l) => (
              <option key={l.id} value={l.id}>{l.code} · {l.nom}</option>
            ))}
          </select>

          {position && (
            <p className="aide" style={{ color: 'var(--etat-ok)' }}>
              📍 Position GPS captée (~{position.precision} m) — ajoutée à la zone pour préciser
              l'endroit exact.
            </p>
          )}

          <label htmlFor="qui-concerne">Qui est concerné</label>
          <input
            id="qui-concerne"
            value={quiConcerne}
            onChange={(e) => setQuiConcerne(e.target.value)}
            placeholder="Ex : bénévole bar, festivalier, prestataire son…"
          />

          <label htmlFor="descriptif">Descriptif de la situation * (min. 5 car.)</label>
          <textarea
            id="descriptif"
            rows={3}
            value={descriptif}
            onChange={(e) => setDescriptif(e.target.value)}
            placeholder="Ce qui se passe, depuis quand, besoin exprimé…"
          />

          <button disabled={occupe || !pret} onClick={creer} style={{ marginTop: 8 }}>
            Envoyer la demande
          </button>
          <p className="aide">
            Visible immédiatement au QG et sur l'app Volante. Doubler à la radio (PMR4.1, PMR333
            si vital).
          </p>
        </>
      ) : (
        <>
          <label htmlFor="type-normale">Catégorie *</label>
          <select id="type-normale" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">— choisir une catégorie —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.libelle}</option>
            ))}
          </select>
          {typeChoisi && (
            <p className="aide" style={{ marginTop: -6 }}>
              Priorité {typeChoisi.priorite} — délai cible {typeChoisi.delai_cible_min} min
              {typeChoisi.categorie === 'securite' && ' · verrouillée, cette catégorie ne se rétrograde pas'}
            </p>
          )}

          <label htmlFor="precision-normale">Précision (facultatif)</label>
          <input
            id="precision-normale"
            value={precision}
            onChange={(e) => setPrecision(e.target.value)}
            onBlur={verifierDoublons}
            placeholder="Ex : gobelets scène 2, panne projecteur backstage…"
          />

          {doublons.length > 0 && !ignorerDoublons && (
            <div className="message erreur">
              <strong>Une demande très proche existe déjà :</strong>
              <ul className="chrono" style={{ marginTop: 6 }}>
                {doublons.slice(0, 3).map((d) => (
                  <li key={d.id}>
                    <span className="corps">
                      {d.texte} — {d.auteur ?? 'quelqu\u2019un'},{' '}
                      {Math.round((Date.now() - new Date(d.cree_le).getTime()) / 60000)} min
                    </span>
                  </li>
                ))}
              </ul>
              <div className="ligne-boutons" style={{ marginTop: 6 }}>
                <button className="discret" onClick={() => setIgnorerDoublons(true)}>
                  Créer quand même — ce n'est pas la même chose
                </button>
              </div>
            </div>
          )}

          <div className="saisie-rapide">
            <div style={{ flex: 1 }}>
              <label htmlFor="lieu-normale">Localisation</label>
              <select
                id="lieu-normale"
                value={lieuId}
                onChange={(e) => {
                  setLieuId(e.target.value)
                  verifierDoublons()
                }}
              >
                <option value="">— choisir un lieu du dispositif —</option>
                {lieux.map((l) => (
                  <option key={l.id} value={l.id}>{l.code} · {l.nom}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="delai">Délai souhaité</label>
              <select id="delai" value={delaiSouhaite} onChange={(e) => setDelaiSouhaite(e.target.value)}>
                {DELAIS_SOUHAITES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          <label htmlFor="bloquant-select">Incident bloquant ?</label>
          <select
            id="bloquant-select"
            value={bloquant ? 'oui' : 'non'}
            onChange={(e) => setBloquant(e.target.value === 'oui')}
          >
            <option value="non">Non</option>
            <option value="oui">Oui</option>
          </select>

          <label htmlFor="qui-signale">Qui signale ? (lecture seule — auto)</label>
          <input
            id="qui-signale"
            value={`${membre.nom_affiche ?? '—'} (${LIBELLE_ROLE[membre.role] ?? membre.role})`}
            disabled
          />

          <button disabled={occupe || !pret} onClick={creer} style={{ marginTop: 8 }}>
            Injecter la demande
          </button>
        </>
      )}

      <button className="discret" onClick={onAnnuler} style={{ marginTop: 8 }}>
        Annuler
      </button>
    </div>
  )
}

function CompteurCarre({ libelle, v, etat }) {
  return (
    <div className={`compteur-carre etat-${etat}`}>
      <div className="compteur-carre-libelle">{libelle}</div>
      <div className="compteur-carre-valeur">{v}</div>
    </div>
  )
}

export function etatDe(m) {
  if (['resolue', 'annulee'].includes(m.statut)) return 'ok'
  if (m.priorite === 'P1') return 'urgent'
  if (m.statut === 'a_traiter') return 'attente'
  return 'cours'
}

function exporterMissions(missions, module) {
  const entetes = ['reference', 'titre', 'priorite', 'statut', 'created_at']
  const echappe = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [
    entetes.join(';'),
    ...missions.map((m) => entetes.map((k) => echappe(m[k])).join(';'))
  ].join('\n')
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `missions-${module}.csv`
  a.click()
  URL.revokeObjectURL(url)
}


/* ================================================================== */
/* Fil de commentaires d'une demande                                   */
/* ================================================================== */

/**
 * Un échange à deux sens entre le QG et le demandeur, attaché à une
 * demande qui a un statut, un porteur et une échéance.
 *
 * C'est la différence avec un tchat d'équipe : la conversation ne peut
 * pas remplacer l'objet, elle le documente. Une question posée ici
 * reste rattachée à la demande qu'elle concerne, et se retrouve avec
 * elle.
 */
function FilCommentaires({ mission, membre, membres, setMessage }) {
  const [fil, setFil] = useState(null)
  const [texte, setTexte] = useState('')
  const [occupe, setOccupe] = useState(false)

  async function charger() {
    const { data, error } = await supabase
      .from('mission_commentaires')
      .select('*')
      .eq('mission_id', mission.id)
      .order('created_at')
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setFil(data ?? [])
  }

  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission.id])

  async function envoyer() {
    if (!texte.trim()) return
    setOccupe(true)
    const { error } = await supabase.from('mission_commentaires').insert({
      evenement_id: mission.evenement_id,
      mission_id: mission.id,
      auteur_id: membre.user_id,
      texte: texte.trim()
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setTexte('')
      charger()
    }
    setOccupe(false)
  }

  const nomDe = (userId) =>
    membres.find((x) => x.user_id === userId)?.nom_affiche ??
    (userId === mission.created_by ? 'le demandeur' : 'QG')

  return (
    <div style={{ marginTop: 10 }}>
      <label>Échange avec le demandeur</label>

      {fil === null ? (
        <p className="aide">…</p>
      ) : fil.length === 0 ? (
        <p className="aide">Aucun échange pour l'instant.</p>
      ) : (
        <ul className="chrono">
          {fil.map((c) => (
            <li key={c.id}>
              <span className="heure mono">
                {new Date(c.created_at).toLocaleTimeString('fr-BE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="corps">
                <strong>{nomDe(c.auteur_id)}</strong> {c.texte}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="saisie-rapide">
        <input
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && texte.trim() && envoyer()}
          placeholder="Pris en compte, en cours, prévu pour…"
          /* Sans ça, le navigateur superpose ses anciennes saisies en
             bulle blanche par-dessus le fil — on croit lire des
             messages alors qu'on lit son propre historique. */
          autoComplete="off"
        />
        <button disabled={occupe || !texte.trim()} onClick={envoyer}>
          Répondre
        </button>
      </div>
      <p className="aide">
        Visible par le demandeur, qui peut répondre ici même — souvent c'est lui qui a la
        précision qui manque.
      </p>
    </div>
  )
}

