/**
 * File d'écritures hors réseau.
 *
 * Le problème : sur un site de festival, le réseau tombe. Pas en
 * panne — par intermittence, sous les arbres, dans un fond de vallée,
 * ou simplement parce que trois mille personnes saturent la cellule.
 * Une écriture perdue à ce moment-là, c'est une mission qu'on croit
 * attribuée et qui ne l'est pas.
 *
 * Le principe est celui de `fileSos.js`, dont ce module généralise le
 * mécanisme aux écritures d'un membre connecté : on écrit d'abord dans
 * le téléphone, on envoie ensuite. Jamais l'inverse. L'interface
 * confirme l'enregistrement local, pas l'arrivée en base — et elle le
 * dit, parce qu'un « c'est fait » mensonger est pire que pas de
 * message du tout.
 *
 * Ce qui entre ici : les trois écritures qu'on fait sur le terrain,
 * debout, avec une main. Changer le statut d'une mission, pointer un
 * passage, prendre en charge un signalement. Rien d'autre — la
 * préparation, les référentiels et les réglages se font assis, avec du
 * réseau, et n'ont aucune raison d'être différés.
 *
 * Ce qui n'entre PAS ici : les lectures. Une donnée opérationnelle
 * périmée servie comme fraîche est plus dangereuse qu'une absence de
 * donnée — c'est déjà la règle du service worker, elle ne change pas.
 *
 * localStorage plutôt qu'IndexedDB : quelques dizaines d'opérations de
 * quelques centaines d'octets, là où IndexedDB n'apporte sa place et
 * son asynchronisme qu'à partir des pièces jointes. Le jour où on met
 * des photos en file, il faudra changer — pas avant.
 */

import { supabase } from './supabaseClient'
import { surRetourReseau, nouvelleCle } from './reessai'
import { texteErreur } from './erreurs'

const CLEF = 'eventware.ecritures.file'
const MAX_ESSAIS = 8

/* ------------------------------------------------------------------ */
/* Stockage                                                            */

export function lireFile() {
  try {
    return JSON.parse(localStorage.getItem(CLEF) || '[]')
  } catch {
    return []
  }
}

function ecrireFile(file) {
  try {
    localStorage.setItem(CLEF, JSON.stringify(file))
  } catch {
    /* stockage plein ou navigation privée : on continue en mémoire */
  }
  prevenir()
}

/* ------------------------------------------------------------------ */
/* Abonnement — l'indicateur d'état s'y branche                        */

const abonnes = new Set()

export function surChangement(fn) {
  abonnes.add(fn)
  return () => abonnes.delete(fn)
}

function prevenir() {
  const file = lireFile()
  abonnes.forEach((fn) => {
    try {
      fn(file)
    } catch {
      /* un abonné qui casse ne doit pas empêcher les autres */
    }
  })
}

/* ------------------------------------------------------------------ */
/* Mise en file                                                        */

/**
 * Empile une écriture et tente de l'envoyer tout de suite.
 *
 * `operation` :
 *   { nature: 'update', table, id, champs, libelle }
 *   { nature: 'rpc',    fonction, arguments, libelle }
 *
 * Le libellé est ce que la personne lira dans l'indicateur : « Mission
 * LOG-012 → résolue », pas « update missions ». Une file illisible ne
 * se vide jamais, parce que personne n'ose y toucher.
 *
 * Les mises à jour sont rejouables telles quelles : réappliquer deux
 * fois « statut = résolue » donne le même résultat. Les RPC doivent
 * porter leur propre clé d'idempotence — `pointer_passage` a la
 * sienne, `p_cle_client`.
 */
export function empiler(operation) {
  const ligne = {
    cle: nouvelleCle(),
    cree_le: new Date().toISOString(),
    essais: 0,
    message: null,
    ...operation
  }
  ecrireFile([...lireFile(), ligne])
  rejouer()
  return ligne.cle
}

export function retirer(cle) {
  ecrireFile(lireFile().filter((o) => o.cle !== cle))
}

export function vider() {
  ecrireFile([])
}

/* ------------------------------------------------------------------ */
/* Écriture directe, avec repli en file                                */

/**
 * `navigator.onLine` ne dit pas si le réseau fonctionne, seulement si
 * une interface est active. Un téléphone accroché au wifi d'un camping
 * sans route vers Internet se déclare en ligne ; un autre en 4G faible
 * se déclare en ligne et voit ses requêtes expirer. Sur un site de
 * festival, c'est la règle plutôt que l'exception.
 *
 * On ne s'y fie donc plus pour décider : on tente l'écriture, et c'est
 * l'échec qui décide. Le drapeau ne sert qu'à éviter une tentative
 * manifestement vouée à l'échec, en mode avion assumé.
 */
