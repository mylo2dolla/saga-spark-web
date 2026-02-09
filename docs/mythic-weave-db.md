# Mythic Weave DB (Supabase) - Mythic Weave "Living Dungeon Comic"

This repo stores the authoritative Mythic Weave rules in Supabase Postgres under schema `mythic`.

## Apply Migrations (Remote Supabase Project)

1. Link the project:
```bash
cd /Users/dev/saga-spark-web
supabase link --project-ref othlyxwtigxzczeffzee
```

2. Push migrations:
```bash
supabase db push
```

If `supabase db push` errors, fix the migration and re-run until clean.

## Local Development Caveat (Docker)

Supabase local development (`supabase start`, local Postgres) requires Docker. If Docker Desktop is not running/installed, use the **remote** project workflow (`supabase link` + `supabase db push`) for migrations.

## Update Canonical Generator Script In DB

The canonical generator script is stored in:
- `mythic.generator_scripts` (row: `name='mythic-weave-core'`)

To update it, **create a new migration** that upserts the row by `name` (recommended):
1. Copy the `insert ... on conflict (name) do update ...` block from
   `supabase/migrations/20260208140200_mythic_weave_seed_rules.sql`.
2. Paste it into a new migration file with a later timestamp.
3. Bump `version` and replace the `content` block.

Keep it deterministic and aligned with `mythic.game_rules` and `mythic.ui_turn_flow_rules`.

## How The UI Reads Boards + Transitions

Authoritative storage:
- `mythic.boards`
  - `state_json`: everything required to render a board deterministically
  - `ui_hints_json`: camera/zoom/highlights
  - `combat_session_id` when board_type = `combat`
- `mythic.board_transitions` (append-only)
  - `animation` is always `page_turn`
  - `payload_json` describes what changed

UI workflow:
1. Read current active board row for a campaign (by `campaign_id`, `status='active'`).
2. Render using `board_type` + `state_json`.
3. When switching, append a `board_transitions` row and update/insert the new `boards` row.
4. UI plays page-turn animation based on the transition row.

Canonical switching rules live in:
- `mythic.ui_turn_flow_rules` (row: `name='mythic-weave-ui-turn-flow-v1'`)

## How The UI Reads Combat Playback

Authoritative storage:
- `mythic.combat_sessions` (current turn index)
- `mythic.turn_order` (turn_index -> combatant_id)
- `mythic.combatants` (grid position, HP, statuses)
- `mythic.action_events` (append-only playback log)

Highlight active turn:
1. Read `combat_sessions.current_turn_index`.
2. Map to the actor via `turn_order`.
3. Highlight that combatant token on the grid.

Playback:
1. Fetch `action_events` ordered by `created_at`.
2. Apply events in order for deterministic replays/animations.

DM payload view:
- `mythic.v_combat_state_for_dm` includes a prebuilt JSON payload with combatants, turn_order, and recent events.

## Quick Seed (No Placeholders)

This snippet creates or reuses a seed campaign owned by the **earliest** `auth.users` row, initializes DM state, ensures an active Town board, and inserts one sample faction.

