-- =====================================================================
-- Vérification de la migration 171 — lecture seule.
--
-- À lancer dans le SQL Editor de Supabase (rôle postgres), après le
-- « Go 171 » puis après chaque migration qui crée une fonction.
--
--   1. Le contrôle : il ne doit renvoyer AUCUNE ligne.
--   2. Les 37 écritures du masquage : la colonne `ok` doit valoir true
--      partout (24 textes masqués, 13 inchangés).
--
-- Rien n'est écrit en base.
-- =====================================================================

-- 1. Les fonctions qui dépassent : exécutables sans connexion hors liste
--    voulue, ouvertes à PUBLIC, ou sans search_path figé. Attendu : vide.
select * from audit_fonctions_exposees();

-- 2. Le masquage. (texte, attendu) ; attendu null = le texte doit rester inchangé.
select t.texte, masquer_numeros(t.texte) as obtenu,
       masquer_numeros(t.texte) = coalesce(t.attendu, t.texte) as ok
  from (values
  ('Appelle Régis au 0470 11 22 33',
     'Appelle Régis au [numéro : voir le QG]'),
  ('GSM 0470/11.22.33',
     'GSM [numéro : voir le QG]'),
  ('+32 470 11 22 33',
     '[numéro : voir le QG]'),
  ('0032470112233',
     '[numéro : voir le QG]'),
  ('+32(0)470 11 22 33',
     '[numéro : voir le QG]'),
  ('0470112233',
     '[numéro : voir le QG]'),
  ('04 70 11 22 33',
     '[numéro : voir le QG]'),
  ('0470-11-22-33',
     '[numéro : voir le QG]'),
  ('Fixe 086 21 12 34',
     'Fixe [numéro : voir le QG]'),
  ('04/222.33.44',
     '[numéro : voir le QG]'),
  ('Numéro vert 0800 12 345',
     'Numéro vert [numéro : voir le QG]'),
  ('0470 11 22 33 ou 0471 22 33 44',
     '[numéro : voir le QG] ou [numéro : voir le QG]'),
  ('tel:0470.11.22.33',
     'tel:[numéro : voir le QG]'),
  ('+33 6 12 34 56 78',
     '[numéro : voir le QG]'),
  ('whatsapp wa.me/32470112233',
     'whatsapp wa.me/[numéro : voir le QG]'),
  ('GSM 0470' || chr(160) || '11' || chr(160) || '22' || chr(160) || '33',
     'GSM [numéro : voir le QG]'),
  ('GSM 0470' || chr(8239) || '11' || chr(8239) || '22' || chr(8239) || '33',
     'GSM [numéro : voir le QG]'),
  ('0470' || chr(8209) || '11' || chr(8209) || '22' || chr(8209) || '33',
     '[numéro : voir le QG]'),
  ('0470_11_22_33',
     '[numéro : voir le QG]'),
  ('Tél : 21 12 34',
     'Tél : [numéro : voir le QG]'),
  ('mail regis.dupont@example.be',
     'mail [adresse : voir le QG]'),
  ('Poste 09.00-12.30 0470 11 22 33',
     'Poste 09.00-12.30 [numéro : voir le QG]'),
  ('Urgence 112, QG canal 3',
     null),
  ('Créneau 14h00-18h30, 25 barrières',
     null),
  ('Code cadenas 4812',
     null),
  ('Montage du 21/08/2027 au 22/08/2027',
     null),
  ('Poste tenu de 20.30-22.30',
     null),
  ('Poste 09.00-12.30 2 personnes',
     null),
  ('Stock : 1 500 000 gobelets',
     null),
  ('Coordonnées 50.3832, 5.6143',
     null),
  ('Rue de la Station 12-14 4190 Ferrières',
     null),
  ('Fréquence 446.00625 MHz',
     null),
  ('le 15-08-2026',
     null),
  ('Réf. LOG-2026-044',
     null),
  ('2 x 10 m, 3 x 3 m (12 pièces)',
     null),
  ('IBAN BE68 5390 0754 7034',
     'IBAN BE[numéro : voir le QG]'),
  ('TVA BE 0123.456.789',
     'TVA BE [numéro : voir le QG]')
  ) as t(texte, attendu);
