-- =====================================================================
-- 172 — BORNER LE DÉPÔT D'AVIS PAR JETON
--
-- `deposer_avis` (159) est la seule écriture ouverte sans compte qui
-- accepte du texte libre sans limite : un commentaire et une liste de
-- prescriptions. Seul le porteur d'un lien d'avis peut l'appeler, mais
-- un lien se transfère, et rien n'empêchait d'y déposer des mégaoctets.
--
--   · commentaire : 4 000 caractères au plus ;
--   · prescriptions : 50 au plus, 1 000 caractères chacune ;
--   · au-delà : refus (22001), et rien n'est écrit — les contrôles
--     passent avant toute écriture.
--
-- Les longueurs se comptent sur le texte tel qu'il sera enregistré
-- (espaces de début et de fin retirés) ; une prescription vide ne compte
-- pas, comme avant. Le formulaire (AvisAutorite.jsx) porte les mêmes
-- limites : l'autorité ne rencontre donc jamais ce refus en usage normal.
--
-- Le reste de la fonction est celui de la base au 12/11 (comparé ligne
-- à ligne à la production : même code, seuls les commentaires du fichier
-- 159 n'y figurent pas). Droits inchangés : `create or replace` les garde.
-- Aucun DROP, rejouable.
-- =====================================================================

begin;

create or replace function public.deposer_avis(
  p_jeton uuid,
  p_avis text,
  p_commentaire text default null,
  p_prescriptions jsonb default '[]'::jsonb,
  p_echeance date default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  c_max_commentaire   constant integer := 4000;
  c_max_prescriptions constant integer := 50;
  c_max_prescription  constant integer := 1000;
  a acces_autorite%rowtype;
  d dossiers_securite%rowtype;
  v_id uuid;
  v_n integer := 0;
  p jsonb;
begin
  a := acces_dossier_par_jeton(p_jeton);
  if a.discipline is null then raise exception 'Cet accès n''a pas de discipline' using errcode = 'P0008'; end if;
  if p_avis not in ('favorable', 'favorable_conditions', 'defavorable') then
    raise exception 'Avis inconnu (favorable, favorable_conditions, defavorable)' using errcode = '22023';
  end if;

  -- (172) Les bornes, avant toute écriture.
  if length(btrim(coalesce(p_commentaire, ''))) > c_max_commentaire then
    raise exception 'Commentaire trop long : % caractères au plus (reçu : %).', c_max_commentaire, length(btrim(p_commentaire))
      using errcode = '22001';
  end if;
  if p_prescriptions is not null and jsonb_typeof(p_prescriptions) <> 'array' then
    raise exception 'Les prescriptions doivent être une liste.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(coalesce(p_prescriptions, '[]'::jsonb)) x
       where coalesce(btrim(x ->> 'texte'), '') <> '') > c_max_prescriptions then
    raise exception 'Trop de prescriptions : % au plus par avis.', c_max_prescriptions using errcode = '22001';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_prescriptions, '[]'::jsonb)) x
              where length(btrim(coalesce(x ->> 'texte', ''))) > c_max_prescription) then
    raise exception 'Prescription trop longue : % caractères au plus chacune.', c_max_prescription using errcode = '22001';
  end if;

  select * into d from dossiers_securite where evenement_id = a.evenement_id for update;
  if d.id is null or d.version_courante = 0 then raise exception 'Aucun dossier déposé pour cet événement' using errcode = 'P0009'; end if;
  if d.statut not in ('depose', 'en_instruction') then
    raise exception 'Le dossier n''est pas en instruction (%)', d.statut using errcode = 'P0012';
  end if;

  -- Un avis par discipline et par version : le précédent est remplacé, jamais effacé.
  update avis_autorite set remplace_le = now()
   where dossier_id = d.id and version = d.version_courante and discipline = a.discipline and remplace_le is null;

  insert into avis_autorite (dossier_id, version, acces_autorite_id, discipline, avis, commentaire, echeance, rendu_par)
  values (d.id, d.version_courante, a.id, a.discipline, p_avis, nullif(btrim(p_commentaire), ''), p_echeance, coalesce(a.organisation, a.libelle))
  returning id into v_id;

  for p in select * from jsonb_array_elements(coalesce(p_prescriptions, '[]'::jsonb)) loop
    if coalesce(btrim(p ->> 'texte'), '') = '' then continue; end if;
    insert into prescriptions_dossier (dossier_id, avis_id, discipline, texte, caractere)
    values (d.id, v_id, a.discipline, btrim(p ->> 'texte'),
            case when p ->> 'caractere' = 'recommande' then 'recommande' else 'obligatoire' end);
    v_n := v_n + 1;
  end loop;

  if d.statut = 'depose' then
    update dossiers_securite set statut = 'en_instruction' where id = d.id;
  end if;

  insert into journal (evenement_id, source, module, categorie, texte, importance, objet_type, objet_id, objet_ref, auteur_nom, phase)
  select d.evenement_id, 'systeme', 'securite', 'dossier',
         format('Avis %s sur le dossier de sécurité (version %s) : %s%s', a.discipline, d.version_courante,
                case p_avis when 'favorable' then 'favorable' when 'favorable_conditions' then 'favorable sous conditions' else 'DÉFAVORABLE' end,
                case when v_n > 0 then format(', %s prescription(s)', v_n) else '' end),
         (case when p_avis = 'defavorable' then 'majeur' else 'notable' end)::importance_journal,
         'avis_autorite', v_id, a.discipline, coalesce(a.organisation, a.libelle), e.phase
  from evenements e where e.id = d.evenement_id;

  return jsonb_build_object('avis_id', v_id, 'discipline', a.discipline, 'version', d.version_courante,
                            'prescriptions', v_n, 'statut', case when d.statut = 'depose' then 'en_instruction' else d.statut end);
end $$;

-- Règle de 090, redite ici pour que le fichier se lise seul : fonction
-- publique par jeton, donc ouverte aux anonymes, mais jamais à PUBLIC.
-- Elle figure dans la liste `voulues` de audit_fonctions_exposees() (171).
revoke execute on function public.deposer_avis(uuid, text, text, jsonb, date) from public;
grant execute on function public.deposer_avis(uuid, text, text, jsonb, date) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
