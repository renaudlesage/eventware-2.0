-- Rattrapage des lignes déjà écrites avant la migration 058 — sans
-- cette passe, seules les futures entrées auraient été lisibles.
update journal
set texte = regexp_replace(
  texte,
  '→ (a_traiter|attribuee|en_cours|resolue|annulee|emis|accuse|clos|annule|recu|pris_en_charge|sans_suite|fait|rate|parti|arrive|abandon)\y',
  '→ ' || libelle_statut((regexp_match(texte,
    '→ (a_traiter|attribuee|en_cours|resolue|annulee|emis|accuse|clos|annule|recu|pris_en_charge|sans_suite|fait|rate|parti|arrive|abandon)\y'
  ))[1]),
  'g'
)
where texte ~ '→ (a_traiter|attribuee|en_cours|resolue|annulee|emis|accuse|clos|annule|recu|pris_en_charge|sans_suite|fait|rate|parti|arrive|abandon)\y';