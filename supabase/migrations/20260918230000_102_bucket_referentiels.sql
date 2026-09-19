-- =====================================================================
-- 102 — LE BUCKET « referentiels » EXISTE ENFIN DANS LE DÉPÔT
--
-- Trouvé à l'audit du 18/09 : les policies de stockage de la 092
-- cloisonnent un bucket que rien ne crée. Il a été ouvert à la main
-- dans le tableau de bord, en même temps que le module conformité (049
-- à 053), et un projet reconstruit depuis ce dépôt n'aurait donc pas de
-- rangement pour les référentiels — l'écran Conformité échouerait au
-- premier envoi de fichier.
--
-- Reprise à l'identique de ce qui existe : public, 20 Mo par fichier,
-- tout type. `on conflict do nothing` : sur le projet actuel, cette
-- migration ne fait rien.
--
-- À NOTER, sans le changer ici : le bucket est PUBLIC, c'est-à-dire
-- que quiconque tient l'URL d'un fichier le lit sans compte, RLS ou
-- pas — la 092 n'a cloisonné que l'écriture et la suppression. C'est
-- acceptable pour des textes réglementaires ; ça ne l'est pas si une
-- organisation y dépose ses propres documents internes. Le passer en
-- privé impose des URL signées côté Conformite.jsx. Décision à prendre,
-- consignée dans le rapport d'audit.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('referentiels', 'referentiels', true, 20971520)
on conflict (id) do nothing;
