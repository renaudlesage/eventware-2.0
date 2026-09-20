import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import Meteo from './Meteo'
import Maydays from './Maydays'
import { libelleStatut } from './libelles'
import { TYPES } from './PcOps'
import { ChevronDown } from 'lucide-react'

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

export default function Situation({ evenement, peut, toutPouvoir, onAller }) {
  const [s, setS] = useState(null)
  const [signalementsRecents, setSignalementsRecents] = useState([])
  const [demandesLogistique, setDemandesLogistique] = useState([])
  const [erreur, setErreur] = useState(null)
  const [maj, setMaj] = useState(null)
  const [sonActif, setSonActif] = useState(false)
  const [veilleActive, setVeilleActive] = useState(false)
  const [veilleIndisponible, setVeilleIndisponible] = useState(false)
  const wakeLockRef = useRef(null)
  const urgencePrecedenteRef = useRef(null)

  // Compte ce qui exige vraiment une réaction immédiate — alertes
  // actives (le Mayday y crée déjà sa propre ligne, pas besoin de le
  // compter à part) et missions P1 non résolues. Un simple total, pas
  // le détail : on ne veut savoir qu'une chose, si ça vient de monter.
  function compterUrgent(donnees) {
    const alertesActives = donnees?.alertes?.length ?? 0
    const p1 = donnees?.missions?.p1 ?? 0
    return alertesActives + p1
  }

  function jouerAlarme() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      ;[0, 260, 520].forEach((decalage) => {
        setTimeout(() => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'square'
          osc.frequency.value = 880
          gain.gain.value = 0.15
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start()
          osc.stop(ctx.currentTime + 0.18)
        }, decalage)
      })
    } catch {
      /* Certains navigateurs bloquent l'audio sans interaction récente
         de l'utilisateur — l'activation du son par un clic suffit
         normalement, mais on ne casse jamais l'écran pour ça. */
    }
  }

  async function charger() {
    const [{ data, error }, sig, logi] = await Promise.all([
      supabase.rpc('situation', { p_evenement: evenement.id }),
      // Requête directe plutôt que de dépendre du sous-objet exposé
      // par situation() : le moniteur affichait la référence et le
      // type, jamais le descriptif que la personne a réellement tapé
      // — illisible en pratique. On garde le contrôle total des
      // colonnes ici plutôt que de deviner ce que le RPC choisit
      // d'exposer.
      supabase
        .from('signalements')
        .select('id, reference, type, description, statut')
        .eq('evenement_id', evenement.id)
        .order('recu_le', { ascending: false })
        .limit(5),
      // Les demandes logistiques ouvertes, pour le moniteur de la
      // colonne Logistique : son compteur les comptait, son moniteur
      // ne montrait que le matériel sous seuil — « 3 demandes » sans
      // aucune demande visible (campagne du 20/09, 3a-01).
      supabase
        .from('missions')
        .select('id, reference, titre, statut, priorite')
        .eq('evenement_id', evenement.id)
        .eq('module', 'logistique')
        .is('deleted_at', null)
        .not('statut', 'in', '("resolue","annulee")')
        .order('priorite')
        .order('created_at', { ascending: false })
        .limit(6)
    ])
    if (error) setErreur(texteErreur(error))
    else {
      const urgentAvant = urgencePrecedenteRef.current
      const urgentMaintenant = compterUrgent(data)
      if (sonActif && urgentAvant != null && urgentMaintenant > urgentAvant) jouerAlarme()
      urgencePrecedenteRef.current = urgentMaintenant

      setS(data)
      setSignalementsRecents(sig.data ?? [])
      setDemandesLogistique(logi.data ?? [])
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
  const jalonsEnRetard = (s.jalons ?? []).filter(
    (j) => j.echeance && new Date(j.echeance) < new Date()
  ).length

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

      <Maydays evenement={evenement} compact />

      {(s.alertes ?? []).map((a, i) => (
        <div className={`bandeau-alerte niv-${a.niveau}`} key={i}>
          <div className="niv">{a.niveau}</div>
          <div className="contenu">
            <strong>{a.titre}</strong>
            {a.consigne && <div className="consigne">→ {a.consigne}</div>}
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
          {signalementsRecents.length === 0 && (s.recherches ?? []).length === 0 ? (
            <p className="moniteur-vide">Aucun signalement actif.</p>
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
                  </span>
                </div>
              ))}
            </>
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
            {demandesLogistique.length === 0 && (s.logistique?.sous_seuil ?? []).length === 0 ? (
              <p className="moniteur-vide">Aucune demande ouverte, aucune anomalie matérielle.</p>
            ) : (
              <>
                {demandesLogistique.map((d) => (
                  <div
                    className={`moniteur-ligne ${d.priorite === 'P1' ? 'urgent' : ''}`}
                    key={d.id}
                  >
                    <strong>
                      {d.priorite} — {d.titre}
                    </strong>
                    <span>
                      {libelleStatut(d.statut)} <span className="mono">· {d.reference}</span>
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
              { libelle: 'En route', valeur: s.parcours?.en_route, etat: 'cours' },
              { libelle: 'Arrivés', valeur: s.parcours?.arrives, etat: 'ok' }
            ]}
          >
            {s.parcours?.sans_nouvelles > 0 ? (
              <p className="moniteur-vide alerte">
                {s.parcours.sans_nouvelles} groupe(s) sans nouvelles — voir Parcours.
              </p>
            ) : (
              <p className="moniteur-vide">Tous les groupes donnent de leurs nouvelles.</p>
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

function ecoule(date) {
  const min = Math.round((Date.now() - new Date(date)) / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 48 ? `${h} h ${min % 60} min` : `${Math.round(h / 24)} j`

}
