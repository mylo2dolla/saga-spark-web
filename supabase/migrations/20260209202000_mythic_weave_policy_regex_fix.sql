-- Mythic Weave: fix sexual-content filter regex (no whitespace/newline literals)
-- Forward-only, idempotent by CREATE OR REPLACE.

create schema if not exists mythic;

create or replace function mythic.contains_forbidden_sexual_content(txt text)
returns boolean
language sql
immutable
as $$
  select coalesce(txt, '') ~* '(\\bsex\\b|\\bsexual\\b|\\bsexual\\s+violence\\b|\\brape\\b|\\braped\\b|\\braping\\b|\\bmolest\\b|\\bmolested\\b|\\bmolester\\b|\\bporn\\b|\\bpornography\\b|\\berotic\\b|\\bnude\\b|\\bnudity\\b|\\bincest\\b|\\bunderage\\b|\\bchild\\s*porn\\b|\\bminor\\s*porn\\b|\\bblowjob\\b|\\bhandjob\\b|\\bintercourse\\b|\\bgenitals\\b|\\bvagina\\b|\\bpenis\\b|\\bclitoris\\b|\\btesticles\\b|\\borgasm\\b|\\bpenetrat(e|es|ed|ing)\\b)';
$$;

create or replace function mythic.content_is_allowed(txt text)
returns boolean
language sql
immutable
as $$
  select not mythic.contains_forbidden_sexual_content(txt);
$$;
