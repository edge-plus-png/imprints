// app/page.js – server wrapper

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import CheckoutPage from "./CheckoutPage";

export default function Page({ searchParams }) {
  const walletsEnabled = process.env.ENABLE_WALLETS === "true";
  const rolloutKey = process.env.WALLET_ROLLOUT_KEY || "";

  const previewKeyFromUrl =
    typeof searchParams?.wallet_preview === "string"
      ? searchParams.wallet_preview
      : "";

  const walletsForAll = walletsEnabled && !rolloutKey;
  const walletsForPreview = walletsEnabled && rolloutKey === previewKeyFromUrl;
  const enableWallets = walletsForAll || walletsForPreview;

  return <CheckoutPage enableWallets={enableWallets} />;
}
