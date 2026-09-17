import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/**
 * Membres de l'événement, et leur rôle.
 *
 * Cet écran manquait : on pouvait ajouter quelqu'un avec un rôle, mais
 * jamais le corriger ensuite. Quelqu'un entré par le lien « bénévoles »
 * restait bénévole, sans recours dans l'application.
 *
 * À ne pas confondre avec « Comptes plateforme », qui désigne les
 * exploitants d'Eventware — un niveau au-dessus, sans rapport avec le
 * rôle tenu sur un événement.
 */
export default function Membres({ evenement, membre, setMessage, onRecharger }) {
  const [membres, setMembres] = useState(null)
  const [roles, setRoles] = useState([])

  async function charger() {
    const [m, r] = await Promise.all([
      supabase
        .from('membres_evenement')
        // Deux clés étrangères relient membres_evenement et equipes
        // (membres_evenement.equipe_id, et equipes.responsable_id en retour).
        // Sans le nom de la contrainte, PostgREST refuse l'embed (PGRST201).
        .select(
          '*, roles(id, code, libelle), equipes!membres_evenement_equipe_id_fkey(code, nom)'
        )
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .order('nom_affiche', { nullsFirst: false }),
      supabase
        .from('roles')
        .select('id, code, libelle')
        .eq('evenement_id', evenement.id)
        .order('libelle')
    ])
    if (m.error) setMessage({ type: 'erreur', texte: texteErreur(m.error) })
    else setMembres(m.data ?? [])
    setRoles(r.data ?? [])
  }

  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  const encadrants = (membres ?? []).filter(
    (m) => ['coordinateur', 'admin'].includes(m.role) && m.actif !== false
  )

  async function changerRole(m, roleId) {
    const choisi = roles.find((r) => r.id === roleId)
    if (!choisi) return

    // Garde-fou : un événement sans personne pour coordonner est un
    // événement que plus personne ne peut administrer — y compris pour
    // réparer l'erreur qu'on vient de faire.
    const perdEncadrement =
      ['coordinateur', 'admin'].includes(m.role) &&
      !['coordinateur', 'admin'].includes(choisi.code)
    if (perdEncadrement && encadrants.length <= 1) {
      setMessage({
        type: 'erreur',
        texte:
          "Impossible : ce serait le dernier coordinateur. Nomme d'abord quelqu'un d'autre."
      })
      return
    }

    const legacy = ['admin', 'coordinateur', 'chef_equipe', 'benevole', 'observateur'].includes(
      choisi.code
    )
      ? choisi.code
      : 'benevole'

    const { error, count } = await supabase
      .from('membres_evenement')
      .update({ role_id: choisi.id, role: legacy }, { count: 'exact' })
      .eq('id', m.id)

    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0)
      setMessage({ type: 'erreur', texte: 'Modification refusée : droits insuffisants.' })
    else {
      charger()
      // Si on vient de changer son propre rôle, l'application doit
      // recharger : ses écrans et ses droits en dépendent.
      if (m.user_id === membre.user_id) onRecharger?.()
    }
  }

  async function retirer(m) {
    // Deux garde-fous. Le dernier encadrant, sinon l'événement devient
    // inadministrable. Et soi-même, parce que c'est presque toujours une
    // fausse manœuvre et qu'aucun écran ne permet de revenir en arrière.
    if (m.user_id === membre.user_id) {
      setMessage({
        type: 'erreur',
        texte: "Tu ne peux pas te retirer toi-même — demande à un autre coordinateur."
      })
      return
    }
    if (['coordinateur', 'admin'].includes(m.role) && encadrants.length <= 1) {
      setMessage({
        type: 'erreur',
        texte: "Impossible : ce serait le dernier coordinateur."
      })
      return
    }
    if (!window.confirm(`Retirer ${m.nom_affiche ?? 'ce membre'} de l'événement ?`)) return

    const { error, count } = await supabase
      .from('membres_evenement')
      .update({ deleted_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', m.id)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0)
      setMessage({ type: 'erreur', texte: 'Retrait refusé : droits insuffisants.' })
    else charger()
  }

  if (membres === null) return <p className="vide">…</p>

  return (
    <section className="bloc">
      <h2>Membres ({membres.length})</h2>
      <p className="aide" style={{ marginTop: 0 }}>
        Le rôle détermine ce que la personne voit et peut faire. Il s'attribue ici — personne
        ne peut se l'accorder soi-même. Pour ajouter quelqu'un, passe par un lien
        d'invitation : plus besoin d'échanger des identifiants.
      </p>

      {membres.map((m) => {
        const moi = m.user_id === membre.user_id
        return (
          <div className={`carte ${m.actif === false ? '' : ''}`} key={m.id}>
            <div className="titre">
              {m.nom_affiche ?? <span className="alerte-texte">sans nom</span>}
              {moi && <span className="jeton"> toi</span>}
            </div>
            <div className="meta">
              <span className={`jeton ${m.role}`}>{m.roles?.libelle ?? m.role}</span>
              {m.equipes?.code && <span>{m.equipes.code}</span>}
              {m.perimetre && <span>{m.perimetre}</span>}
              {m.invite_le && <span>entré par invitation</span>}
            </div>

            <div className="ligne-boutons" style={{ marginTop: 8 }}>
              <select
                value={m.role_id ?? ''}
                onChange={(e) => changerRole(m, e.target.value)}
                style={{ width: 'auto', marginBottom: 0 }}
              >
                <option value="">— choisir un rôle —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.libelle}
                  </option>
                ))}
              </select>
              <button className="discret" onClick={() => retirer(m)}>
                Retirer
              </button>
            </div>
          </div>
        )
      })}

      {encadrants.length <= 1 && (
        <p className="aide alerte-texte">
          Un seul coordinateur sur cet événement. S'il perd son accès, plus personne ne peut
          administrer — mieux vaut en nommer un second.
        </p>
      )}
    </section>
  )
}
