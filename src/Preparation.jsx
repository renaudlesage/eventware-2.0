import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import PiecesJointes from './PiecesJointes'
import VisibiliteJalon from './VisibiliteJalon'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'

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
 * Deux natures de lignes, une seule table (`jalons`) :
 *
 *   JALON  — une échéance de l'événement lui-même : dépôt du dossier à
 *            la commune, ouverture du site, réunion de coordination.
 *            Il n'appartient à aucun groupe (`groupe_travail_id` nul),
 *            il a toujours une date, et c'est lui qui structure la
 *            frise du Planning.
 *   ACTION — ce qu'un groupe de travail a à faire pour y arriver.
 *            Elle vit dans son groupe, avec ou sans date ; datée, elle
 *            rejoint la frise ; confiée à quelqu'un, elle arrive dans
 *            son écran « Mes missions ».
 *
 * La campagne du 20/09 a corrigé une erreur de lecture : l'écran
 * traitait tout jalon sans groupe comme une action orpheline « que
 * personne ne porte ». Un jalon n'a pas à être porté par un groupe —
 * il est porté par l'événement. Le rattachement à un groupe reste
 * possible, mais c'est une transformation choisie (le jalon devient
 * une action du groupe), pas une anomalie à résorber.
 */
export default function Preparation({ evenement, membre, peut, toutPouvoir, setMessage }) {
  const [groupes, setGroupes] = useState(null)
  const [lignes, setLignes] = useState([])
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
        .select('id, nom_affiche, role, equipe_id')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .order('nom_affiche', { nullsFirst: false }),
      supabase
        .from('equipes')
        .select('id, code, nom, groupe_travail_id')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
    ])
    if (g.error) setMessage({ type: 'erreur', texte: texteErreur(g.error) })
    else setGroupes(g.data ?? [])
    setLignes(a.data ?? [])
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
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
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
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else charger()
  }

  /**
   * Reprendre un groupe de travail comme équipe opérationnelle.
   *
   * Pourquoi cette bascule existe : le groupe porte la préparation,
   * l'équipe porte le terrain — mais dans la plupart des cas ce sont
   * les mêmes périmètres et les mêmes personnes. Celui qui a préparé
   * le bar tient le bar. Recopier neuf noms dans un second écran est
   * une corvée dont on sort avec des libellés qui divergent.
   *
   * Ce que la fonction serveur (107) fait, en une fois : l'équipe,
   * liée au groupe et portant son nom (qui suivra ses renommages, 094) ;
   * le pilote du groupe en responsable d'équipe ; les membres du groupe
   * affectés à l'équipe — sauf ceux qui en ont déjà une autre, comptés
   * et rendus ; une ligne au journal. Le groupe, lui, continue de vivre
   * ici avec ses actions : la bascule ajoute, elle ne remplace pas.
   */
  async function reprendreCommeEquipe(g) {
    const siens = compositions.filter((c) => c.groupe_id === g.id).length
    const ok = window.confirm(
      `Reprendre « ${g.nom} » comme équipe opérationnelle ?\n\n` +
        `Une équipe du même nom est créée pour le terrain (missions, créneaux, radio). ` +
        `Ses ${siens} membre(s) y sont affectés — sauf ceux qui ont déjà une autre équipe — ` +
        `et le pilote en devient responsable. Le groupe reste ici avec ses actions.`
    )
    if (!ok) return
    const { data, error } = await supabase.rpc('reprendre_groupe_comme_equipe', {
      p_groupe: g.id
    })
    if (error) {
      setMessage({ type: 'erreur', texte: texteErreur(error) })
      return
    }
    const deja = data?.deja_en_equipe ? ` ; ${data.deja_en_equipe} déjà dans une autre équipe, non déplacé(s)` : ''
    setMessage({
      type: 'succes',
      texte: data?.existait
        ? `« ${g.nom} » avait déjà son équipe (${data.code}).`
        : `Équipe ${data?.code} « ${g.nom} » créée — ${data?.membres_affectes ?? 0} membre(s) affecté(s)${deja}. Les affectations se retouchent dans Bénévoles › Membres.`
    })
    charger()
  }

  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  if (groupes === null) return <p className="vide">…</p>

  const jalons = lignes.filter((a) => !a.groupe_travail_id)

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
        Les jalons sont les échéances de l'événement ; les groupes de travail portent les
        actions qui y mènent. Tout ce qui a une date se retrouve dans la frise du Planning.
      </p>

      {/* ---- Jalons de l'événement ---- */}
      <div className="pave-titre">Jalons de l'événement ({jalons.length})</div>
      <Lignes
        nature="jalon"
        evenement={evenement}
        groupe={null}
        lignes={jalons}
        membres={membres}
        peutGerer={peutGerer}
        toutPouvoir={toutPouvoir}
        groupes={groupes}
        setMessage={setMessage}
        onFait={charger}
      />

      {/* ---- Groupes de travail ---- */}
      <div className="pave-titre" style={{ marginTop: 18 }}>
        Groupes de travail ({groupes.length})
      </div>

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
        const siennes = lignes.filter((a) => a.groupe_travail_id === g.id)
        const faites = siennes.filter((a) => a.statut === 'fait').length
        const enRetard = siennes.filter(
          (a) => a.echeance && a.statut === 'a_venir' && new Date(a.echeance) < new Date()
        ).length

        const siens = compositions
          .filter((c) => c.groupe_id === g.id)
          .map((c) => membres.find((m) => m.id === c.membre_id))
          .filter(Boolean)
        const dispo = membres.filter((m) => !siens.some((x) => x.id === m.id))
        const equipe = equipeDe(g, equipes)
        const affectes = equipe ? membres.filter((m) => m.equipe_id === equipe.id).length : 0

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
              {equipe && (
                <span>
                  équipe {equipe.code} · {affectes} affecté(s)
                </span>
              )}
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
              {!equipe && peutEquipes && (
                <button
                  className="discret"
                  onClick={() => reprendreCommeEquipe(g)}
                  title="Créer l'équipe opérationnelle correspondante et y affecter les membres du groupe"
                >
                  Reprendre comme équipe
                </button>
              )}
            </div>

            {ouvert === g.id && (
              <Lignes
                nature="action"
                evenement={evenement}
                groupe={g}
                lignes={siennes}
                membres={membres}
                peutGerer={peutGerer}
                toutPouvoir={toutPouvoir}
                groupes={groupes}
                setMessage={setMessage}
                onFait={charger}
              />
            )}
          </div>
        )
      })}

      {peutEquipes && groupes.some((g) => !equipeDe(g, equipes)) && (
        <p className="aide">
          « Reprendre comme équipe » : le groupe prépare, l'équipe tient le terrain. La bascule
          crée l'équipe du même nom, y affecte les membres du groupe et en confie la
          responsabilité au pilote — sans rien ressaisir. Le nom de l'équipe suivra celui du
          groupe.
        </p>
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

/**
 * Une liste de jalons (groupe nul) ou d'actions (dans un groupe). Même
 * carte, même commandes ; ce qui change : un jalon exige une échéance,
 * une action non ; et le rattachement à un groupe se lit dans les deux
 * sens — un jalon peut devenir l'action d'un groupe, une action peut
 * changer de groupe ou en sortir et redevenir un jalon.
 */
function Lignes({ nature, evenement, groupe, lignes, membres, peutGerer, toutPouvoir, groupes, setMessage, onFait }) {
  const [ouvrir, setOuvrir] = useState(false)
  const [f, setF] = useState({ code: '', libelle: '', echeance: '', responsable_membre_id: '', critique: false })

  const estJalon = nature === 'jalon'

  async function creer() {
    if (!f.code.trim() || !f.libelle.trim()) return
    if (estJalon && !f.echeance) return
    const { error } = await supabase.from('jalons').insert({
      evenement_id: evenement.id,
      code: f.code.trim(),
      libelle: f.libelle.trim(),
      // Facultative pour une action — c'est tout l'intérêt en
      // préparation. Obligatoire pour un jalon : sans date, ce n'est
      // pas une échéance.
      echeance: f.echeance ? new Date(f.echeance).toISOString() : null,
      responsable_membre_id: f.responsable_membre_id || null,
      critique: estJalon ? f.critique : false,
      groupe_travail_id: groupe?.id ?? null
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setF({ code: '', libelle: '', echeance: '', responsable_membre_id: '', critique: false })
      setOuvrir(false)
      onFait()
    }
  }

  async function modifier(id, champs) {
    const refus = await modifierOuRefuser('jalons', champs, { id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
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
      `Supprimer ${estJalon ? 'le jalon' : "l'action"} « ${a.libelle} » ?\n\n` +
        'Pour garder la trace de quelque chose d’abandonné, le statut ' +
        '« Annulé » est plus juste : la ligne reste lisible.'
    )
    if (!ok) return

    // Pas un `update` direct : poser `deleted_at` rend la ligne
    // invisible au regard de la policy de lecture, et PostgreSQL
    // refuse alors l'écriture. La fonction 091 vérifie les droits
    // elle-même et écrit au-dessus de RLS.
    const { data, error } = await supabase.rpc('supprimer_logiquement', {
      p_table: 'jalons',
      p_id: a.id
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (data === false)
      setMessage({ type: 'erreur', texte: 'Ligne introuvable ou déjà supprimée.' })
    else onFait()
  }

  return (
    <div style={{ marginTop: 8 }}>
      {lignes.length === 0 ? (
        <p className="aide">
          {estJalon
            ? "Aucun jalon. Les dates qui comptent — dossier à la commune, ouverture du site, réunion de coordination — se posent ici."
            : 'Aucune action.'}
        </p>
      ) : (
        lignes.map((a) => {
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
                <span>{STATUTS.find(([v]) => v === a.statut)?.[1] ?? a.statut}</span>
                {a.responsable_membre_id && (
                  <span>
                    {membres.find((m) => m.id === a.responsable_membre_id)?.nom_affiche ??
                      'quelqu’un'}
                  </span>
                )}
                {a.responsable && <span>{a.responsable}</span>}
                {a.visibilite === 'public' && <span>public : {a.libelle_public}</span>}
                {a.visibilite === 'coordination' && <span>coordination</span>}
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
                    title="La ligne apparaîtra dans « Mes missions » de cette personne"
                  >
                    <option value="">— personne —</option>
                    {membres.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nom_affiche ?? 'sans nom'}
                      </option>
                    ))}
                  </select>

                  {/* Le rattachement change la nature de la ligne : un
                      jalon confié à un groupe devient une de ses
                      actions ; une action sortie de son groupe
                      redevient un jalon de l'événement. */}
                  {groupes.length > 0 && (
                    <select
                      value={a.groupe_travail_id ?? ''}
                      onChange={(e) =>
                        modifier(a.id, { groupe_travail_id: e.target.value || null })
                      }
                      style={{ width: 'auto', marginBottom: 0 }}
                      title={estJalon ? 'Confier ce jalon à un groupe : il devient une de ses actions' : 'Changer de groupe, ou en sortir : la ligne redevient un jalon'}
                    >
                      <option value="">{estJalon ? '— confier à un groupe —' : '— hors groupe (jalon) —'}</option>
                      {groupes.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.nom}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Qui voit cette ligne. En préparation, la plupart
                      restent internes : c'est ici qu'on décide des
                      rares qui intéressent le public. */}
                  <VisibiliteJalon
                    jalon={a}
                    toutPouvoir={toutPouvoir}
                    modifier={(champs) => modifier(a.id, champs)}
                  />

                  <button className="discret" onClick={() => supprimer(a)}>
                    Supprimer
                  </button>
                </div>
              )}
            </div>
          )
        })
      )}

      {peutGerer && (
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
                  placeholder={estJalon ? "L'échéance — ex. Dépôt du dossier à la commune" : "Ce qu'il y a à faire"}
                  autoFocus
                />
              </div>
              <div className="saisie-rapide">
                <select
                  value={f.responsable_membre_id}
                  onChange={(e) => setF({ ...f, responsable_membre_id: e.target.value })}
                >
                  <option value="">{estJalon ? 'Qui en répond ? (facultatif)' : "Qui s'en charge ?"}</option>
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
                  aria-label="Échéance"
                />
                {estJalon && (
                  <label className="case-confirme" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={f.critique}
                      onChange={(e) => setF({ ...f, critique: e.target.checked })}
                    />
                    <span>critique</span>
                  </label>
                )}
                <button
                  disabled={!f.code.trim() || !f.libelle.trim() || (estJalon && !f.echeance)}
                  onClick={creer}
                >
                  Ajouter
                </button>
              </div>
              <p className="aide">
                {estJalon
                  ? "Un jalon a toujours une date : c'est elle qui compte. Il apparaît dans la frise du Planning ; confié à quelqu'un, dans son écran « Mes missions »."
                  : "L'échéance est facultative. Sans elle, l'action reste ici ; avec elle, elle rejoint la frise du Planning. Attribuée à quelqu'un, elle apparaît dans son écran « Mes missions »."}
              </p>
            </div>
          ) : (
            <div className="ligne-boutons" style={{ marginTop: 8 }}>
              <button className="discret" onClick={() => setOuvrir(true)}>
                {estJalon ? '+ Jalon' : '+ Action'}
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
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
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

/**
 * Le groupe a-t-il déjà son équipe ? Par la liaison depuis la 094 — le
 * rapprochement par le nom se cassait au premier renommage et laissait
 * réapparaître le bouton « Reprendre », prêt à créer un doublon.
 */
function equipeDe(groupe, equipes) {
  return equipes.find((e) => e.groupe_travail_id === groupe.id)
}
