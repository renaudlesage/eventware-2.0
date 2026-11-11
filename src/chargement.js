/**
 * « Chargement… » plutôt que « Aucun… » (11/11, audit M13).
 *
 * Une centaine de listes affichent leur texte d'état vide (« Aucune
 * demande », « Rien ici ») dès leur montage, donc AVANT que la réponse
 * du serveur n'arrive : pendant une seconde — dix sur un mauvais
 * réseau — l'écran affirme qu'il n'y a rien. Sur un écran de sécurité,
 * c'est une fausse bonne nouvelle.
 *
 * Plutôt que d'ajouter un état de chargement à chacune, on le sait
 * d'ici : entre une navigation (changement d'écran ou de rubrique) et
 * le retour des requêtes qu'elle a lancées, le document porte
 * `data-charge`, et la feuille de style remplace le texte des états
 * vides par « Chargement… ». Les rafraîchissements périodiques, eux,
 * ne touchent à rien : une liste réellement vide ne clignote pas.
 */
const DELAI_SANS_REQUETE_MS = 200
const PLAFOND_MS = 10000
let enVol = 0
let actif = false
let plafond = null
let attente = null

function finir() {
  actif = false
  clearTimeout(plafond)
  clearTimeout(attente)
  document.documentElement.removeAttribute('data-charge')
}

function commencer() {
  actif = true
  document.documentElement.setAttribute('data-charge', '')
  clearTimeout(plafond)
  clearTimeout(attente)
  // Une navigation qui ne lance aucune requête : rien à attendre.
  attente = setTimeout(() => { if (enVol === 0) finir() }, DELAI_SANS_REQUETE_MS)
  // Une requête qui ne revient pas ne laisse pas « Chargement… » pour toujours.
  plafond = setTimeout(finir, PLAFOND_MS)
}

/** Compte une lecture en cours ; au retour de la dernière, les états vides redeviennent lisibles. */
export function suivreLecture(promesse) {
  enVol++
  const rendre = () => {
    enVol = Math.max(0, enVol - 1)
    // Un souffle : les requêtes s'enchaînent souvent (la liste, puis ses détails).
    if (enVol === 0 && actif) {
      clearTimeout(attente)
      attente = setTimeout(() => { if (enVol === 0) finir() }, 120)
    }
  }
  promesse.then(rendre, rendre)
  return promesse
}

export function demarrerChargement() {
  commencer()
  window.addEventListener('eventware:route', commencer)
  window.addEventListener('popstate', commencer)
  window.addEventListener('hashchange', commencer)
}
