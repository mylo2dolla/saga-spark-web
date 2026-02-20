import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

type Row = Record<string, unknown>;

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

async function main() {
  const client = new Client({
    hostname: env("PGHOST"),
    port: Number(Deno.env.get("PGPORT") ?? "5432"),
    user: env("PGUSER"),
    password: env("PGPASSWORD"),
    database: Deno.env.get("PGDATABASE") ?? "postgres",
    // Supabase pooler often fails strict verification in some runtimes; prefer encrypted when possible.
    tls: { enabled: true, enforce: false },
  });

  await client.connect();
  await client.queryArray("set role postgres");

  const queryOne = async (text: string, args: unknown[] = []): Promise<Row> => {
    const res = await client.queryObject<Row>({ text, args });
    if (res.rows.length !== 1) throw new Error(`Expected 1 row, got ${res.rows.length} for: ${text}`);
    return res.rows[0]!;
  };

  const queryMany = async (text: string, args: unknown[] = []): Promise<Row[]> => {
    const res = await client.queryObject<Row>({ text, args });
    return res.rows;
  };

  const out: Record<string, unknown> = {};

  out.power = await queryOne("select mythic.power_at_level(1) as p1, mythic.power_at_level(99) as p99");
  out.rng = await queryOne("select mythic.rng01($1,$2) as r01", [123, "test"]);

  const expectedVersions = { generator_script: 3, game_rules: 3, ui_turn_flow_rules: 2 };

  const scriptVersion = await queryOne(
    "select version, is_active from mythic.generator_scripts where name=$1",
    ["mythic-weave-core"],
  );
  const rulesVersion = await queryOne(
    "select version from mythic.game_rules where name=$1",
    ["mythic-weave-rules-v1"],
  );
  const uiVersion = await queryOne(
    "select version from mythic.ui_turn_flow_rules where name=$1",
    ["mythic-weave-ui-turn-flow-v1"],
  );

  out.versions = {
    expected: expectedVersions,
    actual: {
      generator_script: scriptVersion.version,
      generator_script_is_active: scriptVersion.is_active,
      game_rules: rulesVersion.version,
      ui_turn_flow_rules: uiVersion.version,
    },
    ok:
      scriptVersion.version === expectedVersions.generator_script &&
      rulesVersion.version === expectedVersions.game_rules &&
      uiVersion.version === expectedVersions.ui_turn_flow_rules,
  };

  out.skills_targeting_json = await queryOne(
    "select count(*)::int as column_count " +
      "from information_schema.columns " +
      "where table_schema='mythic' and table_name='skills' and column_name='targeting_json'",
  );

  out.content_policy_filters = {
    profanity_allowed: await queryOne("select not mythic.contains_forbidden_sexual_content($1) as ok", ["fuck"]),
    sexual_violence_blocked: await queryOne("select mythic.contains_forbidden_sexual_content($1) as ok", ["rape"]),
  };

  out.views = await queryOne(
    "select " +
      "to_regclass($1) is not null as has_v_combat_state_for_dm, " +
      "to_regclass($2) is not null as has_v_character_state_for_dm, " +
      "to_regclass($3) is not null as has_v_board_state_for_dm_legacy",
    ["mythic.v_combat_state_for_dm", "mythic.v_character_state_for_dm", "mythic.v_board_state_for_dm"],
  );

  out.tables = await queryOne(
    "select " +
      "to_regclass($1) is not null as has_campaign_runtime, " +
      "to_regclass($2) is not null as has_runtime_events, " +
      "to_regclass($3) is not null as has_combat_sessions, " +
      "to_regclass($4) is not null as has_action_events, " +
      "to_regclass($5) is not null as has_characters, " +
      "to_regclass($6) is not null as has_skills, " +
      "to_regclass($7) is not null as has_items, " +
      "to_regclass($8) is not null as has_inventory",
    [
      "mythic.campaign_runtime",
      "mythic.runtime_events",
      "mythic.combat_sessions",
      "mythic.action_events",
      "mythic.characters",
      "mythic.skills",
      "mythic.items",
      "mythic.inventory",
    ],
  );

  // Hard-fail if core expectations are not met.
  if ((out.versions as { ok: boolean }).ok !== true) {
    throw new Error(`Canonical versions mismatch: ${JSON.stringify(out.versions)}`);
  }
  if ((out.skills_targeting_json as { column_count: number }).column_count !== 1) {
    throw new Error(`Expected mythic.skills.targeting_json to exist`);
  }
  if (((out.content_policy_filters as { profanity_allowed: { ok: boolean } }).profanity_allowed.ok) !== true) {
    throw new Error(`Profanity appears to be blocked by contains_forbidden_sexual_content`);
  }
  if (((out.content_policy_filters as { sexual_violence_blocked: { ok: boolean } }).sexual_violence_blocked.ok) !== true) {
    throw new Error(`Sexual violence term did not trigger forbidden content filter`);
  }

  console.log(JSON.stringify(out, null, 2));
  await client.end();
}

if (import.meta.main) {
  await main();
}
