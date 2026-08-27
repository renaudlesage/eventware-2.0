import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Console plateforme — vue de l'éditeur.
 *
 * Séparée de l'exploitation d'un événement, et volontairement pauvre en
 * opérationnel : on n'y pilote rien. On y ouvre des organisations, on y
 * règle ce qui est souscrit, on y crée des événements et on y gère les
 * accès. Le coordinateur fait le reste, chez lui.
 */

const MODULES = [
  ['securite', 'Sécurité'],
  ['logistique', 'Logistique'],
  ['rh', 'Bénévoles'],
  ['parcours', 'Parcours'],
  ['sos_participants', 'SOS participants'],
  ['plan_implantation', "Plan d'implantation"],
  ['analyse', 'Analyse / REX']
]

const STATUTS = [
  ['essai', 'Essai'],
  ['active', 'Active'],
  ['suspendue', 'Suspendue'],
  ['close', 'Close']
]

const ONGLETS = [
  ['organisations', 'Organisations'],
  ['evenements', 'Événements'],
  ['comptes', 'Comptes plateforme']
]

export default function Plateforme({ session, setMessage, onOuvrir }) {
  const [onglet, setOnglet] = useState('organisations')

  return (
    <div className="plateforme">
      <div className="entete-dashboard">
        <h2>Console plateforme</h2>
        <span className="compte">{session.user.email}</span>
      </div>

      <p className="aide">
        Espace de l'éditeur. Aucun pilotage opérationnel ici : les événements se conduisent
        depuis leur propre espace, par leur coordinateur.
      </p>

      <div className="onglets">
        {ONGLETS.map(([k, l]) => (
          <button
            key={k}
            className={`module ${onglet === k ? 'actif' : ''}`}
            onClick={() => setOnglet(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {onglet === 'organisations' && <Organisations setMessage={setMessage} />}
      {onglet === 'evenements' && (
        <Evenements setMessage={setMessage} onOuvrir={onOuvrir} />
      )}
      {onglet === 'comptes' && <Comptes setMessage={setMessage} />}
    </div>
  )
}

/* ================================================================== */
/* Organisations et licences                                           */
/* ================================================================== */

function Organisations({ setMessage }) {
  const [orgs, setOrgs] = useState([])
  const [ouvert, setOuvert] = useState(null)
  const [f, setF] = useState({ nom: '', contact_nom: '', contact_email: '' })

  async function charger() {
    const { data, error } = await supabase
      .from('organisations')
      .select('*, evenements(id, nom, phase)')
      .is('deleted_at', null)
      .order('nom')
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setOrgs(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [])

  async function creer() {
    if (!f.nom.trim()) return
    const slug = f.nom
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const { error } = await supabase.from('organisations').insert({ ...f, slug })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ nom: '', contact_nom: '', contact_email: '' })
      charger()
    }
  }

  async function maj(id, champs) {
    const { error, count } = await supabase
      .from('organisations')
      .update(champs, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Modification refusée.' })
    else charger()
  }

  return (
    <>
      <div className="saisie-rapide">
        <input
          value={f.nom}
          onChange={(e) => setF({ ...f, nom: e.target.value })}
          placeholder="Nom du client"
        />
        <input
          value={f.contact_nom}
          onChange={(e) => setF({ ...f, contact_nom: e.target.value })}
          placeholder="Contact"
          style={{ flex: '0 1 160px' }}
        />
        <input
          value={f.contact_email}
          onChange={(e) => setF({ ...f, contact_email: e.target.value })}
          placeholder="E-mail"
          style={{ flex: '0 1 190px' }}
        />
        <button disabled={!f.nom.trim()} onClick={creer}>
          Ouvrir un client
        </button>
      </div>
      <p className="aide">
        Une organisation nouvelle démarre en essai, avec le seul module Sécurité. C'est le
        plancher : rien ne s'ouvre par défaut.
      </p>

      {orgs.map((o) => {
        const actifs = MODULES.filter(([k]) => o.modules_autorises?.[k]).length
        return (
          <div className={`carte ${o.statut === 'suspendue' ? 'urgent' : ''}`} key={o.id}>
            <div className="titre">
              {o.nom} <span className={`jeton statut-${o.statut}`}>{o.statut}</span>
            </div>
            <div className="meta">
              <span className="mono">{o.slug}</span>
              <span>{(o.evenements ?? []).length} événement(s)</span>
              <span>
                {actifs}/{MODULES.length} module(s)
              </span>
              {o.contact_nom && <span>{o.contact_nom}</span>}
              {o.echeance && <span>échéance {o.echeance}</span>}
            </div>

            <div className="ligne-boutons" style={{ marginTop: 10 }}>
              <select
                value={o.statut}
                onChange={(e) => maj(o.id, { statut: e.target.value })}
                style={{ width: 'auto', marginBottom: 0 }}
              >
                {STATUTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <button
                className="discret"
                onClick={() => setOuvert(ouvert === o.id ? null : o.id)}
              >
                {ouvert === o.id ? 'Fermer' : 'Licence'}
              </button>
            </div>

            {ouvert === o.id && (
              <div className="formulaire">
                <div className="plaques">
                  {MODULES.map(([k, libelle]) => (
                    <button
                      key={k}
                      className={`plaque-nav ${o.modules_autorises?.[k] ? 'actif' : ''}`}
                      onClick={() =>
                        maj(o.id, {
                          modules_autorises: {
                            ...o.modules_autorises,
                            [k]: !o.modules_autorises?.[k]
                          }
                        })
                      }
                    >
                      {libelle}
                    </button>
                  ))}
                </div>
                <p className="aide">
                  Retirer un module le désactive aussitôt sur les événements en cours du
                  client, avec une trace dans leur main courante. Les événements clos ne
                  sont pas touchés — on ne réécrit pas l'historique pour une raison
                  commerciale.
                </p>
                <div className="saisie-rapide">
                  <input
                    type="date"
                    defaultValue={o.echeance ?? ''}
                    onBlur={(e) => maj(o.id, { echeance: e.target.value || null })}
                  />
                  <input
                    defaultValue={o.notes ?? ''}
                    placeholder="Notes commerciales"
                    onBlur={(e) => maj(o.id, { notes: e.target.value || null })}
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

/* ================================================================== */
/* Événements — vue éditeur                                            */
/* ================================================================== */

function Evenements({ setMessage, onOuvrir }) {
  const [evenements, setEvenements] = useState([])
  const [orgs, setOrgs] = useState([])
  const [f, setF] = useState({ nom: '', organisation_id: '', geometrie: 'site_ferme' })

  async function charger() {
    const [e, o] = await Promise.all([
      supabase
        .from('evenements')
        .select('*, organisations(nom), membres_evenement(id)')
        .is('deleted_at', null)
        .order('nom'),
      supabase.from('organisations').select('id, nom').is('deleted_at', null).order('nom')
    ])
    if (e.error) setMessage({ type: 'erreur', texte: e.error.message })
    else setEvenements(e.data ?? [])
    setOrgs(o.data ?? [])
    if (!f.organisation_id && o.data?.[0]) setF((x) => ({ ...x, organisation_id: o.data[0].id }))
  }

  useEffect(() => {
    charger()
  }, [])

  async function creer() {
    if (!f.nom.trim() || !f.organisation_id) return
    const slug = f.nom
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const { error } = await supabase.from('evenements').insert({ ...f, slug })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ ...f, nom: '' })
      charger()
    }
  }

  return (
    <>
      <div className="saisie-rapide">
        <input
          value={f.nom}
          onChange={(e) => setF({ ...f, nom: e.target.value })}
          placeholder="Nom de l'événement"
        />
        <select
          value={f.organisation_id}
          onChange={(e) => setF({ ...f, organisation_id: e.target.value })}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nom}
            </option>
          ))}
        </select>
        <select
          value={f.geometrie}
          onChange={(e) => setF({ ...f, geometrie: e.target.value })}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          <option value="site_ferme">Site fermé</option>
          <option value="parcours">Parcours</option>
          <option value="hybride">Hybride</option>
        </select>
        <button disabled={!f.nom.trim()} onClick={creer}>
          Ouvrir
        </button>
      </div>
      <p className="aide">
        Tu deviens coordinateur de l'événement que tu crées. Pour un client, transfère
        ensuite ce rôle à son responsable et retire-toi : l'éditeur n'a pas vocation à
        rester dans le dispositif.
      </p>

      {evenements.map((e) => (
        <div className="carte" key={e.id}>
          <div className="titre">{e.nom}</div>
          <div className="meta">
            <span>{e.organisations?.nom ?? 'sans organisation'}</span>
            <span className={`plaque phase-${e.phase}`}>{e.phase}</span>
            <span>{e.geometrie}</span>
            <span>{(e.membres_evenement ?? []).length} membre(s)</span>
            <span>
              {MODULES.filter(([k]) => e.modules?.[k]).length} module(s) actif(s)
            </span>
          </div>
          <div className="ligne-boutons" style={{ marginTop: 10 }}>
            <button onClick={() => onOuvrir?.(e.id)}>Ouvrir cet événement</button>
          </div>
        </div>
      ))}
      <p className="aide">
        « Ouvrir » bascule ton espace de travail sur cet événement. Si tu n'en es pas
        membre, l'écran te proposera de rejoindre le dispositif.
      </p>
    </>
  )
}

/* ================================================================== */
/* Comptes plateforme                                                  */
/* ================================================================== */

function Comptes({ setMessage }) {
  const [membres, setMembres] = useState([])
  const [f, setF] = useState({ user_id: '', nom: '', niveau: 'support' })

  async function charger() {
    const { data, error } = await supabase.from('membres_plateforme').select('*')
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setMembres(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [])

  async function ajouter() {
    if (!f.user_id.trim()) return
    const { error } = await supabase
      .from('membres_plateforme')
      .insert({ ...f, user_id: f.user_id.trim() })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ user_id: '', nom: '', niveau: 'support' })
      charger()
    }
  }

  async function basculer(userId, actif) {
    const { error } = await supabase
      .from('membres_plateforme')
      .update({ actif })
      .eq('user_id', userId)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else charger()
  }

  return (
    <>
      <div className="saisie-rapide">
        <input
          value={f.user_id}
          onChange={(e) => setF({ ...f, user_id: e.target.value })}
          placeholder="Identifiant du compte"
        />
        <input
          value={f.nom}
          onChange={(e) => setF({ ...f, nom: e.target.value })}
          placeholder="Nom"
          style={{ flex: '0 1 160px' }}
        />
        <select
          value={f.niveau}
          onChange={(e) => setF({ ...f, niveau: e.target.value })}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          <option value="support">Support</option>
          <option value="exploitant">Exploitant</option>
        </select>
        <button disabled={!f.user_id.trim()} onClick={ajouter}>
          Ajouter
        </button>
      </div>
      <p className="aide">
        Un exploitant voit et administre toutes les organisations. À n'accorder qu'à
        quelqu'un dont c'est le métier — ce compte traverse la cloison entre clients.
      </p>

      {membres.map((m) => (
        <div className={`carte ${m.actif ? '' : 'revoque'}`} key={m.user_id}>
          <div className="titre">{m.nom ?? '(sans nom)'}</div>
          <div className="meta">
            <span className={`jeton ${m.niveau === 'exploitant' ? 'admin' : ''}`}>
              {m.niveau}
            </span>
            <span className="mono">{m.user_id.slice(0, 8)}…</span>
            {!m.actif && <span className="alerte-texte">désactivé</span>}
          </div>
          <div className="ligne-boutons" style={{ marginTop: 10 }}>
            <button className="discret" onClick={() => basculer(m.user_id, !m.actif)}>
              {m.actif ? 'Désactiver' : 'Réactiver'}
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
