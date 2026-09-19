import { useState } from 'react'
import { LIBELLES_PUBLICS, TOUS_LIBELLES_PUBLICS, VISIBILITES } from './jalonsPublics'

/**
 * Le sélecteur de visibilité d'un jalon — partagé entre Préparation et
 * Planning, qui sont les deux écrans où un jalon s'édite.
 *
 * Un composant plutôt que deux copies : la règle « publier exige un
 * libellé public » est une règle de produit, pas une particularité
 * d'écran. Dupliquée, elle aurait divergé au premier correctif.
 *
 * LE PASSAGE EN « PUBLIC » NE S'ÉCRIT PAS TOUT DE SUITE. La base refuse
 * `visibilite = 'public'` sans `libelle_public` (contrainte de la 099),
 * et c'est voulu : un jalon publié sans libellé sortirait sous son nom
 * interne. Écrire la visibilité dès le choix ferait donc remonter une
 * violation de contrainte à quelqu'un qui n'a rien fait de faux — il
 * n'avait simplement pas fini. On retient l'intention ici, on affiche
 * la liste des libellés, et les deux colonnes partent dans le même
 * UPDATE une fois le libellé choisi.
 */
export default function VisibiliteJalon({ jalon, modifier }) {
  const [enAttente, setEnAttente] = useState(false)

  const visibilite = enAttente ? 'public' : jalon.visibilite ?? 'membres'
  const libelle = jalon.libelle_public ?? ''

  // Un libellé enregistré avant une évolution du catalogue doit rester
  // sélectionné plutôt que de disparaître silencieusement de la liste :
  // c'est le texte qui est stocké, pas une clé, et un message déjà
  // publié ne se réécrit pas parce que le catalogue a bougé.
  const horsCatalogue = libelle !== '' && !TOUS_LIBELLES_PUBLICS.includes(libelle)

  const aide = VISIBILITES.find(([v]) => v === visibilite)?.[2]

  function changerVisibilite(v) {
    if (v === 'public' && libelle === '') {
      setEnAttente(true)
      return
    }
    setEnAttente(false)
    modifier({ visibilite: v })
  }

  function changerLibelle(l) {
    if (l === '') return
    if (enAttente) {
      setEnAttente(false)
      modifier({ visibilite: 'public', libelle_public: l })
    } else {
      modifier({ libelle_public: l })
    }
  }

  return (
    <>
      <select
        value={visibilite}
        onChange={(e) => changerVisibilite(e.target.value)}
        style={{ width: 'auto', marginBottom: 0 }}
        title={aide}
      >
        {VISIBILITES.map(([v, l, a]) => (
          <option key={v} value={v} title={a}>
            {l}
          </option>
        ))}
      </select>

      {visibilite === 'public' && (
        <select
          value={libelle}
          onChange={(e) => changerLibelle(e.target.value)}
          // Tant que le libellé n'est pas choisi, rien n'est publié :
          // le liseré le dit sans message.
          style={{
            width: 'auto',
            marginBottom: 0,
            ...(enAttente ? { borderColor: 'var(--etat-chaud)' } : {})
          }}
          title={
            'Texte affiché aux participants. Le libellé interne ne sort jamais : ' +
            'il est écrit pour l’organisation, pas pour trois mille personnes.'
          }
        >
          <option value="">
            {enAttente ? '— choisir un libellé pour publier —' : '— libellé public —'}
          </option>
          {horsCatalogue && <option value={libelle}>{libelle}</option>}
          {LIBELLES_PUBLICS.map((g) => (
            <optgroup key={g.groupe} label={g.groupe}>
              {g.libelles.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
    </>
  )
}
