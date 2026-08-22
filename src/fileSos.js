/**
 * File d'attente locale des signalements.
 *
 * Principe : un signalement est d'abord écrit dans le téléphone, puis
 * envoyé. Jamais l'inverse. Si le réseau manque — fond de vallée,
 * couvert forestier — il part dès que la couverture revient, sans que
 * le participant ait à y penser.
 *
 * La cle_client est générée AVANT le premier envoi et ne change jamais.
 * C'est elle qui garantit qu'un renvoi ne crée pas de doublon côté base.
 */

const CLEF = 'eventware.sos.file'

export function lireFile() {
  try {
    return JSON.parse(localStorage.getItem(CLEF) || '[]')
  } catch {
    return []
  }
}

export function ecrireFile(file) {
  try {
    localStorage.setItem(CLEF, JSON.stringify(file))
  } catch {
    /* stockage plein ou navigation privée : on continue en mémoire */
  }
}

export function ajouter(signalement) {
  const file = lireFile()
  file.unshift(signalement)
  ecrireFile(file)
  return file
}

export function majSignalement(cleClient, champs) {
  const file = lireFile().map((s) =>
    s.cle_client === cleClient ? { ...s, ...champs } : s
  )
  ecrireFile(file)
  return file
}

export function retirer(cleClient) {
  const file = lireFile().filter((s) => s.cle_client !== cleClient)
  ecrireFile(file)
  return file
}

export function nouvelleCle() {
  if (crypto?.randomUUID) return crypto.randomUUID()
  // Repli pour les contextes non sécurisés (http://)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export const ETATS = {
  en_attente: "En attente d'envoi",
  envoi: 'Envoi en cours…',
  recu: 'Reçu au poste de commandement',
  echec: "Refusé"
}
