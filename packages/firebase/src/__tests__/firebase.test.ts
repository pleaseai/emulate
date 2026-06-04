import { describe, it, expect, beforeEach } from "bun:test";
import { createServer } from "@emulators/core";
import { firebasePlugin, seedFromConfig, getFirebaseStore, type FirebaseSeedConfig } from "../index.js";

const BASE = "http://localhost:4000";
const API_KEY = "demo-api-key";
const PROJECT_ID = "demo-project";

function makeApp() {
  const { app, store } = createServer(firebasePlugin, { port: 4000 });
  firebasePlugin.seed?.(store, BASE);
  return { app, store };
}

function decodeJwtPayload(token: string): any {
  const parts = token.split(".");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
}

async function post(app: { fetch: (r: Request) => Promise<Response> }, path: string, body: unknown, key = API_KEY) {
  const url = key ? `${BASE}${path}?key=${key}` : `${BASE}${path}`;
  return app.fetch(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function signUp(app: any, email: string, password: string, displayName?: string) {
  const res = await post(app, "/v1/accounts:signUp", {
    email,
    password,
    displayName,
    returnSecureToken: true,
  });
  return { res, json: await res.json() };
}

describe("Identity Toolkit - signUp", () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => {
    ctx = makeApp();
  });

  it("creates an account and returns a JWT-shaped idToken", async () => {
    const { res, json } = await signUp(ctx.app, "alice@example.com", "password123", "Alice");
    expect(res.status).toBe(200);
    expect(json.kind).toBe("identitytoolkit#SignupNewUserResponse");
    expect(json.email).toBe("alice@example.com");
    expect(json.expiresIn).toBe("3600");
    expect(typeof json.localId).toBe("string");
    expect(typeof json.refreshToken).toBe("string");

    // idToken must be JWT-shaped (three base64url segments).
    expect(json.idToken.split(".")).toHaveLength(3);
    const payload = decodeJwtPayload(json.idToken);
    expect(payload.iss).toBe(`https://securetoken.google.com/${PROJECT_ID}`);
    expect(payload.aud).toBe(PROJECT_ID);
    expect(payload.sub).toBe(json.localId);
    expect(payload.user_id).toBe(json.localId);
    expect(payload.email).toBe("alice@example.com");
    expect(payload.exp - payload.iat).toBe(3600);
    expect(payload.firebase.sign_in_provider).toBe("password");
  });

  it("rejects EMAIL_EXISTS", async () => {
    await signUp(ctx.app, "dup@example.com", "password123");
    const { res, json } = await signUp(ctx.app, "dup@example.com", "password123");
    expect(res.status).toBe(400);
    expect(json.error.message).toBe("EMAIL_EXISTS");
    expect(json.error.errors[0].reason).toBe("invalid");
  });

  it("rejects WEAK_PASSWORD", async () => {
    const { res, json } = await signUp(ctx.app, "weak@example.com", "123");
    expect(res.status).toBe(400);
    expect(json.error.message).toBe("WEAK_PASSWORD : Password should be at least 6 characters");
  });

  it("supports anonymous sign-up", async () => {
    const res = await post(ctx.app, "/v1/accounts:signUp", { returnSecureToken: true });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(typeof json.localId).toBe("string");
    expect(json.email).toBeUndefined();
    const payload = decodeJwtPayload(json.idToken);
    expect(payload.firebase.sign_in_provider).toBe("anonymous");
  });

  it("rejects invalid API key", async () => {
    const res = await post(ctx.app, "/v1/accounts:signUp", { returnSecureToken: true }, "bad-key");
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.message).toBe("API key not valid. Please pass a valid API key.");
    expect(json.error.status).toBe("INVALID_ARGUMENT");
  });
});

describe("Identity Toolkit - signInWithPassword", () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    ctx = makeApp();
    await signUp(ctx.app, "bob@example.com", "password123", "Bob");
  });

  it("signs in successfully", async () => {
    const res = await post(ctx.app, "/v1/accounts:signInWithPassword", {
      email: "bob@example.com",
      password: "password123",
      returnSecureToken: true,
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.registered).toBe(true);
    expect(json.displayName).toBe("Bob");
    expect(json.idToken.split(".")).toHaveLength(3);
  });

  it("returns EMAIL_NOT_FOUND", async () => {
    const res = await post(ctx.app, "/v1/accounts:signInWithPassword", {
      email: "nobody@example.com",
      password: "password123",
      returnSecureToken: true,
    });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.message).toBe("EMAIL_NOT_FOUND");
  });

  it("returns INVALID_PASSWORD", async () => {
    const res = await post(ctx.app, "/v1/accounts:signInWithPassword", {
      email: "bob@example.com",
      password: "wrongpass",
      returnSecureToken: true,
    });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.message).toBe("INVALID_PASSWORD");
  });
});

