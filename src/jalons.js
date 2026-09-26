import { supprimerOuRefuser } from './ecriture'

/**
 * Ce que Planning (les jalons de l'événement) et Préparation (jalons et
 * actions des groupes de travail) partagent : la même table, les mêmes
 * statuts, le même retard, la même suppression. Auparavant recopié dans
 * les deux écrans (audit, « logique jalon copiée ») — les deux listes de
 * statuts étaient identiques par chance, pas par construction.
 *
 * Les cartes, elles, restent propres à chaque écran : Préparation y
 * ajoute pièces jointes, responsable et groupe, Planning l'heure et la
 * catégorie. Les forcer dans un même composant aurait demandé autant
 * d'options que de différences.
 */

export const STATUTS_JALON = [
  ['a_venir', 'À venir'],
  ['en_cours', 'En cours'],
  ['fait', 'Fait'],
  ['rate', 'Raté'],
  ['annule', 'Annulé']
]

export const libelleStatutJalon = (statut) =>
  STATUTS_JALON.find(([v]) => v === statut)?.[1] ?? statut

/** Échéance passée alors que la ligne est encore « à venir ». */
export const jalonEnRetard = (ligne, maintenant = Date.now()) =>
  Boolean(ligne.echeance) &&
  ligne.statut === 'a_venir' &&
  new Date(ligne.echeance).getTime() < maintenant

/**
 * Suppression logique après confirmation. Renvoie `null` si l'on a
 * renoncé ou si tout s'est bien passé, sinon le message à afficher —
 * et `true` quand la ligne a bien été supprimée, pour recharger.
 *
 * Pas un `update` direct de `deleted_at` : la ligne deviendrait
 * invisible pour la policy de lecture et PostgreSQL refuserait
 * l'écriture ; la fonction 091 vérifie les droits et écrit au-dessus
 * de RLS.
 */
export async function supprimerJalon(ligne, nature = 'le jalon') {
  const ok = window.confirm(
    `Supprimer ${nature} « ${ligne.libelle} » ?\n\n` +
      'Pour garder la trace de quelque chose d’abandonné, le statut ' +
      '« Annulé » est plus juste : la ligne reste lisible.'
  )
  if (!ok) return { fait: false, refus: null }
  const refus = await supprimerOuRefuser('jalons', ligne.id)
  return { fait: !refus, refus }
}
