-- Mythic Weave Core (sync): deterministic RNG + power curve + combat math
-- This migration exists to reconcile local migration history with the remote project.
-- Idempotent by design: CREATE IF NOT EXISTS / CREATE OR REPLACE only.

create extension if not exists pgcrypto;

create schema if not exists mythic;

-- -----------------------------
-- Helper: clamp
-- -----------------------------
create or replace function mythic.clamp_double(x double precision, lo double precision, hi double precision)
returns double precision
language sql
immutable
as $$
select least(greatest(x, lo), hi);
$$;

-- -----------------------------
-- Deterministic RNG (md5-based)
-- -----------------------------
-- rng01(seed,label) -> [0,1)
create or replace function mythic.rng01(seed int, label text)
returns double precision
language plpgsql
immutable
as $$
declare
  h text;
  n numeric;
begin
  -- md5 is stable across versions; use first 16 hex chars -> 64-bit-ish space
  h := substr(md5(seed::text || ':' || coalesce(label, '')), 1, 16);
  -- Convert hex to numeric; keep it positive and in a fixed range.
  n := abs(('x' || h)::bit(64)::bigint)::numeric;
  return ((n % 1000000000)::double precision) / 1000000000.0;
end;
$$;

create or replace function mythic.rng_int(seed int, label text, lo int, hi int)
returns int
language plpgsql
immutable
as $$
declare
  a int := least(lo, hi);
  b int := greatest(lo, hi);
  span int := (b - a) + 1;
begin
  if span <= 1 then
    return a;
  end if;
  return a + floor(mythic.rng01(seed, label) * span)::int;
end;
$$;

create or replace function mythic.rng_pick(seed int, label text, arr text[])
returns text
language plpgsql
immutable
as $$
declare
  n int;
  idx int;
begin
  n := coalesce(array_length(arr, 1), 0);
  if n <= 0 then
    return null;
  end if;
  idx := mythic.rng_int(seed, label, 1, n);
  return arr[idx];
end;
$$;

-- -----------------------------
-- Power curve (Level 1..99)
-- Level 1 power: 1
-- Level 99 power: 1,000,000
-- -----------------------------
create or replace function mythic.power_at_level(lvl int)
returns numeric
language plpgsql
immutable
as $$
declare
  l int := greatest(1, least(99, coalesce(lvl, 1)));
  t double precision := (l - 1)::double precision / 98.0;
  p double precision;
begin
  p := exp(t * ln(1000000.0));
  if p < 1.0 then p := 1.0; end if;
  if p > 1000000.0 then p := 1000000.0; end if;
  return p::numeric;
end;
$$;

-- -----------------------------
-- Derived stats
-- Base stats are 0..100:
-- offense, defense, control, support, mobility, utility
-- -----------------------------
create or replace function mythic.attack_rating(lvl int, offense int, weapon_power numeric)
returns numeric
language plpgsql
immutable
as $$
declare
  p double precision := sqrt(mythic.power_at_level(lvl)::double precision);
  o double precision := mythic.clamp_double(coalesce(offense, 0), 0, 100);
  wp double precision := greatest(coalesce(weapon_power, 0)::double precision, 0);
begin
  return (p * (1.0 + o / 100.0) * (1.0 + wp / 100.0))::numeric;
end;
$$;

create or replace function mythic.armor_rating(lvl int, defense int, armor_power numeric)
returns numeric
language plpgsql
immutable
as $$
declare
  p double precision := sqrt(mythic.power_at_level(lvl)::double precision);
  d double precision := mythic.clamp_double(coalesce(defense, 0), 0, 100);
  ap double precision := greatest(coalesce(armor_power, 0)::double precision, 0);
begin
  return (p * (1.0 + d / 100.0) * (1.0 + ap / 100.0))::numeric;
end;
$$;

create or replace function mythic.max_hp(lvl int, defense int, support int)
returns numeric
language plpgsql
immutable
as $$
declare
  p double precision := sqrt(mythic.power_at_level(lvl)::double precision);
  d double precision := mythic.clamp_double(coalesce(defense, 0), 0, 100);
  s double precision := mythic.clamp_double(coalesce(support, 0), 0, 100);
begin
  -- Keep HP in a manageable range while still scaling across 1..99.
  return (100.0 + p * (1.0 + d / 150.0) * (1.0 + s / 200.0))::numeric;
end;
$$;

