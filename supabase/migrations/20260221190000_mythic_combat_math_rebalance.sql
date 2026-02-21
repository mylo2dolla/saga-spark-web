-- Combat math rebalance: target 6-10 hit baseline in equal-level fights.
-- Forward-only change: keeps deterministic RNG/crit pipeline, updates rating/HP scaling and integer final damage.

create or replace function mythic.attack_rating(lvl int, offense int, weapon_power numeric)
returns numeric
language plpgsql
immutable
as $$
declare
  l double precision := greatest(1, least(99, coalesce(lvl, 1)));
  o double precision := mythic.clamp_double(coalesce(offense, 0), 0, 100);
  wp double precision := greatest(coalesce(weapon_power, 0)::double precision, 0);
begin
  return round(14.0 + (l * 1.55) + (o * 0.32) + (wp * 0.40));
end;
$$;

create or replace function mythic.max_hp(lvl int, defense int, support int)
returns numeric
language plpgsql
immutable
as $$
declare
  l double precision := greatest(1, least(99, coalesce(lvl, 1)));
  d double precision := mythic.clamp_double(coalesce(defense, 0), 0, 100);
  s double precision := mythic.clamp_double(coalesce(support, 0), 0, 100);
begin
  return round(120.0 + (l * 6.5) + (d * 0.95) + (s * 0.75));
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
  mitigated numeric;
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

  mitigated := mythic.mitigate(pre, r);

  if pre <= 0 then
    final_damage := 0;
  else
    final_damage := greatest(1, round(mitigated));
  end if;

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
