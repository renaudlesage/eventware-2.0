import { useDemandesSimilaires } from './useDemandesSimilaires'

const LIBELLES = {
  doublon: 'Doublon probable',
  complement: 'Complément',
  recurrence: 'Besoin récurrent'
}

/**
 * À placer sous le champ « précision » du formulaire de demande
 * (module « demandes similaires » de Ren, 15/10).
 *  - onSuivre(missionId)    : ouvrir la demande existante au lieu d'en créer une
 *  - onCommenter(missionId) : ajouter le texte saisi en commentaire de l'existante
 * La création reste toujours possible : la suggestion n'est jamais bloquante.
 */
export default function SuggestionsDemande({ evenementId, titre, description, lieuId, missionId, onSuivre, onCommenter }) {
  const suggestions = useDemandesSimilaires({ evenementId, titre, description, lieuId, missionId })
  if (!suggestions.length) return null

  return (
    <div className="suggestions-demande" role="status" aria-live="polite">
      {suggestions.map((s) => (
        <div key={`${s.mission_id}-${s.relation}`} className={`suggestion suggestion--${s.relation}`}>
          <div className="suggestion__entete">
            <span className="suggestion__type">{LIBELLES[s.relation] ?? s.relation}</span>
            <span className="suggestion__ref mono">{s.reference}</span>
          </div>
          <p className="suggestion__texte">{s.titre}</p>
          <p className="suggestion__raison">{s.raison}</p>
          <div className="suggestion__actions">
            {s.relation === 'complement' && onCommenter && (
              <button type="button" className="discret" onClick={() => onCommenter(s.mission_id)}>
                Ajouter en commentaire
              </button>
            )}
            {s.relation !== 'recurrence' && onSuivre && (
              <button type="button" className="discret" onClick={() => onSuivre(s.mission_id)}>
                Voir {s.reference}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
