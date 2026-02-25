// app/page.js – server wrapper

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import CheckoutPage from "./CheckoutPage";

function getFirstParam(params, key) {
  const value = params?.[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

export default async function Page({ searchParams }) {
  const params = (await searchParams) || {};
  const walletsEnabled = process.env.ENABLE_WALLETS === "true";
  const enableWallets = walletsEnabled;

  const qAmount = getFirstParam(params, "amount");
  const qOrderReference = getFirstParam(params, "order_reference");
  const qCustomerName = getFirstParam(params, "customer_name");
  const qCustomerEmail = getFirstParam(params, "customer_email");
  const qBillingPostcode = getFirstParam(params, "billing_postcode");

  const hasValidAmount = qAmount && !Number.isNaN(parseFloat(qAmount));

  return (
    <CheckoutPage
      enableWallets={enableWallets}
      initialAmount={hasValidAmount ? qAmount : "1.00"}
      initialAmountLocked={Boolean(hasValidAmount)}
      initialOrderReference={qOrderReference || ""}
      initialOrderRefLocked={Boolean(qOrderReference)}
      initialName={qCustomerName || ""}
      initialEmail={qCustomerEmail || ""}
      initialPostcode={qBillingPostcode || ""}
    />
  );
}
