import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import Meteo from './Meteo'
import Maydays from './Maydays'
import { libelleStatut, libelleStatutTransport } from './libelles'
import { TYPES } from './PcOps'
import { ChevronDown } from 'lucide-react'
import { ecrireOuEmpiler } from './fileEcritures'
import { jouerAlarme } from './alarme'
import { situerSurTrace, libelleSurTrace } from './geometrie'
import { CarteTactique, useTactique, Radio } from './ColonneSituation'
import { libelleEtapeTransport } from './libelles'
import { Accuses } from './Bandeau'

/**
 * Tableau de bord général — la vue QG.
 *
 * Distinct du tableau de bord individuel : celui-ci ne montre pas ce
 * qui me concerne, il montre la situation. C'est ce qu'on projette sur
 * l'écran du PC-Ops et ce qu'on regarde quand quelqu'un demande
 * « où on en est ? ».
 *
 * Ordre de lecture délibéré : ce qui exige une décision d'abord,
 * ce qui informe ensuite, ce qui rassure en dernier.
 */
/**
 * Ce que la Situation montre, selon la phase.
 *
 * On ne pilote pas la même chose avant et pendant. En préparation, un
 * coordinateur voyait « 0 mission, 0 signalement, 0 sur le parcours,
 * 0 créneau découvert » — un mur de zéros — pendant que ses deux
 * jalons à venir n'étaient affichés nulle part.
 *
 * Chaque phase déclare donc ses colonnes. Les composants ne changent
 * pas : seule leur composition change, comme les pavés de Mon poste
 * suivent le rôle.
 */
const COLONNES_PAR_PHASE = {
  // Des échéances et des trous. Rien de temps réel n'existe encore —
  // et la colonne Sécurité, qui ne compte que des signalements et des
  // missions, n'affichait donc qu'un mur de zéros : exactement le
  // défaut que cette table de composition est là pour corriger. Elle
  // reprend au montage, quand l'installation crée de vrais risques.
  preparation:  ['preparation', 'rh'],
  // Une installation et ses risques. La météo compte ici plus que
  // partout ailleurs : le vent décide du montage d'un chapiteau.
  montage:      ['preparation', 'securite', 'logistique', 'rh'],
  // Le temps réel, tel qu'il existait.
  exploitation: ['securite', 'logistique', 'parcours', 'rh'],
  // Des restitutions : qui est rentré, ce qui n'est pas rendu.
  demontage:    ['parcours', 'logistique', 'preparation'],
  // On ne pilote plus, on capitalise.
  cloture:      ['logistique', 'preparation']
}

/** Vrai à partir de 1440 px : la colonne tactique vit à côté. */
function useLarge() {
  const [large, setLarge] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1440px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1440px)')
    const f = (e) => setLarge(e.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return large
}

