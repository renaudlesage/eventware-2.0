import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import PiecesJointes from './PiecesJointes'

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
  const [membres, setMembres] = useState([])
  const [equipes, setEquipes] = useState([])
  const [compositions, setCompositions] = useState([])
  const [ouvert, setOuvert] = useState(null)
  const [creerGroupe, setCreerGroupe] = useState(false)

  const peutGerer = toutPouvoir || peut?.('rh', 'creer')
  const peutEquipes = toutPouvoir || peut?.('equipes', 'creer')

  async function charger() {
    const [g, a, mb, eq] = await Promise.all([
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
        .order('echeance', { nullsFirst: false }),
      supabase
        .from('membres_evenement')
        .select('id, nom_affiche, role')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .order('nom_affiche', { nullsFirst: false }),
      supabase
        .from('equipes')
        .select('id, code, nom')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
    ])
    if (g.error) setMessage({ type: 'erreur', texte: g.error.message })
    else setGroupes(g.data ?? [])
    setActions(a.data ?? [])
    setMembres(mb.data ?? [])
    setEquipes(eq.data ?? [])

    // Composition des groupes de travail. Requête séparée : elle a
    // besoin des identifiants de groupes que la précédente vient de
    // ramener, et RLS ne filtre que par événement — sans le `in`, on
    // récupérerait les groupes des autres événements où l'on siège.
    const ids = (g.data ?? []).map((x) => x.id)
    if (ids.length) {
      const { data: c } = await supabase
        .from('membres_groupe_travail')
        .select('groupe_id, membre_id')
        .in('groupe_id', ids)
      setCompositions(c ?? [])
    } else {
      setCompositions([])
    }
  }

  async function ajouterAuGroupe(groupeId, membreId) {
    const { error } = await supabase
      .from('membres_groupe_travail')
      .insert({ groupe_id: groupeId, membre_id: membreId })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else charger()
  }

  async function retirerDuGroupe(groupeId, membreId) {
    // Table de liaison sans suppression logique : retirer quelqu'un d'un
    // groupe de travail n'est pas un fait à conserver, c'est une
    // correction. La ligne part pour de bon.
    const { error } = await supabase
      .from('membres_groupe_travail')
      .delete()
      .eq('groupe_id', groupeId)
      .eq('membre_id', membreId)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else charger()
  }

  /**
   * Reprendre un groupe de travail comme équipe opérationnelle.
   *
   * Les deux objets restent distincts — le groupe porte la préparation,
   * l'équipe porte le terrain — mais dans la plupart des cas ce sont les
   * mêmes périmètres : celui qui a préparé le bar tient le bar. Recopier
   * les neuf noms à la main dans un second écran est une corvée dont on
   * sort avec des libellés qui divergent.
   *
   * Copie explicite, pas lien vivant : renommer le groupe plus tard ne
   * renomme pas l'équipe. C'est voulu — une équipe engagée le jour J ne
   * doit pas changer de nom parce que quelqu'un retouche la préparation.
   */
  async function reprendreCommeEquipe(g) {
    const { error } = await supabase.from('equipes').insert({
      evenement_id: evenement.id,
      code: codeLibre(g.nom, equipes),
      nom: g.nom,
      description: g.objet ?? null,
      responsable_id: g.pilote_membre_id ?? null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setMessage({
        type: 'succes',
        texte: `Équipe « ${g.nom} » créée — attribuable dans Bénévoles.`
      })
      charger()
    }
  }

  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  if (groupes === null) return <p className="vide">…</p>

  const orphelines = actions.filter((a) => !a.groupe_travail_id)

  return (
    <div className="bloc dom-tilleul">
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

        const siens = compositions
          .filter((c) => c.groupe_id === g.id)
          .map((c) => membres.find((m) => m.id === c.membre_id))
          .filter(Boolean)
        const dispo = membres.filter((m) => !siens.some((x) => x.id === m.id))

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

            {/* Qui compose le groupe. Le pilote répond du groupe ; ceux-ci
                y travaillent. Sans cette liste, « le groupe bar » ne
                désigne personne et les actions se rattachent à un nom
                plutôt qu'à une équipe. */}
            <div className="meta" style={{ marginTop: 4 }}>
              {siens.length === 0 ? (
                <span className="aide">Personne n&rsquo;y est encore rattaché.</span>
              ) : (
                siens.map((m) => (
                  <span className="jeton" key={m.id}>
                    {m.nom_affiche ?? 'sans nom'}
                    {peutGerer && (
                      <button
                        className="lien"
                        style={{ marginLeft: 6 }}
                        onClick={() => retirerDuGroupe(g.id, m.id)}
                        title="Retirer du groupe"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))
              )}
            </div>

            {peutGerer && dispo.length > 0 && (
              <select
                value=""
                onChange={(e) => e.target.value && ajouterAuGroupe(g.id, e.target.value)}
                style={{ width: 'auto', marginTop: 6, marginBottom: 0 }}
              >
                <option value="">— rattacher quelqu&rsquo;un —</option>
                {dispo.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nom_affiche ?? 'sans nom'}
                  </option>
                ))}
              </select>
            )}

            <div className="ligne-boutons" style={{ marginTop: 8 }}>
              <button onClick={() => setOuvert(ouvert === g.id ? null : g.id)}>
                {ouvert === g.id ? 'Fermer' : `Ses actions (${siennes.length})`}
              </button>
              {equipeDe(g, equipes) ? (
                <span className="jeton">équipe {equipeDe(g, equipes).code}</span>
              ) : (
                peutEquipes && (
                  <button
                    className="discret"
                    onClick={() => reprendreCommeEquipe(g)}
                    title="Créer l'équipe opérationnelle correspondante"
                  >
                    Reprendre comme équipe
                  </button>
                )
              )}
            </div>

            {ouvert === g.id && (
              <Actions
                evenement={evenement}
                groupe={g}
                actions={siennes}
                membres={membres}
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
            membres={membres}
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

function Actions({ evenement, groupe, actions, membres, peutGerer, groupesDisponibles, setMessage, onFait }) {
  const [ouvrir, setOuvrir] = useState(false)
  const [f, setF] = useState({ code: '', libelle: '', echeance: '', responsable_membre_id: '' })

  async function creer() {
    if (!f.code.trim() || !f.libelle.trim()) return
    const { error } = await supabase.from('jalons').insert({
      evenement_id: evenement.id,
      code: f.code.trim(),
      libelle: f.libelle.trim(),
      // Facultative — c'est tout l'intérêt en préparation.
      echeance: f.echeance ? new Date(f.echeance).toISOString() : null,
      responsable_membre_id: f.responsable_membre_id || null,
      groupe_travail_id: groupe?.id ?? null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ code: '', libelle: '', echeance: '', responsable_membre_id: '' })
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

  /**
   * Suppression logique : la ligne reste en base, l'écran ne la montre
   * plus. C'est la convention du projet, et ici elle a une raison de
   * plus — une action supprimée par erreur en préparation se retrouve,
   * alors qu'une ligne effacée pour de bon ne se retrouve pas.
   *
   * À ne pas confondre avec le statut « Annulé », qui garde l'action
   * visible : on annule ce qui a existé et qu'on assume, on supprime ce
   * qui n'aurait pas dû être encodé.
   */
  async function supprimer(a) {
    const ok = window.confirm(
      `Supprimer l'action « ${a.libelle} » ?\n\n` +
        'Pour garder la trace de quelque chose d\u2019abandonné, le statut ' +
        '« Annulé » est plus juste : l\u2019action reste lisible.'
    )
    if (!ok) return

    // Pas un `update` direct : poser `deleted_at` rend la ligne
    // invisible au regard de la policy de lecture, et PostgreSQL
    // refuse alors l'écriture. La fonction 040 vérifie les droits
    // elle-même et écrit au-dessus de RLS.
    const { data, error } = await supabase.rpc('supprimer_logiquement', {
      p_table: 'jalons',
      p_id: a.id
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (data === false)
      setMessage({ type: 'erreur', texte: 'Action introuvable ou déjà supprimée.' })
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
                {a.responsable_membre_id && (
                  <span>
                    {membres.find((m) => m.id === a.responsable_membre_id)?.nom_affiche ??
                      'quelqu\u2019un'}
                  </span>
                )}
                {a.responsable && <span>{a.responsable}</span>}
                {a.critique && <span className="alerte-texte">critique</span>}
              </div>

              <PiecesJointes
                evenement={evenement}
                objetType="jalon"
                objetId={a.id}
                peutGerer={peutGerer}
                setMessage={setMessage}
              />

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

                  <select
                    value={a.responsable_membre_id ?? ''}
                    onChange={(e) =>
                      modifier(a.id, { responsable_membre_id: e.target.value || null })
                    }
                    style={{ width: 'auto', marginBottom: 0 }}
                    title="L'action apparaîtra dans « Mes missions » de cette personne"
                  >
                    <option value="">— personne —</option>
                    {membres.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nom_affiche ?? 'sans nom'}
                      </option>
                    ))}
                  </select>

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

                  <button className="discret" onClick={() => supprimer(a)}>
                    Supprimer
                  </button>
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
                <select
                  value={f.responsable_membre_id}
                  onChange={(e) => setF({ ...f, responsable_membre_id: e.target.value })}
                >
                  <option value="">Qui s'en charge ?</option>
                  {membres.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nom_affiche ?? 'sans nom'}
                    </option>
                  ))}
                </select>
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
                rejoint la frise du Planning. Attribuée à quelqu'un, elle apparaît dans son
                écran « Mes missions ».
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

/* ------------------------------------------------------------------ */

/** Le groupe a-t-il déjà son équipe ? Rapprochement par le nom. */
function equipeDe(groupe, equipes) {
  const n = groupe.nom.trim().toLowerCase()
  return equipes.find((e) => e.nom.trim().toLowerCase() === n)
}

/**
 * Un code d'équipe court, tiré du nom du groupe, libre dans
 * l'événement. `equipes.code` est unique par événement : sans contrôle
 * ici, « Bar » et « Barrières » se disputeraient BAR et la seconde
 * reprise échouerait sur une erreur de contrainte incompréhensible.
 */
function codeLibre(nom, equipes) {
  const base =
    nom
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6) || 'GRP'
  const pris = new Set(equipes.map((e) => e.code?.toUpperCase()))
  if (!pris.has(base)) return base
  for (let i = 2; i < 100; i++) {
    const essai = `${base.slice(0, 5)}${i}`
    if (!pris.has(essai)) return essai
  }
  return `${base.slice(0, 3)}${Date.now().toString().slice(-3)}`
}
