import type { RouteContext } from "@emulators/core";
import { renderCheckoutPage, escapeAttr } from "@emulators/core";
import { getTossStore } from "../store.js";
import {
  generatePaymentKey,
  generateTransactionKey,
  kstNow,
  buildCard,
  formatPayment,
  tossError,
} from "../helpers.js";

/**
 * Browser/checkout-widget simulation. These endpoints stand in for the hosted
 * Toss payment widget so an end-to-end flow can run without a real browser.
 */
export function checkoutRoutes(ctx: RouteContext): void {
  const { app, store, baseUrl } = ctx;
  const ts = () => getTossStore(store);

  // Renders the (simulated) payment widget page. Creates a READY payment.
  app.get("/checkout", (c) => {
    const clientKey = c.req.query("clientKey");
    const orderId = c.req.query("orderId");
    const orderName = c.req.query("orderName");
    const amountRaw = c.req.query("amount");
    const successUrl = c.req.query("successUrl");
    const failUrl = c.req.query("failUrl");
    const customerName = c.req.query("customerName");

    if (!clientKey) return tossError(c, 400, "INVALID_REQUEST", "clientKey가 필요합니다.");
    if (!orderId || !orderName || !amountRaw || !successUrl || !failUrl) {
      return tossError(c, 400, "INVALID_REQUEST", "필수 결제 정보가 누락되었습니다.");
    }

    const merchant = ts().merchants.findOneBy("client_key", clientKey);
    if (!merchant) {
      return tossError(c, 400, "INVALID_CLIENT_KEY", "잘못된 클라이언트 키 입니다.");
    }

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return tossError(c, 400, "INVALID_REQUEST", "유효하지 않은 결제 금액입니다.");
    }

    const paymentKey = generatePaymentKey();
    ts().payments.insert({
      payment_key: paymentKey,
      order_id: orderId,
      order_name: orderName,
      status: "READY",
      method: "카드",
      total_amount: amount,
      balance_amount: amount,
      requested_at: kstNow(),
      approved_at: null,
      last_transaction_key: null,
      use_escrow: false,
      culture_expense: false,
      cancels: null,
      card: null,
    });

    const approveUrl = `${baseUrl}/checkout/approve?paymentKey=${encodeURIComponent(paymentKey)}`;

    const page = renderCheckoutPage(
      {
        merchantName: customerName ? `${orderName} (${customerName})` : orderName,
        lineItems: [
          {
            name: orderName,
            quantity: 1,
            unitPrice: amount,
            totalPrice: amount,
            currency: "KRW",
          },
        ],
        subtotal: amount,
        total: amount,
        currency: "KRW",
        sessionId: paymentKey,
        cancelUrl: failUrl,
      },
      "tosspayments",
    );

    // The built-in checkout page posts to a generic /complete endpoint that does
    // not match the Toss GET-approve flow, so we inject explicit approve/fail
    // links that drive the simulated browser flow.
    const actions = `<div class="checkout-actions" style="margin-top:16px;display:flex;gap:12px;">
  <a class="checkout-pay-btn" href="${escapeAttr(approveUrl)}">결제 승인</a>
  <a class="checkout-cancel" href="${escapeAttr(failUrl)}">결제 실패</a>
</div>`;

    const patched = page.replace("</body>", `${actions}\n</body>`);
    return c.html(patched);
  });

  // Approves the payment (READY -> IN_PROGRESS) and redirects to successUrl.
  app.get("/checkout/approve", (c) => {
    const paymentKey = c.req.query("paymentKey");
    if (!paymentKey) return tossError(c, 400, "INVALID_REQUEST", "paymentKey가 필요합니다.");

    const payment = ts().payments.findOneBy("payment_key", paymentKey);
    if (!payment) {
      return tossError(c, 404, "NOT_FOUND_PAYMENT", "존재하지 않는 결제 입니다.");
    }

    const updated = ts().payments.update(payment.id, { status: "IN_PROGRESS" });
    const target = c.req.query("successUrl");
    const successUrl =
      target ??
      `${baseUrl}/checkout/success?paymentKey=${encodeURIComponent(paymentKey)}` +
        `&orderId=${encodeURIComponent(updated!.order_id)}&amount=${updated!.total_amount}`;

    const url = new URL(successUrl);
    if (!url.searchParams.has("paymentKey")) url.searchParams.set("paymentKey", paymentKey);
    if (!url.searchParams.has("orderId")) url.searchParams.set("orderId", updated!.order_id);
    if (!url.searchParams.has("amount")) url.searchParams.set("amount", String(updated!.total_amount));

    return c.redirect(url.toString(), 302);
  });

  // Test/CI helper: directly create an IN_PROGRESS payment without the browser flow.
  app.post("/internal/payments", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return tossError(c, 400, "INVALID_REQUEST", "잘못된 요청 본문입니다.");
    }

    const orderId = body.orderId as string | undefined;
    const orderName = body.orderName as string | undefined;
    const amount = body.amount as number | undefined;
    const method = (body.method as string | undefined) ?? "카드";

    if (!orderId || !orderName || amount == null) {
      return tossError(c, 400, "INVALID_REQUEST", "orderId, orderName, amount가 필요합니다.");
    }

    const paymentKey = generatePaymentKey();
    const created = ts().payments.insert({
      payment_key: paymentKey,
      order_id: orderId,
      order_name: orderName,
      status: "IN_PROGRESS",
      method,
      total_amount: amount,
      balance_amount: amount,
      requested_at: kstNow(),
      approved_at: null,
      last_transaction_key: generateTransactionKey(),
      use_escrow: false,
      culture_expense: false,
      cancels: null,
      card: method === "카드" ? buildCard(amount) : null,
    });

    return c.json(formatPayment(created, baseUrl), 200);
  });
}
