import type { Hono } from "@emulators/core";
import type { ServicePlugin, Store, WebhookDispatcher, TokenMap, AppEnv, RouteContext } from "@emulators/core";
import { getTossStore } from "./store.js";
import { checkoutRoutes } from "./routes/checkout.js";
import { paymentRoutes } from "./routes/payments.js";

export { getTossStore, type TossStore } from "./store.js";
export * from "./entities.js";

export interface TossSeedConfig {
  port?: number;
  merchants?: Array<{
    client_key: string;
    secret_key: string;
  }>;
  webhooks?: Array<{
    url: string;
    events: string[];
  }>;
}

/** Inserts a merchant only if no merchant with the same client_key exists yet. */
function seedMerchant(store: Store, clientKey: string, secretKey: string): void {
  const ts = getTossStore(store);
  if (ts.merchants.findOneBy("client_key", clientKey)) return;
  ts.merchants.insert({ client_key: clientKey, secret_key: secretKey });
}

export function seedFromConfig(
  store: Store,
  _baseUrl: string,
  config: TossSeedConfig,
  webhooks?: WebhookDispatcher,
): void {
  if (config.merchants) {
    for (const m of config.merchants) {
      seedMerchant(store, m.client_key, m.secret_key);
    }
  }

  if (config.webhooks && webhooks) {
    for (const w of config.webhooks) {
      webhooks.register({ url: w.url, events: w.events, active: true, owner: "tosspayments" });
    }
  }
}

export const tossPaymentsPlugin: ServicePlugin = {
  name: "tosspayments",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    checkoutRoutes(ctx);
    paymentRoutes(ctx);
  },
  seed(store: Store, _baseUrl: string): void {
    // Minimal default merchant so the emulator works without any config.
    seedMerchant(store, "test_ck_default", "test_sk_default");
  },
};

export default tossPaymentsPlugin;
