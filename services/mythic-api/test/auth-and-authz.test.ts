import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Ensure required env is present before importing the app (env is read at module load).
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_PROJECT_REF ||= "example";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "service_role_key_for_tests";

const { buildApp } = await import("../src/app.js");
const { AuthzError, assertCampaignAccess } = await import("../src/shared/authz.js");

describe("mythic-api auth + authz spine", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects missing bearer token with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/functions/v1/mythic-list-campaigns",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    const json = JSON.parse(res.body) as Record<string, unknown>;
    expect(typeof json.error).toBe("string");
    expect(json.code).toBe("auth_required");
    expect(typeof json.requestId).toBe("string");
  });

  it("rejects invalid bearer token format with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/functions/v1/mythic-list-campaigns",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer not-a-jwt",
      },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    const json = JSON.parse(res.body) as Record<string, unknown>;
    expect(typeof json.error).toBe("string");
    expect(json.code).toBe("auth_invalid");
    expect(typeof json.requestId).toBe("string");
  });

  it("returns 403 when campaign exists but user is not a member", async () => {
    const stubSvc = {
      from: (table: string) => {
        const builder: Record<string, any> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.maybeSingle = async () => {
          if (table === "campaigns") {
            return { data: { id: "11111111-1111-1111-1111-111111111111", owner_id: "owner" }, error: null };
          }
          if (table === "campaign_members") {
            return { data: null, error: null };
          }
          return { data: null, error: null };
        };
        return builder;
      },
    } as any;

    await expect(assertCampaignAccess(stubSvc, "11111111-1111-1111-1111-111111111111", "user"))
      .rejects
      .toEqual(expect.any(AuthzError));

    try {
      await assertCampaignAccess(stubSvc, "11111111-1111-1111-1111-111111111111", "user");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthzError);
      const err = error as AuthzError;
      expect(err.status).toBe(403);
      expect(err.code).toBe("campaign_access_denied");
    }
  });
});

