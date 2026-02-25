// app/api/process-payment/route.js

import { NextResponse } from "next/server";
import crypto from "crypto";

// Helper: send webhook events to all configured URLs
async function sendWebhooks(event) {
  const urls = (process.env.WEBHOOK_URLS || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  if (!urls.length) {
    console.warn("WEBHOOK_URLS is empty – skipping webhooks");
    return;
  }

  const secret = process.env.WEBHOOK_SECRET || "";
  const body = JSON.stringify(event);

  await Promise.all(
    urls.map(async (url) => {
      try {
        const headers = { "Content-Type": "application/json" };

        if (secret) {
          const signature = crypto
            .createHmac("sha256", secret)
            .update(body)
            .digest("hex");

          // canonical (what we standardised on)
          headers["x-edge-signature"] = signature;

          // alias (matches Adam's docs / expectation)
          headers["X-EdgePlus-Signature"] = signature;
        }

        await fetch(url, {
          method: "POST",
          headers,
          body,
        });
      } catch (err) {
        console.error("Webhook POST failed for", url, err);
      }
    })
  );
}

// Build redirect URL based on env + outcome
function buildRedirectUrl({ ok, orderReference, transactionId }) {
  const env = (process.env.IMPRINTS_ENV || "staging").toLowerCase();

  const successBase =
    env === "production"
      ? process.env.REDIRECT_SUCCESS_PROD
      : process.env.REDIRECT_SUCCESS_STAGING;

  const failureBase =
    env === "production"
      ? process.env.REDIRECT_FAILURE_PROD
      : process.env.REDIRECT_FAILURE_STAGING;

  const base = ok ? successBase : failureBase;
  if (!base) return null;

  const url = new URL(base);

  // keep it simple: always send status + refs
  url.searchParams.set("status", ok ? "approved" : "declined");
  if (orderReference) url.searchParams.set("orderReference", orderReference);
  if (transactionId) url.searchParams.set("transactionId", transactionId);

  return url.toString();
}

export async function POST(request) {
  try {
    const body = await request.json();

    const {
      paymentToken,
      amount,
      firstName,
      lastName,
      email,
      address1,
      city,
      postcode,
      country,
      order_reference,
      cardHolderAuth,
      cavv,
      directoryServerId,
      eci,
      threeDsVersion,
      xid,
      session_hash,
    } = body;

    if (!paymentToken || !amount) {
      return NextResponse.json(
        { success: false, error: "Missing payment token or amount" },
        { status: 400 }
      );
    }

    // Simple honeypot check
    if (session_hash) {
      return NextResponse.json(
        { success: false, error: "Blocked by anti-bot check" },
        { status: 400 }
      );
    }

    const gatewayUrl =
      process.env.NMI_GATEWAY_URL ||
      "https://edge-plus.transactiongateway.com/api/transact.php";

    const securityKey = process.env.NMI_SECURITY_KEY;

    if (!securityKey) {
      return NextResponse.json(
        { success: false, error: "Gateway not configured" },
        { status: 500 }
      );
    }

    // ---------- Build NMI form data ----------
    const params = new URLSearchParams();

    params.append("security_key", securityKey);
    params.append("type", "sale");
    params.append("amount", Number(amount).toFixed(2));
    params.append("currency", "GBP");
    params.append("payment_token", paymentToken);

    if (order_reference) params.append("orderid", order_reference);

    if (firstName) params.append("first_name", firstName);
    if (lastName) params.append("last_name", lastName);
    if (email) params.append("email", email);
    if (address1) params.append("address1", address1);
    if (city) params.append("city", city);
    if (postcode) params.append("postalcode", postcode);
    if (country) params.append("country", country);

    // 3DS
    if (cardHolderAuth)
      params.append("cardholder_authentication_value", cardHolderAuth);
    if (cavv) params.append("cavv", cavv);
    if (eci) params.append("eci", eci);
    if (xid) params.append("xid", xid);
    if (threeDsVersion) params.append("three_ds_version", threeDsVersion);
    if (directoryServerId) params.append("directory_server_id", directoryServerId);

    // ---------- Call NMI ----------
    const res = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const text = await res.text();
    const parsed = new URLSearchParams(text);

    const responseCode = parsed.get("response"); // "1" is approved
    const responseText = parsed.get("responsetext");
    const transactionId = parsed.get("transactionid");

    const ok = responseCode === "1";
    const eventName = ok ? "payment.succeeded" : "payment.failed";

    // ---------- Webhook payload (canonical + aliases) ----------
    const baseEvent = {
      // canonical
      type: eventName,
      status: ok ? "approved" : "declined",
      channel: "imprints",
      createdAt: new Date().toISOString(),

      // aliases (to reduce integration friction)
      event: eventName,
      order_reference: order_reference || null,

      data: {
        amount: Number(amount),
        currency: "GBP",

        // canonical
        orderReference: order_reference || null,
        transactionId: transactionId || null,

        // alias
        order_reference: order_reference || null,

        customer: {
          firstName,
          lastName,
          email,
          address1,
          city,
          postcode,
          country,
        },

        // raw gateway response for debugging / reconciliation
        gatewayResponse: Object.fromEntries(parsed),
      },
    };

    // Fire webhooks (staging + prod + edge-lab if included)
    await sendWebhooks(baseEvent);

    // Redirect URL returned to frontend
    const redirectUrl = buildRedirectUrl({
      ok,
      orderReference: order_reference || null,
      transactionId: transactionId || null,
    });

    if (ok) {
      return NextResponse.json({
        success: true,
        transactionId,
        redirectUrl,
        raw: Object.fromEntries(parsed),
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: responseText || "Gateway declined the payment",
        redirectUrl,
        raw: Object.fromEntries(parsed),
      },
      { status: 400 }
    );
  } catch (err) {
    console.error("process-payment error", err);

    try {
      await sendWebhooks({
        type: "payment.error",
        status: "error",
        channel: "imprints",
        createdAt: new Date().toISOString(),
        event: "payment.error",
        data: {
          message: "Server error in process-payment route",
        },
      });
    } catch {}

    return NextResponse.json(
      { success: false, error: "Server error processing payment" },
      { status: 500 }
    );
  }
}