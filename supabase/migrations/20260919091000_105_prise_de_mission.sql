-- =====================================================================
-- 105 — UN BÉNÉVOLE PEUT PRENDRE UNE MISSION OUVERTE
--
-- La policy `missions_modification` datait de la 011 et n'avait jamais
-- été relue depuis les rôles personnalisables (025) ni la matrice par
-- rôle (026). Elle exigeait, en plus de `missions:modifier`, d'être
-- admin, coordinateur ou chef d'équipe — OU d'être déjà le titulaire
-- de la mission. Une mission ouverte n'a pas de titulaire : « Je
-- prends » (Terrain.jsx) mettait donc `membre_id = moi` sur une ligne
-- que la policy refusait de laisser toucher, et le bénévole lisait
-- « droits insuffisants » — alors que la matrice lui donne
-- `missions:modifier`, et que l'écran lui présente la mission comme un
-- appel au volontariat.
--
-- Même sort pour tout rôle personnalisé, dont le rôle legacy est forcé
-- à `benevole`.
--
-- LA NOUVELLE RÈGLE NE PARLE PLUS DE RÔLES, SEULEMENT DE CAPACITÉS :
--   - qui peut CRÉER des missions (l'encadrement, dans la matrice
--     standard : chef d'équipe et coordinateur) peut modifier n'importe
--     laquelle ;
--   - qui peut seulement les MODIFIER peut toucher les siennes, et
--     prendre une mission sans titulaire ;
--   - et ce qu'il écrit doit le laisser titulaire (WITH CHECK) : un
--     bénévole ne réattribue pas une mission à quelqu'un d'autre, et
--     ne la remet pas dans le pot.
--
-- Au passage, `auth.uid()` est enveloppé dans un `(select …)` : évalué
-- une fois par requête au lieu d'une fois par ligne (advisor
-- performance).
-- =====================================================================

begin;

drop policy if exists missions_modification on missions;

create policy missions_modification on missions for update to authenticated
  using (
    a_permission(evenement_id, 'missions', 'modifier')
    and (
      a_permission(evenement_id, 'missions', 'creer')
      or membre_id is null
      or membre_id in (
        select m.id from membres_evenement m
        where m.evenement_id = missions.evenement_id
          and m.user_id = (select auth.uid())
          and m.deleted_at is null
      )
    )
  )
  with check (
    a_permission(evenement_id, 'missions', 'modifier')
    and (
      a_permission(evenement_id, 'missions', 'creer')
      or membre_id in (
        select m.id from membres_evenement m
        where m.evenement_id = missions.evenement_id
          and m.user_id = (select auth.uid())
          and m.deleted_at is null
      )
    )
  );

commit;

-- =====================================================================
-- VÉRIFICATION
--
-- droits.sql, bloc M : un bénévole prend une mission ouverte (1 ligne
-- modifiée), ne peut pas la donner à quelqu'un d'autre (0 ligne).
--
-- Dans l'application, avec le compte bénévole de Rando VTT : Terrain,
-- « Je prends » sur une mission à traiter → elle passe en « attribuée »
-- à son nom.
-- =====================================================================
