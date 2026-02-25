// app/CheckoutPage.js
"use client";

import { useState, useRef } from "react";
import dynamic from "next/dynamic";

// Load NMI components only on the client
const NmiPayments = dynamic(
  () => import("@nmipayments/nmi-pay-react").then((m) => m.NmiPayments),
  { ssr: false }
);
const NmiThreeDSecure = dynamic(
  () => import("@nmipayments/nmi-pay-react").then((m) => m.NmiThreeDSecure),
  { ssr: false }
);

export default function CheckoutPage({
  enableWallets = false,
  initialAmount = "1.00",
  initialAmountLocked = false,
  initialOrderReference = "",
  initialOrderRefLocked = false,
  initialName = "",
  initialEmail = "",
  initialPostcode = "",
}) {
  // Basic form state
  const [amount, setAmount] = useState(initialAmount);
  const [amountLocked] = useState(initialAmountLocked);

  const [orderReference, setOrderReference] = useState(initialOrderReference);
  const [orderRefLocked] = useState(initialOrderRefLocked);

  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [address1, setAddress1] = useState("");
  const [city, setCity] = useState("");
  const [postcode, setPostcode] = useState(initialPostcode);
  const [country] = useState("GB");

  // NMI / 3DS state
  const [paymentToken, setPaymentToken] = useState("");
  const [isValid, setIsValid] = useState(false);
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Honeypot (simple bot protection)
  const [sessionHash, setSessionHash] = useState("");
  // Force NmiPayments to reset when we need to clear the card form
  const [paymentsKey, setPaymentsKey] = useState(0);

  const threeDSRef = useRef(null);

  // ✅ Redirect guard (prevents double redirects)
  const redirectedRef = useRef(false);

  const tokenizationKey = process.env.NEXT_PUBLIC_NMI_TOKENIZATION_KEY || "";
  const applePayMerchantId =
    process.env.NEXT_PUBLIC_APPLE_PAY_MERCHANT_ID || undefined;
  const applePayDisplayName =
    process.env.NEXT_PUBLIC_APPLE_PAY_DISPLAY_NAME || "Imprints";
  const googlePayMerchantId =
    process.env.NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID || undefined;
  const googlePayEnvironment =
    process.env.NEXT_PUBLIC_GOOGLE_PAY_ENVIRONMENT || "PRODUCTION";
  const expressCheckoutConfig = {
    amount: parseFloat(amount || "0").toFixed(2),
    currency: "GBP",
    ...(applePayMerchantId
      ? {
          applePay: {
            merchantId: applePayMerchantId,
            displayName: applePayDisplayName,
            countryCode: "GB",
            currencyCode: "GBP",
          },
        }
      : {}),
    ...(googlePayMerchantId
      ? {
          googlePay: {
            merchantId: googlePayMerchantId,
            environment:
              googlePayEnvironment === "TEST" ? "TEST" : "PRODUCTION",
            countryCode: "GB",
            currencyCode: "GBP",
          },
        }
      : {}),
  };

  // -------------------------
  // Redirect helpers (ENV-driven)
  // -------------------------
  function getEnvMode() {
    const v = (process.env.NEXT_PUBLIC_IMPRINTS_ENV || "").toLowerCase().trim();
    if (v === "production" || v === "prod") return "production";
    return "staging"; // default safe
  }

  function getRedirectBase(statusType) {
    const mode = getEnvMode();

    const envStagingSuccess = process.env.NEXT_PUBLIC_REDIRECT_SUCCESS_STAGING || "";
    const envStagingFailure = process.env.NEXT_PUBLIC_REDIRECT_FAILURE_STAGING || "";
    const envProdSuccess = process.env.NEXT_PUBLIC_REDIRECT_SUCCESS_PROD || "";
    const envProdFailure = process.env.NEXT_PUBLIC_REDIRECT_FAILURE_PROD || "";

    // Fallbacks (in case env vars aren’t set yet)
    const fallbackStagingSuccess = "https://imprints.hatched.agency/portal/?order=200";
    const fallbackStagingFailure = "https://imprints.hatched.agency/portal/?order=500";
    const fallbackProdSuccess = "https://imprintstaunton.co.uk/portal/?order=200";
    const fallbackProdFailure = "https://imprintstaunton.co.uk/portal/?order=500";

    const stagingSuccess = envStagingSuccess || fallbackStagingSuccess;
    const stagingFailure = envStagingFailure || fallbackStagingFailure;
    const prodSuccess = envProdSuccess || fallbackProdSuccess;
    const prodFailure = envProdFailure || fallbackProdFailure;

    const isProd = mode === "production";

    if (statusType === "success") return isProd ? prodSuccess : stagingSuccess;
    return isProd ? prodFailure : stagingFailure;
  }

  // ✅ Redirect only once
  function redirectToResult({ ok, transactionId, errorMessage }) {
    if (redirectedRef.current) return;
    redirectedRef.current = true;

    const base = getRedirectBase(ok ? "success" : "failure");
    const url = new URL(base);

    // Keep Adam's ?order=200/500, add ours alongside it
    url.searchParams.set("status", ok ? "approved" : "declined");
    if (orderReference) url.searchParams.set("order_reference", orderReference);
    if (transactionId) url.searchParams.set("transaction_id", String(transactionId));
    if (amount) url.searchParams.set("amount", String(parseFloat(amount).toFixed(2)));
    url.searchParams.set("currency", "GBP");
    if (!ok && errorMessage) url.searchParams.set("reason", errorMessage.slice(0, 120));

    window.location.assign(url.toString());
  }

  // -------------------------
  // Pay button handler
  // -------------------------
  async function handlePay() {
    setStatus("");

    if (!isValid || !paymentToken) {
      setStatus("Please complete card details first.");
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setStatus("Enter a valid amount.");
      return;
    }

    if (!name || !email || !postcode) {
      setStatus("Please complete the required fields.");
      return;
    }

    // Honeypot hit → likely bot
    if (sessionHash) {
      setStatus("Payment blocked.");
      return;
    }

    const [firstName, ...rest] = name.trim().split(" ");
    const lastName = rest.join(" ") || firstName;

    const paymentInfo = {
      paymentToken,
      currency: "GBP",
      amount: parseFloat(amount).toFixed(2),
      firstName,
      lastName,
      email,
      address1,
      city,
      postalCode: postcode,
      country,
    };

    if (!threeDSRef.current || !threeDSRef.current.startThreeDSecure) {
      setStatus("3-D Secure not ready.");
      return;
    }

    setIsProcessing(true);
    threeDSRef.current.startThreeDSecure(paymentInfo);
  }

  const isSuccess = status === "Payment successful";

  // -------------------------
  // JSX – minimal styling
  // -------------------------
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
        background: "#f3f4f6",
      }}
    >
      {isProcessing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 20,
          }}
        >
          <div
            style={{
              background: "#ffffff",
              padding: "16px 20px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              maxWidth: 280,
              textAlign: "center",
              fontSize: 14,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              Processing your payment
            </div>
            <div>Don&apos;t close or refresh this page.</div>
          </div>
        </div>
      )}

      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#ffffff",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          padding: 20,
          boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
        }}
      >
        <h1 style={{ fontSize: 18, margin: "0 0 12px", fontWeight: 600 }}>
          Imprints – Secure card payment
        </h1>

        {enableWallets && (
          <div
            style={{
              marginBottom: 10,
              padding: "8px 10px",
              borderRadius: 6,
              fontSize: 12,
              backgroundColor: "#eff6ff",
              border: "1px solid #93c5fd",
              color: "#1e3a8a",
            }}
          >
            Apple Pay and Google Pay are enabled on this checkout.
          </div>
        )}

        {/* Honeypot – hidden field */}
        <input
          type="text"
          value={sessionHash}
          onChange={(e) => setSessionHash(e.target.value)}
          style={{ display: "none" }}
          autoComplete="off"
        />

        <FieldLabel>Amount (GBP)</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          readOnly={amountLocked}
          style={inputStyle}
        />

        <FieldLabel>Order reference</FieldLabel>
        <input
          type="text"
          value={orderReference}
          onChange={(e) => setOrderReference(e.target.value)}
          readOnly={orderRefLocked}
          style={inputStyle}
        />

        <FieldLabel>Full name</FieldLabel>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
        />

        <FieldLabel>Email</FieldLabel>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />

        <FieldLabel>Address</FieldLabel>
        <input
          type="text"
          value={address1}
          onChange={(e) => setAddress1(e.target.value)}
          style={inputStyle}
        />

        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="Town / City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
          />
          <input
            type="text"
            placeholder="Postcode"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            style={{ ...inputStyle, marginBottom: 0, width: 130 }}
          />
        </div>

        {status && (
          <div
            style={{
              marginTop: 10,
              marginBottom: 10,
              padding: "8px 10px",
              borderRadius: 6,
              fontSize: 13,
              backgroundColor: isSuccess ? "#ecfdf3" : "#fef2f2",
              border: `1px solid ${isSuccess ? "#22c55e" : "#ef4444"}`,
              color: isSuccess ? "#166534" : "#b91c1c",
            }}
          >
            {status}
          </div>
        )}

        {/* Card input + 3DS */}
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
              fontSize: 13,
            }}
          >
            <strong>Card details</strong>
            <span style={{ color: "#6b7280" }}>Visa · Mastercard · Amex</span>
          </div>

          <NmiPayments
            key={paymentsKey}
            tokenizationKey={tokenizationKey}
            layout="multiLine"
            paymentMethods={
              enableWallets ? ["card", "apple-pay", "google-pay"] : ["card"]
            }
            preSelectFirstMethod={true}
            payButtonText="Pay"
            expressCheckoutConfig={expressCheckoutConfig}
            onChange={(data) => {
              const complete = data?.complete || false;
              setIsValid(complete);
              if (complete && data?.token) setPaymentToken(data.token);
            }}
          />

          <NmiThreeDSecure
            ref={threeDSRef}
            tokenizationKey={tokenizationKey}
            modal={true}
            onComplete={async (result) => {
              try {
                const [firstName, ...rest] = name.trim().split(" ");
                const lastName = rest.join(" ") || firstName;

                const response = await fetch("/api/process-payment", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    paymentToken,
                    amount: parseFloat(amount),
                    firstName,
                    lastName,
                    email,
                    address1,
                    city,
                    postcode,
                    country,
                    order_reference: orderReference,

                    cardHolderAuth: result.cardHolderAuth,
                    cavv: result.cavv,
                    directoryServerId: result.directoryServerId,
                    eci: result.eci,
                    threeDsVersion: result.threeDsVersion,
                    xid: result.xid,

                    session_hash: sessionHash,
                  }),
                });

                const data = await response.json();
                setIsProcessing(false);

                if (data.success) {
                  setStatus("Payment successful");

                  redirectToResult({
                    ok: true,
                    transactionId: data.transactionId || data.transaction_id,
                  });

                  // Optional: cleanup in case redirect ever gets blocked
                  setAddress1("");
                  setCity("");
                  setPaymentToken("");
                  setIsValid(false);
                  setSessionHash("");
                  setPaymentsKey((k) => k + 1);
                } else {
                  const msg = data.error || "Payment failed";
                  setStatus(msg);

                  redirectToResult({
                    ok: false,
                    errorMessage: msg,
                    transactionId: data.transactionId || data.transaction_id,
                  });
                }
              } catch (err) {
                console.error(err);
                setIsProcessing(false);
                setStatus("Error processing payment.");

                redirectToResult({
                  ok: false,
                  errorMessage: "error",
                });
              }
            }}
            onFailure={() => {
              setIsProcessing(false);
              setStatus("3-D Secure cancelled or failed.");

              redirectToResult({
                ok: false,
                errorMessage: "3ds_cancelled",
              });
            }}
          />
        </div>

        <button
          onClick={handlePay}
          disabled={!isValid || !paymentToken}
          style={{
            width: "100%",
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 999,
            border: "none",
            fontWeight: 600,
            fontSize: 15,
            cursor: !isValid || !paymentToken ? "not-allowed" : "pointer",
            backgroundColor: !isValid || !paymentToken ? "#d1d5db" : "#16a34a",
            color: !isValid || !paymentToken ? "#6b7280" : "#ffffff",
          }}
        >
          Verify &amp; pay securely
        </button>

        <p
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "#6b7280",
            textAlign: "center",
          }}
        >
          Imprints never sees your full card number. Payments are encrypted and
          processed by Getedge Payments Ltd.
        </p>
      </div>
    </main>
  );
}

// Small helper components/styles
function FieldLabel({ children }) {
  return (
    <label
      style={{
        display: "block",
        marginTop: 10,
        marginBottom: 4,
        fontSize: 12,
        fontWeight: 600,
        color: "#374151",
      }}
    >
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  borderRadius: 4,
  border: "1px solid #d1d5db",
  outline: "none",
  marginBottom: 4,
  boxSizing: "border-box",
};
