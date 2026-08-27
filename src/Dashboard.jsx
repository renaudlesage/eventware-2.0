import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { PAVES, pavesDisponibles, pavesObligatoires, composition } from './paves'

export default function Dashboard({ evenement, membre, peut, onFait }) {
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
    <div className="dashboard">
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
          <Pave key={k} clef={k} evenement={evenement} membre={membre} />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Pave({ clef, evenement, membre }) {
  return (
    <div className="pave">
      <div className="pave-titre">{PAVES[clef].libelle}</div>
      <Contenu clef={clef} evenement={evenement} membre={membre} />
    </div>
  )
}

function Contenu({ clef, evenement, membre }) {
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
    case 'mes_creneaux':
      return <PaveMesCreneaux evenement={evenement} membre={membre} />
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

function PaveMesCreneaux({ evenement, membre }) {
  const [lignes, setLignes] = useState(null)

  useEffect(() => {
    let vivant = true
    supabase
      .from('affectations')
      .select('id, statut, creneaux(poste, debut, fin)')
      .eq('evenement_id', evenement.id)
      .eq('membre_id', membre.id)
      .not('statut', 'in', '("annule")')
      .then(({ data }) => vivant && setLignes(data ?? []))
    return () => {
      vivant = false
    }
  }, [evenement.id, membre.id])

  if (lignes === null) return <div className="vide">…</div>
  if (!lignes.length) return <div className="vide">Aucun créneau</div>

  const aConfirmer = lignes.filter((l) => l.statut === 'propose').length

  return (
    <>
      {aConfirmer > 0 && (
        <div className="grand alerte-texte">{aConfirmer}</div>
      )}
      {aConfirmer > 0 && (
        <div className="meta">
          <span>à confirmer</span>
        </div>
      )}
      <ul className="liste-pave" style={{ marginTop: aConfirmer ? 8 : 0 }}>
        {lignes
          .sort((a, b) => new Date(a.creneaux?.debut) - new Date(b.creneaux?.debut))
          .slice(0, 4)
          .map((l) => (
            <li key={l.id} className={l.statut === 'propose' ? 'alerte-texte' : ''}>
              {l.creneaux?.poste}
              <span className="mono">
                {' '}
                ·{' '}
                {l.creneaux &&
                  new Date(l.creneaux.debut).toLocaleString('fr-BE', {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
              </span>
            </li>
          ))}
      </ul>
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