export default function Situation({ evenement, peut, toutPouvoir, onAller }) {
  const large = useLarge()
  const [s, setS] = useState(null)
  const [signalementsRecents, setSignalementsRecents] = useState([])
  const [equipes, setEquipes] = useState([])
  // (123) Le fond pour dire où : la trace et les lieux, chargés une fois.
  const [fond, setFond] = useState(null)
  const [engagement, setEngagement] = useState(null) // formulaire « engager une équipe »
  const [demandesLogistique, setDemandesLogistique] = useState([])
  const [demandesSecurite, setDemandesSecurite] = useState([])
  // Retour d'une action faite depuis un moniteur (prise en charge,
  // clôture) : une ligne, pas une erreur qui remplacerait l'écran.
  const [retour, setRetour] = useState(null)
  const [occupe, setOccupe] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [maj, setMaj] = useState(null)
  const [sonActif, setSonActif] = useState(false)
  const [veilleActive, setVeilleActive] = useState(false)
  const [veilleIndisponible, setVeilleIndisponible] = useState(false)
  const wakeLockRef = useRef(null)
  const urgencePrecedenteRef = useRef(null)

  // Compte ce qui exige vraiment une réaction immédiate — alertes
  // actives (le Mayday y crée déjà sa propre ligne, pas besoin de le
  // compter à part), missions P1 non résolues, SOS participants pas
  // encore pris en charge et recherches en cours. Un simple total, pas
  // le détail : on ne veut savoir qu'une chose, si ça vient de monter.
  // Les SOS et les recherches manquaient (comparatif BFMF 2026, lot 1) :
  // un SOS participant arrivait en silence sur l'écran projeté.
  function compterUrgent(donnees) {
    const alertesActives = donnees?.alertes?.length ?? 0
    const p1 = donnees?.missions?.p1 ?? 0
    const sos = donnees?.signalements?.non_pris_en_charge ?? 0
    const recherches = donnees?.recherches?.length ?? 0
    return alertesActives + p1 + sos + recherches
  }

  async function charger() {
    const [{ data, error }, sig, logi, eq] = await Promise.all([
      supabase.rpc('situation', { p_evenement: evenement.id }),
      // Requête directe plutôt que de dépendre du sous-objet exposé
      // par situation() : le moniteur affichait la référence et le
      // type, jamais le descriptif que la personne a réellement tapé
      // — illisible en pratique. On garde le contrôle total des
      // colonnes ici plutôt que de deviner ce que le RPC choisit
      // d'exposer.
      // Les signalements OUVERTS seulement : maintenant qu'on les clôture
      // d'ici, un signalement clos qui resterait affiché aurait l'air de
      // ne pas l'être (24/09).
      // Heure, contact, position et lieu (lot 1 du comparatif BFMF
      // 2026) : sans eux, le moniteur disait « Malaise — reçu » sans
      // dire depuis quand, ni où, ni qui rappeler.
      supabase
        .from('signalements')
        .select('id, reference, type, description, statut, recu_le, contact, latitude, longitude, lieu_id, lieu:lieu_id(nom, latitude, longitude)')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .is('doublon_de', null)
        .in('statut', ['recu', 'pris_en_charge', 'en_cours'])
        .order('recu_le', { ascending: false })
        .limit(6),
      // Les demandes logistiques ouvertes, pour le moniteur de la
      // colonne Logistique : son compteur les comptait, son moniteur
      // ne montrait que le matériel sous seuil — « 3 demandes » sans
      // aucune demande visible (campagne du 20/09, 3a-01).
      // (122) Avec l'équipe, le lieu et le titulaire : la ligne dit qui
      // s'en occupe, et l'équipe se choisit ici même.
      supabase
        .from('missions')
        .select('id, reference, titre, statut, priorite, module, equipe_id, lieu_id, membre_id, attribuee_le, demarree_le, equipe:equipe_id(code), lieu:lieu_id(nom), membre:membre_id(nom_affiche)')
        .eq('evenement_id', evenement.id)
        .in('module', ['logistique', 'securite'])
        .is('deleted_at', null)
        .not('statut', 'in', '("resolue","annulee")')
        .order('priorite')
        .order('created_at', { ascending: false })
        .limit(12),
      // (122) Les équipes, pour attribuer une demande sans quitter
      // l'écran projeté — un clic dans BFMF, quatre et un changement
      // d'écran ici.
      supabase
        .from('equipes')
        .select('id, code, nom')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .order('code')
    ])
    if (error) setErreur(texteErreur(error))
    else {
      const urgentAvant = urgencePrecedenteRef.current
      const urgentMaintenant = compterUrgent(data)
      if (sonActif && urgentAvant != null && urgentMaintenant > urgentAvant) jouerAlarme()
      urgencePrecedenteRef.current = urgentMaintenant

      setS(data)
      setSignalementsRecents(sig.data ?? [])
      if (!eq.error) setEquipes(eq.data ?? [])
      setDemandesLogistique((logi.data ?? []).filter((d) => d.module === 'logistique').slice(0, 6))
      setDemandesSecurite((logi.data ?? []).filter((d) => d.module === 'securite').slice(0, 6))
      setMaj(new Date())
      setErreur(null)
    }
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id, sonActif])

  useEffect(() => {
    let vivant = true
    Promise.all([
      supabase.from('traces').select('nom, points').eq('evenement_id', evenement.id).is('deleted_at', null).eq('actif', true),
      supabase.from('lieux').select('id, code, nom, pk_km, latitude, longitude').eq('evenement_id', evenement.id).is('deleted_at', null).eq('actif', true)
    ]).then(([tr, l]) => {
      if (vivant) setFond({ traces: tr.data ?? [], lieux: l.data ?? [] })
    })
    return () => {
      vivant = false
    }
  }, [evenement.id])

  // (123) « km 3,2 · entre E2 et E3 » : la position du signalement, ou
  // celle de son lieu, projetée sur la trace.
  function surTrace(x) {
    if (!fond) return ''
    const lat = x.latitude ?? x.lieu?.latitude
    const lon = x.longitude ?? x.lieu?.longitude
    return libelleSurTrace(situerSurTrace(fond.traces, fond.lieux, lat, lon))
  }

  // (123) Engager une équipe sur un lieu depuis l'écran projeté : une
  // demande sécurité P1 attribuée d'emblée. Dans BFMF c'était le geste
  // de base du PC ; ici il fallait aller dans Sécurité → Demandes.
  // « Je démarre » côté Terrain vaut accusé : la ligne dira « engagée
  // à <lieu> depuis HH:MM ».
  async function engager() {
    const { titre, equipe, lieu } = engagement
    if (!titre.trim() || !equipe) return
    setOccupe('engagement')
    const { error } = await supabase.from('missions').insert({
      evenement_id: evenement.id,
      module: 'securite',
      phase: evenement.phase,
      titre: titre.trim(),
      priorite: 'P1',
      equipe_id: equipe,
      lieu_id: lieu || null
    })
    setOccupe(null)
    if (error) setRetour({ type: 'erreur', texte: texteErreur(error) })
    else {
      const eq = equipes.find((e) => e.id === equipe)
      setRetour({ type: 'ok', texte: `Équipe ${eq?.code ?? ''} engagée : ${titre.trim()}.` })
      setEngagement(null)
      charger()
    }
  }

  // Agir depuis la Situation, comme le QG de BFMF 2026 : prendre en
  // charge et clôturer un SOS, démarrer et clore une demande sécurité
  // ou logistique, sans quitter l'écran qu'on projette (Ren, 24/09).
  // Même chemin d'écriture que Sécurité : si le réseau tombe,
  // l'écriture part en file et la barre du haut le dit. Horodatage et
  // journal sont posés par les déclencheurs (cycle_mission,
  // statut_signalement), pas ici.
  const peutSos = toutPouvoir || peut?.('sos', 'modifier')
  const peutMissions = toutPouvoir || (peut?.('missions', 'modifier') && peut?.('missions', 'creer'))
  const peutAlertes = toutPouvoir || peut?.('alertes', 'modifier')

  // (122) Attribuer une demande à une équipe depuis le moniteur. Le
  // déclencheur cycle_mission (015) la passe en « attribuée ».
  async function attribuer(d, equipeId) {
    setOccupe(d.id)
    const eq = equipes.find((e) => e.id === equipeId)
    const r = await ecrireOuEmpiler({
      nature: 'update',
      table: 'missions',
      id: d.id,
      champs: { equipe_id: equipeId || null },
      libelle: `${d.reference ?? ''} — ${equipeId ? `attribuée à ${eq?.code ?? 'équipe'}` : 'désattribuée'}`
    })
    setOccupe(null)
    if (r.statut === 'refus') setRetour({ type: 'erreur', texte: `${d.reference} : ${r.message}` })
    else {
      if (r.statut === 'enfile') setRetour({ type: 'info', texte: `${d.reference} : réseau indisponible, l'attribution partira au retour du signal.` })
      charger()
    }
  }

  // (122) « Vu, pris en compte » : le PC a la main sur l'alerte sans la
  // lever. Qui et quand sont posés par le déclencheur cycle_alerte.
  async function acquitter(a) {
    const r = await ecrireOuEmpiler({
      nature: 'update',
      table: 'alertes',
      id: a.id,
      champs: { acquittee_le: new Date().toISOString() },
      libelle: `${a.titre} — vu, pris en compte`
    })
    if (r.statut === 'refus') setRetour({ type: 'erreur', texte: `${a.titre} : ${r.message}` })
    else charger()
  }

  async function agir(table, ligne, statut, libelle) {
    setOccupe(ligne.id)
    const r = await ecrireOuEmpiler({
      nature: 'update',
      table,
      id: ligne.id,
      champs: { statut },
      libelle: `${ligne.reference ?? ''} — ${libelle}`
    })
    setOccupe(null)
    if (r.statut === 'refus') {
      setRetour({ type: 'erreur', texte: `${ligne.reference} : ${r.message}` })
    } else if (r.statut === 'enfile') {
      setRetour({ type: 'info', texte: `${ligne.reference} : réseau indisponible, « ${libelle} » partira au retour du signal.` })
    } else {
      setRetour({ type: 'ok', texte: `${ligne.reference} : ${libelle}.` })
      charger()
    }
  }

  // Un signalement devient une demande sécurité P2, sans quitter
  // l'écran projeté ; l'attribution fine (priorité, équipe) se fait
  // depuis PC-OPS. La RPC passe aussi le signalement en pris en charge.
  async function convertir(x) {
    setOccupe(x.id)
    const { data, error } = await supabase.rpc('convertir_signalement_en_mission', {
      p_signalement: x.id,
      p_module: 'securite',
      p_priorite: 'P2'
    })
    setOccupe(null)
    if (error) setRetour({ type: 'erreur', texte: `${x.reference} : ${texteErreur(error)}` })
    else {
      setRetour({ type: 'ok', texte: `${x.reference} → demande ${data?.reference ?? ''} créée, signalement pris en charge.` })
      charger()
    }
  }

  // Veille active — repris de BFMF2026 : le QG reste affiché en
  // permanence sur un écran dédié, un verrouillage automatique y est
  // plus gênant qu'utile. Relâché à la fermeture ou si l'onglet perd le
  // focus puis qu'on désactive — jamais laissé actif en arrière-plan
  // sans que l'utilisateur l'ait choisi ici.
  async function basculerVeille() {
    if (veilleActive) {
      wakeLockRef.current?.release()
      wakeLockRef.current = null
      setVeilleActive(false)
      return
    }
    if (!('wakeLock' in navigator)) {
      setVeilleIndisponible(true)
      return
    }
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen')
      setVeilleActive(true)
      wakeLockRef.current.addEventListener('release', () => setVeilleActive(false))
    } catch {
      setVeilleIndisponible(true)
    }
  }

  useEffect(() => {
    return () => wakeLockRef.current?.release()
  }, [])

  if (erreur) return <div className="message erreur">{erreur}</div>
  if (!s) return <p className="vide">Chargement de la situation…</p>

  const m = s.evenement?.modules ?? {}

  // Demandes ventilées par domaine. Avant, chaque colonne affichait le
  // total tous modules confondus : « 7 ouvertes » sous Sécurité alors
  // que 4 des 7 étaient logistiques, et absentes de Logistique.
  const parModule = s.missions?.par_module ?? {}
  const secu = parModule.securite ?? { ouvertes: 0, p1: 0 }
  const logi = parModule.logistique ?? { ouvertes: 0, p1: 0 }

  // Colonnes de cette phase. Une phase inconnue retombe sur
  // l'exploitation : mieux vaut trop montrer que rien du tout.
  const colonnes = COLONNES_PAR_PHASE[s.evenement?.phase] ?? COLONNES_PAR_PHASE.exploitation
  const montre = (clef) => colonnes.includes(clef)
  // (125) Le compte du serveur — le même que le Mur et le bandeau
  // d'état. Le calcul local sur les cinq prochains jalons n'est plus
  // qu'un repli.
  const jalonsEnRetard =
    s.jalons_en_retard ?? (s.jalons ?? []).filter((j) => j.echeance && new Date(j.echeance) < new Date()).length
  const etapes = s.parcours?.etapes ?? []
  const etapesChargees = etapes.filter((e) => e.capacite > 0 && (e.charge ?? 0) >= 0.9 * e.capacite).length

  return (
    <div className="situation dom-indigo">
      <div className="entete-dashboard">
        <h2>Situation</h2>
        <div className="ligne-boutons" style={{ marginBottom: 0 }}>
          <button
            className={sonActif ? '' : 'discret'}
            onClick={() => setSonActif(!sonActif)}
            title="Alarme sonore sur toute nouvelle urgence — mayday, P1, alerte"
          >
            {sonActif ? '🔔 Son ON' : '🔕 Son OFF'}
          </button>
          <button
            className={veilleActive ? '' : 'discret'}
            onClick={basculerVeille}
            title="Empêche le verrouillage automatique de cet écran"
          >
            {veilleActive ? '☀ Veille ON' : '🌙 Veille OFF'}
          </button>
          <span className="compte">
            {maj && `relevé ${maj.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`}
          </span>
        </div>
      </div>
      {veilleIndisponible && (
        <p className="aide">
          Ce navigateur ne permet pas d'empêcher le verrouillage d'écran depuis cette page.
        </p>
      )}

      {/* --- 1. Ce qui exige une décision --- */}

      {retour && (
        <div className={`message ${retour.type === 'erreur' ? 'erreur' : ''}`} role="status">
          {retour.texte}
          <button className="lien" style={{ marginLeft: 10 }} onClick={() => setRetour(null)}>
            OK
          </button>
        </div>
      )}

      <Maydays evenement={evenement} compact />

      {(s.alertes ?? []).map((a, i) => (
        <div className={`bandeau-alerte niv-${a.niveau}`} key={a.id ?? i}>
          <div className="niv">{a.niveau}</div>
          <div className="contenu">
            <strong>{a.titre}</strong>
            {a.message && <div className="msg">{a.message}</div>}
            {a.consigne && <div className="consigne">→ {a.consigne}</div>}
            {a.emise_le && (
              <div className="meta">
                <span>émise à {new Date(a.emise_le).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</span>
                <span>il y a {ecoule(a.emise_le)}</span>
                {peutAlertes && a.id && !a.acquittee_le && (
                  <button className="discret" onClick={() => acquitter(a)} title="Le PC a vu et prend en compte, sans lever">
                    Vu, pris en compte
                  </button>
                )}
              </div>
            )}
            {/* (122) Qui a lu : la liste nominative, comme au QG de BFMF. */}
            {a.accuses && (
              <Accuses liste={a.accuses} acquittee_le={a.acquittee_le} acquittee_par={a.acquittee_par} membresActifs={a.membres_actifs} />
            )}
          </div>
        </div>
      ))}

      {(s.recherches ?? []).length > 0 && (
        <div className="bloc-alerte">
          <div className="pave-titre">Recherche en cours</div>
          {s.recherches.map((r, i) => (
            <div className="ligne-retard" key={i}>
              <strong>
                {r.nom || 'Personne non identifiée'}{' '}
                <span className="mono">{r.reference}</span>
              </strong>
              <div className="meta">
                <span>{r.description}</span>
                {r.dernier_lieu && <span>vu·e : {r.dernier_lieu}</span>}
                <span>depuis {ecoule(r.depuis)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Meteo evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} compact />

      {/* --- 2/3. Domaines opérationnels ------------------------------
           Repris du dashboard v18 : un bandeau de couleur par domaine,
           des compteurs minuscules colorés par ÉTAT (pas par domaine —
           rouge = nouveau/urgent, ambre = en attente, bleu = en cours,
           vert = traité), et un panneau qui défile en dessous avec un
           lien direct vers l'écran complet. C'est ce qui tient sur un
           seul écran de QG sans jamais faire défiler la page entière. */}

      <div className="grille-domaines">
        {/* Colonne propre aux phases où l'on pilote des échéances plutôt
            que du temps réel. C'est elle qui manquait : les jalons
            existaient dans les données mais n'étaient affichés nulle
            part sur cet écran. */}
        {montre('preparation') && (
          <ColonneDomaine
            teinte="tilleul"
            icone="☑"
            titre="Préparation"
            lien="preparation"
            onAller={onAller}
            compteurs={[
              { libelle: 'En retard', valeur: jalonsEnRetard || null, etat: 'urgent' },
              { libelle: 'À venir', valeur: (s.jalons ?? []).length, etat: 'attente' }
            ]}
          >
            {(s.jalons ?? []).length === 0 ? (
              <p className="moniteur-vide">Aucune échéance à venir.</p>
            ) : (
              (s.jalons ?? []).map((j, i) => {
                const retard = j.echeance && new Date(j.echeance) < new Date()
                return (
                  <div className={`moniteur-ligne ${retard || j.critique ? 'urgent' : ''}`} key={i}>
                    <strong>{j.libelle}</strong>
                    <span>
                      {j.echeance
                        ? new Date(j.echeance).toLocaleDateString('fr-BE', {
                            weekday: 'short',
                            day: '2-digit',
                            month: '2-digit'
                          })
                        : 'sans échéance'}
                      {j.responsable ? ` · ${j.responsable}` : ''}
                      {retard ? ' · en retard' : ''}
                    </span>
                  </div>
                )
              })
            )}
          </ColonneDomaine>
        )}


        {montre('securite') && (
        <ColonneDomaine
          teinte="grenat"
          icone="⚠"
          titre="Sécurité"
          lien="securite"
          onAller={onAller}
          compteurs={[
            // Les signalements (SOS) et les demandes sécurité sont deux
            // files distinctes : le moniteur montre les premiers, les
            // deux compteurs suivants comptent les secondes. Sans ce
            // compteur, un SOS apparaissait dans le moniteur sans que
            // rien ne bouge en tête de colonne (3a-01).
            { libelle: 'SOS à traiter', valeur: s.signalements?.non_pris_en_charge ?? 0, etat: 'urgent' },
            { libelle: 'Demandes P1', valeur: secu.p1, etat: 'urgent' },
            {
              libelle: 'Demandes',
              valeur: Math.max(0, (secu.ouvertes ?? 0) - (secu.p1 ?? 0)),
              etat: 'attente'
            }
          ]}
        >
          {signalementsRecents.length === 0 && demandesSecurite.length === 0 && (s.recherches ?? []).length === 0 ? (
            <p className="moniteur-vide">Aucun signalement ni demande ouverts.</p>
          ) : (
            <>
              {(s.recherches ?? []).map((r, i) => (
                <div className="moniteur-ligne urgent" key={'r' + i}>
                  <strong>Recherche — {r.nom || 'personne'}</strong>
                  <span>{r.description}</span>
                </div>
              ))}
              {signalementsRecents.map((x) => (
                <div
                  className={`moniteur-ligne ${x.statut === 'recu' ? 'urgent' : ''}`}
                  key={x.id}
                >
                  <strong>
                    {TYPES[x.type] ?? x.type}
                    {x.description ? ` — ${x.description}` : ''}
                  </strong>
                  <span>
                    {libelleStatut(x.statut)} <span className="mono">· {x.reference}</span>
                    {x.recu_le && ` · il y a ${ecoule(x.recu_le)}`}
                    {x.lieu?.nom && ` · ${x.lieu.nom}`}
                    {surTrace(x) && <span className="sur-trace"> · {surTrace(x)}</span>}
                    {x.contact && (
                      <>
                        {' · '}
                        <a href={`tel:${x.contact.replace(/\s/g, '')}`}>{x.contact}</a>
                      </>
                    )}
                    {x.latitude && (
                      <>
                        {' · '}
                        <a
                          href={`https://www.google.com/maps?q=${x.latitude},${x.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          carte
                        </a>
                      </>
                    )}
                  </span>
                  {(peutSos || peutMissions) && (
                    <span className="moniteur-actions">
                      {peutSos && x.statut === 'recu' && (
                        <button className="discret" disabled={occupe === x.id}
                          onClick={() => agir('signalements', x, 'pris_en_charge', 'pris en charge')}>
                          Prendre en charge
                        </button>
                      )}
                      {peutMissions && peutSos && (
                        <button className="discret" disabled={occupe === x.id}
                          title="Créer une demande sécurité P2 à partir de ce signalement"
                          onClick={() => convertir(x)}>
                          → Demande
                        </button>
                      )}
                      {peutSos && (
                        <button className="discret cloturer" disabled={occupe === x.id}
                          onClick={() => agir('signalements', x, 'clos', 'clôturé')}>
                          Clôturer
                        </button>
                      )}
                    </span>
                  )}
                </div>
              ))}
              {demandesSecurite.map((d) => (
                <LigneDemande key={d.id} d={d} peut={peutMissions} occupe={occupe} agir={agir} equipes={equipes} attribuer={attribuer} />
              ))}
            </>
          )}
          {peutMissions && equipes.length > 0 && (
            engagement ? (
              <div className="moniteur-ligne engagement">
                <input
                  autoFocus
                  value={engagement.titre}
                  onChange={(e) => setEngagement({ ...engagement, titre: e.target.value })}
                  placeholder="Quoi — ex. : chute cycliste, renfort barrière"
                  aria-label="Objet de l'engagement"
                />
                <span className="moniteur-actions">
                  <select value={engagement.equipe} onChange={(e) => setEngagement({ ...engagement, equipe: e.target.value })} aria-label="Équipe">
                    <option value="">— équipe —</option>
                    {equipes.map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.code}
                      </option>
                    ))}
                  </select>
                  <select value={engagement.lieu} onChange={(e) => setEngagement({ ...engagement, lieu: e.target.value })} aria-label="Lieu">
                    <option value="">— lieu —</option>
                    {(fond?.lieux ?? [])
                      .slice()
                      .sort((a, b) => (a.pk_km ?? 1e9) - (b.pk_km ?? 1e9) || (a.nom ?? '').localeCompare(b.nom ?? ''))
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.pk_km != null ? `km ${Number(l.pk_km).toFixed(1)} · ` : ''}
                          {l.code || l.nom}
                        </option>
                      ))}
                  </select>
                  <button className="discret" disabled={occupe === 'engagement' || !engagement.titre.trim() || !engagement.equipe} onClick={engager}>
                    Engager (P1)
                  </button>
                  <button className="discret" onClick={() => setEngagement(null)}>
                    Annuler
                  </button>
                </span>
              </div>
            ) : (
              <p className="moniteur-vide">
                <button className="discret" onClick={() => setEngagement({ titre: '', equipe: '', lieu: '' })}>
                  + Engager une équipe
                </button>
              </p>
            )
          )}
        </ColonneDomaine>
        )}

        {m.logistique && montre('logistique') && (
          <ColonneDomaine
            teinte="bronze"
            icone="▤"
            titre="Logistique"
            lien="logistique"
            onAller={onAller}
            compteurs={[
              // Masqué à zéro : cinq compteurs sur un téléphone, c'est
              // trop, et une demande logistique P1 est rare. Sécurité
              // garde le sien visible — y lire « 0 P1 » rassure.
              { libelle: 'P1', valeur: logi.p1 || null, etat: 'urgent' },
              {
                libelle: 'Demandes',
                valeur: Math.max(0, (logi.ouvertes ?? 0) - (logi.p1 ?? 0)),
                etat: 'attente'
              },
              {
                libelle: 'Sous seuil',
                valeur: (s.logistique?.sous_seuil ?? []).length,
                etat: 'urgent'
              },
              { libelle: 'Transports', valeur: s.logistique?.transports_ouverts, etat: 'cours' },
              { libelle: 'Non rendus', valeur: s.logistique?.biens_non_rendus, etat: 'attente' }
            ]}
          >
            {/* La jauge contre la capacité attendue : « 412 présents »
                ne dit rien sans « sur 500 ». Chaude à 90 %, comme le
                bandeau d'état (comparatif BFMF 2026, lot 1). */}
            {evenement.frequentation_max > 0 && s.logistique?.jauge != null && (
              <JaugeLigne presents={s.logistique.jauge} max={evenement.frequentation_max} />
            )}
            {demandesLogistique.length === 0 && (s.logistique?.sous_seuil ?? []).length === 0 ? (
              <p className="moniteur-vide">Aucune demande ouverte, aucune anomalie matérielle.</p>
            ) : (
              <>
                {demandesLogistique.map((d) => (
                  <LigneDemande key={d.id} d={d} peut={peutMissions} occupe={occupe} agir={agir} equipes={equipes} attribuer={attribuer} />
                ))}
                {/* (122) Les six prochains transports, avec chauffeur et
                    RDV : un compteur seul ne disait pas où en est la
                    navette de la gare. */}
                {(s.logistique?.transports ?? []).map((t) => (
                  <div className={`moniteur-ligne ${t.priorite === 'P1' ? 'urgent' : ''}`} key={t.id}>
                    <strong>
                      {t.reference} — {t.depart ?? '?'} → {t.arrivee ?? '?'}
                      {t.nb_personnes ? ` · ${t.nb_personnes} pers.` : ''}
                    </strong>
                    <span>
                      {libelleStatutTransport(t.statut)}
                      {t.souhaite_pour && ` · RDV ${heureCourte(t.souhaite_pour)}`}
                      {t.prise_en_charge_le && ` · en route depuis ${heureCourte(t.prise_en_charge_le)}`}
                      {t.chauffeur ? ` · ${t.chauffeur}` : ' · sans chauffeur'}
                      {t.vehicule ? ` (${t.vehicule})` : ''}
                      {t.motif ? ` · ${t.motif}` : ''}
                      {/* (125) Où en est la course, dit par le chauffeur. */}
                      {t.etape && <span className={`jeton etape-${t.etape}`}>{libelleEtapeTransport(t.etape)}</span>}
                    </span>
                  </div>
                ))}
                {(s.logistique?.sous_seuil ?? []).map((a, i) => (
                  <div className="moniteur-ligne urgent" key={'s' + i}>
                    <strong>{a.nom}</strong>
                    <span>
                      {Number(a.quantite)} {a.unite ?? ''} (seuil {Number(a.seuil)})
                    </span>
                  </div>
                ))}
              </>
            )}
          </ColonneDomaine>
        )}

        {m.parcours && montre('parcours') && (
          <ColonneDomaine
            teinte="mousse"
            icone="➜"
            titre="Parcours"
            lien="parcours"
            onAller={onAller}
            compteurs={[
              { libelle: 'Sans nouvelles', valeur: s.parcours?.sans_nouvelles, etat: 'urgent' },
              // (125) Une étape à 90 % de sa capacité : on freine les départs.
              ...(etapes.some((e) => e.capacite > 0)
                ? [{ libelle: 'Étapes chargées', valeur: etapesChargees || null, etat: 'urgent' }]
                : []),
              // (122) En attente au départ et rentrés, en personnes :
              // les deux cadrans de BFMF qui manquaient.
              { libelle: 'En attente', valeur: s.parcours?.personnes_en_attente || null, etat: 'attente' },
              { libelle: 'En route', valeur: s.parcours?.en_route, etat: 'cours' },
              { libelle: 'Rentrés', valeur: s.parcours?.personnes_rentrees ?? s.parcours?.arrives, etat: 'ok' }
            ]}
          >
            {/* (125) Charge et capacité des étapes : barre à partir de
                72 %, rouge à 100 %. Une étape sans capacité renseignée
                n'a pas de barre — elle se règle dans l'import des lieux. */}
            {etapes
              .filter((e) => e.capacite > 0)
              .map((e) => (
                <JaugeEtape key={e.id} etape={e} />
              ))}
            {(s.parcours?.groupes ?? []).length === 0 ? (
              <p className="moniteur-vide">Aucun groupe dehors.</p>
            ) : (
              // (122) Chaque groupe dehors, où il a été vu et quand —
              // avant, la colonne tactique seule le montrait, à partir
              // de 1440 px.
              (s.parcours?.groupes ?? []).map((g) => (
                <div className={`moniteur-ligne ${g.sans_nouvelles ? 'urgent' : ''}`} key={g.id}>
                  <strong>
                    {g.code ? `${g.code} · ` : ''}{g.nom}
                    {g.effectif ? ` · ${g.effectif} pers.` : ''}
                  </strong>
                  <span>
                    {g.dernier_lieu ?? 'position inconnue'}
                    {g.dernier_passage ? ` · vu il y a ${ecoule(g.dernier_passage)}` : ' · jamais pointé'}
                    {g.sans_nouvelles ? ' · sans nouvelles' : ''}
                  </span>
                </div>
              ))
            )}
          </ColonneDomaine>
        )}

        {m.rh && montre('rh') && (
          <ColonneDomaine
            teinte="azur"
            icone="☺"
            titre="Bénévoles"
            lien="rh"
            onAller={onAller}
            compteurs={[
              { libelle: 'À couvrir', valeur: s.rh?.postes_a_couvrir, etat: 'urgent' },
              { libelle: 'Créneaux', valeur: s.rh?.creneaux_decouverts, etat: 'attente' }
            ]}
          >
            {s.rh?.postes_a_couvrir > 0 ? (
              <p className="moniteur-vide alerte">
                {s.rh.creneaux_decouverts} créneau(x) découvert(s) — voir Bénévoles.
              </p>
            ) : (
              <p className="moniteur-vide">Couverture complète.</p>
            )}
          </ColonneDomaine>
        )}
      </div>

      {/* (125) Sous 1440 px la colonne tactique n'existe pas : la carte
          et le plan radio se replient ici, fermés par défaut, ouverts à
          la demande — un portable de PC n'a pas la largeur du mur. */}
      {!large && <TactiqueRepliee evenement={evenement} onAller={onAller} />}

      {/* --- 4. Le fil --- */}

      <section className="panneau large">
        <h2>Derniers événements</h2>
        <div className="panneau-corps">
        <ul className="chrono">
          {(s.journal ?? []).map((l, i) => (
            <li key={i} className={`imp-${l.importance} src-${l.source}`}>
              <span className="heure mono">
                {new Date(l.horodatage).toLocaleTimeString('fr-BE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="corps">
                {l.texte}
                {l.module && <span className="tag">{l.module}</span>}
              </span>
            </li>
          ))}
        </ul>
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Colonne de domaine — bandeau coloré, compteurs minuscules colorés
 * par ÉTAT, panneau défilant, lien direct vers l'écran complet.
 */
/**
 * Un bloc de domaine — partagé par Situation et Mon poste.
 *
 * Le repli vient de la couche mobile mais ne lui appartient pas : ce
 * qu'il résout, c'est le NOMBRE de blocs, pas la largeur de l'écran.
 * Un coordinateur a neuf blocs sur Mon poste ; même en quatre colonnes,
 * cela fait trois rangées pleine hauteur. Pouvoir n'en garder ouverts
 * que deux ou trois vaut aussi devant un grand écran.
 *
 * Le défaut diffère, lui, selon l'appareil : tout ouvert sur un poste
 * de PC, tout replié sur un téléphone. Et le choix se retient — un bloc
 * qu'on doit replier à chaque rechargement est une corvée, pas un
 * réglage.
 */
/* Une demande (mission) sécurité ou logistique dans un moniteur, avec
   ce que le QG en fait sans quitter la Situation : la démarrer, la
   clore — et depuis la 122, l'attribuer à une équipe (BFMF le faisait
   en un clic ; ici il fallait changer d'écran). La ligne dit aussi
   l'équipe, le lieu et le titulaire. */
function LigneDemande({ d, peut, occupe, agir, equipes = [], attribuer }) {
  return (
    <div className={`moniteur-ligne ${d.priorite === 'P1' ? 'urgent' : ''}`}>
      <strong>
        {d.priorite} — {d.titre}
      </strong>
      <span>
        {libelleStatut(d.statut)} <span className="mono">· {d.reference}</span>
        {d.lieu?.nom && ` · ${d.lieu.nom}`}
        {d.equipe?.code && ` · équipe ${d.equipe.code}`}
        {d.membre?.nom_affiche && ` · ${d.membre.nom_affiche}`}
        {!d.equipe_id && !d.membre_id && ' · sans titulaire'}
        {/* (123) L'accusé de l'équipe : « Je démarre » sur le terrain
            date l'engagement, et le PC le voit ici. */}
        {d.statut === 'en_cours' && d.demarree_le && (
          <span className="engagee"> · engagée{d.lieu?.nom ? ` à ${d.lieu.nom}` : ''} depuis {heureCourte(d.demarree_le)}</span>
        )}
        {d.statut === 'attribuee' && d.attribuee_le && !d.demarree_le && (
          <span className="sourdine"> · attribuée {heureCourte(d.attribuee_le)}, pas encore démarrée</span>
        )}
      </span>
      {peut && (
        <span className="moniteur-actions">
          {attribuer && equipes.length > 0 && (
            <select
              value={d.equipe_id ?? ''}
              disabled={occupe === d.id}
              onChange={(e) => attribuer(d, e.target.value)}
              aria-label="Attribuer à une équipe"
              title="Attribuer à une équipe"
            >
              <option value="">— équipe —</option>
              {equipes.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.code}
                </option>
              ))}
            </select>
          )}
          {d.statut !== 'en_cours' && (
            <button className="discret" disabled={occupe === d.id}
              onClick={() => agir('missions', d, 'en_cours', 'en cours')}>
              Démarrer
            </button>
          )}
          <button className="discret cloturer" disabled={occupe === d.id}
            onClick={() => agir('missions', d, 'resolue', 'close')}>
            Clore
          </button>
        </span>
      )}
    </div>
  )
}

export function ColonneDomaine({ teinte, icone, titre, lien, onAller, compteurs, children }) {
  const clef = `bloc-replie:${titre}`

  const [ouvert, setOuvert] = useState(() => {
    if (typeof window === 'undefined') return true
    try {
      const garde = window.localStorage.getItem(clef)
      if (garde !== null) return garde === 'ouvert'
    } catch {
      /* stockage refusé (navigation privée) : on retombe sur le défaut */
    }
    return !window.matchMedia('(max-width: 700px)').matches
  })

  function basculer() {
    const suivant = !ouvert
    setOuvert(suivant)
    try {
      window.localStorage.setItem(clef, suivant ? 'ouvert' : 'replie')
    } catch {
      /* sans persistance, le repli reste valable pour la session */
    }
  }

  return (
    <div className={`colonne-domaine dom-${teinte} ${ouvert ? '' : 'replie'}`}>
      <button className="colonne-tete" onClick={basculer} aria-expanded={ouvert}>
        <span className="colonne-icone">{icone}</span>
        <span className="colonne-titre">{titre}</span>
        <ChevronDown className="colonne-chevron" size={16} strokeWidth={2} aria-hidden="true" />
      </button>

      <div className="colonne-compteurs">
        {compteurs
          .filter((c) => c.valeur !== null && c.valeur !== undefined)
          .map((c, i) => (
            <div className={`compteur-mini etat-${c.etat}`} key={i}>
              <span className="compteur-mini-valeur">{c.valeur}</span>
              <span className="compteur-mini-libelle">{c.libelle}</span>
            </div>
          ))}
      </div>

      <div className="moniteur">
        <div className="moniteur-entete">
          <span>Moniteur</span>
          {onAller && (
            <button className="moniteur-lien" onClick={() => onAller(lien)}>
              Ouvrir l'app →
            </button>
          )}
        </div>
        <div className="moniteur-corps">{children}</div>
      </div>
    </div>
  )
}

/** Présents contre capacité attendue, en barre : chaude dès 90 %. */
/* (125) Une étape : charge / capacité, barre à partir de 72 %, rouge à
   100 %. Les seuils de BFMF. */
function JaugeEtape({ etape }) {
  const taux = Math.min(1, (etape.charge ?? 0) / etape.capacite)
  const niveau = taux >= 1 ? 'urgent' : taux >= 0.72 ? 'veille' : ''
  return (
    <div className={`moniteur-ligne jauge-ligne jauge-etape ${niveau}`}>
      <strong>
        {etape.code ? `${etape.code} · ` : ''}{etape.nom} {etape.charge ?? 0} / {etape.capacite}
        {taux >= 0.72 ? ` · ${Math.round(taux * 100)} %` : ''}
        {taux >= 1 ? ' · pleine' : ''}
      </strong>
      {taux >= 0.72 && (
        <span className="barre" aria-hidden="true">
          <span style={{ width: `${Math.round(taux * 100)}%` }} />
        </span>
      )}
    </div>
  )
}

/* (125) La carte tactique et le plan radio, repliés : les données ne
   sont chargées qu'à l'ouverture — un écran projeté sous 1440 px ne
   paie pas vingt requêtes de plus pour un bloc fermé. */
function TactiqueRepliee({ evenement, onAller }) {
  const [ouvert, setOuvert] = useState(() => {
    try { return window.localStorage.getItem('situation.tactique') === '1' } catch { return false }
  })
  useEffect(() => {
    try { window.localStorage.setItem('situation.tactique', ouvert ? '1' : '0') } catch {}
  }, [ouvert])
  return (
    <section className={`panneau large tactique-repliee ${ouvert ? 'ouvert' : ''}`}>
      <div className="entete-dashboard">
        <h2>Carte tactique et radio</h2>
        <button className="lien" onClick={() => setOuvert(!ouvert)}>
          {ouvert ? 'Replier' : 'Déplier'}
        </button>
      </div>
      {ouvert && <TactiqueContenu evenement={evenement} onAller={onAller} />}
    </section>
  )
}

function TactiqueContenu({ evenement, onAller }) {
  const { fond, vif, lieux } = useTactique(evenement)
  return (
    <div className="tactique-contenu">
      <div>
        {!fond ? (
          <p className="vide">Chargement de la carte…</p>
        ) : (
          <CarteTactique evenement={evenement} fond={fond} vif={vif} lieux={lieux} hauteur={360} />
        )}
      </div>
      <div>
        <Radio evenement={evenement} onAller={onAller} />
      </div>
    </div>
  )
}

export function JaugeLigne({ presents, max }) {
  const taux = Math.min(1, presents / max)
  const chaud = taux >= 0.9
  return (
    <div className={`moniteur-ligne jauge-ligne ${chaud ? 'urgent' : ''}`}>
      <strong>
        Présents {presents} / {max}
        {chaud ? ` · ${Math.round(taux * 100)} % de la capacité` : ''}
      </strong>
      <span className="barre" aria-hidden="true">
        <span style={{ width: `${Math.round(taux * 100)}%` }} />
      </span>
    </div>
  )
}

function heureCourte(iso) {
  return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}

function ecoule(date) {
  const min = Math.round((Date.now() - new Date(date)) / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 48 ? `${h} h ${min % 60} min` : `${Math.round(h / 24)} j`

}
