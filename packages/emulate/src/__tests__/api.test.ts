import { describe, it, expect, afterAll } from "bun:test";
import { createEmulator, type Emulator } from "../api.js";
import { SERVICE_REGISTRY } from "../registry.js";

const BASE_PORT = 4900;
const emulators: Emulator[] = [];

afterAll(async () => {
  await Promise.all(emulators.map((e) => e.close().catch(() => {})));
});

async function start(service: keyof typeof SERVICE_REGISTRY, port: number): Promise<Emulator> {
  // Use initConfig directly as the seed — this also verifies that the registry contract and seedFromConfig agree
  const emulator = await createEmulator({
    service,
    port,
    seed: SERVICE_REGISTRY[service].initConfig as Record<string, unknown>,
  });
  emulators.push(emulator);
  return emulator;
}

describe("createEmulator", () => {
  it("rejects unknown services", async () => {
    await expect(createEmulator({ service: "nope" as never })).rejects.toThrow("Unknown service");
  });

  it("starts kakao and completes an OAuth flow", async () => {
    const { url } = await start("kakao", BASE_PORT);

    const authorize = await fetch(
      `${url}/oauth/authorize?client_id=kakao_rest_api_key_example&redirect_uri=${encodeURIComponent(
        "http://localhost:3000/api/auth/callback/kakao",
      )}&response_type=code&state=xyz&user_id=1001`,
      { redirect: "manual" },
    );
    expect(authorize.status).toBe(302);
    const location = new URL(authorize.headers.get("location")!);
    const code = location.searchParams.get("code")!;
    expect(location.searchParams.get("state")).toBe("xyz");

    const token = await fetch(`${url}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "kakao_rest_api_key_example",
        client_secret: "kakao_client_secret_example",
        redirect_uri: "http://localhost:3000/api/auth/callback/kakao",
        code,
      }),
    });
    expect(token.status).toBe(200);
    const tokenBody = (await token.json()) as { access_token: string };

    const me = await fetch(`${url}/v2/user/me`, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { kakao_account: { profile: { nickname: string } } };
    expect(meBody.kakao_account.profile.nickname).toBe("홍길동");
  });

  it("starts naver and serves the profile API", async () => {
    const { url } = await start("naver", BASE_PORT + 1);

    const authorize = await fetch(
      `${url}/oauth2.0/authorize?response_type=code&client_id=naver_client_id_example&redirect_uri=${encodeURIComponent(
        "http://localhost:3000/api/auth/callback/naver",
      )}&state=abc&user=naver_user_001`,
      { redirect: "manual" },
    );
    expect(authorize.status).toBe(302);
    const code = new URL(authorize.headers.get("location")!).searchParams.get("code");

    const token = await fetch(
      `${url}/oauth2.0/token?grant_type=authorization_code&client_id=naver_client_id_example&client_secret=naver_client_secret_example&code=${code}&state=abc`,
    );
    expect(token.status).toBe(200);
    const tokenBody = (await token.json()) as { access_token: string; expires_in: string };
    expect(typeof tokenBody.expires_in).toBe("string");

    const me = await fetch(`${url}/v1/nid/me`, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    const meBody = (await me.json()) as { resultcode: string; response: { name: string } };
    expect(meBody.resultcode).toBe("00");
    expect(meBody.response.name).toBe("홍길동");
  });

  it("starts tosspayments and confirms a payment", async () => {
    const { url } = await start("tosspayments", BASE_PORT + 2);

    const created = await fetch(`${url}/internal/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: "order-1", orderName: "테스트 주문", amount: 11000 }),
    });
    expect(created.status).toBe(200);
    const payment = (await created.json()) as { paymentKey: string };

    const confirmed = await fetch(`${url}/v1/payments/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Basic ${Buffer.from("test_sk_example:").toString("base64")}`,
      },
      body: JSON.stringify({ paymentKey: payment.paymentKey, orderId: "order-1", amount: 11000 }),
    });
    expect(confirmed.status).toBe(200);
    const confirmedBody = (await confirmed.json()) as { status: string; totalAmount: number; vat: number };
    expect(confirmedBody.status).toBe("DONE");
    expect(confirmedBody.vat).toBe(1000);
  });

  it("starts firebase and signs in a seeded user", async () => {
    const { url } = await start("firebase", BASE_PORT + 3);

    const signIn = await fetch(`${url}/v1/accounts:signInWithPassword?key=firebase_api_key_example`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "hong@example.com", password: "password123", returnSecureToken: true }),
    });
    expect(signIn.status).toBe(200);
    const body = (await signIn.json()) as { idToken: string; registered: boolean };
    expect(body.registered).toBe(true);
    expect(body.idToken.split(".")).toHaveLength(3);
  });

  it("starts supabase and queries seeded tables", async () => {
    const { url } = await start("supabase", BASE_PORT + 4);

    const rows = await fetch(`${url}/rest/v1/todos?completed=eq.false`, {
      headers: { apikey: "supabase_anon_key_example" },
    });
    expect(rows.status).toBe(200);
    const list = (await rows.json()) as Array<{ title: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("장보기");
  });

  it("reset() restores seeded state", async () => {
    const emulator = await start("supabase", BASE_PORT + 5);

    const del = await fetch(`${emulator.url}/rest/v1/todos?id=eq.1`, {
      method: "DELETE",
      headers: { apikey: "supabase_anon_key_example" },
    });
    expect(del.status).toBe(204);

    emulator.reset();

    const rows = await fetch(`${emulator.url}/rest/v1/todos`, {
      headers: { apikey: "supabase_anon_key_example" },
    });
    const list = (await rows.json()) as unknown[];
    expect(list).toHaveLength(2);
  });
});
