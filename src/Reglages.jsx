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
import { conditionsGenerales, enregistrerConditionsGenerales } from './DemandesPrix'
import Diffusion from './Diffusion'
import VitrineAdmin from './VitrineAdmin'
import ViderEvenement from './ViderEvenement'
import { RESSOURCES } from './colonnesImport'
import { PHASES, MODULES } from './referentielsProduit'
import { texteErreur } from './erreurs'
import { slugDe } from './slug'
import { modifierOuRefuser } from './ecriture'
import { useDrapeau } from './useDrapeau'

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
          <IdentiteEvenement evenement={evenement} onFait={onRecharger} setMessage={setMessage} />

          <LogoEvenement evenement={evenement} onFait={onRecharger} setMessage={setMessage} />

          <LienParticipants evenement={evenement} />

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

          {(toutPouvoir || peut?.('rh', 'modifier')) && (
            <RecalerPlanning evenement={evenement} setMessage={setMessage} />
          )}

          {(toutPouvoir || peut?.('logistique', 'modifier')) && evenement.organisation_id && (
            <ConditionsGenerales organisation={evenement.organisation_id} setMessage={setMessage} />
          )}

          {toutPouvoir && (
            <ViderEvenement
              evenement={evenement}
              setMessage={setMessage}
              onFait={() => setCompteur((c) => c + 1)}
            />
          )}
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

/**
 * (31/10, audit d'ergonomie) Le lien que les participants scannent pour
 * signaler un problème (QR code, affichage, dossard). Il occupait le haut
 * de Sécurité › Signalements, l'écran qu'on regarde pendant l'événement ;
 * c'est un réglage qu'on prépare avant. Sécurité le garde replié.
 */
function LienParticipants({ evenement }) {
  const [copie, setCopie] = useState(false)
  if (!evenement.jeton_public) return null
  const lien = `${window.location.origin}${window.location.pathname}?sos=${evenement.jeton_public}`
  async function copier() {
    try {
      await navigator.clipboard.writeText(lien)
      setCopie(true)
      setTimeout(() => setCopie(false), 2000)
    } catch {}
  }
  return (
    <section className="bloc">
      <h2>Lien des participants</h2>
      <p className="aide" style={{ marginTop: 0 }}>
        À diffuser aux participants (QR code, affichage, dossard) : il ouvre la page publique de l'événement et son bouton
        « Signaler un problème », qui arrive dans Sécurité › Signalements.
      </p>
      <p className="identifiant">{lien}</p>
      <div className="ligne-boutons">
        <button className="discret" onClick={copier}>{copie ? 'Copié' : 'Copier le lien'}</button>
      </div>
    </section>
  )
}

/**
 * Le nom, la commune et la fréquentation se réglaient à la création
 * (Plateforme) et plus jamais ensuite : un nom mal tapé restait. Ils
 * s'éditent ici, par qui a tout pouvoir (policy `evenements_modification`).
 * L'identifiant d'URL (slug) ne bouge pas : les liens déjà diffusés
 * (vitrine, autorité, QR) restent bons.
 */
