import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Cartographie linéaire.
 *
 * Repris du PC-Ops v18 : une ligne P0 → étapes → P0, avec la position
 * de chaque groupe en cours de route. Sur un parcours, c'est plus
 * parlant qu'une liste — on voit d'un coup d'œil qui est où, et le
 * trou entre deux groupes saute aux yeux.
 *
 * La position d'un groupe vient de son DERNIER POINTAGE, pas d'un GPS
 * continu : entre deux bornes, on sait seulement qu'il a dépassé la
 * précédente. C'est une estimation, pas un tracking — l'étiquette au
 * survol le rappelle.
 */
export default function LigneParcours({ evenement, groupes }) {
  const [bornes, setBornes] = useState(null)

  useEffect(() => {
    let vivant = true
    supabase
      .from('lieux')
      .select('id, code, nom, pk_km')
      .eq('evenement_id', evenement.id)
      .not('pk_km', 'is', null)
      .order('pk_km')
      .then(({ data }) => vivant && setBornes(data ?? []))
    return () => {
      vivant = false
    }
  }, [evenement.id])

  if (bornes === null) return null
  if (bornes.length < 2) return null // une ligne a besoin d'au moins deux points

  const min = bornes[0].pk_km
  const max = bornes[bornes.length - 1].pk_km
  const etendue = max - min || 1
  const pourcent = (pk) => Math.min(100, Math.max(0, ((pk - min) / etendue) * 100))

  // Un groupe se place sur la ligne si sa dernière position connue
  // porte un PK. Sinon il reste dans la liste texte, pas sur le schéma
  // — mieux vaut l'absence que la fausse précision.
  const surLigne = groupes.filter(
    (g) =>
      ['parti', 'en_cours', 'arrive'].includes(g.statut) &&
      (g.lieux?.pk_km != null || (g.statut === 'parti' && !g.dernier_passage))
  )

  const enRoute = groupes.filter((g) => ['parti', 'en_cours'].includes(g.statut))
  const total = enRoute.reduce((n, g) => n + (g.effectif_reel ?? g.effectif_prevu ?? 0), 0)

  return (
    <div className="ligne-parcours-bloc">
      <div className="ligne-parcours-tete">
        <span className="pave-titre">Cartographie linéaire</span>
        <span className="ligne-parcours-total">
          <strong>{total}</strong> personne(s) sur le parcours
        </span>
      </div>

      <div className="ligne-parcours">
        <div className="ligne-parcours-piste" />

        {bornes.map((b) => (
          <div
            key={b.id}
            className="ligne-parcours-borne"
            style={{ left: `${pourcent(b.pk_km)}%` }}
            title={`${b.nom} — PK ${b.pk_km}`}
          >
            <span className="ligne-parcours-point" />
            <span className="ligne-parcours-label">{b.code}</span>
          </div>
        ))}

        {surLigne.map((g, i) => {
          const pk = g.lieux?.pk_km ?? min
          const connu = g.lieux?.pk_km != null
          const enRetard = ['parti', 'en_cours'].includes(g.statut) && retardeur(g)

          return (
            <div
              key={g.id}
              className={`ligne-parcours-groupe ${connu ? '' : 'incertain'} ${
                enRetard ? 'urgent' : ''
              } ${g.statut === 'arrive' ? 'arrive' : ''}`}
              style={{ left: `${pourcent(pk)}%`, top: `${(i % 3) * 16}px` }}
              title={`${g.nom} — ${g.effectif_reel ?? g.effectif_prevu ?? '?'} pers.${
                connu ? ` — ${g.lieux.nom}` : ' — position estimée, pas encore pointé'
              }`}
            >
              {g.code}
            </div>
          )
        })}
      </div>

      <p className="aide">
        Position au dernier pointage — entre deux bornes, un groupe est simplement compté
        comme ayant dépassé la précédente. Les repères en pointillé n'ont jamais pointé :
        leur place est supposée, pas connue.
      </p>
    </div>
  )
}

/** Un groupe est en retard si son dernier signal dépasse le seuil habituel. */
function retardeur(g) {
  const ref = g.dernier_passage ?? g.depart_reel
  if (!ref) return true
  return Date.now() - new Date(ref).getTime() > 45 * 60000
}
