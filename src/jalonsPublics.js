/**
 * Catalogue des libellés publics de jalon.
 *
 * ⚠️ Métadonnées de produit, aucune donnée client — même règle que
 * `paves.js` : un client n'invente pas un libellé, il en demande un, et
 * il monte dans la roadmap pour tout le monde. Une liste ouverte
 * produirait « Fermeture rue du Bac », « fermeture de la Rue du bac »
 * et « RUE DU BAC FERMÉE » sur trois éditions du même événement.
 *
 * Pourquoi un catalogue figé plutôt qu'un champ libre : ce texte
 * s'affiche à des milliers de personnes qui ne connaissent pas le
 * vocabulaire interne, souvent sur un téléphone, parfois dans
 * l'urgence. Il doit être court, neutre, et dire la même chose d'un
 * événement à l'autre. Le détail — quelle rue, quelle étape — se lit
 * dans l'échéance et dans le plan, pas dans le libellé.
 *
 * C'est le TEXTE retenu qui est enregistré, pas une clé : un message
 * déjà publié ne doit pas changer de formulation parce que ce fichier
 * a évolué depuis. Modifier une entrée ici n'affecte donc que les
 * jalons publiés ensuite.
 */

export const LIBELLES_PUBLICS = [
  {
    groupe: 'Accès au site',
    libelles: [
      'Ouverture du site',
      'Fermeture du site',
      'Ouverture de la billetterie',
      'Fermeture de la billetterie',
      'Dernière entrée'
    ]
  },
  {
    groupe: 'Circulation',
    libelles: [
      'Fermeture de route',
      'Réouverture de route',
      'Mise en place de la déviation',
      'Levée de la déviation',
      'Ouverture du parking',
      'Fermeture du parking',
      'Début des navettes',
      'Fin des navettes'
    ]
  },
  {
    groupe: 'Parcours',
    libelles: [
      'Premier départ',
      'Dernier départ',
      'Fermeture d’une étape',
      'Arrivée du dernier groupe'
    ]
  },
  {
    groupe: 'Services',
    libelles: [
      'Ouverture des bars',
      'Fermeture des bars',
      'Ouverture du camping',
      'Fermeture du camping',
      'Fin de la diffusion sonore'
    ]
  }
]

/** Tous les libellés à plat — pour vérifier qu'une valeur stockée est encore au catalogue. */
export const TOUS_LIBELLES_PUBLICS = LIBELLES_PUBLICS.flatMap((g) => g.libelles)

export const VISIBILITES = [
  [
    'coordination',
    'Coordination',
    'Réservé à la coordination — les rôles à tout pouvoir. Une négociation en cours, un point de friction, une échéance qu’on n’annonce pas avant qu’elle soit tenue.'
  ],
  [
    'membres',
    'Membres',
    'Visible de tous ceux qui ont accès à l’événement. C’est le comportement par défaut.'
  ],
  [
    'public',
    'Public',
    'Remonte en plus dans la vitrine participant, sous le libellé public choisi — jamais sous le libellé interne.'
  ]
]