function IdentiteEvenement({ evenement, onFait, setMessage }) {
  const [v, setV] = useState({ nom: evenement.nom ?? '', commune: evenement.commune ?? '', frequentation_min: evenement.frequentation_min ?? '', frequentation_max: evenement.frequentation_max ?? '' })
  const [communes, setCommunes] = useState([])
  const [occupe, setOccupe] = useState(false)
  const [enregistre, setEnregistre] = useDrapeau()
  useEffect(() => {
    setV({ nom: evenement.nom ?? '', commune: evenement.commune ?? '', frequentation_min: evenement.frequentation_min ?? '', frequentation_max: evenement.frequentation_max ?? '' })
  }, [evenement.id, evenement.nom, evenement.commune, evenement.frequentation_min, evenement.frequentation_max])
  useEffect(() => {
    supabase.from('communes').select('nom').order('nom').then(({ data }) => setCommunes(data ?? []))
  }, [])

  async function enregistrer() {
    if (!v.nom.trim()) return
    setOccupe(true)
    const refus = await modifierOuRefuser('evenements', {
      nom: v.nom.trim(),
      commune: v.commune.trim() || null,
      frequentation_min: v.frequentation_min === '' ? null : Number(v.frequentation_min),
      frequentation_max: v.frequentation_max === '' ? null : Number(v.frequentation_max)
    }, { id: evenement.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else { onFait?.(); setEnregistre() }
    setOccupe(false)
  }

  return (
    <section className="bloc">
      <h2>Identité</h2>
      <div className="grille-champs dp-grille">
        <label className="dp-large">Nom<input value={v.nom} onChange={(e) => setV({ ...v, nom: e.target.value })} /></label>
        <label>Commune
          <input list="communes-reglages" value={v.commune} onChange={(e) => setV({ ...v, commune: e.target.value })} placeholder="Commune" />
          <datalist id="communes-reglages">
            {communes.map((c) => <option key={c.nom} value={c.nom} />)}
          </datalist>
        </label>
        <label>Fréquentation attendue, de<input type="number" min="0" value={v.frequentation_min} onChange={(e) => setV({ ...v, frequentation_min: e.target.value })} /></label>
        <label>à<input type="number" min="0" value={v.frequentation_max} onChange={(e) => setV({ ...v, frequentation_max: e.target.value })} /></label>
      </div>
      <p className="aide">
        L&rsquo;identifiant d&rsquo;URL (<span className="mono">{evenement.slug}</span>) ne change pas : les liens déjà diffusés restent valables.
      </p>
      <button disabled={occupe || !v.nom.trim()} onClick={enregistrer}>
        {enregistre ? 'Enregistré ✓' : 'Enregistrer'}
      </button>
    </section>
  )
}

function DatesEvenement({ evenement, onFait, setMessage }) {
  const [debut, setDebut] = useState(evenement.date_debut ?? '')
  const [fin, setFin] = useState(evenement.date_fin ?? '')
  // (129) Montage et démontage : les bandes du Gantt et les ancres des
  // jalons en dépendent ; ils ne se réglaient nulle part.
  const [montage, setMontage] = useState(evenement.date_montage ?? '')
  const [demontage, setDemontage] = useState(evenement.date_demontage ?? '')

  // L'état initial est figé au premier rendu : sans cette
  // resynchronisation, changer d'événement dans le menu du haut
  // laisserait les dates du précédent dans les champs.
  useEffect(() => {
    setDebut(evenement.date_debut ?? '')
    setFin(evenement.date_fin ?? '')
    setMontage(evenement.date_montage ?? '')
    setDemontage(evenement.date_demontage ?? '')
  }, [evenement.id, evenement.date_debut, evenement.date_fin, evenement.date_montage, evenement.date_demontage])
  const [occupe, setOccupe] = useState(false)
  const [enregistre, setEnregistre] = useDrapeau()

  async function enregistrer() {
    setOccupe(true)
    const { error, count } = await supabase
      .from('evenements')
      .update({ date_debut: debut || null, date_fin: fin || null, date_montage: montage || null, date_demontage: demontage || null }, { count: 'exact' })
      .eq('id', evenement.id)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0) {
      setMessage({ type: 'erreur', texte: 'Enregistrement refusé : droits insuffisants.' })
    } else {
      onFait?.()
      setEnregistre()
    }
    setOccupe(false)
  }

  // Une fin antérieure au début n'est pas une faute de frappe rare :
  // c'est ce qu'on tape quand on remplit le second champ avant le
  // premier. Autant le dire avant l'enregistrement.
  const incoherent = (debut && fin && fin < debut) || (montage && debut && montage > debut) || (demontage && fin && demontage < fin)

  return (
    <section className="bloc">
      <h2>Dates</h2>
      <p className="aide" style={{ marginTop: 0 }}>
        Le premier et le dernier jour de l&rsquo;événement, montage et démontage exclus. Elles
        servent au dossier de sécurité, au placement des jalons, et au décalage des créneaux
        lors d&rsquo;une reconduction.
      </p>

      <div className="grille-champs dp-grille">
        <label>Premier jour<input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></label>
        <label>Dernier jour<input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></label>
        <label>Début du montage<input type="date" value={montage} onChange={(e) => setMontage(e.target.value)} /></label>
        <label>Fin du démontage<input type="date" value={demontage} onChange={(e) => setDemontage(e.target.value)} /></label>
      </div>

      {incoherent && (
        <p className="alerte-texte">Dates dans le désordre : montage ≤ premier jour ≤ dernier jour ≤ démontage.</p>
      )}

      <button disabled={occupe || incoherent} onClick={enregistrer}>
        {enregistre ? 'Enregistré ✓' : 'Enregistrer les dates'}
      </button>
    </section>
  )
}

/**
 * (129) Recaler le planning sur les dates de l'événement : chaque jalon
 * garde sa position en jours par rapport à son ancre (J, fin, montage,
 * démontage) ; quand les dates changent, on réécrit ses dates depuis
 * ces offsets. Jamais automatique : on compte d'abord, on applique
 * sur confirmation.
 */
function RecalerPlanning({ evenement, setMessage }) {
  const [simulation, setSimulation] = useState(null)
  const [occupe, setOccupe] = useState(false)

  async function simuler() {
    setOccupe(true)
    const { data, error } = await supabase.rpc('recaler_jalons', { p_evenement: evenement.id, p_simuler: true })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setSimulation(Array.isArray(data) ? data[0] : data)
    setOccupe(false)
  }
  async function appliquer() {
    setOccupe(true)
    const { data, error } = await supabase.rpc('recaler_jalons', { p_evenement: evenement.id, p_simuler: false })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      const r = Array.isArray(data) ? data[0] : data
      setMessage({ type: 'succes', texte: `${r?.touches ?? 0} jalon(s) recalé(s) sur les dates de l'événement.` })
      setSimulation(null)
    }
    setOccupe(false)
  }

  return (
    <section className="bloc">
      <h2>Recaler le planning sur les dates de l'événement</h2>
      <p className="aide" style={{ marginTop: 0 }}>
        Chaque jalon connaît sa place en jours par rapport au jour J (ou à la fin, au montage, au démontage).
        Si les dates de l'événement ont changé, ceci replace les jalons à venir ou en cours ; les faits et annulés ne bougent pas.
      </p>
      {simulation ? (
        simulation.touches > 0 ? (
          <>
            <p>
              <strong>{simulation.touches}</strong> jalon(s) seraient recalés
              {simulation.exemples?.length ? ` : ${simulation.exemples.join(', ')}${simulation.touches > simulation.exemples.length ? '…' : ''}` : ''}.
            </p>
            <div className="ligne-boutons">
              <button disabled={occupe} onClick={appliquer}>Recaler {simulation.touches} jalon(s)</button>
              <button className="discret" onClick={() => setSimulation(null)}>Annuler</button>
            </div>
          </>
        ) : (
          <p className="aide">Rien à recaler : les jalons sont déjà aux dates de l'événement.</p>
        )
      ) : (
        <button className="discret" disabled={occupe} onClick={simuler}>Compter les jalons à recaler</button>
      )}
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
  const slug = slugDe(nom)

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

/**
 * (131) Les conditions générales imprimées au bas d'une demande de
 * prix, saisies une fois pour l'organisation. Rangées dans le stockage
 * local du navigateur, comme le rail et le thème : la base n'a pas
 * encore de place pour un texte libre d'organisation (à faire quand
 * les réglages d'organisation existeront).
 */
function ConditionsGenerales({ organisation, setMessage }) {
  const [texte, setTexte] = useState(() => conditionsGenerales(organisation))
  return (
    <section className="bloc">
      <h2>Demandes de prix — conditions générales</h2>
      <p className="aide">Imprimées au bas de chaque demande de prix (Logistique › Demandes de prix › Imprimer). Propres à ce navigateur.</p>
      <textarea rows={4} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Paiement à 30 jours fin de mois ; matériel livré et repris par le fournisseur ; …" />
      <div className="ligne-boutons">
        <button className="discret" onClick={() => { enregistrerConditionsGenerales(organisation, texte); setMessage({ type: 'info', texte: 'Conditions générales enregistrées sur ce navigateur.' }) }}>Enregistrer</button>
      </div>
    </section>
  )
}
