-- REX BFMF 2026, point 4 : demande explicite du terrain — un
-- commentaire du QG visible par l'initiateur de la demande. Distinct
-- de `description` (ce que demande l'initiateur) et de `resolution`
-- (le mot de fin) : celui-ci sert pendant le traitement.
alter table missions add column commentaire_qg text;
comment on column missions.commentaire_qg is
  'Message du QG visible par celui qui a initié la demande, pendant le traitement — distinct de la résolution finale.';