-- =====================================================================
-- Migration 051 : distinguer le requis du recommandé
-- ---------------------------------------------------------------------
-- Constat direct de l'utilisateur en confrontant RezonWal aux
-- référentiels locaux réels : RezonWal va plus loin que ce qui
-- s'impose aujourd'hui — il finira par devenir la norme, mais n'est
-- pas encore contraignant partout. Un item du référentiel ne porte
-- donc pas seulement une portée géographique (national/zone/commune),
-- mais aussi un caractère : ce qui est exigé maintenant n'est pas ce
-- qui est recommandé pour demain. Les deux méritent d'être vus, mais
-- jamais confondus dans un bilan.
-- =====================================================================

alter table referentiel_items add column caractere text not null default 'obligatoire';
alter table referentiel_items add constraint chk_caractere check (caractere in ('obligatoire','recommande'));

comment on column referentiel_items.caractere is
  'obligatoire : contraignant aujourd''hui, sur ce territoire. recommande : bonne pratique qui n''est pas encore imposée partout (ex. RezonWal, en cours de généralisation).';

-- Les trois items RezonWal déjà chargés sont recommandés, pas
-- obligatoires — ils ne le deviendront que zone de secours par zone
-- de secours, à mesure de son adoption.
update referentiel_items set caractere = 'recommande'
where referentiel_id = (select id from referentiels where code = 'rezonwal');