// app/api/webhook-test/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "crypto";

let lastWebhook = null; // in-memory store (good enough for testing)

export async function POST(req) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-edge-signature") || "";
  const secret = process.env.WEBHOOK_SECRET || "";

  let parsed = null;
  let jsonError = null;
  let verified = false;

  // Try to parse JSON
  try {
    parsed = JSON.parse(rawBody);
  } catch (e) {
    jsonError = "Invalid JSON body";
  }

  // Optional: check signature (won't block the request)
  if (secret && rawBody) {
    try {
      const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

      // Simple equality is fine for testing
      verified = signature === expected;
    } catch (e) {
      // ignore
    }
  }

  lastWebhook = {
    receivedAt: new Date().toISOString(),
    signature,
    verified,
    jsonError,
    parsed,
    rawBody,
  };

  console.log("Webhook-test received:", lastWebhook);

  return NextResponse.json({
    ok: true,
    receivedAt: lastWebhook.receivedAt,
    verified,
  });
}

// Simple GET to inspect the last webhook received
export async function GET() {
  if (!lastWebhook) {
    return NextResponse.json(
      { message: "No webhook received yet" },
      { status: 404 }
    );
  }

  return NextResponse.json(lastWebhook);
}