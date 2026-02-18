-- Mythic Weave: relax sexual-content filter to allow mild sexuality / banter,
-- while still blocking sexual violence/coercion, minors, and explicit porn/acts.
-- Forward-only, additive (CREATE OR REPLACE).

create schema if not exists mythic;

create or replace function mythic.contains_forbidden_sexual_content(txt text)
returns boolean
language sql
immutable
as $$
  select coalesce(txt, '') ~* '(\msexual\s+violence\M|\msexual\s+assault\M|\mrape\M|\mraped\M|\mraping\M|\mmolest\M|\mmolested\M|\mmolester\M|\mnonconsensual\M|\mnon-consensual\M|\munderage\M|\mchild\s*porn\M|\mminor\s*porn\M|\mloli\M|\mporn\M|\mpornography\M|\merotic\M|\mnude\M|\mnudity\M|\mincest\M|\mblowjob\M|\mhandjob\M|\mintercourse\M|\mgenitals\M|\mvagina\M|\mpenis\M|\mclitoris\M|\mtesticles\M|\morgasm\M)';
$$;

create or replace function mythic.content_is_allowed(txt text)
returns boolean
language sql
immutable
as $$
  select not mythic.contains_forbidden_sexual_content(txt);
$$;

