import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Gestion des rôles.
 *
 * Le client nomme ses rôles avec ses mots et compose leurs capacités.
 * Il ne peut pas inventer une capacité : le vocabulaire — ressources et
 * actions — reste figé au produit. C'est ce qui évite le sur-mesure
 * infini tout en laissant chaque organisation parler sa langue.
 */

const RESSOURCES = [
  ['membres', 'Membres'],
  ['equipes', 'Équipes'],
  ['referentiels', 'Référentiels'],
  ['missions', 'Missions'],
  ['journal', 'Main courante'],
  ['sos', 'Signalements'],
  ['alertes', 'Alertes'],
  ['logistique', 'Logistique'],
  ['parcours', 'Parcours'],
  ['rh', 'Bénévoles'],
  ['plan_implantation', "Plan d'implantation"],
  ['installations_risque', 'Installations à risque'],
  ['analyse', 'Analyse / REX']
]

const ACTIONS = ['lire', 'creer', 'modifier', 'supprimer']
const PHASES = ['preparation', 'montage', 'exploitation', 'demontage', 'cloture']
const TERRAIN = ['montage', 'exploitation', 'demontage']

export default function Roles({ evenement, setMessage }) {
  const [roles, setRoles] = useState([])
  const [capacites, setCapacites] = useState({})
  const [ouvert, setOuvert] = useState(null)
  const [nouveau, setNouveau] = useState({ code: '', libelle: '', description: '' })
  const [occupe, setOccupe] = useState(false)

  async function charger() {
    const { data: r, error } = await supabase
      .from('roles')
      .select('*')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .order('ordre')
    if (error) return setMessage({ type: 'erreur', texte: error.message })
    setRoles(r ?? [])

    const ids = (r ?? []).map((x) => x.id)
    if (!ids.length) return
    const { data: c } = await supabase
      .from('role_capacites')
      .select('*')
      .in('role_id', ids)
    const par = {}
    for (const x of c ?? []) {
      par[x.role_id] ??= new Set()
      par[x.role_id].add(`${x.ressource}:${x.action}:${x.phase}`)
    }
    setCapacites(par)
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function creer() {
    if (!nouveau.libelle.trim()) return
    setOccupe(true)
    const code =
      nouveau.code.trim() ||
      nouveau.libelle
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
    const { error } = await supabase.from('roles').insert({
      evenement_id: evenement.id,
      code,
      libelle: nouveau.libelle.trim(),
      description: nouveau.description.trim() || null,
      ordre: 60
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setNouveau({ code: '', libelle: '', description: '' })
      charger()
    }
    setOccupe(false)
  }

  async function renommer(role, libelle) {
    const { error, count } = await supabase
      .from('roles')
      .update({ libelle }, { count: 'exact' })
      .eq('id', role.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Modification refusée.' })
    else charger()
  }

  async function basculer(roleId, ressource, action, phases) {
    const jeu = capacites[roleId] ?? new Set()
    const actif = phases.every((p) => jeu.has(`${ressource}:${action}:${p}`))
    if (actif) {
      const { error } = await supabase
        .from('role_capacites')
        .delete()
        .eq('role_id', roleId)
        .eq('ressource', ressource)
        .eq('action', action)
        .in('phase', phases)
      if (error) return setMessage({ type: 'erreur', texte: error.message })
    } else {
      const lignes = phases.map((p) => ({
        role_id: roleId,
        ressource,
        action,
        phase: p
      }))
      const { error } = await supabase.from('role_capacites').upsert(lignes)
      if (error) return setMessage({ type: 'erreur', texte: error.message })
    }
    charger()
  }

  return (
    <>
      <section className="bloc">
        <h2>Rôles</h2>
        <p className="aide">
          Les intitulés sont libres. Les capacités, non : le vocabulaire du système reste
          figé, ce qui évite qu'un événement devienne un cas particulier impossible à
          maintenir. Un rôle système peut être renommé, jamais supprimé.
        </p>

        {roles.map((r) => {
          const jeu = capacites[r.id] ?? new Set()
          const nb = jeu.size
          return (
            <div className="carte" key={r.id}>
              <div className="titre">
                {r.libelle}
                {r.tout_pouvoir && <span className="jeton admin"> tout pouvoir</span>}
                {r.systeme && !r.tout_pouvoir && <span className="jeton"> système</span>}
              </div>
              {r.description && <p className="aide" style={{ margin: '2px 0' }}>{r.description}</p>}
              <div className="meta">
                <span className="mono">{r.code}</span>
                <span>{r.tout_pouvoir ? 'toutes capacités' : `${nb} capacité(s)`}</span>
              </div>

              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                <button
                  className="discret"
                  onClick={() => setOuvert(ouvert === r.id ? null : r.id)}
                  disabled={r.tout_pouvoir}
                  title={r.tout_pouvoir ? 'Ce rôle passe partout par construction' : undefined}
                >
                  {ouvert === r.id ? 'Fermer' : 'Capacités'}
                </button>
                <button
                  className="discret"
                  onClick={() => {
                    const l = prompt('Nouvel intitulé', r.libelle)
                    if (l && l.trim()) renommer(r, l.trim())
                  }}
                >
                  Renommer
                </button>
              </div>

              {ouvert === r.id && (
                <GrilleCapacites
                  jeu={jeu}
                  onBasculer={(res, act, phases) => basculer(r.id, res, act, phases)}
                />
              )}
            </div>
          )
        })}
      </section>

      <section className="bloc">
        <h2>Nouveau rôle</h2>
        <div className="saisie-rapide">
          <input
            value={nouveau.libelle}
            onChange={(e) => setNouveau({ ...nouveau, libelle: e.target.value })}
            placeholder="Intitulé — ex. Chef d'étape, Dir-PC-Ops, Régisseur"
          />
          <button disabled={occupe || !nouveau.libelle.trim()} onClick={creer}>
            Créer
          </button>
        </div>
        <input
          value={nouveau.description}
          onChange={(e) => setNouveau({ ...nouveau, description: e.target.value })}
          placeholder="À quoi sert ce rôle (facultatif)"
        />
        <p className="aide">
          Le rôle est créé sans aucune capacité : il ne voit rien tant que tu ne lui en
          donnes pas. C'est volontaire — on ouvre des droits, on n'en retire pas.
        </p>
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ */

function GrilleCapacites({ jeu, onBasculer }) {
  const [portee, setPortee] = useState('terrain')
  const phases = portee === 'terrain' ? TERRAIN : PHASES

  return (
    <div className="formulaire">
      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        {[
          ['terrain', 'Phases terrain'],
          ['toutes', 'Toutes les phases']
        ].map(([k, l]) => (
          <button
            key={k}
            className={`module ${portee === k ? 'actif' : ''}`}
            onClick={() => setPortee(k)}
          >
            {l}
          </button>
        ))}
      </div>

      <table className="grille-capacites">
        <thead>
          <tr>
            <th></th>
            {ACTIONS.map((a) => (
              <th key={a}>{a}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RESSOURCES.map(([res, libelle]) => (
            <tr key={res}>
              <th scope="row">{libelle}</th>
              {ACTIONS.map((act) => {
                const toutes = phases.every((p) => jeu.has(`${res}:${act}:${p}`))
                const partielles =
                  !toutes && phases.some((p) => jeu.has(`${res}:${act}:${p}`))
                return (
                  <td key={act}>
                    <button
                      className={`case ${toutes ? 'active' : ''} ${partielles ? 'partielle' : ''}`}
                      onClick={() => onBasculer(res, act, phases)}
                      aria-label={`${libelle} ${act}`}
                      title={
                        partielles ? 'Actif sur certaines phases seulement' : undefined
                      }
                    >
                      {toutes ? '×' : partielles ? '–' : ''}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="aide">
        Un tiret signale une capacité ouverte sur une partie des phases seulement. La lecture
        des signalements, des alertes et de la main courante reste ouverte à tout membre,
        quoi qu'on décoche ici : on ne peut pas rendre quelqu'un aveugle au critique.
      </p>
    </div>
  )
}
