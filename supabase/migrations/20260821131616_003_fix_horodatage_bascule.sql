-- now() renvoie l'heure de DÉBUT de transaction : trois bascules dans la même
-- transaction portaient un horodatage identique, rendant l'ordre indéterminable.
-- clock_timestamp() donne l'heure réelle de l'instruction.
alter table bascule_phase alter column bascule_le set default clock_timestamp();