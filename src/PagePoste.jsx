import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { appliquerIconeEvenement } from './logoPwa'

/**
 * LA PAGE DU POSTE (168) — ce que lit un bénévole qui scanne le QR collé
 * sur son poste, sans compte ni installation.
 *
 * Tout tient sur un téléphone, dans l'ordre où on en a besoin en
 * arrivant : le créneau en cours, le canal radio, la fiche de poste, les
 * secours les plus proches, les fiches réflexe, le numéro du QG. La
 * page ne montre aucun nom de bénévole ni aucun numéro personnel : le
 * serveur masque les numéros avant de répondre, seul celui du QG passe.
 */
const REFUS = {
  P0002: 'Ce QR ne correspond à aucun poste. Vérifie le QR code, ou demande au QG.',
  P0003: 'Ce QR a été désactivé par l’organisateur.'
}

const CATEGORIES_SECOURS = {
  dea: 'DEA (défibrillateur)',
  poste_secours: 'Poste de secours',
  sortie_secours: 'Sortie de secours',
  point_rencontre_secours: 'Point de rencontre secours',
  prv: 'Point de rassemblement'
}

const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '')
const jour = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '')
const distance = (m) => (m == null ? '' : m < 1000 ? `à ${m} m` : `à ${(m / 1000).toFixed(1)} km`)