describe("Identity Toolkit - lookup / update / delete", () => {
  let ctx: ReturnType<typeof makeApp>;
  let idToken: string;
  let localId: string;

  beforeEach(async () => {
    ctx = makeApp();
    const { json } = await signUp(ctx.app, "carol@example.com", "password123", "Carol");
    idToken = json.idToken;
    localId = json.localId;
  });

  it("looks up account info", async () => {
    const res = await post(ctx.app, "/v1/accounts:lookup", { idToken });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.kind).toBe("identitytoolkit#GetAccountInfoResponse");
    expect(json.users).toHaveLength(1);
    expect(json.users[0].localId).toBe(localId);
    expect(json.users[0].email).toBe("carol@example.com");
    expect(json.users[0].emailVerified).toBe(false);
    expect(json.users[0].displayName).toBe("Carol");
    expect(Array.isArray(json.users[0].providerUserInfo)).toBe(true);
  });

  it("rejects an invalid idToken on lookup", async () => {
    const res = await post(ctx.app, "/v1/accounts:lookup", { idToken: "not-a-real-token" });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.message).toBe("INVALID_ID_TOKEN");
  });

  it("updates displayName", async () => {
    const res = await post(ctx.app, "/v1/accounts:update", {
      idToken,
      displayName: "Caroline",
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.displayName).toBe("Caroline");
    expect(json.idToken.split(".")).toHaveLength(3);

    // Verify the change persisted via lookup.
    const lookup = await (await post(ctx.app, "/v1/accounts:lookup", { idToken: json.idToken })).json();
    expect(lookup.users[0].displayName).toBe("Caroline");
  });

  it("deletes the account and invalidates its token", async () => {
    const res = await post(ctx.app, "/v1/accounts:delete", { idToken });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.kind).toBe("identitytoolkit#DeleteAccountResponse");

    const lookup = await post(ctx.app, "/v1/accounts:lookup", { idToken });
    expect(lookup.status).toBe(400);
    expect((await lookup.json()).error.message).toBe("INVALID_ID_TOKEN");
  });
});

describe("Identity Toolkit - sendOobCode", () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    ctx = makeApp();
    await signUp(ctx.app, "dave@example.com", "password123");
  });

  it("issues a PASSWORD_RESET code and records it internally", async () => {
    const res = await post(ctx.app, "/v1/accounts:sendOobCode", {
      requestType: "PASSWORD_RESET",
      email: "dave@example.com",
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.kind).toBe("identitytoolkit#GetOobConfirmationCodeResponse");
    expect(json.email).toBe("dave@example.com");

    const internal = await (await ctx.app.fetch(new Request(`${BASE}/internal/oob_codes`))).json();
    expect(internal.oobCodes).toHaveLength(1);
    expect(internal.oobCodes[0].email).toBe("dave@example.com");
    expect(internal.oobCodes[0].requestType).toBe("PASSWORD_RESET");
    expect(typeof internal.oobCodes[0].oobCode).toBe("string");
  });
});

describe("Secure Token - refresh", () => {
  let ctx: ReturnType<typeof makeApp>;
  let refreshToken: string;
  let localId: string;

  beforeEach(async () => {
    ctx = makeApp();
    const { json } = await signUp(ctx.app, "erin@example.com", "password123");
    refreshToken = json.refreshToken;
    localId = json.localId;
  });

  it("refreshes via form-encoded body", async () => {
    const res = await ctx.app.fetch(
      new Request(`${BASE}/v1/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.token_type).toBe("Bearer");
    expect(json.expires_in).toBe("3600");
    expect(json.user_id).toBe(localId);
    expect(json.project_id).toBe(PROJECT_ID);
    expect(json.id_token.split(".")).toHaveLength(3);
    expect(typeof json.refresh_token).toBe("string");
  });

  it("rejects an invalid refresh_token", async () => {
    const res = await ctx.app.fetch(
      new Request(`${BASE}/v1/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: "bogus" }),
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.message).toBe("INVALID_REFRESH_TOKEN");
  });
});

