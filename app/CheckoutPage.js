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
  payloadSignatureValid = true,
  initialAmount = "1.00",
  initialAmountLocked = false,
  initialCurrency = "GBP",
  initialCurrencyLocked = false,
  initialOrderReference = "",
  initialOrderRefLocked = false,
  initialName = "",
  initialEmail = "",
  initialAddress1 = "",
  initialAddress2 = "",
  initialCity = "",
  initialPostcode = "",
  initialCountry = "GB",
  initialCustomerId = "",
}) {
  // Basic form state
  const [amount, setAmount] = useState(initialAmount);
  const [amountLocked] = useState(initialAmountLocked);
  const [currency, setCurrency] = useState(initialCurrency || "GBP");
  const [currencyLocked] = useState(initialCurrencyLocked);

  const [orderReference, setOrderReference] = useState(initialOrderReference);
  const [orderRefLocked] = useState(initialOrderRefLocked);
  const [customerId] = useState(initialCustomerId);

  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [address1, setAddress1] = useState(initialAddress1);
  const [address2, setAddress2] = useState(initialAddress2);
  const [city, setCity] = useState(initialCity);
  const [postcode, setPostcode] = useState(initialPostcode);
  const [country, setCountry] = useState((initialCountry || "GB").toUpperCase());
  const requireOrderReference =
    process.env.NEXT_PUBLIC_REQUIRE_ORDER_REFERENCE === "true";
  const supportedCurrencies = ["GBP"];
  const isCurrencyValid = supportedCurrencies.includes(
    (currency || "").toUpperCase()
  );
  const normalizedCurrency = (currency || "GBP").toUpperCase();

  // NMI / 3DS state
  const [paymentToken, setPaymentToken] = useState("");
  const [isValid, setIsValid] = useState(false);
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Honeypot (simple bot protection)
  const [sessionHash, setSessionHash] = useState("");
  // Force NmiPayments to reset when we need to clear the card form
  const [paymentsKey, setPaymentsKey] = useState(0);
  const [walletMissingFields, setWalletMissingFields] = useState([]);

  const threeDSRef = useRef(null);
  const lastWalletTokenRef = useRef("");

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
  const safeAmount = getSafeAmount(amount);
  const expressCheckoutConfig = {
    amount: safeAmount,
    currency: normalizedCurrency,
    ...(applePayMerchantId
      ? {
          applePay: {
            merchantId: applePayMerchantId,
            displayName: applePayDisplayName,
            countryCode: "GB",
            currencyCode: normalizedCurrency,
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
            currencyCode: normalizedCurrency,
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
    const stagingSuccess = envStagingSuccess;
    const stagingFailure = envStagingFailure;
    const prodSuccess = envProdSuccess;
    const prodFailure = envProdFailure;

    const isProd = mode === "production";

    if (statusType === "success") return isProd ? prodSuccess : stagingSuccess;
    return isProd ? prodFailure : stagingFailure;
  }

  // ✅ Redirect only once
  function redirectToResult({ ok, transactionId, errorCode }) {
    if (redirectedRef.current) return;
    redirectedRef.current = true;

    const base = getRedirectBase(ok ? "success" : "failure");
    if (!base) {
      setStatus("Redirect URL is not configured.");
      return;
    }
    const url = new URL(base);

    url.searchParams.set("status", ok ? "success" : "failed");
    if (orderReference) url.searchParams.set("order_reference", orderReference);
    if (ok && transactionId)
      url.searchParams.set("transaction_id", String(transactionId));
    if (ok) {
      url.searchParams.set("amount", safeAmount);
      url.searchParams.set("currency", normalizedCurrency);
    }
    if (!ok && errorCode) url.searchParams.set("error_code", errorCode.slice(0, 80));

    window.location.assign(url.toString());
  }

  // -------------------------
  // Pay button handler
  // -------------------------
  async function handlePay() {
    if (isProcessing || !payloadSignatureValid) return;
    setStatus("");

    if (!isValid || !paymentToken) {
      setStatus("Please complete card details first.");
      return;
    }

    if (!isValidAmountInput(amount)) {
      setStatus("Amount must be greater than 0 and use up to 2 decimal places.");
      return;
    }

    if (!isCurrencyValid) {
      setStatus("Unsupported currency.");
      return;
    }

    if (!name || !email || !postcode) {
      setStatus("Please complete the required fields.");
      return;
    }

    if ((requireOrderReference || initialOrderRefLocked) && !orderReference) {
      setStatus("Order reference is required.");
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
      currency: normalizedCurrency,
      amount: safeAmount,
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

  async function submitPaymentWithToken(
    token,
    threeDS,
    { redirectOnFailure = true } = {}
  ) {
    const [firstName, ...rest] = name.trim().split(" ");
    const lastName = rest.join(" ") || firstName;
    const response = await fetch("/api/process-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentToken: token,
        amount: parseFloat(safeAmount),
        currency: normalizedCurrency,
        firstName,
        lastName,
        email,
        address1,
        address2,
        city,
        postcode,
        country,
        customer_id: customerId,
        order_reference: orderReference,
        cardHolderAuth: threeDS?.cardHolderAuth,
        cavv: threeDS?.cavv,
        directoryServerId: threeDS?.directoryServerId,
        eci: threeDS?.eci,
        threeDsVersion: threeDS?.threeDsVersion,
        xid: threeDS?.xid,
        session_hash: sessionHash,
      }),
    });

    const data = await response.json();
    if (data.success) {
      setStatus("Payment successful");
      redirectToResult({
        ok: true,
        transactionId: data.transactionId || data.transaction_id,
      });
      return { success: true, data };
    }

    const msg = data.error || "Payment failed";
    setStatus(msg);
    const errorCode = data.error_code || data.code || "gateway_decline";
    if (redirectOnFailure) {
      redirectToResult({
        ok: false,
        errorCode,
        transactionId: data.transactionId || data.transaction_id,
      });
    }
    return { success: false, data, error: msg, errorCode };
  }

  async function handleWalletPay(tokenFromWallet) {
    if (isProcessing || !payloadSignatureValid) return "Payment in progress.";
    setStatus("");
    setWalletMissingFields([]);
    if (!isValidAmountInput(amount)) return "Invalid amount.";
    if (!isCurrencyValid) return "Unsupported currency.";
    if ((requireOrderReference || initialOrderRefLocked) && !orderReference)
      return "Order reference required.";

    setIsProcessing(true);
    try {
      const result = await submitPaymentWithToken(tokenFromWallet, undefined, {
        redirectOnFailure: false,
      });
      setIsProcessing(false);
      if (result.success) return true;

      const missingFields = detectWalletMissingFields({
        error: result.error,
        errorCode: result.errorCode,
        values: { name, email, address1, address2, city, postcode, country },
      });

      if (missingFields.length > 0) {
        setWalletMissingFields(missingFields);
        setStatus("Please complete the missing details and retry wallet payment.");
        lastWalletTokenRef.current = "";
        return "Missing required fields";
      }

      redirectToResult({
        ok: false,
        errorCode: result.errorCode || "gateway_decline",
      });
      lastWalletTokenRef.current = "";
      return "Payment failed";
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
      setStatus("Error processing payment.");
      redirectToResult({ ok: false, errorCode: "server_error" });
      lastWalletTokenRef.current = "";
      return "Error processing payment";
    }
  }

  const [payMode, setPayMode] = useState(enableWallets ? "wallet" : "card");
  const walletReady =
    isValidAmountInput(amount) &&
    isCurrencyValid &&
    !(requireOrderReference || initialOrderRefLocked ? !orderReference : false) &&
    payloadSignatureValid &&
    !isProcessing;

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
        <div
          style={{
            marginBottom: 12,
            borderRadius: 10,
            background: "#3a3633",
            color: "#ffffff",
            padding: "16px 14px 14px",
            textAlign: "center",
          }}
        >
          <img
            src="/imprints-logo.png"
            alt="Imprints"
            style={{
              width: 210,
              maxWidth: "80%",
              height: "auto",
              display: "block",
              margin: "0 auto 8px",
            }}
          />
          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>
            Secure card payment
          </div>
          <div style={{ fontSize: 12, opacity: 0.95, marginTop: 4 }}>
            Safe online payment, verified with 3-D Secure.
          </div>
          <div
            style={{
              margin: "10px auto 8px",
              width: "fit-content",
              borderRadius: 999,
              border: "2px solid #10b981",
              color: "#9cf7db",
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1,
              boxShadow: "0 0 0 2px rgba(16,185,129,0.2), 0 0 18px rgba(16,185,129,0.35)",
            }}
          >
            ● 3-D Secure enabled
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.95 }}>
            Powered by edge+
          </div>
        </div>

        {!payloadSignatureValid && (
          <div
            style={{
              marginBottom: 10,
              padding: "8px 10px",
              borderRadius: 6,
              fontSize: 13,
              backgroundColor: "#fef2f2",
              border: "1px solid #ef4444",
              color: "#b91c1c",
            }}
          >
            Invalid payment link.
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
        <div style={{ fontSize: 12, color: "#374151", marginBottom: 6 }}>
          You&apos;re paying £{safeAmount}
        </div>

        <FieldLabel>Currency</FieldLabel>
        <select
          value={normalizedCurrency}
          onChange={(e) => setCurrency(e.target.value)}
          disabled={currencyLocked}
          style={inputStyle}
        >
          {supportedCurrencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <FieldLabel>Order reference</FieldLabel>
        <input
          type="text"
          value={orderReference}
          onChange={(e) => setOrderReference(e.target.value)}
          readOnly={orderRefLocked}
          style={inputStyle}
        />

        {payMode === "card" && (
          <>
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
            <input
              type="text"
              placeholder="Address line 2"
              value={address2}
              onChange={(e) => setAddress2(e.target.value)}
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
            <input
              type="text"
              placeholder="Country (e.g. GB)"
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              style={{ ...inputStyle, marginTop: 8 }}
            />
          </>
        )}

        {payMode === "wallet" && (
          <>
            <p style={{ marginTop: 8, marginBottom: 8, fontSize: 12, color: "#6b7280" }}>
              Name, email and address are requested from Apple Pay / Google Pay.
            </p>
            {walletMissingFields.length > 0 && (
              <div
                style={{
                  marginBottom: 8,
                  padding: "10px 10px 8px",
                  border: "1px solid #f59e0b",
                  background: "#fffbeb",
                  borderRadius: 8,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Complete missing details
                </div>
                {walletMissingFields.includes("name") && (
                  <input
                    type="text"
                    placeholder="Full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={inputStyle}
                  />
                )}
                {walletMissingFields.includes("email") && (
                  <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={inputStyle}
                  />
                )}
                {walletMissingFields.includes("address1") && (
                  <input
                    type="text"
                    placeholder="Address line 1"
                    value={address1}
                    onChange={(e) => setAddress1(e.target.value)}
                    style={inputStyle}
                  />
                )}
                {walletMissingFields.includes("city") && (
                  <input
                    type="text"
                    placeholder="Town / City"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    style={inputStyle}
                  />
                )}
                {walletMissingFields.includes("postcode") && (
                  <input
                    type="text"
                    placeholder="Postcode"
                    value={postcode}
                    onChange={(e) => setPostcode(e.target.value)}
                    style={inputStyle}
                  />
                )}
                {walletMissingFields.includes("country") && (
                  <input
                    type="text"
                    placeholder="Country (e.g. GB)"
                    value={country}
                    onChange={(e) => setCountry(e.target.value.toUpperCase())}
                    style={inputStyle}
                  />
                )}
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#92400e" }}>
                  Retry wallet payment after entering the missing fields.
                </p>
              </div>
            )}
          </>
        )}

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

        {/* Gold Standard payment box */}
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
              display: "inline-flex",
              gap: 6,
              marginBottom: 10,
              background: "#e5e7eb",
              borderRadius: 999,
              padding: 4,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setPayMode("wallet");
                setWalletMissingFields([]);
              }}
              disabled={!enableWallets}
              style={modeButtonStyle(payMode === "wallet")}
            >
              Wallet
            </button>
            <button
              type="button"
              onClick={() => {
                setPayMode("card");
                setWalletMissingFields([]);
              }}
              style={modeButtonStyle(payMode === "card")}
            >
              Pay by card
            </button>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
              fontSize: 13,
            }}
          >
            <strong>{payMode === "wallet" ? "Wallet" : "Card details"}</strong>
            <span style={{ color: "#6b7280" }}>
              {payMode === "wallet"
                ? "Apple Pay · Google Pay"
                : "Visa · Mastercard · Amex"}
            </span>
          </div>

          <div
            className={payMode === "wallet" ? "walletModeWidget" : undefined}
            style={
              payMode === "wallet" && !walletReady
                ? { opacity: 0.5, pointerEvents: "none" }
                : undefined
            }
          >
            <NmiPayments
              key={paymentsKey}
              tokenizationKey={tokenizationKey}
              layout="multiLine"
              paymentMethods={
                payMode === "wallet" && enableWallets
                  ? ["apple-pay", "google-pay"]
                  : ["card"]
              }
              preSelectFirstMethod={true}
              payButtonText="Pay"
              expressCheckoutConfig={expressCheckoutConfig}
              onChange={(data) => {
                const complete = data?.complete || false;
                setIsValid(complete);
                if (complete && data?.token) {
                  setPaymentToken(data.token);
                  if (
                    payMode === "wallet" &&
                    walletReady &&
                    data.token !== lastWalletTokenRef.current
                  ) {
                    lastWalletTokenRef.current = data.token;
                    void handleWalletPay(data.token);
                  }
                }
              }}
            />
          </div>

          <NmiThreeDSecure
            ref={threeDSRef}
            tokenizationKey={tokenizationKey}
            modal={true}
            onComplete={async (result) => {
              try {
                await submitPaymentWithToken(paymentToken, result);
                setIsProcessing(false);
              } catch (err) {
                console.error(err);
                setIsProcessing(false);
                setStatus("Error processing payment.");

                redirectToResult({
                  ok: false,
                  errorCode: "server_error",
                });
              }
            }}
            onFailure={() => {
              setIsProcessing(false);
              setStatus("3-D Secure cancelled or failed.");

              redirectToResult({
                ok: false,
                errorCode: "3ds_cancelled",
              });
            }}
          />
        </div>

        {payMode === "card" && (
          <button
            onClick={handlePay}
            disabled={!isValid || !paymentToken || isProcessing || !payloadSignatureValid}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "10px 12px",
              borderRadius: 999,
              border: "none",
              fontWeight: 600,
              fontSize: 15,
              cursor:
                !isValid || !paymentToken || isProcessing || !payloadSignatureValid
                  ? "not-allowed"
                  : "pointer",
              backgroundColor:
                !isValid || !paymentToken || isProcessing || !payloadSignatureValid
                  ? "#d1d5db"
                  : "#16a34a",
              color:
                !isValid || !paymentToken || isProcessing || !payloadSignatureValid
                  ? "#6b7280"
                  : "#ffffff",
            }}
          >
            Pay £{safeAmount}
          </button>
        )}

        {payMode === "wallet" && !walletReady && (
          <p style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
            Complete amount, currency and order reference to enable wallet payment.
          </p>
        )}

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

function isValidAmountInput(value) {
  const trimmed = String(value || "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return false;
  return Number(trimmed) > 0;
}

function getSafeAmount(value) {
  if (!isValidAmountInput(value)) return "0.00";
  return Number(value).toFixed(2);
}

function modeButtonStyle(active) {
  return {
    border: "none",
    borderRadius: 999,
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    background: active ? "#111827" : "transparent",
    color: active ? "#ffffff" : "#374151",
  };
}

function detectWalletMissingFields({ error, errorCode, values }) {
  const text = `${errorCode || ""} ${error || ""}`.toLowerCase();
  const missing = [];

  const maybeAdd = (field, pattern) => {
    if (pattern.test(text) && !String(values[field] || "").trim()) missing.push(field);
  };

  maybeAdd("name", /name|first_name|last_name/);
  maybeAdd("email", /email/);
  maybeAdd("address1", /address|address1|street/);
  maybeAdd("city", /city|town/);
  maybeAdd("postcode", /postal|postcode|zip/);
  maybeAdd("country", /country/);

  return [...new Set(missing)];
}
