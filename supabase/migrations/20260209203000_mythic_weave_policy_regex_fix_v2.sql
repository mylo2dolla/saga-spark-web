-- Mythic Weave: fix sexual-content filter regex to use Postgres word boundaries (\m ... \M)
-- Forward-only, idempotent by CREATE OR REPLACE.

create schema if not exists mythic;

create or replace function mythic.contains_forbidden_sexual_content(txt text)
returns boolean
language sql
immutable
as $$
  select coalesce(txt, '') ~* '(\msex\M|\msexual\M|\msexual\s+violence\M|\mrape\M|\mraped\M|\mraping\M|\mmolest\M|\mmolested\M|\mmolester\M|\mporn\M|\mpornography\M|\merotic\M|\mnude\M|\mnudity\M|\mincest\M|\munderage\M|\mchild\s*porn\M|\mminor\s*porn\M|\mblowjob\M|\mhandjob\M|\mintercourse\M|\mgenitals\M|\mvagina\M|\mpenis\M|\mclitoris\M|\mtesticles\M|\morgasm\M)';
$$;

create or replace function mythic.content_is_allowed(txt text)
returns boolean
language sql
immutable
as $$
  select not mythic.contains_forbidden_sexual_content(txt);
$$;
