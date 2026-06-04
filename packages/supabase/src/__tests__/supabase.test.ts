import { describe, it, expect, beforeEach } from "bun:test";
import { createServer } from "@emulators/core";
import { supabasePlugin, seedFromConfig, getSupabaseStore } from "../index.js";

const ANON = "supabase-anon-key";
const BASE = "http://localhost:4000";

function makeApp() {
  const { app, store } = createServer(supabasePlugin, { port: 4000 });
  supabasePlugin.seed?.(store, BASE);
  // Seed users + tables via the registry-shaped config.
  seedFromConfig(store, BASE, {
    anon_key: ANON,
    service_role_key: "supabase-service-role-key",
    users: [{ email: "hong@example.com", password: "password123" }],
    tables: {
      todos: [
        { id: 1, title: "장보기", completed: false },
        { id: 2, title: "청소하기", completed: true },
        { id: 3, title: "운동하기", completed: false },
      ],
    },
  });
  return { app, store };
}

function req(path: string, init: RequestInit = {}, withKey = true): Request {
  const headers = new Headers(init.headers);
  if (withKey && !headers.has("apikey")) headers.set("apikey", ANON);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`${BASE}${path}`, { ...init, headers });
}

describe("api key", () => {
  it("rejects requests without an apikey", async () => {
    const { app } = makeApp();
    const res = await app.fetch(req("/auth/v1/user", {}, false));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toBe("No API key found in request");
    expect(body.hint).toContain("No 'apikey'");
  });

  it("rejects REST requests without an apikey", async () => {
    const { app } = makeApp();
    const res = await app.fetch(req("/rest/v1/todos", {}, false));
    expect(res.status).toBe(401);
  });
});

describe("auth: signup", () => {
  it("creates a user and returns a JWT-shaped session", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      req("/auth/v1/signup", { method: "POST", body: JSON.stringify({ email: "new@example.com", password: "pw" }) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token_type).toBe("bearer");
    expect(body.expires_in).toBe(3600);
    expect(typeof body.refresh_token).toBe("string");
    expect(body.user.email).toBe("new@example.com");
    expect(body.user.role).toBe("authenticated");
    expect(body.user.aud).toBe("authenticated");
    // JWT shape: 3 base64url parts; middle decodes to expected payload.
    const parts = body.access_token.split(".");
    expect(parts.length).toBe(3);
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(payload.sub).toBe(body.user.id);
    expect(payload.role).toBe("authenticated");
    expect(payload.aud).toBe("authenticated");
    expect(typeof payload.session_id).toBe("string");
    expect(typeof payload.exp).toBe("number");
  });

  it("rejects duplicate signup with 422 user_already_exists", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      req("/auth/v1/signup", {
        method: "POST",
        body: JSON.stringify({ email: "hong@example.com", password: "x" }),
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error_code).toBe("user_already_exists");
    expect(body.msg).toBe("User already registered");
  });
});

describe("auth: token grants", () => {
  it("password grant succeeds", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      req("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email: "hong@example.com", password: "password123" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.user.email).toBe("hong@example.com");
  });

  it("password grant with wrong password returns invalid_credentials", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      req("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email: "hong@example.com", password: "wrong" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe("invalid_credentials");
  });

  it("refresh grant rotates the refresh token and rejects reuse", async () => {
    const { app } = makeApp();
    const login = await (
      await app.fetch(
        req("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: JSON.stringify({ email: "hong@example.com", password: "password123" }),
        }),
      )
    ).json();
    const oldRefresh = login.refresh_token;

    const refreshed = await app.fetch(
      req("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: oldRefresh }),
      }),
    );
    expect(refreshed.status).toBe(200);
    const refreshedBody = await refreshed.json();
    expect(refreshedBody.refresh_token).not.toBe(oldRefresh);
    expect(refreshedBody.access_token).not.toBe(login.access_token);

    // Reusing the old (rotated-out) refresh token is rejected.
    const reuse = await app.fetch(
      req("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: oldRefresh }),
      }),
    );
    expect(reuse.status).toBe(400);
  });
});

