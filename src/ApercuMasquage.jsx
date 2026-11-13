import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * « Sur la page du QR, ce texte s'affichera ainsi » (12/11, migration 171).
 *
 * La page publique du QR de poste masque les numéros de téléphone et
 * les adresses e-mail des textes libres : seul le numéro du QG y
 * figure. Un organisateur qui écrit « Appeler Marc au 0470… » dans une
 * fiche ne le savait pas, et le bénévole lisait « [numéro : voir le
 * QG] » sans que personne l'ait voulu.
 *
 * Une seule règle, celle du serveur : on lui demande ce que le texte
 * deviendra (`masquer_numeros`, ou `masquer_numeros_json` pour une
 * liste), un instant après la frappe. Rien n'est réécrit ici — la
 * seule économie est de ne rien demander pour un texte sans chiffre ni
 * arobase, que le masquage ne peut pas toucher.
 *
 * L'avertissement ne paraît que si le texte change. Si la fonction ne
 * répond pas (réseau coupé, migration pas encore appliquée), on se
 * tait : c'est une aide à la saisie, pas un contrôle.
 */
const DELAI_MS = 500
const memoire = new Map() // texte → texte masqué (les mêmes phrases reviennent d'une frappe à l'autre)

const peutChanger = (t) => typeof t === 'string' && /[0-9@]/.test(t)

/**
 * @param {string|string[]} valeur  un texte, ou une liste de textes
 * @returns {null | string | (string|null)[]}  le texte tel qu'il s'affichera ; pour une liste, un tableau
 *          de même longueur où seuls les éléments modifiés sont renseignés ; null si rien ne change.
 */
export function useMasquage(valeur) {
  const liste = Array.isArray(valeur)
  const textes = liste ? valeur.map((v) => v ?? '') : [valeur ?? '']
  const cle = JSON.stringify(textes)
  const [, redessiner] = useState(0)
  const tour = useRef(0)

  useEffect(() => {
    const aDemander = [...new Set(textes.filter((t) => peutChanger(t) && !memoire.has(t)))]
    if (!aDemander.length) return undefined
    const moi = ++tour.current
    const minuterie = setTimeout(async () => {
      try {
        const { data, error } = aDemander.length === 1
          ? await supabase.rpc('masquer_numeros', { p_texte: aDemander[0] })
          : await supabase.rpc('masquer_numeros_json', { p: aDemander })
        if (error) return
        const rendus = aDemander.length === 1 ? [data] : data
        if (!Array.isArray(rendus) || rendus.length !== aDemander.length) return
        aDemander.forEach((t, i) => { if (typeof rendus[i] === 'string') memoire.set(t, rendus[i]) })
        if (moi === tour.current) redessiner((n) => n + 1)
      } catch {
        /* une aide à la saisie ne casse pas le formulaire */
      }
    }, DELAI_MS)
    return () => clearTimeout(minuterie)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle])

  const rendus = textes.map((t) => (peutChanger(t) && memoire.has(t) && memoire.get(t) !== t ? memoire.get(t) : null))
  if (rendus.every((r) => r === null)) return null
  return liste ? rendus : rendus[0]
}

/**
 * L'avertissement sous un champ (ou sous une liste de champs).
 *   <ApercuMasquage texte={f.mission} />
 *   <ApercuMasquage texte={f.taches} />      // liste : seules les lignes modifiées sont montrées
 */
export default function ApercuMasquage({ texte }) {
  const rendu = useMasquage(texte)
  if (!rendu) return null
  const lignes = Array.isArray(rendu) ? rendu.filter(Boolean) : [rendu]
  return (
    <p className="aide apercu-masquage" role="status">
      Sur la page du QR, ce texte s'affichera ainsi :{' '}
      {lignes.map((l, i) => (
        <span key={i} className="apercu-masquage-texte">« {l} »{i < lignes.length - 1 ? ' ; ' : ''}</span>
      ))}
      . Seul le numéro du QG y figure.
    </p>
  )
}