export function estErreurReseau(e) {
  if (!e) return false
  if (e.definitif) return false
  const m = `${e.name ?? ''} ${e.message ?? ''}`.toLowerCase()
  return (
    e instanceof TypeError ||
    m.includes('fetch') ||
    m.includes('network') ||
    m.includes('load failed') ||
    m.includes('timeout') ||
    m.includes('abort')
  )
}

/**
 * Tente l'écriture ; met en file si le réseau lâche.
 * Retourne 'ok', 'enfile', ou 'refus' avec le message à afficher.
 */
export async function ecrireOuEmpiler(operation) {
  if (!navigator.onLine) {
    empiler(operation)
    return { statut: 'enfile' }
  }
  try {
    await envoyer(operation)
    return { statut: 'ok' }
  } catch (e) {
    if (estErreurReseau(e)) {
      empiler(operation)
      return { statut: 'enfile' }
    }
    return { statut: 'refus', message: texteErreur(e) }
  }
}

/* ------------------------------------------------------------------ */
/* Rejeu                                                               */

let enCours = false

async function envoyer(op) {
  if (op.nature === 'update') {
    let requete = supabase
      .from(op.table)
      .update(op.champs, { count: 'exact' })
      .eq('id', op.id)

    // Garde anti-écrasement, sur les seules écritures différées.
    //
    // Une modification faite hors réseau à 14h et rejouée à 16h ne doit
    // pas effacer ce qu'un autre a décidé à 15h, en connaissance de
    // cause et avec du réseau. La ligne n'est donc écrite que si
    // personne n'y a touché depuis qu'on l'a quittée.
    //
    // Le dernier qui écrit ne gagne pas : c'est le dernier qui SAVAIT
    // qui gagne. Sur un terrain, celui qui a l'information la plus
    // fraîche est rarement celui dont le téléphone repasse en ligne le
    // plus tard.
    if (op.cree_le) requete = requete.lt('updated_at', op.cree_le)

    const { error, count } = await requete
    if (error) throw error

    if (count === 0) {
      if (!op.cree_le) {
        throw Object.assign(new Error('Écriture refusée'), { definitif: true })
      }
      // Zéro ligne touchée : soit les droits manquent, soit quelqu'un
      // est passé avant. Les deux appellent une réaction très
      // différente, donc on va voir.
      const { data } = await supabase
        .from(op.table)
        .select('updated_at')
        .eq('id', op.id)
        .maybeSingle()

      if (data && data.updated_at >= op.cree_le) {
        throw Object.assign(
          new Error('Quelqu’un a modifié cette ligne entre-temps — votre version n’a pas été appliquée.'),
          { definitif: true, conflit: true }
        )
      }
      throw Object.assign(new Error('Écriture refusée'), { definitif: true })
    }
    return
  }

  if (op.nature === 'rpc') {
    const { error } = await supabase.rpc(op.fonction, op.arguments)
    if (error) throw error
    return
  }

  throw Object.assign(new Error(`Nature inconnue : ${op.nature}`), { definitif: true })
}

/**
 * Vide la file, dans l'ordre d'arrivée. S'arrête à la première panne
 * réseau : l'ordre compte — prendre en charge puis résoudre une mission
 * n'est pas la même chose que l'inverse.
 */
export async function rejouer() {
  // Pas de garde sur navigator.onLine : il ment dans les deux sens, et
  // une tentative qui échoue ne coûte rien puisque la ligne reste en
  // file. Se fier au drapeau, c'est risquer une file qui ne repart
  // jamais parce que le téléphone se croit hors ligne.
  if (enCours) return
  enCours = true

  try {
    for (const op of lireFile()) {
      try {
        await envoyer(op)
        retirer(op.cle)
      } catch (e) {
        const definitif = e.definitif || op.essais + 1 >= MAX_ESSAIS
        const file = lireFile().map((o) =>
          o.cle === op.cle
            ? { ...o, essais: o.essais + 1, message: texteErreur(e), definitif, conflit: !!e.conflit }
            : o
        )
        ecrireFile(file)
        // Panne réseau : inutile d'essayer les suivantes, et surtout
        // pas dans le désordre. Un refus définitif, lui, ne bloque
        // pas la file : on passe à la suivante.
        if (!definitif) break
      }
    }
  } finally {
    enCours = false
  }
}

/** Ce qui reste à envoyer, hors refus définitifs. */
export function enAttente() {
  return lireFile().filter((o) => !o.definitif)
}

/** Ce qui a été refusé et demande une décision humaine. */
export function refusees() {
  return lireFile().filter((o) => o.definitif)
}

/* ------------------------------------------------------------------ */
/* Déclencheurs                                                        */

let installe = false

export function demarrer() {
  if (installe) return
  installe = true
  // Déclencheurs partagés avec les deux files publiques : même moment,
  // mêmes réglages. Le filet ne tente rien si la file est vide.
  surRetourReseau(() => {
    if (enAttente().length) rejouer()
  })
  rejouer()
}
