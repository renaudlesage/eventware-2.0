import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { PAVES, pavesDisponibles, pavesObligatoires, composition } from './paves'
import { libelleStatut } from './libelles'
import { etatDe } from './Securite'
import { ColonneDomaine } from './Situation'
import Terrain from './Terrain'
import { MesCreneaux } from './Rh'
import { GestionAlertes } from './Bandeau'

/**
 * Mon poste — la position d'une seule personne, dans le même langage
 * visuel que la Situation : des blocs thématiques uniformes, un
 * compteur en tête quand il dit quelque chose, un moniteur qui défile
 * quand la liste dépasse.
 *
 * Toute la page est personnalisable. Il n'y a plus de bandeau de pavés
 * d'un côté et de sections figées de l'autre : Mes missions, Mes
 * créneaux, Alertes et Mon compte sont des blocs comme les autres,
 * réordonnables ou masquables — sauf ceux qu'un rôle impose.
 */
export default function Dashboard({
  evenement, membre, session, peut, toutPouvoir, onFait, onAller, setMessage
}) {
  const [reglage, setReglage] = useState(false)
  const [choix, setChoix] = useState(membre.paves ?? null)

  const modules = evenement.modules ?? {}
  const role = membre.role
  const obligatoires = pavesObligatoires(role, modules, peut)
  const disponibles = pavesDisponibles(modules, peut)
  const actifs = composition(role, modules, choix, peut)

  async function enregistrer(nouveau) {
    setChoix(nouveau)
    const { error } = await supabase
      .from('membres_evenement')
      .update({ paves: nouveau })
      .eq('id', membre.id)
    if (!error) onFait?.()
  }

  function basculer(clef) {
    if (obligatoires.includes(clef)) return
    const nouveau = actifs.includes(clef)
      ? actifs.filter((k) => k !== clef)
      : [...actifs, clef]
    enregistrer(nouveau)
  }

  const props = { evenement, membre, session, peut, toutPouvoir, onAller, setMessage }

  return (
    <div className="dashboard dom-violet">
      <div className="entete-dashboard">
        <h2>Mon poste</h2>
        <button className="lien" onClick={() => setReglage(!reglage)}>
          {reglage ? 'Terminé' : 'Personnaliser'}
        </button>
      </div>

      {reglage && (
        <div className="reglage-paves">
          {disponibles.map((k) => {
            const fige = obligatoires.includes(k)
            return (
              <button
                key={k}
                className={`module ${actifs.includes(k) ? 'actif' : ''}`}
                disabled={fige}
                title={fige ? 'Imposé par votre rôle' : undefined}
                onClick={() => basculer(k)}
              >
                {PAVES[k].libelle}
                {fige && ' ·'}
              </button>
            )
          })}
          <p className="aide">
            Les blocs marqués d'un point sont imposés par votre rôle et ne peuvent pas être
            retirés. Les autres sont libres.
          </p>
        </div>
      )}

      <div className="grille-domaines grille-poste">
        {actifs.map((k) => (
          <Contenu key={k} clef={k} {...props} />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Un bloc du tableau de bord = une ColonneDomaine de la Situation,
 * réutilisée telle quelle, habillée par les métadonnées du catalogue.
 */
function Bloc({ clef, compteurs = [], onAller, children }) {
  const p = PAVES[clef]
  const lien = p.lien
  return (
    <ColonneDomaine
      teinte={p.teinte}
      icone={p.icone}
      titre={p.libelle}
      lien={lien}
      onAller={
        lien
          ? () => (Array.isArray(lien) ? onAller?.(...lien) : onAller?.(lien))
          : undefined
      }
      compteurs={compteurs}
    >
      {children}
    </ColonneDomaine>
  )
}

function Contenu({ clef, ...p }) {
  switch (clef) {
    case 'identite':
      return <PaveIdentite {...p} />
    case 'mes_missions':
      return <PaveMesMissions {...p} />
    case 'mes_demandes':
      return <PaveMesDemandes {...p} />
    case 'mes_creneaux':
      return <PaveMesCreneaux {...p} />
    case 'alertes':
      return <PaveAlertes {...p} />
    case 'sos':
      return <PaveSos {...p} />
    case 'planning':
      return <PavePlanning {...p} />
    case 'contacts':
      return <PaveListe clef="contacts" table="contacts" champ="nom" second="telephone" {...p} />
    case 'equipes':
      return <PaveListe clef="equipes" table="equipes" champ="nom" second="code" {...p} />
    case 'lieux':
      return <PaveListe clef="lieux" table="lieux" champ="nom" second="type" {...p} />
    case 'materiel':
      return <PaveMateriel {...p} />
    case 'compte':
      return <PaveCompte {...p} />
    default:
      return null
  }
}

/* --- Blocs ---------------------------------------------------------- */

function PaveIdentite({ evenement, membre, onAller }) {
  return (
    <Bloc clef="identite" onAller={onAller}>
      <div className="grand">{membre.nom_affiche ?? '—'}</div>
      <div className="meta">
        <span className={`jeton ${membre.role}`}>{membre.role}</span>
        <span className="jeton phase">{evenement.phase}</span>
        {membre.perimetre && <span>{membre.perimetre}</span>}
      </div>
    </Bloc>
  )
}

function PaveMesMissions({ evenement, membre, onAller }) {
  const [c, setC] = useState({ aFaire: null, pourMoi: null, p1: null })
  return (
    <Bloc
      clef="mes_missions"
      onAller={onAller}
      compteurs={[
        { libelle: 'à faire', valeur: c.aFaire, etat: c.aFaire ? 'attente' : 'ok' },
        { libelle: 'pour moi', valeur: c.pourMoi, etat: c.pourMoi ? 'cours' : 'ok' },
        { libelle: 'P1', valeur: c.p1, etat: c.p1 ? 'urgent' : 'ok' }
      ]}
    >
      <Terrain evenement={evenement} membre={membre} embarque onCompteurs={setC} />
    </Bloc>
  )
}

function PaveMesCreneaux({ evenement, membre, setMessage, onAller }) {
  const [c, setC] = useState({ aConfirmer: null, confirmes: null })
  return (
    <Bloc
      clef="mes_creneaux"
      onAller={onAller}
      compteurs={[
        { libelle: 'à confirmer', valeur: c.aConfirmer, etat: c.aConfirmer ? 'attente' : 'ok' },
        { libelle: 'confirmés', valeur: c.confirmes, etat: 'ok' }
      ]}
    >
      <MesCreneaux evenement={evenement} membre={membre} setMessage={setMessage} onCompteurs={setC} />
    </Bloc>
  )
}

function PaveAlertes({ evenement, setMessage, onAller }) {
  const [c, setC] = useState({ actives: null })
  return (
    <Bloc
      clef="alertes"
      onAller={onAller}
      compteurs={[{ libelle: 'actives', valeur: c.actives, etat: c.actives ? 'urgent' : 'ok' }]}
    >
      <GestionAlertes evenement={evenement} setMessage={setMessage} embarque onCompteurs={setC} />
    </Bloc>
  )
}

function PaveCompte({ session, onAller }) {
  return (
    <Bloc clef="compte" onAller={onAller}>
      <p className="aide" style={{ marginTop: 0 }}>Connecté en tant que {session.user.email}.</p>
      <div className="identite">
        <span className="etiquette">Mon identifiant</span>
        <code>{session.user.id}</code>
      </div>
      <button className="discret" onClick={() => supabase.auth.signOut()}>
        Se déconnecter
      </button>
    </Bloc>
  )
}

function PaveSos({ evenement, onAller }) {
  const [n, setN] = useState(null)

  useEffect(() => {
    let vivant = true
    async function charger() {
      const { count } = await supabase
        .from('signalements')
        .select('id', { count: 'exact', head: true })
        .eq('evenement_id', evenement.id)
        .in('statut', ['recu', 'pris_en_charge', 'en_cours'])
      if (vivant) setN(count ?? 0)
    }
    charger()
    const t = setInterval(charger, 15000)
    return () => {
      vivant = false
      clearInterval(t)
    }
  }, [evenement.id])

  return (
    <Bloc
      clef="sos"
      onAller={onAller}
      compteurs={[{ libelle: 'ouverts', valeur: n, etat: n ? 'urgent' : 'ok' }]}
    >
      <p className={n ? 'moniteur-vide' : 'moniteur-vide'}>
        {n === null ? '…' : n === 0 ? 'Aucun signalement ouvert.' : 'En attente de traitement — ouvrir l\u2019app.'}
      </p>
    </Bloc>
  )
}

function PaveListe({ clef, evenement, table, champ, second, onAller }) {
  const [lignes, setLignes] = useState(null)

  useEffect(() => {
    let vivant = true
    supabase
      .from(table)
      .select('*')
      .eq('evenement_id', evenement.id)
      .limit(8)
      .then(({ data }) => vivant && setLignes(data ?? []))
    return () => {
      vivant = false
    }
  }, [evenement.id, table])

  return (
    <Bloc
      clef={clef}
      onAller={onAller}
      compteurs={[{ libelle: 'encodés', valeur: lignes?.length ?? null, etat: 'ok' }]}
    >
      {lignes === null ? (
        <p className="moniteur-vide">…</p>
      ) : !lignes.length ? (
        <p className="moniteur-vide">Rien d'encodé.</p>
      ) : (
        lignes.map((l) => (
          <div className="moniteur-ligne" key={l.id}>
            <strong>{l[champ]}</strong>
            {l[second] && <span className="mono">{l[second]}</span>}
          </div>
        ))
      )}
    </Bloc>
  )
}

// Module → écran, pour router chaque demande vers le bon endroit —
// une demande sécurité et une demande logistique ne mènent pas au
// même écran.
const ECRAN_PAR_MODULE = {
  securite: 'securite',
  logistique: 'logistique',
  rh: 'rh',
  parcours: 'parcours'
}

function PaveMesDemandes({ evenement, membre, onAller }) {
  const [demandes, setDemandes] = useState(null)

  useEffect(() => {
    let vivant = true
    supabase
      .from('missions')
      .select('id, reference, titre, statut, module, priorite')
      .eq('evenement_id', evenement.id)
      .eq('created_by', membre.user_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => {
        if (vivant) setDemandes(data ?? [])
      })
    return () => {
      vivant = false
    }
  }, [evenement.id, membre.user_id])

  const enCours = demandes?.filter((d) => !['resolue', 'annulee'].includes(d.statut)).length ?? null

  return (
    <Bloc
      clef="mes_demandes"
      onAller={onAller}
      compteurs={[
        { libelle: 'en cours', valeur: enCours, etat: enCours ? 'cours' : 'ok' },
        { libelle: 'au total', valeur: demandes?.length ?? null, etat: 'ok' }
      ]}
    >
      {demandes === null ? (
        <p className="moniteur-vide">…</p>
      ) : demandes.length === 0 ? (
        <p className="moniteur-vide">Aucune demande envoyée pour l'instant.</p>
      ) : (
        demandes.map((d) => {
          const ecran = ECRAN_PAR_MODULE[d.module]
          const ligne = (
            <>
              <strong>
                <span className={`point-etat point-${etatDe(d)}`} /> {d.titre}
              </strong>
              <span>
                {libelleStatut(d.statut)} <span className="mono">· {d.reference}</span>
              </span>
            </>
          )
          return ecran ? (
            <button
              className="moniteur-ligne pave-lien-ligne"
              key={d.id}
              onClick={() => onAller?.(ecran)}
            >
              {ligne}
            </button>
          ) : (
            <div className="moniteur-ligne" key={d.id}>
              {ligne}
            </div>
          )
        })
      )}
    </Bloc>
  )
}

/**
 * Bloc Planning : ce qui est en direct, et le prochain à venir.
 *
 * Même logique de fusion que l'écran Planning (programme + jalons +
 * transports datés) et le même calcul de "en cours" — les deux doivent
 * dire la même chose, sinon le bloc contredirait l'écran qu'il ouvre.
 */
function PavePlanning({ evenement, onAller }) {
  const [items, setItems] = useState(null)

  useEffect(() => {
    let vivant = true

    async function charger() {
      const debutFenetre = new Date(Date.now() - 6 * 3600000).toISOString()

      const [p, j, t] = await Promise.all([
        supabase
          .from('programme')
          .select('titre, categorie, intervenant, debut, lieu_libre, lieux:lieu_id(nom)')
          .eq('evenement_id', evenement.id)
          .is('deleted_at', null)
          .gte('debut', debutFenetre),
        supabase
          .from('jalons')
          .select('libelle, echeance, critique, responsable')
          .eq('evenement_id', evenement.id)
          .is('deleted_at', null)
          .gte('echeance', debutFenetre),
        supabase
          .from('transports')
          .select('depart_libre, arrivee_libre, souhaite_pour')
          .eq('evenement_id', evenement.id)
          .is('deleted_at', null)
          .not('souhaite_pour', 'is', null)
          .not('statut', 'in', '("annulee")')
          .gte('souhaite_pour', debutFenetre)
      ])

      const tout = [
        ...(p.data ?? []).map((x) => ({
          heure: new Date(x.debut),
          titre: x.titre,
          detail: [x.intervenant, x.lieux?.nom ?? x.lieu_libre].filter(Boolean).join(' · ')
        })),
        ...(j.data ?? []).map((x) => ({
          heure: new Date(x.echeance),
          titre: x.libelle,
          detail: x.responsable,
          critique: x.critique
        })),
        ...(t.data ?? []).map((x) => ({
          heure: new Date(x.souhaite_pour),
          titre: `${x.depart_libre ?? 'Départ'} → ${x.arrivee_libre ?? 'Arrivée'}`
        }))
      ].sort((a, b) => a.heure - b.heure)

      if (vivant) setItems(tout)
    }

    charger()
    const t = setInterval(charger, 60000)
    return () => {
      vivant = false
      clearInterval(t)
    }
  }, [evenement.id])

  const maintenant = Date.now()
  const aVenir = items?.filter((i) => i.heure.getTime() > maintenant) ?? []
  const heure = (d) => d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })

  return (
    <Bloc
      clef="planning"
      onAller={onAller}
      compteurs={[{ libelle: 'à venir', valeur: items ? aVenir.length : null, etat: 'ok' }]}
    >
      {items === null ? (
        <p className="moniteur-vide">…</p>
      ) : !items.length ? (
        <p className="moniteur-vide">Rien de planifié.</p>
      ) : (
        items.slice(0, 8).map((i, idx) => {
          const passe = i.heure.getTime() <= maintenant
          return (
            <div className={`moniteur-ligne ${i.critique ? 'urgent' : ''}`} key={idx}>
              <strong style={passe ? { opacity: 0.6 } : undefined}>
                <span className="mono">{heure(i.heure)}</span> {i.titre}
              </strong>
              {i.detail && <span>{i.detail}</span>}
            </div>
          )
        })
      )}
    </Bloc>
  )
}

function PaveMateriel({ evenement, onAller }) {
  const [lignes, setLignes] = useState(null)

  useEffect(() => {
    let vivant = true
    supabase
      .from('materiel')
      .select('*')
      .eq('evenement_id', evenement.id)
      .not('seuil_alerte', 'is', null)
      .then(({ data }) => {
        const sous = (data ?? []).filter((m) => Number(m.quantite) <= Number(m.seuil_alerte))
        if (vivant) setLignes(sous)
      })
    return () => {
      vivant = false
    }
  }, [evenement.id])

  return (
    <Bloc
      clef="materiel"
      onAller={onAller}
      compteurs={[{ libelle: 'sous seuil', valeur: lignes?.length ?? null, etat: lignes?.length ? 'urgent' : 'ok' }]}
    >
      {lignes === null ? (
        <p className="moniteur-vide">…</p>
      ) : !lignes.length ? (
        <p className="moniteur-vide">Aucun seuil franchi.</p>
      ) : (
        lignes.map((m) => (
          <div className="moniteur-ligne urgent" key={m.id}>
            <strong>{m.nom}</strong>
            <span className="mono">
              {m.quantite} {m.unite ?? ''} · seuil {m.seuil_alerte}
            </span>
          </div>
        ))
      )}
    </Bloc>
  )
}