export default function PagePoste({ jeton }) {
  const [page, setPage] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [reflexeOuvert, setReflexeOuvert] = useState(null)

  useEffect(() => {
    supabase.rpc('poste_par_jeton', { p_jeton: jeton }).then(({ data, error }) => {
      if (error) return setErreur(REFUS[error.code] ?? 'La page du poste ne répond pas. Réessaie dans un instant, ou demande au QG.')
      const p = Array.isArray(data) ? data[0] : data
      setPage(p)
      if (p?.evenement) appliquerIconeEvenement(p.evenement.nom, p.evenement.logo_url)
    })
  }, [jeton])

  if (erreur) {
    return (
      <div className="participant page-poste">
        <div className="bandeau"><h1>Poste</h1></div>
        <div className="message erreur">{erreur}</div>
        <p className="urgence-112"><strong>Urgence vitale : appelez le 112</strong></p>
      </div>
    )
  }
  if (!page) return <div className="attente">Chargement…</div>

  const { evenement, poste, fiche, creneau_courant: courant, creneau_suivant: suivant, radio, secours = [], reflexes = [] } = page
  const taches = Array.isArray(fiche?.taches) ? fiche.taches : []
  const telQg = evenement.telephone_qg

  return (
    <div className="participant page-poste">
      <div className="bandeau">
        <div>
          {evenement.logo_url && <img className="logo-evenement" src={evenement.logo_url} alt="" />}
          <h1>{poste.poste}</h1>
          <span className="session">{evenement.nom}{poste.lieu ? ` · ${poste.lieu}` : ''}{poste.equipe ? ` · équipe ${poste.equipe}` : ''}</span>
        </div>
      </div>

      {/* Le QG et le 112 d'abord : c'est ce qu'on cherche quand ça va mal. */}
      <div className="poste-contacts">
        {telQg && (
          <a className="poste-contact qg" href={`tel:${telQg.replace(/[^+\d]/g, '')}`}>
            <span className="etiquette">Joindre le QG</span>
            <strong>{telQg}</strong>
          </a>
        )}
        <a className="poste-contact urgence" href="tel:112">
          <span className="etiquette">Urgence vitale</span>
          <strong>112</strong>
        </a>
      </div>

      {(radio?.equipe || radio?.urgence) && (
        <section className="poste-bloc poste-radio">
          <h2>Radio</h2>
          <div className="poste-canaux">
            {radio.equipe && (
              <div className="poste-canal">
                <span className="etiquette">Canal de l’équipe</span>
                <strong>{radio.equipe.numero}</strong>
                {radio.equipe.libelle && <span className="aide">{radio.equipe.libelle}</span>}
              </div>
            )}
            {radio.urgence && (
              <div className="poste-canal urgence">
                <span className="etiquette">Canal d’urgence</span>
                <strong>{radio.urgence.numero}</strong>
                {radio.urgence.libelle && <span className="aide">{radio.urgence.libelle}</span>}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="poste-bloc poste-creneaux">
        <h2>Créneau</h2>
        {courant ? (
          <p className="poste-creneau courant">
            <strong>En cours</strong> · {heure(courant.debut)} → {heure(courant.fin)}
            {courant.lieu && ` · ${courant.lieu}`}
            {courant.equipe && ` · équipe ${courant.equipe}`}
            {courant.consignes && <><br /><span className="aide">{courant.consignes}</span></>}
          </p>
        ) : (
          <p className="aide">Pas de créneau en cours sur ce poste{evenement.phase === 'preparation' ? ' — l’événement est en préparation' : ''}.</p>
        )}
        {suivant && (
          <p className="poste-creneau">
            <strong>Suivant</strong> · {jour(suivant.debut)} {heure(suivant.debut)} → {heure(suivant.fin)}
            {suivant.lieu && ` · ${suivant.lieu}`}
            {suivant.equipe && ` · équipe ${suivant.equipe}`}
            {suivant.consignes && <><br /><span className="aide">{suivant.consignes}</span></>}
          </p>
        )}
      </section>

      <section className="poste-bloc poste-fiche">
        <h2>Fiche de poste</h2>
        {fiche ? (
          <>
            {fiche.intitule && fiche.intitule !== poste.poste && <p className="aide" style={{ marginTop: 0 }}>{fiche.intitule}</p>}
            {fiche.mission && <p style={{ marginTop: 0 }}>{fiche.mission}</p>}
            {taches.length > 0 && (
              <>
                <span className="etiquette">Ce qu’il y a à faire</span>
                <ol className="poste-taches">
                  {taches.map((t, i) => <li key={i}>{t}</li>)}
                </ol>
              </>
            )}
            {fiche.materiel && <p className="aide"><span className="etiquette">Matériel remis</span> {fiche.materiel}</p>}
            {fiche.a_signaler && <p className="aide alerte-texte"><span className="etiquette">À remonter tout de suite</span> {fiche.a_signaler}</p>}
            {fiche.contact && <p className="aide"><span className="etiquette">Qui prévenir</span> {fiche.contact}</p>}
          </>
        ) : (
          <p className="aide">Pas de fiche pour ce poste : demande les consignes au QG.</p>
        )}
        {poste.consigne && <p className="poste-consigne">{poste.consigne}</p>}
      </section>

      {secours.length > 0 && (
        <section className="poste-bloc poste-secours">
          <h2>Secours les plus proches</h2>
          <ul>
            {secours.map((s, i) => (
              <li key={i}>
                <strong>{CATEGORIES_SECOURS[s.categorie] ?? s.categorie}</strong> — {s.nom}
                {s.distance_m != null && <span className="aide"> {distance(s.distance_m)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {reflexes.length > 0 && (
        <section className="poste-bloc poste-reflexes">
          <h2>Fiches réflexe</h2>
          {reflexes.map((f) => (
            <div className={`poste-reflexe ${reflexeOuvert === f.code ? 'ouvert' : ''}`} key={f.code}>
              <button className="lien" onClick={() => setReflexeOuvert(reflexeOuvert === f.code ? null : f.code)}>
                {f.titre}{f.declencheur ? <span className="aide"> — {f.declencheur}</span> : null}
              </button>
              {reflexeOuvert === f.code && (
                <div className="poste-reflexe-corps">
                  {(f.conduite ?? []).length > 0 && (
                    <ol className="poste-taches">{f.conduite.map((e, i) => <li key={i}>{e}</li>)}</ol>
                  )}
                  {(f.a_ne_pas_faire ?? []).length > 0 && (
                    <p className="aide alerte-texte"><span className="etiquette">À ne pas faire</span> {f.a_ne_pas_faire.join(' · ')}</p>
                  )}
                  {f.contacts && <p className="aide"><span className="etiquette">Contacts</span> {f.contacts}</p>}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <p className="aide poste-pied">
        Page du poste — Eventware. Aucun nom ni numéro personnel n’y figure : pour joindre quelqu’un, passe par le QG.
      </p>
    </div>
  )
}
