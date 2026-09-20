import { useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'
import { GEOMETRIES } from './referentielsProduit'

/* ================================================================== */
/* Entrer dans un événement — les écrans d'avant le poste de travail   */
/* ================================================================== */

/**
 * Rattrapage du nom manquant.
 *
 * Le nom est demandé à l'inscription depuis peu, mais les comptes créés
 * avant — et les membres ajoutés à la main — n'en ont pas. Ils
 * apparaissent « sans nom » dans Bénévoles, et le PC ne sait pas qui
 * répond à la radio. C'est une information de sécurité, pas de confort :
 * on la demande avant d'ouvrir l'application, une fois, en un champ.
 */
export function NomManquant({ membre, session, onFait }) {
  const [nom, setNom] = useState(
    () => session.user.user_metadata?.nom ?? ''
  )
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  async function enregistrer() {
    if (!nom.trim()) return
    setOccupe(true)
    setErreur(null)
    // Sur le compte ET sur l'adhésion : le compte pour les prochains
    // événements, l'adhésion pour celui-ci.
    await supabase.auth.updateUser({ data: { nom: nom.trim() } })
    const refus = await modifierOuRefuser('membres_evenement', { nom_affiche: nom.trim() }, { id: membre.id })
    if (refus) setErreur(refus)
    else onFait()
    setOccupe(false)
  }

  return (
    <div className="corps">
      <main className="travail">
        <section className="bloc dom-violet">
          <h2>Comment t'appelles-tu ?</h2>
          <p className="aide" style={{ marginTop: 0 }}>
            C'est le nom que verra le poste de commandement dans les listes et sur les
            missions. Sans lui, tu apparais « sans nom » et personne ne sait qui répond.
          </p>
          {erreur && <div className="message erreur">{erreur}</div>}
          <div className="saisie-rapide">
            <input
              value={nom}
              autoFocus
              autoComplete="name"
              onChange={(e) => setNom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && nom.trim() && enregistrer()}
              placeholder="Nom et prénom"
            />
            <button disabled={occupe || !nom.trim()} onClick={enregistrer}>
              Continuer
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}

export function CreationEvenement({ onFait, setMessage }) {
  const [nom, setNom] = useState('')
  const [slug, setSlug] = useState('')
  const [geometrie, setGeometrie] = useState('site_ferme')
  const [occupe, setOccupe] = useState(false)

  async function creer() {
    setOccupe(true)
    const { error } = await supabase.from('evenements').insert({ nom, slug, geometrie })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setNom('')
      setSlug('')
      onFait()
    }
    setOccupe(false)
  }

  return (
    <>
      <div className="saisie-rapide">
        <input
          value={nom}
          onChange={(e) => {
            setNom(e.target.value)
            setSlug(
              e.target.value
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
            )
          }}
          placeholder="Nom de l'événement"
        />
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="Identifiant court"
          style={{ flex: '0 1 180px' }}
        />
        <select
          value={geometrie}
          onChange={(e) => setGeometrie(e.target.value)}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          {GEOMETRIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button disabled={occupe || !nom.trim() || !slug.trim()} onClick={creer}>
          Créer
        </button>
      </div>
      <p className="aide">
        Tu en deviens administrateur. La géométrie détermine les outils proposés : un
        parcours ouvre les bornes kilométriques, un site fermé les zones et les entrées.
      </p>
    </>
  )
}

export function PremierEvenement({ session, onFait, setMessage }) {
  return (
    <div className="corps">
      <main className="travail">
        <section className="bloc">
          <h2>Aucun événement</h2>
          <p className="aide">
            Crée le premier, ou fais-toi ajouter à un événement existant en transmettant ton
            identifiant à son administrateur.
          </p>
          <CreationEvenement onFait={onFait} setMessage={setMessage} />
          <div className="identite">
            <span className="etiquette">Mon identifiant</span>
            <code>{session.user.id}</code>
          </div>
        </section>
      </main>
    </div>
  )
}

/* ================================================================== */

export function RejoindreEvenement({ evenement, onFait, setMessage }) {
  const [role, setRole] = useState('coordinateur')
  const [occupe, setOccupe] = useState(false)

  async function rejoindre() {
    setOccupe(true)
    const { error } = await supabase.rpc('rejoindre_evenement', {
      p_evenement: evenement.id,
      p_role_code: role
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else onFait()
    setOccupe(false)
  }

  return (
    <div className="saisie-rapide">
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        style={{ width: 'auto', marginBottom: 0 }}
      >
        <option value="observateur">en observateur (lecture seule)</option>
        <option value="coordinateur">en coordinateur (tous droits)</option>
      </select>
      <button disabled={occupe} onClick={rejoindre}>
        Rejoindre le dispositif
      </button>
    </div>
  )
}
