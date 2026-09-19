alter table transports add column precisions text;
comment on column transports.precisions is 'Contraintes horaires, matériel particulier, accès — texte libre distinct du motif.';