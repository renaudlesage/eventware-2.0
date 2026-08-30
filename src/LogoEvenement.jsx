import { useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Logo de l'événement.
 *
 * Deux usages du même fichier :
 *   décoratif — affiché dans la barre et sur les écrans publics
 *   icône PWA — échangée côté client au chargement (voir logoPwa.js)
 *
 * D'où la recommandation d'un carré simple et contrasté : c'est ce
 * qu'exige une icône d'app, le décoratif s'en accommode toujours.
 */
export default function LogoEvenement({ evenement, onFait, setMessage }) {
  const [occupe, setOccupe] = useState(false)

  async function televerser(fichier) {
    if (!fichier.type.startsWith('image/')) {
      setMessage({ type: 'erreur', texte: 'Choisis une image (PNG, JPG, WebP ou SVG).' })
      return
    }
    if (fichier.size > 2 * 1024 * 1024) {
      setMessage({ type: 'erreur', texte: 'Fichier trop lourd — 2 Mo maximum.' })
      return
    }

    setOccupe(true)
    const extension = fichier.name.split('.').pop().toLowerCase()
    const chemin = `${evenement.id}/logo.${extension}`

    const { error: erreurEnvoi } = await supabase.storage
      .from('logos')
      .upload(chemin, fichier, { upsert: true, cacheControl: '3600' })

    if (erreurEnvoi) {
      setMessage({ type: 'erreur', texte: erreurEnvoi.message })
      setOccupe(false)
      return
    }

    const { data } = supabase.storage.from('logos').getPublicUrl(chemin)
    const urlSansCache = `${data.publicUrl}?v=${Date.now()}`

    const { error: erreurMaj } = await supabase
      .from('evenements')
      .update({ logo_url: urlSansCache })
      .eq('id', evenement.id)

    if (erreurMaj) setMessage({ type: 'erreur', texte: erreurMaj.message })
    else onFait()
    setOccupe(false)
  }

  async function retirer() {
    const { error } = await supabase
      .from('evenements')
      .update({ logo_url: null })
      .eq('id', evenement.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFait()
  }

  return (
    <section className="bloc">
      <h2>Identité visuelle</h2>

      <div className="ligne-logo">
        {evenement.logo_url ? (
          <img src={evenement.logo_url} alt="" className="logo-apercu" />
        ) : (
          <div className="logo-apercu logo-vide">
            <span>Eventware</span>
          </div>
        )}

        <div>
          <label htmlFor="logo-fichier" className="bouton-fichier">
            {occupe ? 'Envoi…' : evenement.logo_url ? 'Remplacer' : 'Téléverser un logo'}
          </label>
          <input
            id="logo-fichier"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            disabled={occupe}
            onChange={(e) => e.target.files?.[0] && televerser(e.target.files[0])}
            style={{ display: 'none' }}
          />
          {evenement.logo_url && (
            <button className="lien" style={{ marginLeft: 12 }} onClick={retirer}>
              Retirer
            </button>
          )}
        </div>
      </div>

      <p className="aide">
        Un carré simple et contrasté fonctionne mieux : ce logo devient aussi l'icône de
        l'app quand un bénévole l'ajoute à son écran d'accueil. 2 Mo maximum.
        <br />
        L'icône ne change que pour une <strong>nouvelle</strong> installation — une app déjà
        sur un écran d'accueil garde son ancienne icône, il faut la réinstaller.
      </p>
    </section>
  )
}
