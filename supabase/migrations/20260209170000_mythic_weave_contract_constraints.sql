-- Mythic Weave Core: enforce contracts/invariants at the DB layer (additive)
-- Idempotent: constraints are added only if missing.

create schema if not exists mythic;

do $$
begin
  -- action_events.event_type contract (append-only playback)
  if not exists (
    select 1 from pg_constraint
    where conname = 'action_events_event_type_contract'
  ) then
    alter table mythic.action_events
      add constraint action_events_event_type_contract
      check (
        event_type in (
          'combat_start',
          'round_start',
          'turn_start',
          'skill_used',
          'damage',
          'status_applied',
          'death',
          'loot_drop',
          'turn_end',
          'round_end',
          'combat_end',
          'board_transition'
        )
      );
  end if;

  -- combat_sessions.status contract
  if not exists (
    select 1 from pg_constraint
    where conname = 'combat_sessions_status_contract'
  ) then
    alter table mythic.combat_sessions
      add constraint combat_sessions_status_contract
      check (status in ('active','paused','ended','archived'));
  end if;

  -- skills JSON shape invariants: must be objects (not arrays/scalars)
  if not exists (
    select 1 from pg_constraint
    where conname = 'skills_json_shape_contract'
  ) then
    alter table mythic.skills
      add constraint skills_json_shape_contract
      check (
        jsonb_typeof(cost_json) = 'object'
        and jsonb_typeof(effects_json) = 'object'
        and jsonb_typeof(scaling_json) = 'object'
        and jsonb_typeof(counterplay) = 'object'
      );
  end if;

  -- items JSON shape invariants: affixes is array; others objects
  if not exists (
    select 1 from pg_constraint
    where conname = 'items_json_shape_contract'
  ) then
    alter table mythic.items
      add constraint items_json_shape_contract
      check (
        jsonb_typeof(weapon_profile) = 'object'
        and jsonb_typeof(affixes) = 'array'
        and jsonb_typeof(stat_mods) = 'object'
        and jsonb_typeof(effects_json) = 'object'
        and jsonb_typeof(drawback_json) = 'object'
        and jsonb_typeof(durability_json) = 'object'
      );
  end if;
end $$;

