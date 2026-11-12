-- =====================================================================
-- 171 — FERMER LES FONCTIONS OUVERTES PAR 167/168, DURCIR LE MASQUAGE
--
-- Contrôle de sécurité du 11/11/2026, après les migrations 155 à 170.
-- Aucune fuite constatée : les gardes internes tiennent, vérifié en
-- production sous le rôle anonyme. Trois écarts à la règle de 090 :
--
--   1. DROITS. Huit fonctions de 167/168 sont restées exécutables sans
--      connexion (la règle « revoke … from public, anon avant grant »
--      n'y a pas été appliquée). Six refusent d'elles-mêmes ; deux
--      répondent à un anonyme, sans rien révéler : `famille_demande`
--      et `masquer_numeros`. Vingt-deux autres (fonctions de
--      déclencheur, aides internes) sont exposées dans l'API sans raison.
--
--   2. MASQUAGE. `masquer_numeros` protège la page publique du QR de
--      poste. Testée sur 37 écritures :
--        · elle LAISSE PASSER un numéro écrit avec des espaces
--          insécables (ce que colle un téléphone ou Word), un tiret
--          insécable, ou des tirets bas, et toute adresse e-mail ;
--        · elle MASQUE À TORT les dates (21/08/2027), les plages
--          horaires (20.30-22.30), une fréquence radio (446.00625 MHz),
--          une adresse (12-14 4190 Ferrières), une référence
--          (LOG-2026-044).
--      Et `poste_par_jeton` ne masque pas tous les champs de texte
--      libre : mission, tâches, matériel, à signaler, déclencheur,
--      conduite, à ne pas faire.
--      Aucune donnée n'est exposée aujourd'hui : aucun de ces champs ne
--      contient de numéro ni d'adresse, et aucun QR n'a été généré.
--
--   3. RÉCIDIVE. C'est la troisième fois (116, 120, 167/168).
--      `audit_fonctions_exposees()` liste ce qui dépasse ; elle doit
--      rester vide après chaque migration.
--
-- Aucun DROP, rejouable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Droits
-- ---------------------------------------------------------------------

-- 1a. Les RPC de 167/168 : réservées aux utilisateurs connectés.
--     Leurs gardes internes (a_permission, est_membre) restent en place.
revoke execute on function
  public.famille_demande(uuid, text),
  public.familles_evenement(uuid),
  public.memoire_lieux(uuid),
  public.rex_proposer(uuid),
  public.rapprocher_lieux(uuid, uuid),
  public.rattacher_demandes_lieux(uuid),
  public.generer_postes_qr(uuid),
  public.notification_dmp_categories(),
  public.type_lieu_du_plan(categorie_element, text)
from public, anon;
grant execute on function
  public.famille_demande(uuid, text),
  public.familles_evenement(uuid),
  public.memoire_lieux(uuid),
  public.rex_proposer(uuid),
  public.rapprocher_lieux(uuid, uuid),
  public.rattacher_demandes_lieux(uuid),
  public.generer_postes_qr(uuid),
  public.notification_dmp_categories(),
  public.type_lieu_du_plan(categorie_element, text)
to authenticated;

alter function public.type_lieu_du_plan(categorie_element, text) set search_path = public, pg_temp;

-- 1b. Aides internes appelées seulement par des déclencheurs SECURITY
--     DEFINER (elles s'exécutent alors comme le propriétaire) : plus
--     aucun appel direct.
revoke execute on function
  public.miroir_lieu_element(elements_plan),
  public.miroir_dependance_lien(liens_plan)
from public, anon, authenticated;

-- 1c. Fonctions de déclencheur : Postgres refuse déjà de les appeler hors
--     déclencheur, et un déclencheur ne vérifie pas EXECUTE au moment où
--     il se déclenche. Les retirer de l'API ne change donc rien au
--     fonctionnement ; cela vide seulement la liste du linter.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prorettype = 'trigger'::regtype
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Masquage des coordonnées personnelles sur les pages publiques
-- ---------------------------------------------------------------------

-- Masque les numéros de téléphone et les adresses e-mail d'un texte libre.
--
-- Un numéro = une suite de chiffres, avec ou sans séparateurs (espaces
-- ordinaires ou insécables, points, barres, tirets, tirets bas,
-- parenthèses), qui compte :
--   · 9 chiffres ou plus ;
--   · ou 8 chiffres ou plus derrière « + » ou « 00 » ;
--   · ou 6 chiffres ou plus juste après « tél », « gsm », « appeler »…
-- Restent lisibles : 100, 101, 112 et les numéros courts, les dates, les
-- plages horaires, les fréquences radio, les quantités, les références.
-- Dans le doute, on masque : mieux vaut un « voir le QG » de trop.
create or replace function public.masquer_numeros(p_texte text)
returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  -- séparateurs admis entre deux chiffres : espace, tabulation, espaces
  -- insécable / fine insécable / de chiffre / fine, ( ) . / _ et les tirets
  -- (trait d'union U+2010, insécable U+2011, demi-cadratin U+2013, « - » en dernier)
  c_sep   constant text := ' ' || chr(9) || chr(160) || chr(8239) || chr(8199) || chr(8201)
                            || '()./_' || chr(8208) || chr(8209) || chr(8211) || '-';
  c_motif constant text := '\+?\(?\d[\d' || c_sep || ']{4,}\d';
  c_mots  constant text := '(t[ée]l|gsm|portable|mobile|whatsapp|appel|joindre|num[ée]ro|n°)[^\d]{0,12}$';
  v_out   text := '';
  v_vu    text := '';     -- texte d'origine déjà parcouru (pour le contexte)
  v_rest  text;
  v_deb   int;
  v_orig  text;
  v_cand  text;
  v_garde text;
  v_pref  text;
  v_nb    int;
  v_ctx   text;
  m       text[];
begin
  if p_texte is null then return null; end if;

  v_rest := regexp_replace(p_texte,
              '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}',
              '[adresse : voir le QG]', 'g');

  loop
    v_deb := regexp_instr(v_rest, c_motif);
    exit when v_deb = 0;
    v_orig := regexp_substr(v_rest, c_motif);
    v_ctx  := lower(right(v_vu || left(v_rest, v_deb - 1), 24));
    v_cand := v_orig;
    v_garde := '';

    -- Une date complète ou une plage horaire en tête de la suite reste lisible ;
    -- ce qui la suit est jugé à part (« 09.00-12.30 0470 11 22 33 » : le numéro est masqué).
    loop
      m := regexp_match(v_cand, '^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)');
      if m is not null and m[1]::int between 1 and 31 and m[2]::int between 1 and 12 and m[3]::int between 1900 and 2100 then
        v_pref := substring(v_cand from '^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}');
      else
        m := regexp_match(v_cand, '^(\d{1,2})\.(\d{2}) ?[–-] ?(\d{1,2})\.(\d{2})(?!\d)');
        if m is not null and m[1]::int < 24 and m[2]::int < 60 and m[3]::int <= 24 and m[4]::int < 60 then
          v_pref := substring(v_cand from '^\d{1,2}\.\d{2} ?[–-] ?\d{1,2}\.\d{2}');
        else
          exit;
        end if;
      end if;
      v_garde := v_garde || v_pref;
      v_cand  := substr(v_cand, length(v_pref) + 1);
      v_pref  := coalesce(substring(v_cand from '^[^\d+(]+'), '');
      v_garde := v_garde || v_pref;
      v_cand  := substr(v_cand, length(v_pref) + 1);
    end loop;

    v_nb := length(regexp_replace(v_cand, '\D', '', 'g'));

    v_out := v_out || left(v_rest, v_deb - 1) || v_garde
          || case when v_nb >= 9
                    or (v_nb >= 8 and v_cand ~ '^\(?(\+|00)')
                    or (v_nb >= 6 and v_ctx ~ c_mots)
                  then '[numéro : voir le QG]'
                  else v_cand end;
    v_vu   := v_vu || left(v_rest, v_deb - 1) || v_orig;
    v_rest := substr(v_rest, v_deb + length(v_orig));
  end loop;

  return v_out || v_rest;
end;
$$;

comment on function public.masquer_numeros(text) is
  'Masque numéros de téléphone (espaces insécables compris) et adresses e-mail d''un texte libre destiné à une page publique. Garde dates, heures, fréquences, quantités, numéros courts (112).';

-- La même chose dans un contenu JSON (listes de tâches, de consignes) :
-- seules les chaînes sont touchées, la structure reste intacte.
create or replace function public.masquer_numeros_json(p jsonb)
returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $$
begin
  if p is null then return null; end if;
  case jsonb_typeof(p)
    when 'string' then
      return to_jsonb(masquer_numeros(p #>> '{}'));
    when 'array' then
      return coalesce((select jsonb_agg(masquer_numeros_json(e.v) order by e.n)
                         from jsonb_array_elements(p) with ordinality as e(v, n)), '[]'::jsonb);
    when 'object' then
      return coalesce((select jsonb_object_agg(e.k, masquer_numeros_json(e.v))
                         from jsonb_each(p) as e(k, v)), '{}'::jsonb);
    else
      return p;
  end case;
end;
$$;

revoke execute on function public.masquer_numeros(text), public.masquer_numeros_json(jsonb) from public, anon;
grant  execute on function public.masquer_numeros(text), public.masquer_numeros_json(jsonb) to authenticated;

-- `poste_par_jeton` : masquer aussi les champs de texte libre qui ne
-- l'étaient pas. La fonction n'est pas recopiée : on lit sa définition
-- en base, on remplace les cinq passages concernés, et on s'arrête sans
-- rien modifier si l'un d'eux n'est pas trouvé exactement une fois.
do $migration$
declare
  v_def text := pg_get_functiondef('public.poste_par_jeton(uuid)'::regprocedure);
  v_paires text[][] := array[
    [$a$'mission', f.mission,$a$,
     $b$'mission', masquer_numeros(f.mission),$b$],
    [$a$'taches', coalesce(f.taches, '[]'::jsonb)$a$,
     $b$'taches', masquer_numeros_json(coalesce(f.taches, '[]'::jsonb))$b$],
    [$a$'materiel', f.materiel, 'a_signaler', f.a_signaler,$a$,
     $b$'materiel', masquer_numeros(f.materiel), 'a_signaler', masquer_numeros(f.a_signaler),$b$],
    [$a$'declencheur', f.declencheur,$a$,
     $b$'declencheur', masquer_numeros(f.declencheur),$b$],
    [$a$'conduite', coalesce(f.conduite, '[]'::jsonb), 'a_ne_pas_faire', coalesce(f.a_ne_pas_faire, '[]'::jsonb),$a$,
     $b$'conduite', masquer_numeros_json(coalesce(f.conduite, '[]'::jsonb)), 'a_ne_pas_faire', masquer_numeros_json(coalesce(f.a_ne_pas_faire, '[]'::jsonb)),$b$]
  ];
  i int; v_nb int;
begin
  if position('masquer_numeros(f.mission)' in v_def) > 0 then
    raise notice '171 : poste_par_jeton masque déjà tous ses champs, rien à faire.';
    return;
  end if;
  for i in 1 .. array_length(v_paires, 1) loop
    v_nb := (length(v_def) - length(replace(v_def, v_paires[i][1], ''))) / length(v_paires[i][1]);
    if v_nb <> 1 then
      raise exception '171 : le passage « % » est trouvé % fois dans poste_par_jeton (1 attendue). Rien n''a été modifié.', v_paires[i][1], v_nb;
    end if;
  end loop;
  for i in 1 .. array_length(v_paires, 1) loop
    v_def := replace(v_def, v_paires[i][1], v_paires[i][2]);
  end loop;
  execute v_def;
  raise notice '171 : poste_par_jeton masque maintenant tous ses champs de texte libre.';
end
$migration$;

-- ---------------------------------------------------------------------
-- 3. Le contrôle qui doit rester vide
-- ---------------------------------------------------------------------

-- Liste les fonctions de `public` qui dépassent :
--   · exécutables sans connexion alors qu'elles ne sont pas dans la liste
--     des fonctions publiques voulues (accès par jeton) ;
--   · ouvertes à PUBLIC (le droit par défaut de Postgres, jamais voulu ici) ;
--   · sans `search_path` figé.
-- À lancer dans le SQL Editor après chaque migration : `select * from
-- audit_fonctions_exposees();` doit ne rien renvoyer.
-- Une nouvelle fonction publique par jeton s'ajoute à `c_voulues`, dans
-- la migration qui la crée.
create or replace function public.audit_fonctions_exposees()
returns table (fonction text, probleme text)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with c(voulues) as (select array[
         'contenu_public', 'evenement_public', 'creer_signalement', 'suivi_signalement', 'suivre_signalement',
         'pointer_passage', 'situation_autorite',
         'dossier_par_jeton', 'deposer_avis', 'accuser_reception_dossier',
         'poste_par_jeton']),
  f as (
    select p.oid, p.proname, p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig, p.proacl
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  )
  select f.sig, 'exécutable sans connexion' || case when f.prosecdef then ' (SECURITY DEFINER)' else '' end
    from f, c
   where has_function_privilege('anon', f.oid, 'execute') and not (f.proname = any (c.voulues))
  union all
  select f.sig, 'ouverte à PUBLIC'
    from f
   where f.proacl is null
      or exists (select 1 from aclexplode(f.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  union all
  select f.sig, 'search_path non figé'
    from f
   where not exists (select 1 from unnest(coalesce(f.proconfig, '{}')) x where x like 'search_path=%')
  order by 2, 1;
$$;

comment on function public.audit_fonctions_exposees() is
  'Contrôle de sécurité : fonctions exécutables sans connexion hors liste voulue, ouvertes à PUBLIC, ou sans search_path. Doit rester vide après chaque migration.';

-- Réservé au SQL Editor (rôle postgres) : rien pour l'API.
revoke execute on function public.audit_fonctions_exposees() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
