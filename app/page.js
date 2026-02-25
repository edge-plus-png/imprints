// app/page.js – server wrapper

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import CheckoutPage from "./CheckoutPage";

export default function Page() {
  return <CheckoutPage />;
}