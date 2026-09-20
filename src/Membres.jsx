import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'

/**
 * Les membres de l'événement — un seul écran pour une seule liste.
 *
 * Il y en avait deux : « Membres » dans Réglages (le rôle, le retrait)
 * et « Bénévoles » dans l'écran du même nom (l'équipe, le statut
 * chauffeur). Deux listes des mêmes personnes, gérées à deux endroits,
 * par les mêmes gens. La campagne du 20/09 a tranché : tout ce qui
 * concerne les personnes vit dans Bénévoles, Réglages ne garde que la
 * composition des rôles.
 *
 * Ce que chacun peut y faire suit la policy `membres_modification` et
 * le trigger `protege_attribution_membre` : le rôle, l'équipe et le
 * retrait sont réservés à `membres:modifier` ; le statut chauffeur et
 * le véhicule se renseignent aussi sur sa propre ligne. Le reste se
 * lit — un bénévole voit qui est dans quelle équipe, c'est fait pour.
 *
 * À ne pas confondre avec « Comptes plateforme », qui désigne les
 * exploitants d'Eventware — un niveau au-dessus, sans rapport avec le
 * rôle tenu sur un événement.
 */
export default function Membres({ evenement, membre, peut, toutPouvoir, setMessage, onRecharger }) {
  const [membres, setMembres] = useState(null)
  const [roles, setRoles] = useState([])
  const [equipes, setEquipes] = useState([])
  const [recherche, setRecherche] = useState('')

  const peutGerer = toutPouvoir || peut?.('membres', 'modifier')
  const estMoi = (m) => m.user_id === membre?.user_id

  async function charger() {
    const [m, r, e] = await Promise.all([
      supabase
        .from('membres_evenement')
        // L'équipe n'est pas embarquée ici : deux clés étrangères
        // relient membres_evenement et equipes (equipe_id, et
        // equipes.responsable_id en retour), PostgREST exigerait le nom
        // de la contrainte (PGRST201). La liste des équipes, chargée à
        // part, sert autant à l'affichage qu'au menu de rattachement.
        .select('*, roles(id, code, libelle)')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .order('nom_affiche', { nullsFirst: false }),
      supabase
        .from('roles')
        .select('id, code, libelle')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .order('libelle'),
      supabase
        .from('equipes')
        .select('id, code, nom')
        .eq('evenement_id', evenement.id)
        // Une équipe supprimée continuait d'apparaître dans le menu de
        // rattachement, et pouvait donc encore être attribuée.
        .is('deleted_at', null)
        .order('code')
    ])
    if (m.error) setMessage({ type: 'erreur', texte: texteErreur(m.error) })
    else setMembres(m.data ?? [])
    setRoles(r.data ?? [])
    setEquipes(e.data ?? [])
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

    const refus = await modifierOuRefuser(
      'membres_evenement',
      { role_id: choisi.id, role: legacy },
      { id: m.id }
    )
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else {
      charger()
      // Si on vient de changer son propre rôle, l'application doit
      // recharger : ses écrans et ses droits en dépendent.
      if (estMoi(m)) onRecharger?.()
    }
  }

  async function rattacher(m, equipeId) {
    const refus = await modifierOuRefuser(
      'membres_evenement',
      { equipe_id: equipeId || null },
      { id: m.id }
    )
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }

  async function basculerChauffeur(m) {
    const refus = await modifierOuRefuser(
      'membres_evenement',
      { est_chauffeur: !m.est_chauffeur },
      { id: m.id }
    )
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }

  async function majVehicule(m, type_vehicule) {
    const refus = await modifierOuRefuser('membres_evenement', { type_vehicule }, { id: m.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }

  async function retirer(m) {
    // Deux garde-fous. Le dernier encadrant, sinon l'événement devient
    // inadministrable. Et soi-même, parce que c'est presque toujours une
    // fausse manœuvre et qu'aucun écran ne permet de revenir en arrière.
    if (estMoi(m)) {
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

    // Pas un `update` direct sur `deleted_at` : la ligne sortirait du
    // champ de la policy de lecture et PostgreSQL refuserait l'écriture
    // — même cause que pour les jalons. La fonction 100 vérifie les
    // droits elle-même (ressource « membres ») et écrit au-dessus de RLS.
    // Depuis la 107, une personne retirée peut revenir : par un code
    // d'invitation, ou d'elle-même si elle est exploitant.
    const { data, error } = await supabase.rpc('supprimer_logiquement', {
      p_table: 'membres_evenement',
      p_id: m.id
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (data === false)
      setMessage({ type: 'erreur', texte: 'Membre introuvable ou déjà retiré.' })
    else charger()
  }

  if (membres === null) return <p className="vide">…</p>

  const q = recherche.trim().toLowerCase()
  const visibles = q
    ? membres.filter((m) =>
        [m.nom_affiche, m.perimetre, m.role, m.roles?.libelle, m.telephone,
         equipes.find((eq) => eq.id === m.equipe_id)?.code]
          .filter(Boolean)
          .some((x) => x.toLowerCase().includes(q))
      )
    : membres

  const equipeDe = (m) => equipes.find((eq) => eq.id === m.equipe_id)

  return (
    <section className="bloc">
      <h2>Membres ({membres.length})</h2>
      {peutGerer && (
        <p className="aide" style={{ marginTop: 0 }}>
          Le rôle détermine ce que la personne voit et peut faire. Il s'attribue ici — personne
          ne peut se l'accorder soi-même. L'équipe de rattachement décide des missions qui lui
          arrivent dans « Mes missions ». Pour ajouter quelqu'un, passe par l'onglet
          Invitations : plus besoin d'échanger des identifiants.
        </p>
      )}

      <div className="compteurs">
        <span>
          Actifs <strong>{membres.filter((m) => m.actif).length}</strong>
        </span>
        <span>
          Chauffeurs <strong>{membres.filter((m) => m.est_chauffeur).length}</strong>
        </span>
        <span>
          Sans équipe <strong>{membres.filter((m) => !m.equipe_id).length}</strong>
        </span>
      </div>

      <input
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        placeholder="Rechercher une personne, un rôle, une équipe…"
      />

      {visibles.length === 0 && (
        <p className="vide">Aucun membre ne correspond à « {recherche} ».</p>
      )}

      {visibles.map((m) => {
        const moi = estMoi(m)
        const peutLigne = peutGerer || moi
        return (
          <div className="carte" key={m.id}>
            <div className="titre">
              {m.nom_affiche ?? <span className="alerte-texte">sans nom</span>}
              {moi && <span className="jeton"> toi</span>}
            </div>
            <div className="meta">
              <span className={`jeton ${m.role}`}>{m.roles?.libelle ?? m.role}</span>
              {/* Sans droit d'écriture, l'équipe et le véhicule restent
                  lisibles — ils ne s'affichaient que dans les commandes. */}
              {!peutGerer && equipeDe(m) && <span>{equipeDe(m).code}</span>}
              {!peutLigne && m.est_chauffeur && (
                <span>chauffeur{m.type_vehicule ? ` · ${m.type_vehicule}` : ''}</span>
              )}
              {m.perimetre && <span>{m.perimetre}</span>}
              {m.telephone && <span className="mono">{m.telephone}</span>}
              {m.invite_le && <span>entré par invitation</span>}
              {!m.actif && <span className="alerte-texte">inactif</span>}
            </div>

            {peutGerer && (
              <div className="ligne-boutons" style={{ marginTop: 8 }}>
                <select
                  value={m.role_id ?? ''}
                  onChange={(e) => changerRole(m, e.target.value)}
                  style={{ width: 'auto', marginBottom: 0 }}
                  aria-label="Rôle"
                >
                  <option value="">— choisir un rôle —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.libelle}
                    </option>
                  ))}
                </select>
                <select
                  value={m.equipe_id ?? ''}
                  onChange={(e) => rattacher(m, e.target.value)}
                  style={{ width: 'auto', marginBottom: 0 }}
                  aria-label="Équipe"
                >
                  <option value="">— sans équipe —</option>
                  {equipes.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.code} · {eq.nom}
                    </option>
                  ))}
                </select>
                <button className="discret" onClick={() => retirer(m)}>
                  Retirer
                </button>
              </div>
            )}

            {peutLigne && (
              <div className="ligne-boutons" style={{ marginTop: 8 }}>
                <button
                  className={`module ${m.est_chauffeur ? 'actif' : ''}`}
                  onClick={() => basculerChauffeur(m)}
                >
                  {m.est_chauffeur ? 'Chauffeur ✓' : 'Marquer chauffeur'}
                </button>
                {m.est_chauffeur && (
                  <input
                    defaultValue={m.type_vehicule ?? ''}
                    placeholder="Véhicule habituel — utilitaire, 7 places…"
                    onBlur={(e) => majVehicule(m, e.target.value || null)}
                    style={{ marginBottom: 0 }}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}

      {peutGerer && encadrants.length <= 1 && (
        <p className="aide alerte-texte">
          Un seul coordinateur sur cet événement. S'il perd son accès, plus personne ne peut
          administrer — mieux vaut en nommer un second.
        </p>
      )}

      <p className="aide">
        « Chauffeur » n'est pas un rôle : c'est une catégorie en plus, qui rend la personne
        disponible pour une attribution dans Logistique → Transports, et lui permet de prendre
        un transport depuis « Mes missions ». Elle garde ses capacités habituelles.
      </p>
    </section>
  )
}
