-- =====================================================================
-- 174 — CRITÈRE DE DÉFAILLANCE UNIQUE
--
-- Pour un événement, dit quelles fonctions de sécurité tiennent à un
-- seul élément : on retire un à un les moyens du plan d'implantation et
-- on regarde ce qui tombe. Cherche aussi les causes communes : un
-- élément à risque (groupe électrogène, friteuse, feu) qui a dans son
-- voisinage TOUS les moyens d'une fonction.
--
-- Reprend le prototype de Ren du 13/11 (lecture seule), éprouvé sur
-- « BFMF 2027 » en production : le seul DEA du site, le QG et le poste
-- de soins sont à moins de 25 m du groupe qui alimente le QG. Six
-- défauts du prototype donnaient un verdict faux ; ils sont corrigés ici :
--
--   1. le QG se reconnaissait à son nom (« ^QG ») : il se reconnaît
--      maintenant à sa fiche de catalogue (QGSECU), à son nom (QG, PC),
--      ou au lieu « PC opérationnel » ; sans QG reconnu, on le dit ;
--   2. le commandement comptait tout membre actif joignable : seules
--      comptent les personnes dont le rôle a tout pouvoir ;
--   3. l'alerte comptait deux canaux radio pour deux voies : la radio
--      est UNE voie, le téléphone du QG en est une autre ;
--   4. sans point 0, les causes communes disparaissaient en silence : le
--      site est alors centré sur ses lieux publics, et on le dit ;
--   5. un moyen qui ne couvre aucune cible sortait en « tient » : il
--      sort « hors de portée » ; un moyen sans position est signalé ;
--   6. la surcharge d'un groupe n'était pas un verdict, et les
--      consommateurs non raccordés n'étaient pas signalés.
--
-- Les seuils sont des paramètres, avec les hypothèses de travail du
-- prototype pour valeurs par défaut :
--   p_dea_m      225 m  3 min aller-retour en courant (150 m/min)
--   p_soins_m    300 m  poste de premiers soins « sur site »
--   p_extinct_m   20 m  un extincteur à portée d'un élément à risque
--   p_voisin_m    30 m  rayon d'une cause commune ; la distance de
--                       sécurité propre à l'élément l'emporte si elle
--                       est plus grande
--   p_site_m     500 m  au-delà, un moyen n'est plus « sur site »
--
-- Niveaux : 3 fonction non assurée ou groupe en surcharge ; 2 élément
-- unique ; 1 à vérifier (donnée manquante, marge absente) ; 0 tient.
--
-- Limites connues : distances à vol d'oiseau, de centre à centre ; les
-- sorties, points de rassemblement et accès des secours sont comptés,
-- pas situés ; les personnes ne sont pas retirées une à une.
--
-- Lecture seule. Aucun DROP, rejouable.
-- =====================================================================

begin;

