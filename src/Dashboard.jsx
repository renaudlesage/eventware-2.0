import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { PAVES, pavesDisponibles, pavesObligatoires, composition } from './paves'

export default function Dashboard({ evenement, membre, peut, onFait, onAller }) {
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

  return (
    <div className="dashboard dom-violet">
      <div className="entete-dashboard">
        <h2>Mon tableau de bord</h2>
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
            Les pavés marqués d'un point sont imposés par votre rôle et ne peuvent pas être
            retirés. Les autres sont libres.
          </p>
        </div>
      )}

      <div className="grille-paves">
        {actifs.map((k) => (
          <Pave key={k} clef={k} evenement={evenement} membre={membre} onAller={onAller} />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/* Chaque pavé mène à l'écran où on peut agir sur ce qu'il montre.
   « identite » n'a pas de destination naturelle — c'est une carte de
   visite, pas un compteur — donc reste seul non cliquable. */
const DESTINATIONS = {
  planning: 'planning',
  sos: ['securite', 'signalements'],
  lieux: 'plan',
  contacts: 'memento',
  materiel: 'logistique',
  equipes: 'rh'
}

function Pave({ clef, evenement, membre, onAller }) {
  const cliquable = clef in DESTINATIONS
  const contenu = (
    <>
      <div className="pave-titre">{PAVES[clef].libelle}</div>
      <Contenu clef={clef} evenement={evenement} membre={membre} onAller={onAller} />
    </>
  )
  if (cliquable) {
    const cible = DESTINATIONS[clef]
    return (
      <button
        className="pave pave-lien"
        onClick={() => (Array.isArray(cible) ? onAller?.(...cible) : onAller?.(cible))}
      >
        {contenu}
      </button>
    )
  }
  return <div className="pave">{contenu}</div>
}

function Contenu({ clef, evenement, membre, onAller }) {
  switch (clef) {
    case 'identite':
      return <PaveIdentite evenement={evenement} membre={membre} />
    case 'sos':
      return <PaveSos evenement={evenement} />
    case 'lieux':
      return <PaveListe evenement={evenement} table="lieux" champ="nom" second="type" />
    case 'contacts':
      return (
        <PaveListe evenement={evenement} table="contacts" champ="nom" second="telephone" />
      )
    case 'equipes':
      return <PaveListe evenement={evenement} table="equipes" champ="nom" second="code" />
    case 'materiel':
      return <PaveMateriel evenement={evenement} />
    case 'planning':
      return <PavePlanning evenement={evenement} onAller={onAller} />
    default:
      return null
  }
}

/* --- Pavés --- */

function PaveIdentite({ evenement, membre }) {
  return (
    <>
      <div className="grand">{membre.nom_affiche ?? '—'}</div>
      <div className="meta">
        <span className={`jeton ${membre.role}`}>{membre.role}</span>
        <span className="jeton phase">{evenement.phase}</span>
        {membre.perimetre && <span>{membre.perimetre}</span>}
      </div>
    </>
  )
}

function PaveSos({ evenement }) {
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

  if (n === null) return <div className="vide">…</div>
  return (
    <>
      <div className={`grand ${n > 0 ? 'alerte-texte' : ''}`}>{n}</div>
      <div className="meta">
        <span>{n === 0 ? 'aucun signalement ouvert' : 'en attente de traitement'}</span>
      </div>
    </>
  )
}

function PaveListe({ evenement, table, champ, second }) {
  const [lignes, setLignes] = useState(null)

  useEffect(() => {
    let vivant = true
    supabase
      .from(table)
      .select('*')
      .eq('evenement_id', evenement.id)
      .limit(6)
      .then(({ data }) => vivant && setLignes(data ?? []))
    return () => {
      vivant = false
    }
  }, [evenement.id, table])

  if (lignes === null) return <div className="vide">…</div>
  if (!lignes.length) return <div className="vide">Rien d'encodé</div>

  return (
    <ul className="liste-pave">
      {lignes.map((l) => (
        <li key={l.id}>
          {l[champ]}
          {l[second] && <span className="mono"> · {l[second]}</span>}
        </li>
      ))}
    </ul>
  )
}

/**
 * Pavé Planning : ce qui est en direct, et le prochain à venir.
 *
 * Même logique de fusion que l'écran Planning (programme + jalons +
 * transports datés) et le même calcul de "en cours" — les deux doivent
 * dire la même chose, sinon le pavé contredirait l'écran qu'il ouvre.
 */
function PavePlanning({ evenement }) {
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

  if (items === null) return <div className="vide">…</div>
  if (!items.length) return <div className="vide">Rien de planifié</div>

  const maintenant = Date.now()
  let enDirect = null
  let suivant = null
  for (let i = 0; i < items.length; i++) {
    const debut = items[i].heure.getTime()
    const fin = items[i + 1] ? items[i + 1].heure.getTime() : debut + 3600000
    if (maintenant >= debut && maintenant < fin) {
      enDirect = items[i]
      suivant = items[i + 1] ?? null
      break
    }
    if (debut > maintenant) {
      suivant = items[i]
      break
    }
  }
  if (!enDirect && !suivant) suivant = items[items.length - 1]

  const heure = (d) =>
    d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })

  return (
    <>
      {enDirect ? (
        <>
          <div className="planning-tag en-direct">en direct</div>
          <div className="grand" style={{ fontSize: 15, marginTop: 3 }}>
            {enDirect.titre}
          </div>
          {enDirect.detail && <div className="meta"><span>{enDirect.detail}</span></div>}
        </>
      ) : (
        <div className="vide">Rien en ce moment</div>
      )}

      {suivant && (
        <>
          <div className="planning-tag" style={{ marginTop: enDirect ? 8 : 0 }}>
            à {heure(suivant.heure)}
          </div>
          <div className="meta">
            <span className={suivant.critique ? 'alerte-texte' : ''}>{suivant.titre}</span>
          </div>
        </>
      )}
    </>
  )
}

function PaveMateriel({ evenement }) {
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

  if (lignes === null) return <div className="vide">…</div>
  if (!lignes.length) return <div className="vide">Aucun seuil franchi</div>

  return (
    <ul className="liste-pave">
      {lignes.map((m) => (
        <li key={m.id} className="alerte-texte">
          {m.nom}
          <span className="mono">
            {' '}
            · {m.quantite} {m.unite ?? ''} (seuil {m.seuil_alerte})
          </span>
        </li>
      ))}
    </ul>
  )
}
