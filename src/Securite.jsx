import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Sitrep from './Sitrep'
import { libelleStatut, DOMAINES } from './libelles'
import { detecterDoublons } from './doublons'
import Maydays from './Maydays'
import Meteo from './Meteo'
import PcOps from './PcOps'
import Conformite from './Conformite'
import DossierSecurite from './DossierSecurite'

/*
 * Deux familles distinctes, pas sept onglets à plat :
 *   OPÉRATIONNEL — ce qui se passe maintenant : signalements, Mayday,
 *   main courante, demandes, recherches, plus les suggestions d'alerte
 *   de la veille météo, poussables d'ici sans repasser par la Situation.
 *   ADMINISTRATIF — ce qui se prépare à froid ou se produit après
 *   coup : fiches réflexe, rapport.
 *
 * « Signalements » vivait comme écran séparé — regroupé ici parce que
 * c'est le même métier que la main courante et les demandes : réagir à
 * ce qui se passe, pas s'y préparer.
 */
function groupesPour(modules) {
  return {
    operationnel: {
      libelle: 'Opérationnel',
      onglets: [
        ...(modules?.sos_participants ? [['signalements', 'Signalements']] : []),
        ['mayday', 'Mayday'],
        ['journal', 'Main courante'],
        ['missions', 'Demandes'],
        ['recherches', 'Recherches']
      ]
    },
    administratif: {
      libelle: 'Administratif',
      onglets: [
        ['fiches', 'Fiches réflexe'],
        ['conformite', 'Conformité'],
        ['dossier', 'Dossier de sécurité'],
        ['sitrep', 'Rapport']
      ]
    }
  }
}