create or replace function public.defaillance_unique(
  p_evenement uuid,
  p_dea_m     integer default 225,
  p_soins_m   integer default 300,
  p_extinct_m integer default 20,
  p_voisin_m  integer default 30,
  p_site_m    integer default 500
) returns table (ordre integer, fonction text, ligne text, verdict text, niveau integer, detail text, element text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  -- Bornes : un seuil absurde ne doit pas donner un verdict rassurant.
  v_dea     constant integer := greatest(1, least(5000, coalesce(p_dea_m, 225)));
  v_soins   constant integer := greatest(1, least(5000, coalesce(p_soins_m, 300)));
  v_extinct constant integer := greatest(1, least(5000, coalesce(p_extinct_m, 20)));
  v_voisin  constant integer := greatest(1, least(5000, coalesce(p_voisin_m, 30)));
  v_site    constant integer := greatest(1, least(50000, coalesce(p_site_m, 500)));
begin
  if not exists (select 1 from evenements ev where ev.id = p_evenement and ev.deleted_at is null) then
    raise exception 'Événement inconnu.' using errcode = 'P0002';
  end if;
  if not (a_tout_pouvoir(p_evenement) or a_permission(p_evenement, 'plan_implantation', 'lire') or est_exploitant()) then
    raise exception 'L''analyse du plan demande « implantation : lire ».' using errcode = '42501';
  end if;

  return query
  with recursive
  p as (select ev.id, ev.point_0_lat pla0, ev.point_0_lon plo0, nullif(trim(ev.telephone_qg), '') tel
          from evenements ev where ev.id = p_evenement),
  e as (select x.id, x.code, x.nom, x.categorie::text cat, x.accueil_public pub, x.est_risque risq,
               x.centre_lat la, x.centre_lon lo, x.alimente_par,
               coalesce(x.puissance_kw, 0) kw, coalesce(x.production_kva, 0) kva, coalesce(x.distance_securite_m, 0) dsec,
               -- (1) Le QG : sa fiche de catalogue, son nom, ou le lieu « PC opérationnel » qui en est le miroir.
               (coalesce(c.code = 'QGSECU', false) or x.nom ~* '^\s*(QG|PC)\M'
                 or exists (select 1 from lieux l where l.element_plan_id = x.id and l.type = 'pc_ops' and l.deleted_at is null)) est_qg,
               -- Une source : comme dans le bilan Énergie de l'application, tout ce qui produit.
               (x.categorie = 'groupe_electrogene' or coalesce(x.production_kva, 0) > 0) est_source
          from elements_plan x left join catalogue_equipements c on c.id = x.catalogue_id
         where x.evenement_id = p_evenement and x.deleted_at is null),
  -- Les QG : ceux du plan, et les lieux « PC opérationnel » posés hors du plan.
  qg as (select e.id, e.code, e.la, e.lo from e where e.est_qg and e.la is not null
         union all
         select l.id, l.code, l.latitude, l.longitude from lieux l
          where l.evenement_id = p_evenement and l.deleted_at is null and l.type = 'pc_ops'
            and l.latitude is not null and l.element_plan_id is null),
  -- (4) Le centre du site : le point 0 ; à défaut les lieux publics ; à défaut tout ce qui est placé.
  ref as (select coalesce(p.pla0, (select avg(e.la) from e where e.pub and e.la is not null), (select avg(e.la) from e where e.la is not null)) pla,
                 coalesce(p.plo0, (select avg(e.lo) from e where e.pub and e.la is not null), (select avg(e.lo) from e where e.la is not null)) plo,
                 (p.pla0 is null or p.plo0 is null) sans_point0
            from p),
  -- Fonctions « de proximité » : chaque lieu public (ou élément à risque) doit avoir un moyen à portée.
  moyens as (select 'DEFIB' f, e.id, e.code, e.la, e.lo from e where e.cat = 'dea'
             union all select 'SOINS', e.id, e.code, e.la, e.lo from e where e.cat in ('poste_secours', 'pma')
             union all select 'EXTINCTION', e.id, e.code, e.la, e.lo from e where e.cat = 'extincteur'),
  cibles as (select 'DEFIB' f, e.id, e.la, e.lo from e where e.pub and e.la is not null
             union all select 'SOINS', e.id, e.la, e.lo from e where e.pub and e.la is not null
             union all select 'EXTINCTION', e.id, e.la, e.lo from e where e.risq and e.la is not null),
  seuils as (select 'DEFIB' f, v_dea s union all select 'SOINS', v_soins union all select 'EXTINCTION', v_extinct),
  rangs as (select c.f, c.id cible, m.id moyen, distance_m(c.la, c.lo, m.la, m.lo) m
              from cibles c join moyens m on m.f = c.f and m.la is not null and m.id <> c.id),
  proche as (select r.f, r.cible, min(r.m) m from rangs r group by r.f, r.cible),
  nominal as (select s.f, s.s seuil,
                     -- ce que la fonction doit couvrir, en clair
                     case when s.f = 'EXTINCTION' then 'élément(s) à risque' else 'lieu(x) public(s)' end quoi,
                     case when s.f = 'EXTINCTION' then 'élément à risque' else 'lieu public' end quoi_un,
                     (select count(*) from cibles c where c.f = s.f) n_cibles,
                     (select count(*) from proche q where q.f = s.f and q.m <= s.s) n_couvertes,
                     (select round(max(q.m)) from proche q where q.f = s.f) pire_m,
                     (select count(*) from moyens m where m.f = s.f) n_moyens,
                     (select count(*) from moyens m where m.f = s.f and m.la is null) n_sans_position,
                     (select string_agg(m.code, ', ' order by m.code) from moyens m where m.f = s.f and m.la is null) sans_position
                from seuils s),
  -- Défaillance unique : on retire le moyen k ; une cible reste couverte si un AUTRE moyen est à portée.
  perte as (select m.f, m.id moyen, m.code,
                   (select count(*) from (select r.cible from rangs r join seuils s on s.f = r.f
                                           where r.f = m.f and r.moyen <> m.id and r.m <= s.s group by r.cible) x) n_sans,
                   (select round(max(x.m2)) from (select min(r.m) m2 from rangs r where r.f = m.f and r.moyen <> m.id group by r.cible) x) pire_sans,
                   -- (5) ce que ce moyen couvre lui-même
                   (select count(*) from rangs r join seuils s on s.f = r.f where r.f = m.f and r.moyen = m.id and r.m <= s.s) n_portee,
                   (select round(min(r.m)) from rangs r where r.f = m.f and r.moyen = m.id) plus_proche
              from moyens m where m.la is not null),
  -- Arbre électrique : chaque source et tout ce qu'elle alimente.
  arbre as (select g.id racine, g.code racine_code, g.nom racine_nom, g.kva, g.id, g.code, g.cat, g.kw, g.est_qg, 0 prof, array[g.id] vus
              from e g where g.est_source
            union all
            select a.racine, a.racine_code, a.racine_nom, a.kva, c.id, c.code, c.cat, c.kw, c.est_qg, a.prof + 1, a.vus || c.id
              from arbre a join e c on c.alimente_par = a.id
             where a.prof < 12 and not (c.id = any (a.vus))),
  energie as (select a.racine, a.racine_code, a.racine_nom, max(a.kva) kva,
                     coalesce(sum(a.kw) filter (where a.prof > 0), 0) kw,
                     coalesce(bool_or(a.est_qg or a.cat in ('scene', 'poste_secours', 'pma')) filter (where a.prof > 0), false) critique,
                     string_agg(a.code, ', ' order by a.code) filter (where a.prof > 0 and (a.est_qg or a.cat in ('scene', 'poste_secours', 'pma'))) critiques,
                     string_agg(a.code, ', ' order by a.code) filter (where a.prof > 0 and a.cat <> 'coffret_electrique') tombent,
                     coalesce(bool_or(a.est_qg) filter (where a.prof > 0), false) alimente_qg
                from arbre a group by a.racine, a.racine_code, a.racine_nom),
  -- Moyens « sur site » d'une fonction, pour les causes communes.
  sur_site as (select m.f, m.id, m.code, m.la, m.lo from moyens m, ref
                where m.f in ('DEFIB', 'SOINS') and m.la is not null and distance_m(ref.pla, ref.plo, m.la, m.lo) <= v_site
               union all select 'QG', qg.id, qg.code, qg.la, qg.lo from qg),
  commune as (select r.id risque, s.f,
                     count(*) filter (where z.dist <= z.rayon) proches, count(*) total,
                     string_agg(s.code || ' à ' || round(z.dist) || ' m', ', ' order by z.dist) filter (where z.dist <= z.rayon) lesquels
                from e r join sur_site s on s.id <> r.id
                cross join lateral (select distance_m(r.la, r.lo, s.la, s.lo) dist, greatest(v_voisin, r.dsec) rayon) z
               where r.risq and r.la is not null
               group by r.id, s.f)

  -- -------------------------------------------------------------------
  -- 1. État nominal des fonctions de proximité
  -- -------------------------------------------------------------------
  select 1, n.f, 'état nominal'::text,
         case when n.n_cibles = 0 then 'non évaluable' when n.n_couvertes = n.n_cibles then 'assurée' else 'NON ASSURÉE' end,
         case when n.n_cibles = 0 then 1 when n.n_couvertes = n.n_cibles then 0 else 3 end,
         case when n.n_cibles = 0 then
                format('aucun %s placé sur le plan', case when n.f = 'EXTINCTION' then 'élément à risque' else 'lieu accueillant du public' end)
              when n.n_moyens - n.n_sans_position = 0 then
                format('aucun moyen placé sur le plan pour %s %s', n.n_cibles, n.quoi)
              else format('%s %s sur %s à moins de %s m ; le plus éloigné à %s m', n.n_couvertes, n.quoi, n.n_cibles, n.seuil, coalesce(n.pire_m::text, '—'))
         end,
         null::text
    from nominal n
  union all
  -- (5) Un moyen encodé sans position ne compte pour personne.
  select 1, n.f, 'moyens sans position', 'à vérifier', 1,
         format('%s moyen(s) encodé(s) sans position sur le plan, donc non comptés : %s', n.n_sans_position, n.sans_position), null::text
    from nominal n where n.n_sans_position > 0
  union all
  -- -------------------------------------------------------------------
  -- 2. Perte d'un moyen
  -- -------------------------------------------------------------------
  select 2, pe.f, 'perte de ' || pe.code,
         case when pe.n_sans < n.n_couvertes then 'ÉLÉMENT UNIQUE' when pe.n_portee = 0 then 'hors de portée' else 'tient' end,
         case when pe.n_sans < n.n_couvertes then 2 else 0 end,
         case when pe.n_sans < n.n_couvertes then
                format('%s %s couvert(s) au lieu de %s ; le plus éloigné passe à %s', pe.n_sans, n.quoi, n.n_couvertes, coalesce(pe.pire_sans::text || ' m', 'aucun autre moyen'))
              when pe.n_portee = 0 then
                format('ne couvre aucun %s à moins de %s m ; le plus proche est à %s', n.quoi_un, n.seuil, coalesce(pe.plus_proche::text || ' m', '—'))
              else format('%s %s couvert(s), comme avant ; le plus éloigné passe à %s m', pe.n_sans, n.quoi, coalesce(pe.pire_sans::text, '—'))
         end,
         pe.code
    from perte pe join nominal n on n.f = pe.f
  union all
  -- -------------------------------------------------------------------
  -- 3. Secouristes
  -- -------------------------------------------------------------------
  select 3, 'SECOURISTES', 'état nominal',
         case when s.n = 0 then 'NON ASSURÉE' when s.n = 1 then 'ÉLÉMENT UNIQUE' else 'tient' end,
         case when s.n = 0 then 3 when s.n = 1 then 2 else 0 end,
         format('%s secouriste(s) encodé(s) ; %s disponible(s) si l''un est occupé', s.n, greatest(s.n - 1, 0)), null::text
    from (select coalesce(sum(m.quantite), 0)::int n from moyens_premiers_secours m
           where m.evenement_id = p_evenement and lower(m.type) like 'secouriste%') s
  union all
  -- -------------------------------------------------------------------
  -- 4. Sorties, rassemblement, accès des secours : comptés, pas situés
  -- -------------------------------------------------------------------
  select 4, c.f, 'état nominal',
         case when c.n = 0 then 'NON ASSURÉE' when c.n = 1 then 'ÉLÉMENT UNIQUE' else 'tient' end,
         case when c.n = 0 then 3 when c.n = 1 then 2 else 0 end,
         format('%s encodé(s)%s', c.n, case when c.n = 1 then ' : ' || c.codes else '' end),
         case when c.n = 1 then c.codes end
    from (select v.f, count(x.id)::int n, string_agg(x.code, ', ' order by x.code) codes
            from (values ('SORTIES', 'sortie_secours'), ('RASSEMBLEMENT', 'point_rassemblement'), ('ACCÈS SECOURS', 'point_rencontre_secours')) v(f, cat)
            left join e x on x.cat = v.cat group by v.f) c
  union all
  -- -------------------------------------------------------------------
  -- 5. Alerte — (3) la radio est une voie, le téléphone du QG une autre
  -- -------------------------------------------------------------------
  select 5, 'ALERTE', 'état nominal',
         case when a.n = 0 then 'NON ASSURÉE' when a.n = 1 then 'ÉLÉMENT UNIQUE' else 'tient' end,
         case when a.n = 0 then 3 when a.n = 1 then 2 else 0 end,
         format('%s voie(s) indépendante(s) : radio %s ; téléphone du QG %s', a.n,
                case when a.canaux = 0 then 'absente' else format('%s canal(aux), dont %s d''urgence', a.canaux, a.urgence) end,
                case when a.tel then 'encodé' else 'absent' end),
         null::text
    from (select count(c.id)::int canaux, (count(c.id) filter (where c.canal_urgence))::int urgence,
                 (max(p.tel) is not null) tel,
                 (least(count(c.id), 1) + case when max(p.tel) is not null then 1 else 0 end)::int n
            from p left join canaux_radio c on c.evenement_id = p.id and c.deleted_at is null and c.actif) a
  union all
  -- -------------------------------------------------------------------
  -- 6. Commandement — (2) les personnes dont le rôle a tout pouvoir
  -- -------------------------------------------------------------------
  select 6, 'COMMANDEMENT', 'état nominal',
         case when m.n = 0 then 'NON ASSURÉE' when m.n = 1 then 'ÉLÉMENT UNIQUE' else 'tient' end,
         case when m.n = 0 then 3 when m.n = 1 then 2 else 0 end,
         format('%s personne(s) à tout pouvoir, dont %s joignable(s) par téléphone', m.total, m.n), null::text
    from (select count(me.id)::int total, (count(me.id) filter (where nullif(trim(me.telephone), '') is not null))::int n
            from p left join (membres_evenement me join roles ro on ro.id = me.role_id and ro.tout_pouvoir and ro.deleted_at is null)
                   on me.evenement_id = p.id and me.actif and me.deleted_at is null) m
  union all
  -- (1) Sans QG reconnu, ni son alimentation ni son voisinage ne sont jugés : on le dit.
  select 6, 'QG', 'état nominal', 'non évaluable', 1,
         'aucun QG reconnu : ni fiche « QG sécurité » du catalogue, ni élément dont le nom commence par QG ou PC, ni lieu « PC opérationnel » placé',
         null::text
   where not exists (select 1 from qg)
  union all
  -- -------------------------------------------------------------------
  -- 7. Énergie
  -- -------------------------------------------------------------------
  select 7, 'ÉNERGIE', 'perte de ' || g.racine_code,
         case when g.critique then 'ÉLÉMENT UNIQUE' when g.racine_nom ~* '(lumi|[ée]clair)' then 'à vérifier' else 'sans effet sur la sécurité' end,
         case when g.critique then 2 when g.racine_nom ~* '(lumi|[ée]clair)' then 1 else 0 end,
         case when g.critique then format('alimente seul : %s ; tombent : %s', g.critiques, g.tombent)
              when g.racine_nom ~* '(lumi|[ée]clair)' then 'source d''éclairage : sa panne éteint sa zone'
              else format('tombent : %s', coalesce(g.tombent, 'rien d''encodé')) end,
         g.racine_code
    from energie g
  union all
  -- (6) La charge : au-delà de 80 % (seuil du bilan Énergie), plus de marge ; au-delà de 100 %, surcharge.
  select 7, 'ÉNERGIE', 'charge de ' || g.racine_code,
         case when g.kw / 0.8 > g.kva then 'SURCHARGE' else 'à vérifier' end,
         case when g.kw / 0.8 > g.kva then 3 else 1 end,
         format('%s kW demandés pour %s kVA : chargé à %s %% (cos φ 0,8)', replace(round(g.kw, 1)::text, '.', ','), round(g.kva), round(100 * g.kw / 0.8 / g.kva)),
         g.racine_code
    from energie g where g.kva > 0 and g.kw / 0.8 > g.kva * 0.8
  union all
  -- (6) Ce qui consomme sans être raccordé : les charges ci-dessus sont alors sous-estimées.
  select 7, 'ÉNERGIE', 'consommateurs non raccordés', 'à vérifier', 1,
         format('%s consommateur(s), %s kW, sans source encodée : %s', nr.n, replace(round(nr.kw, 1)::text, '.', ','), nr.codes), null::text
    from (select count(*)::int n, sum(e.kw) kw, string_agg(e.code, ', ' order by e.kw desc, e.code) codes
            from e where e.kw > 0 and e.alimente_par is null and not e.est_source) nr
   where nr.n > 0
  union all
  -- -------------------------------------------------------------------
  -- 8. Causes communes
  -- -------------------------------------------------------------------
  select 8, 'CAUSE COMMUNE', 'autour de ' || r.code || ' (' || r.nom || ')', 'ÉLÉMENT UNIQUE', 2,
         string_agg(format('%s : %s sur %s (%s)', case c.f when 'DEFIB' then 'défibrillation' when 'SOINS' then 'soins' else c.f end, c.proches, c.total, c.lesquels), ' ; ' order by c.f)
           || case when exists (select 1 from energie g where g.racine = r.id and g.alimente_qg) then ' ; ce groupe alimente aussi le QG' else '' end,
         r.code
    from commune c join e r on r.id = c.risque
   where c.proches = c.total and c.total > 0
   group by r.id, r.code, r.nom
  union all
  -- -------------------------------------------------------------------
  -- 9. Le repère du site — (4)
  -- -------------------------------------------------------------------
  select 9, 'SITE', 'point 0', 'à vérifier', 1,
         case when ref.pla is null then 'point 0 non posé et aucun élément placé : les causes communes ne sont pas évaluées'
              else 'point 0 non posé : le site est centré sur ses lieux publics pour dire quels moyens sont « sur site »' end,
         null::text
    from ref where ref.sans_point0
  order by 1, 2, 3;
end;
$$;

comment on function public.defaillance_unique(uuid, integer, integer, integer, integer, integer) is
  'Critère de défaillance unique : fonctions de sécurité qui tiennent à un seul élément du plan d''implantation, et causes communes. Lecture seule. Niveaux : 3 non assurée, 2 élément unique, 1 à vérifier, 0 tient.';

-- Règle de 090 : jamais ouverte à PUBLIC ni aux anonymes.
revoke execute on function public.defaillance_unique(uuid, integer, integer, integer, integer, integer) from public, anon;
grant  execute on function public.defaillance_unique(uuid, integer, integer, integer, integer, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
