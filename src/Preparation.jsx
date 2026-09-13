import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Préparation — l'avant-événement.
 *
 * À ce stade, les utilisateurs ne sont pas des bénévoles mais les
 * membres de l'organisation, et le travail s'organise en groupes :
 * sécurité, bar, communication. Un groupe de travail n'est pas une
 * équipe opérationnelle — « Volante » dit qui fait quoi pendant
 * l'événement, « Sécurité » dit qui prépare quoi avant. Les mêmes
 * personnes s'y croisent souvent, jamais aux mêmes moments.
 *
 * Les actions sont des jalons : mêmes libellé, responsable, échéance,
 * statut. Une action datée apparaît dans la frise du Planning, une
 * action sans date reste ici — c'est la même chose vue deux fois, pas
 * deux objets à tenir à jour séparément.
 */
export default function Preparation({ evenement, membre, peut, toutPouvoir, setMessage }) {
  const [groupes, setGroupes] = useState(null)
  const [actions, setActions] = useState([])
  const [ouvert, setOuvert] = useState(null)
  const [creerGroupe, setCreerGroupe] = useState(false)

  const peutGerer = toutPouvoir || peut?.('rh', 'creer')

  async function charger() {
    const [g, a] = await Promise.all([
      supabase
        .from('groupes_travail')
        .select('*, pilote:pilote_membre_id(nom_affiche)')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .order('ordre')
        .order('nom'),
      supabase
        .from('jalons')
        .select('*')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .order('echeance', { nullsFirst: false })
    ])
    if (g.error) setMessage({ type: 'erreur', texte: g.error.message })
    else setGroupes(g.data ?? [])
    setActions(a.data ?? [])
  }

  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  if (groupes === null) return <p className="vide">…</p>

  const orphelines = actions.filter((a) => !a.groupe_travail_id)

  return (
    <div className="bloc dom-azur">
      <div className="entete-dashboard">
        <h2>Préparation</h2>
        {peutGerer && (
          <button className="lien" onClick={() => setCreerGroupe(!creerGroupe)}>
            {creerGroupe ? 'Fermer' : 'Nouveau groupe'}
          </button>
        )}
      </div>

      <p className="aide" style={{ marginTop: 0 }}>
        Qui prépare quoi. Une action datée apparaît aussi dans la frise du Planning ; une
        action sans date reste ici jusqu'à ce qu'on lui en donne une.
      </p>

      {creerGroupe && (
        <FormGroupeTravail
          evenement={evenement}
          setMessage={setMessage}
          onFait={() => {
            setCreerGroupe(false)
            charger()
          }}
        />
      )}

      {groupes.length === 0 && !creerGroupe && (
        <p className="vide">
          Aucun groupe de travail. Commence par créer ceux qui portent réellement la
          préparation — sécurité, bar, communication.
        </p>
      )}

      {groupes.map((g) => {
        const siennes = actions.filter((a) => a.groupe_travail_id === g.id)
        const faites = siennes.filter((a) => a.statut === 'fait').length
        const enRetard = siennes.filter(
          (a) => a.echeance && a.statut === 'a_venir' && new Date(a.echeance) < new Date()
        ).length

        return (
          <div className={`carte ${enRetard ? 'urgent' : ''}`} key={g.id}>
            <div className="titre">{g.nom}</div>
            {g.objet && <p className="aide">{g.objet}</p>}
            <div className="meta">
              {g.pilote?.nom_affiche && <span>piloté par {g.pilote.nom_affiche}</span>}
              <span>
                {faites}/{siennes.length} fait(s)
              </span>
              {enRetard > 0 && <span className="alerte-texte">{enRetard} en retard</span>}
            </div>

            <div className="ligne-boutons" style={{ marginTop: 8 }}>
              <button onClick={() => setOuvert(ouvert === g.id ? null : g.id)}>
                {ouvert === g.id ? 'Fermer' : `Ses actions (${siennes.length})`}
              </button>
            </div>

            {ouvert === g.id && (
              <Actions
                evenement={evenement}
                groupe={g}
                actions={siennes}
                peutGerer={peutGerer}
                setMessage={setMessage}
                onFait={charger}
              />
            )}
          </div>
        )
      })}

      {orphelines.length > 0 && (
        <>
          <div className="pave-titre" style={{ marginTop: 16 }}>
            Actions sans groupe ({orphelines.length})
          </div>
          <p className="aide" style={{ marginTop: -2 }}>
            Personne ne les porte explicitement — c'est souvent là que ça coince.
          </p>
          <Actions
            evenement={evenement}
            groupe={null}
            actions={orphelines}
            peutGerer={peutGerer}
            groupesDisponibles={groupes}
            setMessage={setMessage}
            onFait={charger}
          />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

const STATUTS = [
  ['a_venir', 'À venir'],
  ['en_cours', 'En cours'],
  ['fait', 'Fait'],
  ['rate', 'Raté'],
  ['annule', 'Annulé']
]

function Actions({ evenement, groupe, actions, peutGerer, groupesDisponibles, setMessage, onFait }) {
  const [ouvrir, setOuvrir] = useState(false)
  const [f, setF] = useState({ code: '', libelle: '', echeance: '', responsable: '' })

  async function creer() {
    if (!f.code.trim() || !f.libelle.trim()) return
    const { error } = await supabase.from('jalons').insert({
      evenement_id: evenement.id,
      code: f.code.trim(),
      libelle: f.libelle.trim(),
      // Facultative — c'est tout l'intérêt en préparation.
      echeance: f.echeance ? new Date(f.echeance).toISOString() : null,
      responsable: f.responsable.trim() || null,
      groupe_travail_id: groupe?.id ?? null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ code: '', libelle: '', echeance: '', responsable: '' })
      setOuvrir(false)
      onFait()
    }
  }

  async function modifier(id, champs) {
    const { error, count } = await supabase
      .from('jalons')
      .update(champs, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Modification refusée.' })
    else onFait()
  }

  return (
    <div style={{ marginTop: 8 }}>
      {actions.length === 0 ? (
        <p className="aide">Aucune action.</p>
      ) : (
        actions.map((a) => {
          const retard =
            a.echeance && a.statut === 'a_venir' && new Date(a.echeance) < new Date()
          return (
            <div className="carte" key={a.id}>
              <div className="titre">
                <span className="mono">{a.code}</span> {a.libelle}
              </div>
              <div className="meta">
                <span className={retard ? 'alerte-texte' : ''}>
                  {a.echeance
                    ? new Date(a.echeance).toLocaleDateString('fr-BE')
                    : 'sans échéance'}
                </span>
                {a.responsable && <span>{a.responsable}</span>}
                {a.critique && <span className="alerte-texte">critique</span>}
              </div>

              {peutGerer && (
                <div className="ligne-boutons" style={{ marginTop: 6 }}>
                  <select
                    value={a.statut}
                    onChange={(e) => modifier(a.id, { statut: e.target.value })}
                    style={{ width: 'auto', marginBottom: 0 }}
                  >
                    {STATUTS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>

                  {!a.echeance && (
                    <input
                      type="date"
                      onChange={(e) =>
                        e.target.value &&
                        modifier(a.id, { echeance: new Date(e.target.value).toISOString() })
                      }
                      style={{ width: 'auto', marginBottom: 0 }}
                      title="Donner une échéance la fera apparaître dans le Planning"
                    />
                  )}

                  {groupesDisponibles && (
                    <select
                      defaultValue=""
                      onChange={(e) =>
                        e.target.value && modifier(a.id, { groupe_travail_id: e.target.value })
                      }
                      style={{ width: 'auto', marginBottom: 0 }}
                    >
                      <option value="">— rattacher à —</option>
                      {groupesDisponibles.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.nom}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}

      {peutGerer && groupe && (
        <>
          {ouvrir ? (
            <div className="formulaire" style={{ marginTop: 8 }}>
              <div className="saisie-rapide">
                <input
                  value={f.code}
                  onChange={(e) => setF({ ...f, code: e.target.value })}
                  placeholder="Code"
                  style={{ flex: '0 1 90px' }}
                />
                <input
                  value={f.libelle}
                  onChange={(e) => setF({ ...f, libelle: e.target.value })}
                  placeholder="Ce qu'il y a à faire"
                  autoFocus
                />
              </div>
              <div className="saisie-rapide">
                <input
                  value={f.responsable}
                  onChange={(e) => setF({ ...f, responsable: e.target.value })}
                  placeholder="Qui s'en charge"
                />
                <input
                  type="date"
                  value={f.echeance}
                  onChange={(e) => setF({ ...f, echeance: e.target.value })}
                  style={{ flex: '0 1 150px' }}
                />
                <button disabled={!f.code.trim() || !f.libelle.trim()} onClick={creer}>
                  Ajouter
                </button>
              </div>
              <p className="aide">
                L'échéance est facultative. Sans elle, l'action reste ici ; avec elle, elle
                rejoint la frise du Planning.
              </p>
            </div>
          ) : (
            <div className="ligne-boutons" style={{ marginTop: 8 }}>
              <button className="discret" onClick={() => setOuvrir(true)}>
                + Action
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FormGroupeTravail({ evenement, setMessage, onFait }) {
  const [f, setF] = useState({ nom: '', objet: '' })

  async function creer() {
    if (!f.nom.trim()) return
    const { error } = await supabase.from('groupes_travail').insert({
      evenement_id: evenement.id,
      nom: f.nom.trim(),
      objet: f.objet.trim() || null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFait()
  }

  return (
    <div className="formulaire">
      <input
        value={f.nom}
        onChange={(e) => setF({ ...f, nom: e.target.value })}
        placeholder="Nom du groupe — ex. Sécurité, Bar, Communication"
        autoFocus
      />
      <input
        value={f.objet}
        onChange={(e) => setF({ ...f, objet: e.target.value })}
        placeholder="Son périmètre en une phrase"
      />
      <div className="ligne-boutons">
        <button disabled={!f.nom.trim()} onClick={creer}>
          Créer
        </button>
      </div>
      <p className="aide">
        Dire aussi ce dont le groupe ne répond pas évite les trous : c'est entre deux
        périmètres que les choses s'oublient.
      </p>
    </div>
  )
}