create or replace function mythic.max_power_bar(lvl int, utility int, support int)
returns numeric
language plpgsql
immutable
as $$
declare
  p double precision := sqrt(mythic.power_at_level(lvl)::double precision);
  u double precision := mythic.clamp_double(coalesce(utility, 0), 0, 100);
  s double precision := mythic.clamp_double(coalesce(support, 0), 0, 100);
begin
  return (50.0 + (p * 0.5) * (1.0 + u / 200.0) * (1.0 + s / 250.0))::numeric;
end;
$$;

-- -----------------------------
-- Combat math
-- -----------------------------
create or replace function mythic.mitigate(raw_damage numeric, resist numeric)
returns numeric
language plpgsql
immutable
as $$
declare
  dmg numeric := greatest(coalesce(raw_damage, 0), 0);
  r numeric := greatest(coalesce(resist, 0), 0);
begin
  return dmg * 100 / (100 + r);
end;
$$;

create or replace function mythic.crit_chance(mobility int, utility int)
returns double precision
language plpgsql
immutable
as $$
declare
  m double precision := mythic.clamp_double(coalesce(mobility, 0), 0, 100);
  u double precision := mythic.clamp_double(coalesce(utility, 0), 0, 100);
  c double precision;
begin
  c := 0.02 + (m + u) / 400.0;
  return mythic.clamp_double(c, 0.02, 0.60);
end;
$$;

create or replace function mythic.crit_mult(offense int, utility int)
returns double precision
language plpgsql
immutable
as $$
declare
  o double precision := mythic.clamp_double(coalesce(offense, 0), 0, 100);
  u double precision := mythic.clamp_double(coalesce(utility, 0), 0, 100);
  m double precision;
begin
  m := 1.5 + (o + u) / 200.0;
  return mythic.clamp_double(m, 1.5, 3.0);
end;
$$;

create or replace function mythic.compute_damage(
  seed int,
  label text,
  lvl int,
  offense int,
  mobility int,
  utility int,
  weapon_power numeric,
  skill_mult numeric,
  resist numeric,
  spread_pct double precision default 0.10
)
returns jsonb
language plpgsql
immutable
as $$
declare
  ar numeric;
  base_before_spread numeric;
  spread double precision;
  pre numeric;
  r numeric := greatest(coalesce(resist, 0), 0);
  cc double precision;
  cm double precision;
  is_crit boolean;
  final_damage numeric;
begin
  ar := mythic.attack_rating(lvl, offense, weapon_power);
  base_before_spread := ar * greatest(coalesce(skill_mult, 1), 0);

  spread := (mythic.rng01(seed, coalesce(label, '') || ':spread') - 0.5) * 2.0 * mythic.clamp_double(coalesce(spread_pct, 0.10), 0.0, 0.50);
  pre := base_before_spread * (1.0 + spread);

  cc := mythic.crit_chance(mobility, utility);
  cm := mythic.crit_mult(offense, utility);
  is_crit := mythic.rng01(seed, coalesce(label, '') || ':crit') < cc;

  if is_crit then
    pre := pre * cm;
  end if;

  final_damage := mythic.mitigate(pre, r);

  return jsonb_build_object(
    'attack_rating', ar,
    'base_before_spread', base_before_spread,
    'spread', spread,
    'pre_mitigation', pre,
    'resist', r,
    'is_crit', is_crit,
    'crit_chance', cc,
    'crit_mult', cm,
    'final_damage', final_damage
  );
end;
$$;

create or replace function mythic.status_apply_chance(control int, utility int, target_resolve int)
returns double precision
language plpgsql
immutable
as $$
declare
  c double precision := mythic.clamp_double(coalesce(control, 0), 0, 100);
  u double precision := mythic.clamp_double(coalesce(utility, 0), 0, 100);
  tr double precision := mythic.clamp_double(coalesce(target_resolve, 0), 0, 200);
  x double precision;
begin
  -- A simple, explainable model: advantage minus resolve with a floor/ceiling.
  x := 0.05 + (c + u - tr) / 200.0;
  return mythic.clamp_double(x, 0.05, 0.95);
end;
$$;

create or replace function mythic.rep_drift(current_rep int, drift_per_day int default 2)
returns int
language plpgsql
immutable
as $$
declare
  rep int := coalesce(current_rep, 0);
  d int := greatest(coalesce(drift_per_day, 2), 0);
begin
  if rep > 0 then
    return greatest(rep - d, 0);
  elsif rep < 0 then
    return least(rep + d, 0);
  else
    return 0;
  end if;
end;
$$;

