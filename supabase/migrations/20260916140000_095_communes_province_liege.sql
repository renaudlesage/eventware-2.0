-- =====================================================================
-- 095 — RÉFÉRENTIEL DES COMMUNES : PROVINCE DE LIÈGE
--
-- La table `communes` ne contenait qu'une ligne, Ferrières, saisie pour
-- le festival. Tout autre organisateur ouvrait l'écran Conformité avec
-- un menu d'origine sans nom de zone, donc un complément local
-- inexploitable.
--
-- ZONES DE SECOURS — 84 communes, 6 zones, source unique et officielle :
-- le Gouverneur de la province de Liège, autorité de tutelle des zones
-- (gouverneur.provincedeliege.be, consulté le 16/09/2026). Vérifié :
-- 13 + 21 + 15 + 19 + 7 + 9 = 84, aucune commune en double, aucune
-- manquante. Une commune relève d'exactement une zone de secours.
--
-- ZONES DE POLICE — volontairement incomplètes. Le découpage policier
-- est INDÉPENDANT de celui des secours et a bougé récemment : le nombre
-- de zones belges est passé de 196 à 176 au 1er janvier 2026. Les
-- fusions concernent la Flandre et Bruxelles, pas la province de Liège
-- qui reste à 20 zones, mais je n'ai pas trouvé de source officielle
-- donnant les 20 périmètres commune par commune. Seule la zone du
-- Condroz est renseignée, parce qu'elle recoupe la note déjà présente
-- sur Ferrières (RGP Condroz, article 58). Les 74 autres restent nulles
-- plutôt que fausses : dans un outil qui produit un dossier de
-- sécurité, une zone absente se voit, une zone erronée se recopie.
--
-- Rejouable : la ligne Ferrières existante est mise à jour sans perdre
-- sa note d'origine.
-- =====================================================================

begin;