```sql
do $$
declare
  v_owner uuid;
  v_campaign_id uuid;
begin
  select id into v_owner
  from auth.users
  order by created_at asc
  limit 1;

  if v_owner is null then
    raise exception 'No auth.users found. Create a Supabase user first, then re-run.';
  end if;

  select id into v_campaign_id
  from public.campaigns
  where owner_id = v_owner and name = 'Mythic Weave Seed'
  order by created_at desc
  limit 1;

  if v_campaign_id is null then
    insert into public.campaigns (name, description, owner_id, current_scene, game_state, is_active)
    values (
      'Mythic Weave Seed',
      'Seed campaign for mythic schema verification',
      v_owner,
      'Town: The Ink-Stained Lantern',
      '{}'::jsonb,
      true
    )
    returning id into v_campaign_id;
  end if;

  insert into public.campaign_members (campaign_id, user_id, is_dm)
  values (v_campaign_id, v_owner, true)
  on conflict (campaign_id, user_id) do update
  set is_dm = excluded.is_dm;

  insert into mythic.dm_campaign_state (campaign_id)
  values (v_campaign_id)
  on conflict (campaign_id) do nothing;

  insert into mythic.dm_world_tension (campaign_id)
  values (v_campaign_id)
  on conflict (campaign_id) do nothing;

  if not exists (
    select 1
    from mythic.boards
    where campaign_id = v_campaign_id and status = 'active'
  ) then
    insert into mythic.boards (campaign_id, board_type, status, state_json, ui_hints_json)
    values (
      v_campaign_id,
      'town',
      'active',
      jsonb_build_object(
        'seed', 12345,
        'vendors', jsonb_build_array(
          jsonb_build_object('id','vendor_blacksmith','name','Grinbolt the Anvil','services', jsonb_build_array('repair','craft')),
          jsonb_build_object('id','vendor_alchemist','name','Mira \"Boom\" Vell','services', jsonb_build_array('potions','bombs'))
        ),
        'services', jsonb_build_array('inn','healer','notice_board'),
        'gossip', jsonb_build_array('A bounty poster has fresh ink.','Something under the well keeps laughing.'),
        'factions_present', jsonb_build_array('Town Watch','Coin-Eaters Guild'),
        'guard_alertness', 0.2,
        'bounties', jsonb_build_array(),
        'rumors', jsonb_build_array('A caravan vanished on the south road.'),
        'consequence_flags', jsonb_build_object()
      ),
      jsonb_build_object('camera', jsonb_build_object('x',0,'y',0,'zoom',1.0))
    );
  end if;

  insert into mythic.factions (campaign_id, name, description, tags)
  values (
    v_campaign_id,
    'Town Watch',
    'Badge-polishers with a grudge and a surprisingly sharp memory.',
    array['law','order','bribes']
  )
  on conflict (campaign_id, name) do update
  set description = excluded.description,
      tags = excluded.tags;

  raise notice 'Seeded campaign_id=%', v_campaign_id;
end $$;
```

## Quick Test SQL Snippets

### RNG
```sql
select mythic.rng01(123,'test') as r01,
       mythic.rng_int(123,'test',1,10) as rint,
       mythic.rng_pick(123,'pick',array['a','b','c']) as pick;
```

### Power curve
```sql
select mythic.power_at_level(1) as p1,
       mythic.power_at_level(99) as p99;
```

### Damage computation
```sql
select mythic.compute_damage(
  1337,
  'slash',
  10,
  35,  -- offense
  20,  -- mobility
  15,  -- utility
  12,  -- weapon_power
  1.15, -- skill_mult
  40,  -- resist
  0.10
) as damage;
```

### Confirm seeded script/rules exist
```sql
select name, version, is_active from mythic.generator_scripts where name='mythic-weave-core';
select name, version from mythic.game_rules where name='mythic-weave-rules-v1';
select name, version from mythic.ui_turn_flow_rules where name='mythic-weave-ui-turn-flow-v1';
```

## Verify Canonical Versions (Expected)

After the latest Mythic Weave V3 migrations, these should be true:

```sql
select name, version, is_active
from mythic.generator_scripts
where name = 'mythic-weave-core';

select name, version
from mythic.game_rules
where name = 'mythic-weave-rules-v1';

select name, version
from mythic.ui_turn_flow_rules
where name = 'mythic-weave-ui-turn-flow-v1';

select column_name, data_type
from information_schema.columns
where table_schema = 'mythic'
  and table_name = 'skills'
  and column_name = 'targeting_json';

select
  mythic.contains_forbidden_sexual_content('fuck') as profanity_should_be_false,
  mythic.contains_forbidden_sexual_content('rape') as sexual_violence_should_be_true;
```
