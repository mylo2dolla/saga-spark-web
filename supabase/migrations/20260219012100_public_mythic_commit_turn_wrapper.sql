-- Public RPC wrapper for mythic commit turn.
-- Required because clients call rpc("mythic_commit_turn") against public schema.

create or replace function public.mythic_commit_turn(
  campaign_id uuid,
  player_id uuid,
  board_id uuid,
  board_type text,
  turn_seed text,
  dm_request_json jsonb,
  dm_response_json jsonb,
  patches_json jsonb,
  roll_log_json jsonb
)
returns jsonb
language sql
security definer
set search_path = public, mythic
as $$
  select mythic.mythic_commit_turn(
    campaign_id,
    player_id,
    board_id,
    board_type,
    turn_seed,
    dm_request_json,
    dm_response_json,
    patches_json,
    roll_log_json
  );
$$;

grant execute on function public.mythic_commit_turn(
  uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb
) to anon, authenticated, service_role;

