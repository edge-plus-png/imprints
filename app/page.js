// app/page.js – server wrapper

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import crypto from "node:crypto";
import CheckoutPage from "./CheckoutPage";

function getFirstParam(params, key) {
  const value = params?.[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function normalizeCurrency(value) {
  const v = (value || "").trim().toUpperCase();
  return v === "GBP" ? "GBP" : "GBP";
}

function verifyPayloadSignature(params, sig, secret) {
  const filtered = Object.entries(params)
    .filter(([k, v]) => k !== "sig" && typeof v === "string")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const digest = crypto.createHmac("sha256", secret).update(filtered).digest("hex");
  return digest === sig;
}

export default async function Page({ searchParams }) {
  const params = (await searchParams) || {};
  const enableWallets = true;

  const qAmount = getFirstParam(params, "amount");
  const qCurrency = getFirstParam(params, "currency");
  const qOrderReference = getFirstParam(params, "order_reference");
  const qFullName = getFirstParam(params, "full_name");
  const qEmail = getFirstParam(params, "email");
  const qAddress1 = getFirstParam(params, "address1");
  const qAddress2 = getFirstParam(params, "address2");
  const qCity = getFirstParam(params, "city");
  const qPostcode = getFirstParam(params, "postcode");
  const qCountry = getFirstParam(params, "country");
  const qCustomerId = getFirstParam(params, "customer_id");
  const qSig = getFirstParam(params, "sig");

  const hasValidAmount = qAmount && !Number.isNaN(parseFloat(qAmount));
  const hasOrderReference = Boolean(qOrderReference);
  const hasCurrency = Boolean(qCurrency);
  const normalizedCurrency = normalizeCurrency(qCurrency);

  let signatureValid = true;
  const payloadSignatureSecret = process.env.PAYLOAD_SIGNATURE_SECRET || "";
  if (qSig && payloadSignatureSecret) {
    signatureValid = verifyPayloadSignature(params, qSig, payloadSignatureSecret);
  }

  return (
    <CheckoutPage
      enableWallets={enableWallets}
      payloadSignatureValid={signatureValid}
      initialAmount={hasValidAmount ? qAmount : "1.00"}
      initialAmountLocked={Boolean(hasValidAmount)}
      initialCurrency={hasCurrency ? normalizedCurrency : "GBP"}
      initialCurrencyLocked={hasCurrency}
      initialOrderReference={qOrderReference}
      initialOrderRefLocked={hasOrderReference}
      initialName={qFullName}
      initialEmail={qEmail}
      initialAddress1={qAddress1}
      initialAddress2={qAddress2}
      initialCity={qCity}
      initialPostcode={qPostcode}
      initialCountry={qCountry || "GB"}
      initialCustomerId={qCustomerId}
    />
  );
}