insert into communes (nom, province, zone_police, zone_secours, derniere_verification, notes)
values
  ('Berloz', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Braives', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Burdinne', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Donceel', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Faimes', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Geer', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Hannut', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Lincent', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Oreye', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Remicourt', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Verlaine', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Waremme', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Wasseiges', 'Liège', null, 'Hesbaye', date '2026-09-16', null),
  ('Ans', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Awans', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Bassenge', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Beyne-Heusay', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Chaudfontaine', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Crisnée', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Engis', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Esneux', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Fexhe-le-Haut-Clocher', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Flémalle', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Fléron', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Grâce-Hollogne', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Herstal', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Juprelle', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Liège', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Neupré', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Oupeye', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Saint-Georges-sur-Meuse', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Saint-Nicolas', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Seraing', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Visé', 'Liège', null, 'Liège Zone 2 IILE-SRI', date '2026-09-16', null),
  ('Amay', 'Liège', null, 'HEMECO', date '2026-09-16', null),
  ('Anthisnes', 'Liège', 'Condroz', 'HEMECO', date '2026-09-16', 'Zone de police du Condroz (5296) — source secondaire, à confirmer par le RGP.'),
  ('Clavier', 'Liège', 'Condroz', 'HEMECO', date '2026-09-16', 'Zone de police du Condroz (5296) — source secondaire, à confirmer par le RGP.'),
  ('Comblain-au-Pont', 'Liège', 'Condroz', 'HEMECO', date '2026-09-16', 'Zone de police du Condroz (5296) — source secondaire, à confirmer par le RGP.'),
  ('Ferrières', 'Liège', 'Condroz', 'HEMECO', date '2026-09-16', 'Zone de police du Condroz (5296) — source secondaire, à confirmer par le RGP.'),
  ('Hamoir', 'Liège', 'Condroz', 'HEMECO', date '2026-09-16', 'Zone de police du Condroz (5296) — source secondaire, à confirmer par le RGP.'),
  ('Héron', 'Liège', null, 'HEMECO', date '2026-09-16', null),
  ('Huy', 'Liège', null, 'HEMECO', date '2026-09-16', null),
  ('Marchin', 'Liège', 'Condroz', 'HEMECO', date '2026-09-16', 'Zone de police du Condroz (5296) — source secondaire, à confirmer par le RGP.'),
  ('Modave', 'Liège', 'Condroz', 'HEMECO', date '2026-09-16', 'Zone de police du Condroz (5296) — source secondaire, à confirmer par le RGP.'),
  ('Nandrin', 'Liège', 'Condroz', 'HEMECO', date '2026-09-16', 'Zone de police du Condroz (5296) — source secondaire, à confirmer par le RGP.'),
  ('Ouffet', 'Liège', 'Condroz', 'HEMECO', date '2026-09-16', 'Zone de police du Condroz (5296) — source secondaire, à confirmer par le RGP.'),
  ('Tinlot', 'Liège', 'Condroz', 'HEMECO', date '2026-09-16', 'Zone de police du Condroz (5296) — source secondaire, à confirmer par le RGP.'),
  ('Villers-le-Bouillet', 'Liège', null, 'HEMECO', date '2026-09-16', null),
  ('Wanze', 'Liège', null, 'HEMECO', date '2026-09-16', null),
  ('Aubel', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Baelen', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Blegny', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Dalhem', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Dison', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Herve', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Jalhay', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Limbourg', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Olne', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Pepinster', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Plombières', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Soumagne', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Spa', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Sprimont', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Theux', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Thimister-Clermont', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Trooz', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Verviers', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Welkenraedt', 'Liège', null, 'Vesdre-Hoëgne & Plateau', date '2026-09-16', null),
  ('Aywaille', 'Liège', null, 'Warche-Amblève-Lienne', date '2026-09-16', null),
  ('Lierneux', 'Liège', null, 'Warche-Amblève-Lienne', date '2026-09-16', null),
  ('Malmedy', 'Liège', null, 'Warche-Amblève-Lienne', date '2026-09-16', null),
  ('Stavelot', 'Liège', null, 'Warche-Amblève-Lienne', date '2026-09-16', null),
  ('Stoumont', 'Liège', null, 'Warche-Amblève-Lienne', date '2026-09-16', null),
  ('Trois-Ponts', 'Liège', null, 'Warche-Amblève-Lienne', date '2026-09-16', null),
  ('Waimes', 'Liège', null, 'Warche-Amblève-Lienne', date '2026-09-16', null),
  ('Amblève', 'Liège', null, 'Zone DG', date '2026-09-16', 'Nom allemand : Amel.'),
  ('Bullange', 'Liège', null, 'Zone DG', date '2026-09-16', 'Nom allemand : Büllingen.'),
  ('Burg-Reuland', 'Liège', null, 'Zone DG', date '2026-09-16', null),
  ('Butgenbach', 'Liège', null, 'Zone DG', date '2026-09-16', 'Nom allemand : Bütgenbach.'),
  ('Eupen', 'Liège', null, 'Zone DG', date '2026-09-16', null),
  ('La Calamine', 'Liège', null, 'Zone DG', date '2026-09-16', 'Nom allemand : Kelmis.'),
  ('Lontzen', 'Liège', null, 'Zone DG', date '2026-09-16', null),
  ('Raeren', 'Liège', null, 'Zone DG', date '2026-09-16', null),
  ('Saint-Vith', 'Liège', null, 'Zone DG', date '2026-09-16', 'Nom allemand : Sankt Vith.')
on conflict (nom) do update set
  province = excluded.province,
  zone_secours = excluded.zone_secours,
  zone_police = coalesce(communes.zone_police, excluded.zone_police),
  derniere_verification = excluded.derniere_verification,
  -- On ne perd jamais une note écrite à la main : la nouvelle s'ajoute.
  notes = trim(both ' ' from coalesce(communes.notes, '') || ' ' || coalesce(excluded.notes, ''));

commit;

-- =====================================================================
-- VÉRIFICATION
--   select zone_secours, count(*) from communes
--   where province = 'Liège' group by zone_secours order by zone_secours;
--   -- Hesbaye 13, HEMECO 15, IILE-SRI 21, VHP 19, WAL 7, DG 9 = 84
-- =====================================================================