describe("auth: user + logout", () => {
  async function login(app: { fetch: (r: Request) => Promise<Response> }) {
    return (
      await app.fetch(
        req("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: JSON.stringify({ email: "hong@example.com", password: "password123" }),
        }),
      )
    ).json();
  }

  it("GET /auth/v1/user returns the user for a valid token", async () => {
    const { app } = makeApp();
    const session = await login(app);
    const res = await app.fetch(
      req("/auth/v1/user", { headers: { Authorization: `Bearer ${session.access_token}` } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("hong@example.com");
  });

  it("GET /auth/v1/user rejects an invalid token with bad_jwt", async () => {
    const { app } = makeApp();
    const res = await app.fetch(req("/auth/v1/user", { headers: { Authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe("bad_jwt");
  });

  it("PUT /auth/v1/user updates email and merges metadata", async () => {
    const { app } = makeApp();
    const session = await login(app);
    const res = await app.fetch(
      req("/auth/v1/user", {
        method: "PUT",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ email: "hong2@example.com", data: { nickname: "길동" } }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("hong2@example.com");
    expect(body.user_metadata.nickname).toBe("길동");
  });

  it("logout revokes the token", async () => {
    const { app } = makeApp();
    const session = await login(app);
    const out = await app.fetch(
      req("/auth/v1/logout", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } }),
    );
    expect(out.status).toBe(204);

    const after = await app.fetch(
      req("/auth/v1/user", { headers: { Authorization: `Bearer ${session.access_token}` } }),
    );
    expect(after.status).toBe(401);
  });
});

describe("auth: recover", () => {
  it("records a recovery request and exposes it internally", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      req("/auth/v1/recover", { method: "POST", body: JSON.stringify({ email: "hong@example.com" }) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});

    const list = await (await app.fetch(req("/internal/recoveries"))).json();
    expect(list.recoveries.length).toBe(1);
    expect(list.recoveries[0].email).toBe("hong@example.com");
  });
});

describe("rest: select", () => {
  it("returns seeded rows", async () => {
    const { app } = makeApp();
    const res = await app.fetch(req("/rest/v1/todos"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(3);
    expect(body[0].title).toBe("장보기");
  });

  it("404s for an unknown table with 42P01", async () => {
    const { app } = makeApp();
    const res = await app.fetch(req("/rest/v1/missing"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("42P01");
    expect(body.message).toBe('relation "public.missing" does not exist');
  });

  it("applies eq filter (boolean)", async () => {
    const { app } = makeApp();
    const res = await app.fetch(req("/rest/v1/todos?completed=eq.false"));
    const body = await res.json();
    expect(body.length).toBe(2);
    expect(body.every((r: { completed: boolean }) => r.completed === false)).toBe(true);
  });

  it("applies gt filter (number)", async () => {
    const { app } = makeApp();
    const res = await app.fetch(req("/rest/v1/todos?id=gt.1"));
    const body = await res.json();
    expect(body.map((r: { id: number }) => r.id).sort()).toEqual([2, 3]);
  });

  it("applies in filter", async () => {
    const { app } = makeApp();
    const res = await app.fetch(req("/rest/v1/todos?id=in.(1,3)"));
    const body = await res.json();
    expect(body.map((r: { id: number }) => r.id).sort()).toEqual([1, 3]);
  });

  it("applies like filter", async () => {
    const { app } = makeApp();
    const res = await app.fetch(req("/rest/v1/todos?title=like.%하기"));
    const body = await res.json();
    expect(body.map((r: { id: number }) => r.id).sort()).toEqual([2, 3]);
  });

  it("orders, limits and offsets", async () => {
    const { app } = makeApp();
    const res = await app.fetch(req("/rest/v1/todos?order=id.desc&limit=1&offset=1"));
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(2);
  });

  it("projects selected columns", async () => {
    const { app } = makeApp();
    const res = await app.fetch(req("/rest/v1/todos?select=id,title&id=eq.1"));
    const body = await res.json();
    expect(body[0]).toEqual({ id: 1, title: "장보기" });
  });

  it("returns a single object with the pgrst.object accept header", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      req("/rest/v1/todos?id=eq.1", { headers: { Accept: "application/vnd.pgrst.object+json" } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(1);
    expect(Array.isArray(body)).toBe(false);
  });

  it("returns 406 PGRST116 when single object matches multiple rows", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      req("/rest/v1/todos?completed=eq.false", { headers: { Accept: "application/vnd.pgrst.object+json" } }),
    );
    expect(res.status).toBe(406);
    const body = await res.json();
    expect(body.code).toBe("PGRST116");
  });

  it("emits Content-Range with count=exact", async () => {
    const { app } = makeApp();
    const res = await app.fetch(req("/rest/v1/todos", { headers: { Prefer: "count=exact" } }));
    expect(res.headers.get("Content-Range")).toBe("0-2/3");
  });
});

describe("rest: mutations", () => {
  it("inserts with representation and auto-assigns id", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      req("/rest/v1/todos", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ title: "새 할일", completed: false }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(4);
    expect(body[0].title).toBe("새 할일");
  });

  it("patches matching rows and merges body", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      req("/rest/v1/todos?id=eq.1", {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ completed: true }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].completed).toBe(true);
    expect(body[0].title).toBe("장보기");
  });

  it("deletes matching rows", async () => {
    const { app, store } = makeApp();
    const res = await app.fetch(
      req("/rest/v1/todos?id=eq.2", {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].id).toBe(2);
    const remaining = getSupabaseStore(store).rows.findBy("table", "todos");
    expect(remaining.length).toBe(2);
  });

  it("returns 204 for mutations without return=representation", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      req("/rest/v1/todos", { method: "POST", body: JSON.stringify({ title: "x", completed: false }) }),
    );
    expect(res.status).toBe(201);
    const patch = await app.fetch(
      req("/rest/v1/todos?id=eq.1", { method: "PATCH", body: JSON.stringify({ completed: true }) }),
    );
    expect(patch.status).toBe(204);
  });
});

describe("seedFromConfig", () => {
  it("seeds the registry initConfig shape", async () => {
    const { app } = makeApp();
    // Default registry user can log in.
    const res = await app.fetch(
      req("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email: "hong@example.com", password: "password123" }),
      }),
    );
    expect(res.status).toBe(200);
    // Seeded todos are queryable.
    const todos = await (await app.fetch(req("/rest/v1/todos"))).json();
    expect(todos.length).toBe(3);
  });
});