describe("Path prefixes", () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => {
    ctx = makeApp();
  });

  it("serves the identitytoolkit.googleapis.com prefix", async () => {
    const res = await ctx.app.fetch(
      new Request(`${BASE}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "prefix@example.com", password: "password123", returnSecureToken: true }),
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.email).toBe("prefix@example.com");
  });

  it("serves the securetoken.googleapis.com token prefix", async () => {
    const { json } = await signUp(ctx.app, "tok@example.com", "password123");
    const res = await ctx.app.fetch(
      new Request(`${BASE}/securetoken.googleapis.com/v1/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: json.refreshToken }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).token_type).toBe("Bearer");
  });
});

describe("FCM messages:send", () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => {
    ctx = makeApp();
  });

  function send(body: unknown, withAuth = true) {
    return ctx.app.fetch(
      new Request(`${BASE}/v1/projects/${PROJECT_ID}/messages:send`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(withAuth ? { Authorization: "Bearer any-token" } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  }

  it("sends a message and records it internally", async () => {
    const res = await send({
      message: { token: "device-token", notification: { title: "Hi", body: "There" } },
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.name).toMatch(new RegExp(`^projects/${PROJECT_ID}/messages/`));

    const internal = await (await ctx.app.fetch(new Request(`${BASE}/internal/messages`))).json();
    expect(internal.messages).toHaveLength(1);
    expect(internal.messages[0].token).toBe("device-token");
    expect(internal.messages[0].notification.title).toBe("Hi");
  });

  it("validate_only does not persist the message", async () => {
    const res = await send({
      message: { topic: "news", notification: { title: "T" } },
      validate_only: true,
    });
    expect(res.status).toBe(200);
    const internal = await (await ctx.app.fetch(new Request(`${BASE}/internal/messages`))).json();
    expect(internal.messages).toHaveLength(0);
  });

  it("rejects a message with no target", async () => {
    const res = await send({ message: { notification: { title: "x" } } });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.status).toBe("INVALID_ARGUMENT");
  });

  it("rejects a missing message field", async () => {
    const res = await send({});
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.status).toBe("INVALID_ARGUMENT");
  });

  it("rejects requests without an Authorization header", async () => {
    const res = await send({ message: { token: "t" } }, false);
    expect(res.status).toBe(401);
  });
});

describe("seedFromConfig", () => {
  it("seeds projects and users from the registry initConfig shape", () => {
    const { store } = makeApp();
    const config: FirebaseSeedConfig = {
      projects: [{ project_id: "my-project", api_key: "firebase_api_key_example" }],
      users: [{ email: "hong@example.com", password: "password123", display_name: "홍길동" }],
    };
    seedFromConfig(store, BASE, config);

    const fs = getFirebaseStore(store);
    expect(fs.projects.findOneBy("project_id", "my-project")?.api_key).toBe("firebase_api_key_example");
    const user = fs.users.findOneBy("email", "hong@example.com");
    expect(user?.password).toBe("password123");
    expect(user?.display_name).toBe("홍길동");
    expect(user?.project_id).toBe("my-project");
    expect(typeof user?.local_id).toBe("string");
  });

  it("is idempotent (skips already-seeded projects/users)", () => {
    const { store } = makeApp();
    const config: FirebaseSeedConfig = {
      projects: [{ project_id: "p", api_key: "k" }],
      users: [{ email: "x@example.com", password: "password123" }],
    };
    seedFromConfig(store, BASE, config);
    seedFromConfig(store, BASE, config);
    const fs = getFirebaseStore(store);
    expect(fs.projects.findBy("project_id", "p")).toHaveLength(1);
    expect(fs.users.findBy("email", "x@example.com")).toHaveLength(1);
  });

  it("seeds and authenticates against the seeded api_key", async () => {
    const { app, store } = makeApp();
    seedFromConfig(store, BASE, {
      projects: [{ project_id: "seeded", api_key: "seeded-key" }],
      users: [{ email: "seed@example.com", password: "password123" }],
    });
    const res = await app.fetch(
      new Request(`${BASE}/v1/accounts:signInWithPassword?key=seeded-key`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "seed@example.com", password: "password123", returnSecureToken: true }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).registered).toBe(true);
  });
});
