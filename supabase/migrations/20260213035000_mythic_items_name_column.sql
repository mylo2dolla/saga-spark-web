create schema if not exists mythic;

alter table if exists mythic.items
  add column if not exists name text;

update mythic.items
set name = coalesce(nullif(trim(name), ''), 'Unnamed Item')
where name is null or trim(name) = '';

alter table if exists mythic.items
  alter column name set default 'Unnamed Item';

alter table if exists mythic.items
  alter column name set not null;
