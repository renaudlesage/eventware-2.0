import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/**
 * Réglages › Données › Vider l'événement (migration 111, 26/09).
 *
 * Après une campagne de tests, une répétition ou une reconduction, on
 * repart d'un événement propre sans script SQL. Par bloc, au choix ;
 * réservé au coordinateur (tout pouvoir, vérifié aussi par la base) ;
 * confirmation en retapant le nom de l'événement ; interdit en
 * exploitation ; une ligne au journal dit qui a vidé quoi.
 *
 * Les comptes affichés viennent de la même fonction, en simulation :
 * ce qu'on lit est exactement ce qui sera supprimé.
 */

const BLOCS = [
  {
    clef: 'activite',
    titre: 'Activité',
    detail:
      "Signalements, demandes et leurs commentaires, recherches, MAYDAY, alertes, journal, comptages, pointages, transports, biens remis, mouvements de stock, REX. Les stocks reviennent à leur quantité d'avant les mouvements ; les groupes du parcours repartent « inscrits ».",
    tables: ['diffusions', 'maydays', 'alertes', 'mission_commentaires', 'missions', 'signalements', 'recherches', 'comptages', 'comptages_parcours', 'passages', 'transports', 'attributions', 'mouvements_stock', 'rex_entrees', 'bascule_phase', 'veille_etat_criteres', 'journal']
  },
  {
    clef: 'preparation',
    titre: 'Préparation et planning',
    detail: 'Jalons et actions, groupes de travail, programme, communications, pièces jointes des jalons (fichiers compris).',
    tables: ['pieces_jointes', 'jalons', 'groupes_travail', 'programme', 'communications']
  },
  {
    clef: 'benevoles',
    titre: 'Bénévoles',
    detail: 'Créneaux, affectations, fiches de poste. Les membres, eux, restent.',
    tables: ['affectations', 'creneaux', 'fiches_poste']
  },
  {
    clef: 'parcours',
    titre: 'Parcours',
    detail: 'Groupes, traces GPS, tronçons.',
    tables: ['segments_parcours', 'groupes', 'traces']
  },
  {
    clef: 'plan',
    titre: "Plan d'implantation",
    detail: 'Éléments du plan (dispositif, installations à risque), moyens de premiers secours, canaux radio.',
    tables: ['elements_plan', 'moyens_premiers_secours', 'canaux_radio']
  },
  {
    clef: 'referentiels',
    titre: 'Référentiels',
    detail:
      'Lieux (et les tronçons qui en partent), matériel et ses mouvements, contacts, équipes, types de demande, fiches réflexe, journal des imports.',
    tables: ['lieux', 'materiel', 'contacts', 'equipes', 'types_mission', 'fiches_reflexe', 'journal_imports']
  },
  {
    clef: 'conformite',
    titre: 'Conformité',
    detail: 'Réponses au questionnaire, contrôles et leurs lignes.',
    tables: ['conformite_reponses', 'controles_sessions']
  }
]

export default function ViderEvenement({ evenement, setMessage, onFait }) {
  const [comptes, setComptes] = useState(null)
  const [choix, setChoix] = useState([])
  const [nom, setNom] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [fait, setFait] = useState(null)

  async function compter() {
    const { data, error } = await supabase.rpc('vider_evenement', {
      p_evenement: evenement.id,
      p_blocs: BLOCS.map((b) => b.clef),
      p_confirmation: null,
      p_simulation: true
    })
    if (error) setErreur(texteErreur(error))
    else setComptes(data?.detail ?? {})
  }

  useEffect(() => {
    compter()
  }, [evenement.id])

  const compteBloc = (b) =>
    comptes ? b.tables.reduce((n, t) => n + (Number(comptes[t]) || 0), 0) : null
  const total = BLOCS.filter((b) => choix.includes(b.clef)).reduce((n, b) => n + (compteBloc(b) ?? 0), 0)
  const enExploitation = evenement.phase === 'exploitation'
  const nomOk = nom.trim().toLowerCase() === (evenement.nom ?? '').trim().toLowerCase()

  function basculer(clef) {
    setFait(null)
    setChoix((c) => (c.includes(clef) ? c.filter((x) => x !== clef) : [...c, clef]))
  }

  async function vider() {
    setOccupe(true)
    setErreur(null)
    // Les fichiers des pièces jointes vivent dans le stockage, pas en
    // base : la fonction efface les lignes, l'application retire les
    // fichiers d'abord (sinon ils resteraient orphelins dans le bucket).
    if (choix.includes('preparation')) {
      const { data } = await supabase
        .from('pieces_jointes')
        .select('chemin')
        .eq('evenement_id', evenement.id)
        .eq('objet_type', 'jalon')
      const chemins = (data ?? []).map((p) => p.chemin).filter(Boolean)
      if (chemins.length) await supabase.storage.from('pieces').remove(chemins)
    }
    const { data, error } = await supabase.rpc('vider_evenement', {
      p_evenement: evenement.id,
      p_blocs: choix,
      p_confirmation: nom,
      p_simulation: false
    })
    setOccupe(false)
    if (error) {
      setErreur(texteErreur(error))
      return
    }
    setFait(data)
    setChoix([])
    setNom('')
    setMessage?.({ type: 'ok', texte: `Événement vidé : ${data.total} ligne(s) supprimée(s).` })
    compter()
    onFait?.()
  }

  return (
    <section className="bloc vider-evenement">
      <h2>Vider l'événement</h2>
      <p className="aide">
        Pour repartir propre après des tests, une répétition ou une reconduction. On choisit
        les blocs à vider ; ce qui est coché est supprimé pour de bon, sans retour possible.
        L'événement, ses réglages, ses membres, ses rôles et ses accès autorité ne sont jamais
        touchés.
      </p>

      {enExploitation && (
        <div className="message erreur">
          L'événement est en exploitation : on ne le vide pas pendant qu'il se déroule. Change
          d'abord de phase (Réglages › Dispositif).
        </div>
      )}

      <div className="blocs-vidage">
        {BLOCS.map((b) => {
          const n = compteBloc(b)
          return (
            <label className={`bloc-vidage ${choix.includes(b.clef) ? 'coche' : ''}`} key={b.clef}>
              <input
                type="checkbox"
                checked={choix.includes(b.clef)}
                onChange={() => basculer(b.clef)}
                disabled={enExploitation || occupe}
              />
              <span>
                <strong>{b.titre}</strong>
                <span className="mono compte-vidage">
                  {n === null ? '…' : `${n} ligne${n > 1 ? 's' : ''}`}
                </span>
                <span className="aide">{b.detail}</span>
              </span>
            </label>
          )
        })}
      </div>

      {choix.length > 0 && !enExploitation && (
        <div className="formulaire confirmation-vidage">
          <p>
            <strong className="alerte-texte">{total} ligne(s)</strong> seront supprimées
            définitivement. Pour confirmer, retape le nom de l'événement :{' '}
            <span className="mono">{evenement.nom}</span>
          </p>
          <div className="saisie-rapide">
            <input
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder="Nom de l'événement"
              aria-label="Nom de l'événement, pour confirmer"
              autoComplete="off"
            />
            <button className="danger" disabled={!nomOk || occupe} onClick={vider}>
              {occupe ? 'Vidage…' : 'Vider définitivement'}
            </button>
          </div>
        </div>
      )}

      {erreur && <div className="message erreur">{erreur}</div>}
      {fait && (
        <div className="message" role="status">
          Vidé : {fait.total} ligne(s) supprimée(s). Une ligne au journal garde la trace de
          l'opération.
        </div>
      )}
    </section>
  )
}
