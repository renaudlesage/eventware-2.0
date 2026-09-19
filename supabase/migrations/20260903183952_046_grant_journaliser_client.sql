-- La veille météo doit pouvoir écrire dans la main courante depuis le
-- client, sans passer par un trigger serveur — c'est un constat fait
-- au moment de la consultation, pas un événement en base.
grant execute on function journaliser(
  uuid, text, text, text, importance_journal, text, uuid, text
) to authenticated;