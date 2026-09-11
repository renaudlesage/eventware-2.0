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
 *
 * La ligne ne montre QUE les groupes en route. Un groupe arrivé en
 * sort : son dernier pointage n'est plus sa position, et le laisser
 * dessiné là désignerait au QG une borne qu'il a quittée. Son état se
 * lit dans la liste en dessous, qui est faite pour ça.
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

  // Une seule définition de « en route », partagée par la ligne, le
  // compteur et le signalement des absents. Elles étaient trois avant,
  // et elles avaient divergé : le compteur excluait les arrivés, la
  // ligne les dessinait — d'où « 0 personne(s) sur le parcours » sous
  // un groupe bien visible.
  const enRoute = groupes.filter((g) => ['parti', 'en_cours'].includes(g.statut))
  const total = enRoute.reduce((n, g) => n + (g.effectif_reel ?? g.effectif_prevu ?? 0), 0)

  // Plaçable : soit le dernier pointage porte un PK, soit le groupe
  // vient de partir sans avoir jamais pointé (on le met au départ, en
  // pointillé). Un groupe arrivé ne figure plus sur la ligne : son
  // dernier pointage n'est plus sa position, et l'afficher là
  // désignerait au QG un endroit qu'il a quitté.
  const plaçable = (g) => g.lieux?.pk_km != null || (g.statut === 'parti' && !g.dernier_passage)
  const surLigne = enRoute.filter(plaçable)

  // En route mais impossible à situer : le dernier pointage est une
  // borne sans PK. Le taire ferait disparaître un groupe de la ligne
  // tout en le comptant dans le total — l'incohérence inverse.
  const sansPosition = enRoute.filter((g) => !plaçable(g))

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
          const enRetard = retardeur(g)

          return (
            <div
              key={g.id}
              className={`ligne-parcours-groupe ${connu ? '' : 'incertain'} ${
                enRetard ? 'urgent' : ''
              }`}
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

      {sansPosition.length > 0 && (
        <p className="aide alerte-texte">
          {sansPosition.length === 1 ? 'Groupe en route absent' : 'Groupes en route absents'} de la
          ligne : {sansPosition.map((g) => g.code).join(', ')} —{' '}
          {sansPosition.length === 1 ? 'son dernier pointage porte' : 'leur dernier pointage porte'}{' '}
          sur une borne sans PK. Renseigner le PK du lieu dans Implantation les y fera apparaître.
        </p>
      )}

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
