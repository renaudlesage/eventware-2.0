-- =====================================================================
-- 153 — HEURES DU SOLEIL CALCULÉES, PLUS DE TABLE PAR MOIS
--
-- `generer_exercice` tirait l'heure du coucher du soleil d'une table à
-- une valeur par mois (120, reprise en 128). Comparée au calcul
-- astronomique pour Ferrières, sur 2026 :
--   · 131 jours sur 365 à plus de 15 min d'erreur, 28 à plus de 30 min ;
--   · la table ignore les changements d'heure : 18h50 pour tout octobre,
--     alors que le soleil se couche à 17h15 le 31/10 (94 min d'écart),
--     et 18h40 pour tout mars, quand il se couche à 20h04 le 29/03 ;
--   · 11/11 (Rando VTT) : table 17h10, réel 16h57.
--
-- Cette migration :
--   1. ajoute `heure_soleil(lat, lon, jour, quoi)` : lever, coucher,
--      début et fin des crépuscules civil et nautique (algorithme NOAA,
--      précision ± 1 min sous nos latitudes) ;
--   2. remplace, dans la définition EN PLACE de `generer_exercice`, la
--      table par le calcul au point 0 de l'événement (arrondi à la
--      minute), et ajoute la clé
--      `fin_crepuscule_civil` (l'heure où l'on n'y voit plus sans
--      lampe à découvert ; sous couvert forestier, plus tôt encore).
--      La fonction n'est pas recopiée : la migration lit sa définition
--      en base, remplace le seul passage concerné et s'arrête si ce
--      passage n'est pas trouvé exactement une fois.
--
-- Idempotente : rejouée, l'étape 2 constate que la table a déjà disparu.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Le calcul
-- ---------------------------------------------------------------------
create or replace function public.heure_soleil(p_lat double precision, p_lon double precision, p_jour date, p_quoi text default 'coucher')
returns timestamptz
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  -- hauteur du centre du Soleil sous l'horizon, en degrés
  h0 double precision := case p_quoi
    when 'lever' then -0.833 when 'coucher' then -0.833
    when 'debut_crepuscule_civil' then -6 when 'fin_crepuscule_civil' then -6
    when 'debut_crepuscule_nautique' then -12 when 'fin_crepuscule_nautique' then -12 end;
  matin boolean := p_quoi in ('lever', 'debut_crepuscule_civil', 'debut_crepuscule_nautique');
  t double precision; l0 double precision; m double precision; e double precision; c double precision;
  lam double precision; eps double precision; decl double precision; y double precision;
  eot double precision; cos_h double precision; h double precision; midi double precision;
begin
  if h0 is null then
    raise exception 'heure_soleil : « % » inconnu (lever, coucher, debut_/fin_crepuscule_civil, debut_/fin_crepuscule_nautique)', p_quoi
      using errcode = '22023';
  end if;
  if p_lat is null or p_lon is null or p_jour is null then return null; end if;

  -- siècles juliens depuis J2000, à midi UTC du jour
  t := (p_jour - date '2000-01-01')::double precision / 36525;
  l0  := mod((280.46646 + t * (36000.76983 + 0.0003032 * t))::numeric, 360)::double precision;
  m   := 357.52911 + t * (35999.05029 - 0.0001537 * t);
  e   := 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  c   := sin(radians(m)) * (1.914602 - t * (0.004817 + 0.000014 * t))
       + sin(radians(2 * m)) * (0.019993 - 0.000101 * t) + sin(radians(3 * m)) * 0.000289;
  lam := l0 + c - 0.00569 - 0.00478 * sin(radians(125.04 - 1934.136 * t));
  eps := 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
       + 0.00256 * cos(radians(125.04 - 1934.136 * t));
  decl := degrees(asin(sin(radians(eps)) * sin(radians(lam))));
  y    := tan(radians(eps / 2)) ^ 2;
  eot  := 4 * degrees(y * sin(2 * radians(l0)) - 2 * e * sin(radians(m))
                      + 4 * e * y * sin(radians(m)) * cos(2 * radians(l0))
                      - 0.5 * y * y * sin(4 * radians(l0)) - 1.25 * e * e * sin(2 * radians(m)));
  cos_h := (sin(radians(h0)) - sin(radians(p_lat)) * sin(radians(decl))) / (cos(radians(p_lat)) * cos(radians(decl)));
  if cos_h > 1 or cos_h < -1 then return null; end if;   -- nuit ou jour polaires
  h := degrees(acos(cos_h));
  midi := 720 - 4 * p_lon - eot;                          -- minutes UTC
  return (p_jour::timestamp at time zone 'UTC')
       + make_interval(secs => 60 * (midi + case when matin then -4 else 4 end * h));
end;
$$;

comment on function public.heure_soleil(double precision, double precision, date, text) is
  'Lever, coucher et crépuscules (algorithme NOAA, ± 1 min sous nos latitudes). quoi : lever, coucher, debut_crepuscule_civil, fin_crepuscule_civil, debut_crepuscule_nautique, fin_crepuscule_nautique. Null en nuit ou jour polaires.';

revoke execute on function public.heure_soleil(double precision, double precision, date, text) from public, anon;
grant  execute on function public.heure_soleil(double precision, double precision, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Brancher le calcul dans generer_exercice, sans recopier la fonction
-- ---------------------------------------------------------------------
do $migration$
declare
  v_oid  oid := 'public.generer_exercice(uuid, text, text, integer, text[], timestamptz, integer)'::regprocedure;
  v_def  text := pg_get_functiondef(v_oid);
  v_motif text := $m$'coucher_soleil',\s*case extract\(month from coalesce\(ev\.date_debut, current_date\)\)::int.*?else '21h40' end$m$;
  v_nb   int;
  v_par  text := $r$'coucher_soleil', coalesce(to_char((heure_soleil(coalesce(ev.point_0_lat, 50.5), coalesce(ev.point_0_lon, 5.6), coalesce(ev.date_debut, current_date), 'coucher') + interval '30 seconds') at time zone 'Europe/Brussels', 'HH24"h"MI'), '?'),
    'fin_crepuscule_civil', coalesce(to_char((heure_soleil(coalesce(ev.point_0_lat, 50.5), coalesce(ev.point_0_lon, 5.6), coalesce(ev.date_debut, current_date), 'fin_crepuscule_civil') + interval '30 seconds') at time zone 'Europe/Brussels', 'HH24"h"MI'), '?')$r$;
begin
  select count(*) into v_nb from regexp_matches(v_def, v_motif, 'g');
  if v_nb = 0 and position('heure_soleil(' in v_def) > 0 then
    raise notice '153 : generer_exercice utilise déjà heure_soleil, rien à faire.';
    return;
  end if;
  if v_nb <> 1 then
    raise exception '153 : la table des couchers de soleil est trouvée % fois dans generer_exercice (1 attendue). Rien n''a été modifié.', v_nb;
  end if;
  execute regexp_replace(v_def, v_motif, v_par);
  raise notice '153 : generer_exercice calcule maintenant le coucher du soleil et la fin du crépuscule civil.';
end
$migration$;

commit;
