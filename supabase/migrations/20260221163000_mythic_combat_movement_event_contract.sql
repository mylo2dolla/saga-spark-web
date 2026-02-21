-- Add movement event type to combat action event contract.
-- Idempotent: drops/recreates the same named constraint with additive 'moved'.

create schema if not exists mythic;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'action_events_event_type_contract'
      and conrelid = 'mythic.action_events'::regclass
  ) then
    alter table mythic.action_events drop constraint action_events_event_type_contract;
  end if;

  alter table mythic.action_events
    add constraint action_events_event_type_contract
    check (
      event_type in (
        'combat_start',
        'round_start',
        'turn_start',
        'skill_used',
        'moved',
        'damage',
        'status_roll',
        'status_applied',
        'status_tick',
        'status_expired',
        'armor_shred',
        'power_drain',
        'power_gain',
        'healed',
        'cleanse',
        'revive',
        'phase_shift',
        'summon_spawn',
        'death',
        'loot_drop',
        'xp_gain',
        'level_up',
        'turn_end',
        'round_end',
        'combat_end',
        'board_transition'
      )
    );
end $$;
