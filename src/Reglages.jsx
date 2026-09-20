import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import QrCodes from './QrCodes'
import ImportCsv from './ImportCsv'
import ImportKml from './ImportKml'
import Roles from './Roles'
import AccesAutorite from './AccesAutorite'
import Conformite from './Conformite'
import DossierSecurite from './DossierSecurite'
import MonCompte from './MonCompte'
import LogoEvenement from './LogoEvenement'
import Point0 from './Point0'
import Diffusion from './Diffusion'
import VitrineAdmin from './VitrineAdmin'
import { RESSOURCES } from './colonnesImport'
import { PHASES, MODULES } from './referentielsProduit'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'

/* ================================================================== */
/* Réglages                                                            */
/* ================================================================== */

/*
 * Réglages de l'événement.
 *
 * Regroupés par ce qu'on vient y faire, et non par ordre d'apparition
 * dans le développement : sept sections empilées obligeaient à parcourir
 * tout l'écran pour trouver une case.
 *
 * Depuis la campagne du 20/09, Réglages ne garde de l'équipe que la
 * COMPOSITION DES RÔLES : inviter quelqu'un et lui attribuer un rôle se
 * font dans Bénévoles, avec le reste de la gestion des personnes. Et
 * la conformité (questionnaire, contrôles, référentiels d'organisation,
 * dossier de sécurité) arrive ici depuis Sécurité : ce sont des actes
 * de la coordination, à froid — l'écran Sécurité, lui, s'ouvre
 * maintenant à tout membre.
 */
const PANNEAUX = [
  ['dispositif', 'Dispositif'],
  ['roles', 'Rôles'],
  ['conformite', 'Conformité'],
  ['donnees', 'Données'],
  ['partage', 'Partage'],
  ['compte', 'Mon compte']
]

