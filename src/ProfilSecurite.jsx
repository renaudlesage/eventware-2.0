import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/**
 * PROFIL DE SÉCURITÉ DE L'ORGANISATION (155, étape 1 du dossier).
 *
 * Responsable légal, assurance, responsable sécurité : ce que la commune
 * demande en tête de tout dossier, et qui ne change pas d'un événement
 * à l'autre. Une ligne par organisation ; qui gère les données
 * d'organisation (même règle que l'annuaire) la modifie, les autres la
 * lisent.
 */
const CHAMPS = [
  ['responsable_legal', 'Responsable légal', 'président, gérant…'],
  ['responsable_legal_tel', 'Téléphone du responsable légal', ''],
  ['assurance_compagnie', 'Compagnie d’assurance', 'RC organisateur'],
  ['assurance_police', 'Numéro de police', ''],
  ['securite_nom', 'Responsable sécurité', 'joignable le jour J'],
  ['securite_tel', 'Téléphone du responsable sécurité', '']
]

const VIDE = Object.fromEntries(CHAMPS.map(([k]) => [k, '']))

export default function ProfilSecurite({ organisation, setMessage }) {
  const [droits, setDroits] = useState(null)
  const [profil, setProfil] = useState(VIDE)
  const [occupe, setOccupe] = useState(false)
  const [modifie, setModifie] = useState(false)

  useEffect(() => {
    if (!organisation) return
    let actif = true
    async function charger() {
      const [d, p] = await Promise.all([
        supabase.rpc('mes_droits_organisation', { p_organisation: organisation }),
        supabase.from('organisations_profil_securite').select('*').eq('organisation_id', organisation).maybeSingle()
      ])
      if (!actif) return
      setDroits(d.data?.[0] ?? { lire: false, gerer: false })
      if (p.data) setProfil({ ...VIDE, ...Object.fromEntries(CHAMPS.map(([k]) => [k, p.data[k] ?? ''])) })
    }
    charger()
    return () => { actif = false }
  }, [organisation])

  async function enregistrer(e) {
    e.preventDefault()
    setOccupe(true)
    const champs = Object.fromEntries(CHAMPS.map(([k]) => [k, profil[k].trim() || null]))
    const { error } = await supabase
      .from('organisations_profil_securite')
      .upsert({ organisation_id: organisation, ...champs }, { onConflict: 'organisation_id' })
    setOccupe(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    setModifie(false)
    setMessage({ type: 'succes', texte: 'Profil de sécurité enregistré.' })
  }

  if (!organisation || !droits?.lire) return null
  const manques = CHAMPS.filter(([k]) => !profil[k].trim()).length

  return (
    <section className="bloc profil-securite">
      <h2>Profil de sécurité de l’organisation</h2>
      <p className="aide" style={{ marginTop: 0 }}>
        Repris en tête de chaque dossier de sécurité.
        {manques > 0 && <> <strong>{manques} champ{manques > 1 ? 's' : ''} à compléter.</strong></>}
      </p>
      <form className="formulaire" onSubmit={enregistrer}>
        <div className="grille-2">
          {CHAMPS.map(([k, libelle, aide]) => (
            <label key={k}>
              {libelle}
              <input
                type={/_tel$/.test(k) ? 'tel' : 'text'}
                value={profil[k]}
                placeholder={aide}
                disabled={!droits.gerer}
                onChange={(e) => { setProfil({ ...profil, [k]: e.target.value }); setModifie(true) }}
              />
            </label>
          ))}
        </div>
        {droits.gerer && (
          <div className="ligne-boutons">
            <button type="submit" disabled={occupe || !modifie}>Enregistrer</button>
          </div>
        )}
      </form>
    </section>
  )
}
