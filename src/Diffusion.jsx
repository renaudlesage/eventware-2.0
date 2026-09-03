import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const NIVEAUX = [
  ['information', 'Information'],
  ['vigilance', 'Vigilance'],
  ['urgence', 'Urgence'],
  ['evacuation', 'Évacuation']
]

/**
 * Diffusion externe des alertes.
 *
 * Le pont entre Eventware et un système extérieur — plateforme-crise en
 * premier lieu, mais aussi n'importe quel autre récepteur de webhook.
 * Les deux produits ne partagent jamais de base : ce qui les relie,
 * c'est ce contrat HTTP, rien d'autre.
 *
 * Une alerte se crée toujours normalement dans Eventware, que la
 * diffusion externe réussisse ou non — le journal ci-dessous est là
 * pour savoir, après coup, ce qui est réellement parti.
 */
export default function Diffusion({ evenement, setMessage }) {
  const [canaux, setCanaux] = useState([])
  const [journal, setJournal] = useState([])
  const [ouvrir, setOuvrir] = useState(false)
  const [f, setF] = useState({
    libelle: '',
    url: '',
    secret_entete: '',
    niveaux_declencheurs: ['urgence', 'evacuation']
  })

  async function charger() {
    const [c, j] = await Promise.all([
      supabase
        .from('canaux_diffusion')
        .select('*')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .order('libelle'),
      supabase
        .from('diffusions')
        .select('*, canaux_diffusion(libelle)')
        .eq('evenement_id', evenement.id)
        .order('tentee_le', { ascending: false })
        .limit(10)
    ])
    setCanaux(c.data ?? [])
    setJournal(j.data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function creer() {
    if (!f.libelle.trim() || !f.url.trim()) return
    const { error } = await supabase.from('canaux_diffusion').insert({
      evenement_id: evenement.id,
      libelle: f.libelle.trim(),
      url: f.url.trim(),
      secret_entete: f.secret_entete.trim() || null,
      niveaux_declencheurs: f.niveaux_declencheurs
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ libelle: '', url: '', secret_entete: '', niveaux_declencheurs: ['urgence', 'evacuation'] })
      setOuvrir(false)
      charger()
    }
  }

  async function basculerActif(canal) {
    await supabase.from('canaux_diffusion').update({ actif: !canal.actif }).eq('id', canal.id)
    charger()
  }

  function basculerNiveau(niveau) {
    setF((x) => ({
      ...x,
      niveaux_declencheurs: x.niveaux_declencheurs.includes(niveau)
        ? x.niveaux_declencheurs.filter((n) => n !== niveau)
        : [...x.niveaux_declencheurs, niveau]
    }))
  }

  return (
    <section className="bloc">
      <h2>Diffusion externe</h2>
      <p className="aide">
        Un canal transmet les alertes de cet événement vers un système extérieur —
        plateforme-crise, un service d'astreinte, un webhook Slack ou Teams. Une
        information simple ne réveille personne à l'extérieur ; une urgence ou une
        évacuation, si. L'échec d'un envoi n'affecte jamais l'alerte elle-même, qui reste
        valide dans Eventware.
      </p>

      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        <button className="discret" onClick={() => setOuvrir(!ouvrir)}>
          {ouvrir ? 'Fermer' : 'Ajouter un canal'}
        </button>
      </div>

      {ouvrir && (
        <div className="formulaire">
          <div className="saisie-rapide">
            <input
              value={f.libelle}
              onChange={(e) => setF({ ...f, libelle: e.target.value })}
              placeholder="Nom — ex. Commune de Ferrières"
            />
          </div>
          <input
            value={f.url}
            onChange={(e) => setF({ ...f, url: e.target.value })}
            placeholder="URL du webhook — https://…"
          />
          <input
            value={f.secret_entete}
            onChange={(e) => setF({ ...f, secret_entete: e.target.value })}
            placeholder="En-tête d'authentification (facultatif)"
          />
          <label>Déclenché par</label>
          <div className="ligne-boutons" style={{ marginBottom: 10 }}>
            {NIVEAUX.map(([v, l]) => (
              <button
                key={v}
                className={`module ${f.niveaux_declencheurs.includes(v) ? 'actif' : ''}`}
                onClick={() => basculerNiveau(v)}
              >
                {l}
              </button>
            ))}
          </div>
          <button disabled={!f.libelle.trim() || !f.url.trim()} onClick={creer}>
            Enregistrer le canal
          </button>
          <p className="aide">
            Le secret, s'il est renseigné, est transmis dans l'en-tête
            <span className="mono"> X-Diffusion-Secret</span> — un simple filtre de bruit,
            pas un mécanisme de sécurité fort.
          </p>
        </div>
      )}

      {canaux.length === 0 ? (
        <p className="vide">Aucun canal configuré.</p>
      ) : (
        canaux.map((c) => (
          <div className="carte" key={c.id}>
            <div className="titre">
              {c.libelle}
              {!c.actif && <span className="jeton"> désactivé</span>}
            </div>
            <div className="meta">
              <span className="mono">{c.url}</span>
              <span>{c.niveaux_declencheurs.join(', ')}</span>
            </div>
            <div className="ligne-boutons" style={{ marginTop: 8 }}>
              <button className="discret" onClick={() => basculerActif(c)}>
                {c.actif ? 'Désactiver' : 'Réactiver'}
              </button>
            </div>
          </div>
        ))
      )}

      <div className="pave-titre" style={{ marginTop: 18 }}>
        Derniers envois
      </div>
      {journal.length === 0 ? (
        <p className="vide">Aucune diffusion pour l'instant.</p>
      ) : (
        <ul className="chrono">
          {journal.map((d) => (
            <li key={d.id} className={d.statut !== 'ok' ? 'imp-majeur' : ''}>
              <span className="heure mono">
                {new Date(d.tentee_le).toLocaleTimeString('fr-BE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="corps">
                {d.canaux_diffusion?.libelle ?? 'canal supprimé'} —{' '}
                {d.statut === 'ok'
                  ? `envoyé (${d.code_reponse})`
                  : `échec${d.erreur ? ' : ' + d.erreur : ''}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
