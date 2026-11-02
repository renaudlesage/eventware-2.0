-- 154 — À lancer après la migration (SQL Editor Supabase) : lecture seule.
-- 1. Les seuils appris de l'organisation (attendu au 2/11/2026 : P1 15, P2 32, P3 32, P4 120).
select * from seuils_prise_en_charge('a6d4d8c5-0ea3-4786-abba-4e1b59fcb32d');
-- 2. Une organisation sans historique : valeurs par défaut (10, 30, 60, 120).
select * from seuils_prise_en_charge('00000000-0000-0000-0000-0000000000aa');
-- 3. Qui souffre, tous événements vivants confondus (vide quand tout va bien).
select e.nom, s.*
  from evenements e, lateral missions_en_souffrance(e.id) s
 where e.deleted_at is null
 order by e.nom, s.priorite, s.attente_min desc;