export default function Securite({ evenement, membre, session, peut, toutPouvoir, exploitant, ongletCible }) {
  const GROUPES = groupesPour(evenement.modules)
  const [groupe, setGroupe] = useState('operationnel')
  const [onglet, setOnglet] = useState(
    evenement.modules?.sos_participants ? 'signalements' : 'journal'
  )
  const [message, setMessage] = useState(null)

  function choisirGroupe(g) {
    setGroupe(g)
    setOnglet(GROUPES[g].onglets[0][0])
  }

  // Navigation ciblée depuis un autre écran — ex. le pavé « Signalements
  // ouverts » du tableau de bord — bascule directement sur le bon
  // groupe et le bon onglet, sans repasser par les valeurs par défaut.
  useEffect(() => {
    if (!ongletCible) return
    for (const [g, { onglets }] of Object.entries(GROUPES)) {
      if (onglets.some(([k]) => k === ongletCible)) {
        setGroupe(g)
        setOnglet(ongletCible)
        break
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ongletCible])

  return (
    <div className="bloc securite dom-grenat">
      <h2>Sécurité</h2>

      <div className="ligne-boutons" style={{ marginBottom: 10 }}>
        {Object.entries(GROUPES).map(([g, { libelle }]) => (
          <button
            key={g}
            className={groupe === g ? '' : 'discret'}
            onClick={() => choisirGroupe(g)}
          >
            {libelle}
          </button>
        ))}
      </div>

      {groupe === 'operationnel' && (
        <Meteo
          evenement={evenement}
          peut={peut}
          toutPouvoir={toutPouvoir}
          compact
          autoJournal={false}
        />
      )}

      <div className="onglets">
        {GROUPES[groupe].onglets.map(([k, l]) => (
          <button
            key={k}
            className={`module ${onglet === k ? 'actif' : ''}`}
            onClick={() => setOnglet(k)}
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

      {onglet === 'signalements' && <PcOps evenement={evenement} />}
      {onglet === 'mayday' && (
        <Maydays evenement={evenement} setMessage={setMessage} />
      )}
      {onglet === 'journal' && <Journal evenement={evenement} setMessage={setMessage} />}
      {onglet === 'missions' && (
        <Missions
          evenement={evenement}
          membre={membre}
          setMessage={setMessage}
          module="securite"
          libelle="Demandes sécurité"
        />
      )}
      {onglet === 'recherches' && (
        <Recherches evenement={evenement} setMessage={setMessage} />
      )}
      {onglet === 'fiches' && <Fiches evenement={evenement} />}
      {onglet === 'conformite' && (
        <Conformite evenement={evenement} exploitant={exploitant} setMessage={setMessage} />
      )}
      {onglet === 'dossier' && (
        <DossierSecurite evenement={evenement} setMessage={setMessage} />
      )}
      {onglet === 'sitrep' && (
        <Sitrep evenement={evenement} session={session} membre={membre} />
      )}
    </div>
  )
}

/* ================================================================== */
/* Main courante                                                       */
/* ================================================================== */

// Pour la saisie manuelle : uniquement les domaines qu'une personne
// Pour la saisie manuelle : uniquement les domaines qu'une personne
// choisit elle-même, importés du module partagé — « Météo », « noyau »
// (alertes système) et « Analyse » n'existent que par écriture
// automatique, inutile de les proposer à la saisie, mais leurs
// entrées doivent rester filtrables et lisibles au même titre que les
// autres.
const MODULES_SAISIE = DOMAINES
const MODULES_JOURNAL = [
  ...MODULES_SAISIE,
  ['meteo', 'Météo'],
  ['sanitaire', 'Sanitaire'],
  ['analyse', 'Analyse'],
  ['noyau', 'Plateforme']
]
const LIBELLE_MODULE = Object.fromEntries(MODULES_JOURNAL)

export function Journal({ evenement, setMessage, moduleParDefaut = 'securite' }) {
  const [lignes, setLignes] = useState([])
  const [texte, setTexte] = useState('')
  const [moduleSaisie, setModuleSaisie] = useState(moduleParDefaut)
  const [filtre, setFiltre] = useState('tout')
  const [filtreModule, setFiltreModule] = useState('tout')
  const [occupe, setOccupe] = useState(false)

  async function charger() {
    const { data, error } = await supabase
      .from('journal')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('horodatage', { ascending: false })
      .limit(200)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function ajouter() {
    if (!texte.trim()) return
    setOccupe(true)
    const { error } = await supabase.from('journal').insert({
      evenement_id: evenement.id,
      source: 'saisie',
      module: moduleSaisie,
      categorie: 'observation',
      texte: texte.trim(),
      phase: evenement.phase
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setTexte('')
      charger()
    }
    setOccupe(false)
  }

  const visibles = lignes
    .filter((l) =>
      filtre === 'tout' ? true : filtre === 'saisie' ? l.source === 'saisie' : l.importance === 'majeur'
    )
    .filter((l) => filtreModule === 'tout' || l.module === filtreModule)

  return (
    <>
      <div className="saisie-rapide">
        <select
          value={moduleSaisie}
          onChange={(e) => setModuleSaisie(e.target.value)}
          style={{ flex: '0 1 150px' }}
        >
          {MODULES_SAISIE.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <input
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ajouter()}
          placeholder="Observation, décision, appel radio…"
        />
        <button disabled={occupe || !texte.trim()} onClick={ajouter}>
          Inscrire
        </button>
      </div>

      <div className="ligne-boutons" style={{ marginBottom: 6 }}>
        {[
          ['tout', 'Tout'],
          ['majeur', 'Majeur'],
          ['saisie', 'Saisies']
        ].map(([k, l]) => (
          <button
            key={k}
            className={`module ${filtre === k ? 'actif' : ''}`}
            onClick={() => setFiltre(k)}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        <button
          className={`discret ${filtreModule === 'tout' ? 'actif' : ''}`}
          onClick={() => setFiltreModule('tout')}
        >
          Tous domaines
        </button>
        {MODULES_JOURNAL.map(([v, l]) => (
          <button
            key={v}
            className={`discret ${filtreModule === v ? 'actif' : ''}`}
            onClick={() => setFiltreModule(v)}
          >
            {l}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <p className="vide">Aucune entrée.</p>
      ) : (
        <ul className="chrono">
          {visibles.map((l) => (
            <li key={l.id} className={`imp-${l.importance} src-${l.source}`}>
              <span className="heure mono">
                {new Date(l.horodatage).toLocaleTimeString('fr-BE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="corps">
                {l.texte}
                {l.module && <span className="tag">{LIBELLE_MODULE[l.module] ?? l.module}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="aide">
        Une seule main courante pour la sécurité et la logistique — délibérément. Comprendre
        après coup les circonstances logistiques d'un événement sécurité demande qu'elles
        soient au même endroit, pas dans deux journaux qu'il faudrait recouper. Les entrées
        grises sont écrites automatiquement par les autres modules. Rien ne peut être modifié
        ni supprimé : une main courante qui se réécrit n'a aucune valeur.
      </p>
    </>
  )
}

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

export function Missions({ evenement, membre, setMessage, module = 'securite', libelle = 'Demandes' }) {
  const [missions, setMissions] = useState([])
  const [equipes, setEquipes] = useState([])
  const [lieux, setLieux] = useState([])
  const [filtre, setFiltre] = useState('tout')
  const [ouvert, setOuvert] = useState(null)
  const [creer, setCreer] = useState(null) // null | 'normal' | 'urgent'

  async function charger() {
    const [m, e, l] = await Promise.all([
      supabase
        .from('missions')
        .select('*')
        .eq('evenement_id', evenement.id)
        .eq('module', module)
        .order('created_at', { ascending: false }),
      supabase.from('equipes').select('id, code, nom').eq('evenement_id', evenement.id),
      supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenement.id).is('deleted_at', null)
    ])
    if (m.error) setMessage({ type: 'erreur', texte: m.error.message })
    else setMissions(m.data ?? [])
    setEquipes(e.data ?? [])
    setLieux(l.data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id, module])

  async function modifier(id, champs) {
    const { error, count } = await supabase
      .from('missions')
      .update(champs, { count: 'exact' })
      .eq('id', id)
    // RLS filtre silencieusement : zéro ligne touchée = refus, pas succès
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0)
      setMessage({ type: 'erreur', texte: 'Modification refusée : droits insuffisants.' })
    else charger()
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
      </div>

      {creer && (
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
                  </div>
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
    if (error) setMessage({ type: 'erreur', texte: error.message })
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

function etatDe(m) {
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

function Recherches({ evenement, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [ouvrir, setOuvrir] = useState(false)
  const [f, setF] = useState({
    nom: '',
    age_approx: '',
    description: '',
    dernier_lieu: '',
    point_regroupement: '',
    accompagnant_nom: '',
    accompagnant_tel: ''
  })
  const [occupe, setOccupe] = useState(false)

  async function charger() {
    const { data, error } = await supabase
      .from('recherches')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('created_at', { ascending: false })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 15000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function declarer() {
    setOccupe(true)
    const numero = lignes.length + 1
    const { error } = await supabase.from('recherches').insert({
      evenement_id: evenement.id,
      reference: 'REC-' + String(numero).padStart(2, '0'),
      ...f,
      age_approx: f.age_approx ? Number(f.age_approx) : null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({
        nom: '',
        age_approx: '',
        description: '',
        dernier_lieu: '',
        point_regroupement: '',
        accompagnant_nom: '',
        accompagnant_tel: ''
      })
      setOuvrir(false)
      charger()
    }
    setOccupe(false)
  }

  async function cloturer(id, circonstances) {
    const { error } = await supabase
      .from('recherches')
      .update({ statut: 'retrouve', retrouve_le: new Date().toISOString(), circonstances })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else charger()
  }

  const actives = lignes.filter((l) => l.statut === 'en_cours')

  return (
    <>
      {actives.length > 0 && (
        <div className="message erreur">
          {actives.length} recherche(s) en cours — diffusion à toutes les équipes
        </div>
      )}

      <button className="discret" onClick={() => setOuvrir(!ouvrir)}>
        {ouvrir ? 'Annuler' : 'Déclarer une recherche'}
      </button>

      {ouvrir && (
        <div className="formulaire">
          {[
            ['nom', 'Nom / prénom'],
            ['age_approx', 'Âge approximatif'],
            ['description', 'Description — vêtements, signes distinctifs'],
            ['dernier_lieu', 'Vu pour la dernière fois'],
            ['point_regroupement', 'Point de regroupement'],
            ['accompagnant_nom', 'Accompagnant'],
            ['accompagnant_tel', 'Téléphone accompagnant']
          ].map(([k, l]) => (
            <div key={k}>
              <label htmlFor={k}>{l}</label>
              <input
                id={k}
                value={f[k]}
                onChange={(e) => setF({ ...f, [k]: e.target.value })}
              />
            </div>
          ))}
          <button disabled={occupe || !f.description.trim()} onClick={declarer}>
            Déclarer et diffuser
          </button>
          <p className="aide">
            La description compte plus que le nom : c'est elle qui permet de reconnaître la
            personne sur le terrain.
          </p>
        </div>
      )}

      {lignes.length === 0 ? (
        <p className="vide">Aucune recherche.</p>
      ) : (
        lignes.map((l) => (
          <div className={`carte ${l.statut === 'en_cours' ? 'urgent' : ''}`} key={l.id}>
            <div className="titre">
              <span className="mono">{l.reference}</span> — {l.nom || 'Personne non identifiée'}
              {l.age_approx ? `, ${l.age_approx} ans` : ''}
            </div>
            <p style={{ margin: '4px 0' }}>{l.description}</p>
            <div className="meta">
              {l.dernier_lieu && <span>vu·e : {l.dernier_lieu}</span>}
              {l.point_regroupement && <span>regroupement : {l.point_regroupement}</span>}
              {l.accompagnant_tel && <span>{l.accompagnant_tel}</span>}
              <span className="jeton">{libelleStatut(l.statut)}</span>
            </div>
            {l.statut === 'en_cours' && (
              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                <button
                  onClick={() => {
                    const c = prompt('Circonstances ?')
                    if (c !== null) cloturer(l.id, c)
                  }}
                >
                  Retrouvé·e
                </button>
              </div>
            )}
            {l.circonstances && <p className="aide">{l.circonstances}</p>}
          </div>
        ))
      )}
    </>
  )
}

/* ================================================================== */
/* Fiches réflexe                                                      */
/* ================================================================== */

function Fiches({ evenement }) {
  const [fiches, setFiches] = useState(null)
  const [ouverte, setOuverte] = useState(null)
  const [edite, setEdite] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [note, setNote] = useState(null)

  async function charger() {
    const { data } = await supabase
      .from('fiches_reflexe')
      .select('*')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .order('ordre')
    setFiches(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function installerPack() {
    setOccupe(true)
    const { data, error } = await supabase.rpc('installer_fiches_standard', {
      p_evenement: evenement.id
    })
    setNote(
      error
        ? error.message
        : `${data} fiche(s) installée(s). Adapte-les à ton site : une fiche générique ne vaut que comme point de départ.`
    )
    setOccupe(false)
    charger()
  }

  async function enregistrer(fiche, champs) {
    const { error, count } = await supabase
      .from('fiches_reflexe')
      .update(champs, { count: 'exact' })
      .eq('id', fiche.id)
    if (error) setNote(error.message)
    else if (count === 0) setNote('Modification refusée : droits insuffisants.')
    else {
      setNote(null)
      setEdite(null)
      charger()
    }
  }

  async function creer() {
    const numero = (fiches?.length ?? 0) + 1
    const { data, error } = await supabase
      .from('fiches_reflexe')
      .insert({
        evenement_id: evenement.id,
        code: 'FR-' + String(numero).padStart(2, '0'),
        titre: 'Nouvelle fiche',
        conduite: [],
        a_ne_pas_faire: [],
        ordre: 100 + numero
      })
      .select()
      .single()
    if (error) setNote(error.message)
    else {
      await charger()
      setEdite(data.id)
      setOuverte(data.id)
    }
  }

  async function supprimer(fiche) {
    if (!confirm(`Retirer la fiche « ${fiche.titre} » ?`)) return
    const { error } = await supabase
      .from('fiches_reflexe')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', fiche.id)
    if (error) setNote(error.message)
    else charger()
  }

  if (fiches === null) return <p className="vide">…</p>

  return (
    <>
      {note && <div className="message">{note}</div>}

      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        <button onClick={creer}>Nouvelle fiche</button>
        <button className="discret" disabled={occupe} onClick={installerPack}>
          Installer le pack standard
        </button>
      </div>

      {fiches.length === 0 && (
        <p className="vide">
          Aucune fiche réflexe. Les conduites à tenir doivent être disponibles avant
          l'événement, pas pendant.
        </p>
      )}

      {fiches.map((fi) =>
        edite === fi.id ? (
          <EditeurFiche
            key={fi.id}
            fiche={fi}
            onEnregistrer={(champs) => enregistrer(fi, champs)}
            onAnnuler={() => setEdite(null)}
          />
        ) : (
          <div className="carte" key={fi.id}>
            <div
              className="titre"
              style={{ cursor: 'pointer' }}
              onClick={() => setOuverte(ouverte === fi.id ? null : fi.id)}
            >
              <span className="mono">{fi.code}</span> — {fi.titre}
            </div>
            <div className="meta">
              {fi.declencheur && <span>{fi.declencheur}</span>}
              {fi.categorie && <span>{fi.categorie}</span>}
              <span>{(fi.conduite ?? []).length} étape(s)</span>
              {fi.origine === 'seed' && <span className="jeton">standard</span>}
            </div>

            {ouverte === fi.id && (
              <div style={{ marginTop: 10 }}>
                <ol className="liste-pave">
                  {(fi.conduite ?? []).map((etape, i) => (
                    <li key={i}>{etape}</li>
                  ))}
                </ol>
                {(fi.a_ne_pas_faire ?? []).length > 0 && (
                  <>
                    <div className="pave-titre" style={{ marginTop: 10 }}>
                      À ne pas faire
                    </div>
                    <ul className="liste-pave">
                      {fi.a_ne_pas_faire.map((x, i) => (
                        <li key={i} className="alerte-texte">
                          {x}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {fi.contacts && <p className="aide">{fi.contacts}</p>}
                <div className="ligne-boutons" style={{ marginTop: 10 }}>
                  <button className="discret" onClick={() => setEdite(fi.id)}>
                    Modifier
                  </button>
                  <button className="discret" onClick={() => supprimer(fi)}>
                    Retirer
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      )}

      <p className="aide">
        Modifier une fiche standard la fait passer en fiche propre à l'événement : elle ne
        sera plus écrasée si tu réinstalles le pack.
      </p>
    </>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Éditeur de fiche réflexe.
 *
 * Les étapes se saisissent une par ligne plutôt que dans un champ unique :
 * une conduite à tenir se lit dans l'ordre, et on doit pouvoir en
 * intercaler une sans réécrire le reste.
 */
function EditeurFiche({ fiche, onEnregistrer, onAnnuler }) {
  const [f, setF] = useState({
    code: fiche.code ?? '',
    titre: fiche.titre ?? '',
    categorie: fiche.categorie ?? '',
    declencheur: fiche.declencheur ?? '',
    contacts: fiche.contacts ?? '',
    ordre: fiche.ordre ?? 100
  })
  const [conduite, setConduite] = useState(fiche.conduite ?? [])
  const [pieges, setPieges] = useState(fiche.a_ne_pas_faire ?? [])

  function enregistrer() {
    onEnregistrer({
      ...f,
      ordre: Number(f.ordre) || 100,
      categorie: f.categorie || null,
      declencheur: f.declencheur || null,
      contacts: f.contacts || null,
      conduite: conduite.filter((x) => x.trim()),
      a_ne_pas_faire: pieges.filter((x) => x.trim())
    })
  }

  return (
    <div className="formulaire">
      <div className="saisie-rapide">
        <input
          value={f.code}
          onChange={(e) => setF({ ...f, code: e.target.value })}
          placeholder="Code"
          style={{ flex: '0 1 110px' }}
        />
        <input
          value={f.titre}
          onChange={(e) => setF({ ...f, titre: e.target.value })}
          placeholder="Titre"
        />
        <input
          type="number"
          value={f.ordre}
          onChange={(e) => setF({ ...f, ordre: e.target.value })}
          title="Ordre d'affichage"
          style={{ flex: '0 1 80px' }}
        />
      </div>

      <label htmlFor={fiche.id + 'decl'}>Quand l'appliquer</label>
      <input
        id={fiche.id + 'decl'}
        value={f.declencheur}
        onChange={(e) => setF({ ...f, declencheur: e.target.value })}
        placeholder="Ce qu'on observe — flammes, personne au sol…"
      />

      <label htmlFor={fiche.id + 'cat'}>Catégorie</label>
      <input
        id={fiche.id + 'cat'}
        value={f.categorie}
        onChange={(e) => setF({ ...f, categorie: e.target.value })}
        placeholder="incendie, sanitaire, évacuation…"
      />

      <ListeOrdonnee
        titre="Conduite à tenir"
        aide="Une action par ligne, dans l'ordre où on les fait."
        valeurs={conduite}
        setValeurs={setConduite}
      />

      <ListeOrdonnee
        titre="À ne pas faire"
        aide="Les erreurs qu'on commet sous le coup de l'urgence."
        valeurs={pieges}
        setValeurs={setPieges}
        alerte
      />

      <label htmlFor={fiche.id + 'cont'}>Contacts</label>
      <input
        id={fiche.id + 'cont'}
        value={f.contacts}
        onChange={(e) => setF({ ...f, contacts: e.target.value })}
        placeholder="112 — PC-Ops — responsable"
      />

      <div className="ligne-boutons">
        <button disabled={!f.titre.trim() || !f.code.trim()} onClick={enregistrer}>
          Enregistrer
        </button>
        <button className="discret" onClick={onAnnuler}>
          Annuler
        </button>
      </div>
    </div>
  )
}

function ListeOrdonnee({ titre, aide, valeurs, setValeurs, alerte }) {
  function modifier(i, v) {
    const copie = [...valeurs]
    copie[i] = v
    setValeurs(copie)
  }
  function retirer(i) {
    setValeurs(valeurs.filter((_, j) => j !== i))
  }
  function deplacer(i, sens) {
    const j = i + sens
    if (j < 0 || j >= valeurs.length) return
    const copie = [...valeurs]
    ;[copie[i], copie[j]] = [copie[j], copie[i]]
    setValeurs(copie)
  }

  return (
    <>
      <div className="pave-titre" style={{ marginTop: 14 }}>
        {titre}
      </div>
      {valeurs.map((v, i) => (
        <div className="saisie-rapide" key={i}>
          <span className="rang mono">{i + 1}</span>
          <input
            value={v}
            onChange={(e) => modifier(i, e.target.value)}
            className={alerte ? 'alerte-texte' : undefined}
          />
          <button className="discret" onClick={() => deplacer(i, -1)} aria-label="Monter">
            ↑
          </button>
          <button className="discret" onClick={() => deplacer(i, 1)} aria-label="Descendre">
            ↓
          </button>
          <button className="discret" onClick={() => retirer(i)} aria-label="Retirer">
            ×
          </button>
        </div>
      ))}
      <div className="ligne-boutons" style={{ marginBottom: 10 }}>
        <button className="discret" onClick={() => setValeurs([...valeurs, ''])}>
          Ajouter une ligne
        </button>
      </div>
      <p className="aide" style={{ marginTop: -4 }}>
        {aide}
      </p>
    </>
  )
}
