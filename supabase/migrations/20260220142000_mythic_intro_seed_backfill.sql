-- Backfill intro starter direction for campaigns that have not taken any turns yet.
-- Idempotent and safe: only touches active town boards with zero committed turns.

with target_boards as (
  select
    b.id as board_id,
    b.campaign_id,
    coalesce(c.name, 'Mythic Campaign') as campaign_name,
    coalesce(nullif(trim(c.description), ''), 'A dangerous world in motion.') as campaign_description,
    coalesce(wp.template_key, cwp.template_key, 'custom') as template_key,
    coalesce(b.state_json, '{}'::jsonb) as state_json
  from mythic.boards b
  join campaigns c
    on c.id = b.campaign_id
  left join mythic.world_profiles wp
    on wp.campaign_id = b.campaign_id
  left join mythic.campaign_world_profiles cwp
    on cwp.campaign_id = b.campaign_id
  where
    b.status = 'active'
    and b.board_type = 'town'
    and not exists (
      select 1
      from mythic.turns t
      where t.campaign_id = b.campaign_id
    )
),
prepared as (
  select
    tb.board_id,
    tb.state_json,
    case
      when jsonb_typeof(tb.state_json -> 'rumors') = 'array'
           and jsonb_array_length(tb.state_json -> 'rumors') > 0
        then tb.state_json -> 'rumors'
      else jsonb_build_array(
        jsonb_build_object(
          'title', 'Frontline Signal',
          'detail', format('A threat report has surfaced around %s.', tb.campaign_name),
          'tags', jsonb_build_array('intro', 'threat', coalesce(nullif(tb.template_key, ''), 'custom'))
        ),
        jsonb_build_object(
          'title', 'Immediate Opportunity',
          'detail', 'A fresh lead is available on the board right now.',
          'tags', jsonb_build_array('intro', 'opportunity')
        )
      )
    end as rumors_json,
    case
      when jsonb_typeof(tb.state_json -> 'objectives') = 'array'
           and jsonb_array_length(tb.state_json -> 'objectives') > 0
        then tb.state_json -> 'objectives'
      else jsonb_build_array(
        jsonb_build_object(
          'title', 'First Footing',
          'description', 'Establish leverage before the next escalation.',
          'priority', 'high',
          'tags', jsonb_build_array('intro', 'starter')
        ),
        jsonb_build_object(
          'title', 'Read The Situation',
          'description', 'Commit one concrete move from current leads this turn.',
          'priority', 'high',
          'tags', jsonb_build_array('intro', 'analysis')
        )
      )
    end as objectives_json,
    case
      when jsonb_typeof(tb.state_json -> 'discovery_log') = 'array'
           and jsonb_array_length(tb.state_json -> 'discovery_log') > 0
        then tb.state_json -> 'discovery_log'
      else jsonb_build_array(
        jsonb_build_object(
          'kind', 'intro_briefing',
          'title', 'Opening Briefing',
          'detail', format('%s: %s', tb.campaign_name, tb.campaign_description),
          'source', 'migration',
          'seeded_at', timezone('utc', now())
        )
      )
    end as discovery_log_json,
    case
      when jsonb_typeof(tb.state_json -> 'action_chips') = 'array'
           and jsonb_array_length(tb.state_json -> 'action_chips') > 0
        then tb.state_json -> 'action_chips'
      else jsonb_build_array(
        jsonb_build_object(
          'id', 'intro-town-brief',
          'label', 'Read Local Briefing',
          'intent', 'town',
          'hint_key', 'intro:town_brief',
          'boardTarget', 'town',
          'prompt', format('I gather immediate leads in %s and identify who controls this front.', tb.campaign_name),
          'payload', jsonb_build_object('intro', true, 'board_feature', 'notice_board')
        ),
        jsonb_build_object(
          'id', 'intro-travel-scout',
          'label', 'Scout Outer Route',
          'intent', 'travel',
          'hint_key', 'intro:travel_scout',
          'boardTarget', 'travel',
          'prompt', 'I scout the outer route for threats, supplies, and a decisive next objective.',
          'payload', jsonb_build_object('intro', true, 'travel_probe', 'scout_route')
        ),
        jsonb_build_object(
          'id', 'intro-dungeon-push',
          'label', 'Press The Hotspot',
          'intent', 'dungeon',
          'hint_key', 'intro:dungeon_push',
          'boardTarget', 'dungeon',
          'prompt', 'I push into the nearest hotspot and force the first meaningful confrontation.',
          'payload', jsonb_build_object('intro', true, 'search_target', 'hotspot')
        ),
        jsonb_build_object(
          'id', 'intro-dm-read',
          'label', 'Ask For Tactical Read',
          'intent', 'dm_prompt',
          'hint_key', 'intro:tactical_read',
          'prompt', format('Give me the immediate tactical read in %s: biggest threat, best opening, and first payoff path.', tb.campaign_name),
          'payload', jsonb_build_object('intro', true, 'followup', 'tactical_read')
        )
      )
    end as action_chips_json,
    (
      case
        when jsonb_typeof(tb.state_json -> 'discovery_flags') = 'object'
          then tb.state_json -> 'discovery_flags'
        else '{}'::jsonb
      end
      || jsonb_build_object(
        'intro_pending', true,
        'intro_version', 1,
        'intro_seeded_at', timezone('utc', now()),
        'intro_source', 'migration'
      )
    ) as discovery_flags_json
  from target_boards tb
)
update mythic.boards b
set state_json = coalesce(b.state_json, '{}'::jsonb)
  || jsonb_build_object(
    'rumors', p.rumors_json,
    'objectives', p.objectives_json,
    'discovery_log', p.discovery_log_json,
    'action_chips', p.action_chips_json,
    'discovery_flags', p.discovery_flags_json
  ),
  updated_at = timezone('utc', now())
from prepared p
where b.id = p.board_id;
