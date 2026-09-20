import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/**
 * Écrire, ou savoir qu'on n'a pas écrit.
 *
 * Un UPDATE que RLS refuse ne renvoie PAS d'erreur : PostgREST répond
 * « 0 ligne touchée » et l'application, qui ne regardait que `error`,
 * rechargeait l'écran en croyant avoir réussi. L'audit du 18/09 a
 * compté trente et une écritures dans ce cas — un bénévole à qui la
 * matrice refuse une action ne le lisait nulle part.
 *
 * Le remède est de demander le compte des lignes touchées
 * (`count: 'exact'`) et de traiter zéro comme un refus. C'était déjà
 * fait à une dizaine d'endroits, à la main, avec le même bloc de cinq
 * lignes recopié ; il est ici une fois pour toutes.
 *
 * Les deux fonctions renvoient le message à afficher, ou `null` si
 * tout s'est bien passé — la forme la plus courte à consommer :
 *
 *   const refus = await modifierOuRefuser('jalons', { statut }, { id })
 *   if (refus) setMessage({ type: 'erreur', texte: refus })
 *   else charger()
 *
 * Pour les écritures de terrain qui doivent survivre à une coupure
 * réseau (statut de mission, pointage), c'est `ecrireOuEmpiler` de
 * fileEcritures.js qu'il faut : il met en file au lieu de refuser.
 */

export const REFUS_SANS_ERREUR =
  'Modification refusée : vos droits ne le permettent pas dans cette phase, ou la ligne a disparu.'

/**
 * @param {string} table
 * @param {object} champs   colonnes à écrire
 * @param {object} filtre   colonnes d'égalité qui désignent la ou les lignes, ex. { id }
 * @returns {Promise<string|null>} message d'erreur, ou null
 */
export async function modifierOuRefuser(table, champs, filtre) {
  let requete = supabase.from(table).update(champs, { count: 'exact' })
  for (const [colonne, valeur] of Object.entries(filtre)) {
    requete = requete.eq(colonne, valeur)
  }
  const { error, count } = await requete
  if (error) return texteErreur(error)
  if (count === 0) return REFUS_SANS_ERREUR
  return null
}

/**
 * Suppression logique par la fonction serveur (migrations 091 et 100) :
 * un `update` direct de `deleted_at` est refusé par RLS, la ligne
 * n'étant plus visible de son auteur au moment où elle est écrite.
 *
 * @returns {Promise<string|null>} message d'erreur, ou null
 */
export async function supprimerOuRefuser(table, id) {
  const { data, error } = await supabase.rpc('supprimer_logiquement', {
    p_table: table,
    p_id: id
  })
  if (error) return texteErreur(error)
  if (data === false) return 'Introuvable, ou déjà supprimé.'
  return null
}