export default function Reglages({ evenement, membre, session, exploitant, peut, toutPouvoir, onRecharger, setMessage }) {
  const [panneau, setPanneau] = useState('dispositif')
  const [occupe, setOccupe] = useState(false)
  const [compteur, setCompteur] = useState(0)

  async function basculerModule(clef) {
    setOccupe(true)
    const modules = { ...evenement.modules, [clef]: !evenement.modules?.[clef] }
    const refus = await modifierOuRefuser('evenements', { modules }, { id: evenement.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else onRecharger()
    setOccupe(false)
  }

  async function changerPhase(phase) {
    const avant = evenement.phase
    const { error, count } = await supabase
      .from('evenements')
      .update({ phase }, { count: 'exact' })
      .eq('id', evenement.id)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    if (count === 0) return setMessage({ type: 'erreur', texte: 'Changement refusé.' })

    // L'entrée et la sortie d'exploitation recomposent le « Mon poste »
    // de tout le monde, sans prévenir personne : les blocs de terrain
    // redeviennent obligatoires, ou cessent de l'être. Quelqu'un qui
    // avait tout décoché en préparation les voit réapparaître le jour J.
    // Autant l'annoncer ici plutôt que de le laisser découvrir.
    if (phase === 'exploitation' && avant !== 'exploitation') {
      setMessage({
        type: 'succes',
        texte:
          'Exploitation — Mes missions, Alertes et Signalements redeviennent obligatoires sur le « Mon poste » de chacun.'
      })
    } else if (avant === 'exploitation' && phase !== 'exploitation') {
      setMessage({
        type: 'succes',
        texte:
          'Sortie d’exploitation — chacun peut de nouveau retirer les blocs de terrain de son « Mon poste ».'
      })
    }
    onRecharger()
  }

  return (
    <>
      <div className="onglets">
        {PANNEAUX.map(([k, l]) => (
          <button
            key={k}
            className={`module ${panneau === k ? 'actif' : ''}`}
            onClick={() => setPanneau(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {panneau === 'dispositif' && (
        <>
          <LogoEvenement evenement={evenement} onFait={onRecharger} setMessage={setMessage} />

          <Point0 evenement={evenement} onFait={onRecharger} setMessage={setMessage} />

          <Completude evenement={evenement} />

          <DatesEvenement evenement={evenement} onFait={onRecharger} setMessage={setMessage} />

          <section className="bloc">
            <h2>Phase</h2>
            <div className="plaques">
              {PHASES.map((p) => (
                <button
                  key={p}
                  className={`plaque-nav ${evenement.phase === p ? 'actif' : ''}`}
                  onClick={() => changerPhase(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <p className="aide">
              La phase ouvre et ferme des droits d&rsquo;écriture. Elle est réversible : on
              repasse en montage le vendredi soir sans que ce soit un incident.
              <br />
              L&rsquo;exploitation a un effet de plus : elle rend obligatoires, pour tout le
              monde, les blocs de terrain de « Mon poste ».
            </p>
          </section>

          <section className="bloc">
            <h2>Modules</h2>
            <div className="plaques">
              {MODULES.map(([k, libelle]) => (
                <button
                  key={k}
                  disabled={occupe || !exploitant}
                  className={`plaque-nav ${evenement.modules?.[k] ? 'actif' : ''}`}
                  onClick={() => basculerModule(k)}
                  title={!exploitant ? 'Relève de la souscription' : undefined}
                >
                  {libelle}
                </button>
              ))}
            </div>
            <p className="aide">
              {exploitant
                ? "Un module éteint disparaît de la navigation et cesse de recevoir des données. Le SOS n'enregistre rien tant qu'il est éteint, même si le lien circule."
                : "Les modules relèvent de la souscription : leur activation se règle avec l'éditeur, pas depuis l'événement."}
            </p>
          </section>

          <Reconduire evenement={evenement} onFait={onRecharger} />
        </>
      )}

      {panneau === 'roles' && (
        <>
          <p className="aide" style={{ marginTop: 0 }}>
            Ici se composent les rôles — ce que chacun peut lire et écrire, phase par phase.
            Inviter quelqu&rsquo;un, lui donner un rôle ou le retirer se fait dans
            Bénévoles › Membres.
          </p>
          <Roles evenement={evenement} setMessage={setMessage} />
        </>
      )}

      {panneau === 'conformite' && (
        <>
          <Conformite
            evenement={evenement}
            exploitant={exploitant}
            peut={peut}
            toutPouvoir={toutPouvoir}
            setMessage={setMessage}
          />
          <DossierSecurite evenement={evenement} setMessage={setMessage} />
        </>
      )}

      {panneau === 'donnees' && (
        <>
          <section className="bloc">
            <h2>Référentiels</h2>
            <Compteurs evenementId={evenement.id} cle={compteur} />
            <ImportCsv
              evenementId={evenement.id}
              phase={evenement.phase}
              peut={peut}
              toutPouvoir={toutPouvoir}
              onFait={() => setCompteur((c) => c + 1)}
            />
          </section>

          <ImportKml evenement={evenement} setMessage={setMessage} />
        </>
      )}

      {panneau === 'partage' && (
        <>
          <AccesAutorite evenement={evenement} setMessage={setMessage} />
          <VitrineAdmin evenement={evenement} setMessage={setMessage} />
          {/* Le lien participant existe pour tout événement : la
              vitrine (infos, horaire, plan) ne dépend pas du module
              SOS. Sans lui, Partage ne montrait aucun lien et le
              coordinateur de BFMF2027 n'avait rien à ouvrir (2b-07). */}
          <QrCodes evenement={evenement} />
          <Diffusion evenement={evenement} setMessage={setMessage} />
        </>
      )}

      {panneau === 'compte' && (
        <MonCompte
          session={session}
          membre={membre}
          evenement={evenement}
          setMessage={setMessage}
          onRecharger={onRecharger}
        />
      )}
    </>
  )
}

/**
 * Reconduire un événement d'une année sur l'autre.
 *
 * Ce que ça reprend est décidé en base (migration 098) et pas ici :
 * l'écran ne doit pas laisser croire qu'il choisit. Il annonce les
 * trois remises à zéro, parce que ce sont les seules surprises
 * possibles — le reste est une copie fidèle.
 */
/**
 * Les dates de l'événement.
 *
 * Les colonnes existaient depuis la première migration, mais aucun
 * écran ne les écrivait : quatre événements sur six n'en avaient donc
 * aucune. Ça s'est vu au premier usage qui en dépendait vraiment — la
 * reconduction, qui décale les créneaux du nombre de jours séparant
 * deux éditions et n'avait rien à décaler.
 *
 * Ce n'est pas qu'un confort : le dossier de sécurité annonce ces
 * dates à la commune, et le planning place les jalons par rapport à
 * elles.
 */
/**
 * Ce qui manque au dispositif, et ce que ça bloque.
 *
 * Le défaut que ce bloc corrige n'est pas l'absence de données : c'est
 * leur absence SILENCIEUSE. Quatre événements sur six n'avaient pas de
 * dates, personne ne l'a vu, et ça n'est apparu qu'au premier usage qui
 * en dépendait vraiment. Une case vide ne se signale pas toute seule.
 *
 * Chaque ligne dit la conséquence, pas seulement le manque. « Pas de
 * commune » n'incite personne à agir ; « la conformité ne sait pas
 * quelle zone de secours s'applique » oui.
 *
 * Volontairement sans bouton « ignorer » : un dispositif incomplet le
 * reste jusqu'à ce qu'on le complète, et masquer l'avertissement ne
 * remplirait pas le dossier de sécurité.
 */
function Completude({ evenement }) {
  const manques = [
    {
      absent: !evenement.date_debut || !evenement.date_fin,
      quoi: 'Dates de l’événement',
      bloque: 'le dossier de sécurité annonce des dates vides à la commune, et une reconduction ne sait pas de combien décaler les créneaux.',
      ou: 'ci-dessous'
    },
    {
      absent: !evenement.commune,
      quoi: 'Commune d’accueil',
      bloque: 'la conformité ne sait pas quelle zone de secours ni quelle zone de police s’appliquent — donc à qui adresser le dossier.',
      ou: 'Dispositif → Point 0'
    },
    {
      absent: evenement.point_0_lat == null || evenement.point_0_lon == null,
      quoi: 'Point 0',
      bloque: 'la veille météo ne sait pas où regarder, et les distances du plan d’implantation ne se calculent pas.',
      ou: 'Dispositif → Point 0'
    },
    {
      absent: evenement.frequentation_max == null,
      quoi: 'Fréquentation attendue',
      bloque: 'le dossier de sécurité laisse en blanc le chiffre dont dépend le dimensionnement des secours.',
      ou: 'Plan → Effectifs'
    }
  ].filter((m) => m.absent)

  if (!manques.length) {
    return (
      <section className="bloc">
        <h2>Dispositif</h2>
        <p className="aide" style={{ marginTop: 0 }}>
          Rien ne manque au socle : dates, commune, point 0 et fréquentation sont renseignés.
        </p>
      </section>
    )
  }

  return (
    <section className="bloc">
      <h2>Dispositif incomplet</h2>
      <p className="aide" style={{ marginTop: 0 }}>
        {manques.length} élément(s) manquant(s). Aucun n’empêche de travailler aujourd’hui —
        ils manqueront le jour où quelque chose en dépendra.
      </p>
      {manques.map((m) => (
        <div className="carte" key={m.quoi}>
          <div className="titre">{m.quoi}</div>
          <p style={{ margin: '4px 0 0', fontSize: 13 }}>{m.bloque}</p>
          <div className="meta">
            <span className="jeton">{m.ou}</span>
          </div>
        </div>
      ))}
    </section>
  )
}

function DatesEvenement({ evenement, onFait, setMessage }) {
  const [debut, setDebut] = useState(evenement.date_debut ?? '')
  const [fin, setFin] = useState(evenement.date_fin ?? '')

  // L'état initial est figé au premier rendu : sans cette
  // resynchronisation, changer d'événement dans le menu du haut
  // laisserait les dates du précédent dans les champs.
  useEffect(() => {
    setDebut(evenement.date_debut ?? '')
    setFin(evenement.date_fin ?? '')
  }, [evenement.id, evenement.date_debut, evenement.date_fin])
  const [occupe, setOccupe] = useState(false)
  const [enregistre, setEnregistre] = useState(false)

  async function enregistrer() {
    setOccupe(true)
    const { error, count } = await supabase
      .from('evenements')
      .update({ date_debut: debut || null, date_fin: fin || null }, { count: 'exact' })
      .eq('id', evenement.id)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0) {
      setMessage({ type: 'erreur', texte: 'Enregistrement refusé : droits insuffisants.' })
    } else {
      onFait?.()
      setEnregistre(true)
      setTimeout(() => setEnregistre(false), 2500)
    }
    setOccupe(false)
  }

  // Une fin antérieure au début n'est pas une faute de frappe rare :
  // c'est ce qu'on tape quand on remplit le second champ avant le
  // premier. Autant le dire avant l'enregistrement.
  const incoherent = debut && fin && fin < debut

  return (
    <section className="bloc">
      <h2>Dates</h2>
      <p className="aide" style={{ marginTop: 0 }}>
        Le premier et le dernier jour de l&rsquo;événement, montage et démontage exclus. Elles
        servent au dossier de sécurité, au placement des jalons, et au décalage des créneaux
        lors d&rsquo;une reconduction.
      </p>

      <div className="saisie-rapide">
        <input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
        <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
      </div>

      {incoherent && (
        <p className="alerte-texte">Le dernier jour précède le premier.</p>
      )}

      <button disabled={occupe || incoherent} onClick={enregistrer}>
        {enregistre ? 'Enregistré ✓' : 'Enregistrer les dates'}
      </button>
    </section>
  )
}

function Reconduire({ evenement, onFait }) {
  const [ouvert, setOuvert] = useState(false)
  const [nom, setNom] = useState('')
  const [debut, setDebut] = useState('')
  const [fin, setFin] = useState('')
  const [occupe, setOccupe] = useState(false)
  // Le message vit dans le bloc, pas en haut de page : « Reconduire »
  // est en bas des Réglages, et un refus de quota affiché à 1 500 px
  // au-dessus n'était vu par personne (campagne du 20/09, 4a-03).
  const [message, setMessage] = useState(null)

  // Un slug se devine bien : c'est le nom, sans accent ni espace. Le
  // laisser saisir à la main n'apporterait qu'une occasion de le rater.
  const slug = nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  async function reconduire() {
    setOccupe(true)
    const { data, error } = await supabase.rpc('dupliquer_evenement', {
      p_source: evenement.id,
      p_nom: nom.trim(),
      p_slug: slug,
      p_date_debut: debut,
      p_date_fin: fin
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setMessage({
        type: 'succes',
        texte: `« ${nom.trim()} » est créé en préparation — sélectionnez-le dans le menu en haut de l'écran.`
      })
      setOuvert(false)
      setNom('')
      onFait?.()
    }
    setOccupe(false)
  }

  return (
    <section className="bloc">
      <h2>Reconduire</h2>
      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}
      {!ouvert ? (
        <>
          <p className="aide" style={{ marginTop: 0 }}>
            Crée l&rsquo;édition suivante à partir de celle-ci : rôles et capacités, lieux,
            équipes, groupes de travail et jalons, contacts, matériel, radio, fiches réflexe,
            créneaux, implantation, seuils météo et questionnaire de conformité.
            <br />
            Rien de l&rsquo;opérationnel ne suit — ni missions, ni signalements, ni journal, ni
            REX. Ce sont les traces d&rsquo;un événement qui a eu lieu.
          </p>
          <button onClick={() => setOuvert(true)}>Reconduire cet événement</button>
        </>
      ) : (
        <>
          <label htmlFor="rec-nom">Nom de la nouvelle édition</label>
          <input
            id="rec-nom"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder={evenement.nom.replace(/\d{4}/, (a) => Number(a) + 1)}
          />
          {slug && <p className="aide">Adresse : {slug}</p>}

          <label htmlFor="rec-debut">Premier jour</label>
          <input id="rec-debut" type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />

          <label htmlFor="rec-fin">Dernier jour</label>
          <input id="rec-fin" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />

          <p className="aide">
            Trois choses repartent à zéro, volontairement : l&rsquo;implantation est reprise mais
            dé-confirmée — la haie a poussé, le chapiteau a bougé ; les jalons repassent « à
            faire » avec leurs échéances décalées d&rsquo;autant de jours que l&rsquo;événement ;
            le matériel garde son catalogue et ses seuils, mais pas ses quantités.
          </p>

          <div className="ligne-boutons">
            <button disabled={occupe || !nom.trim() || !debut || !fin} onClick={reconduire}>
              {occupe ? 'Reconduction…' : 'Créer l’édition'}
            </button>
            <button className="discret" onClick={() => setOuvert(false)}>
              Annuler
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function Compteurs({ evenementId, cle }) {
  const [comptes, setComptes] = useState(null)

  useEffect(() => {
    let vivant = true
    Promise.all(
      Object.entries(RESSOURCES).map(async ([, r]) => {
        const { count } = await supabase
          .from(r.table)
          .select('id', { count: 'exact', head: true })
          .eq('evenement_id', evenementId)
          // Les entrées supprimées ne sont plus comptées : le compteur
          // annonçait un référentiel plus fourni que l'écran ne le montre.
          .is('deleted_at', null)
        return [r.libelle, count ?? 0]
      })
    ).then((e) => vivant && setComptes(e))
    return () => {
      vivant = false
    }
  }, [evenementId, cle])

  if (!comptes) return null

  return (
    <div className="compteurs">
      {comptes.map(([libelle, n]) => (
        <span key={libelle}>
          {libelle} <strong>{n}</strong>
        </span>
      ))}
    </div>
  )
}
