# Imprints Checkout

Hosted Next.js checkout with NMI card processing, 3DS, and webhook/redirect handling.

## Apple Pay Domain Verification

Verification file is served at:

- `/.well-known/apple-developer-merchantid-domain-association`

Implementation:

- Static file: `public/.well-known/apple-developer-merchantid-domain-association`
- Rewrite: `/.well-known/...` -> `/api/apple-pay/domain-association`

## Wallet Rollout (Production-Safe)

Wallet UI can be enabled without changing card checkout behavior for all users.

### Environment variables

- `ENABLE_WALLETS=true|false`
- `WALLET_ROLLOUT_KEY=<secret>` (optional)
- `NEXT_PUBLIC_APPLE_PAY_MERCHANT_ID=<merchant-id>` (optional)
- `NEXT_PUBLIC_APPLE_PAY_DISPLAY_NAME=Imprints` (optional)
- `NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID=<merchant-id>` (optional)
- `NEXT_PUBLIC_GOOGLE_PAY_ENVIRONMENT=PRODUCTION|TEST` (optional)

### Modes

1. `ENABLE_WALLETS=false`
- Wallets fully off.

2. `ENABLE_WALLETS=true` and no `WALLET_ROLLOUT_KEY`
- Wallets on for all users.

3. `ENABLE_WALLETS=true` and `WALLET_ROLLOUT_KEY` set
- Wallets only on URLs including:
- `/?wallet_preview=<WALLET_ROLLOUT_KEY>`

## Local Dev

```bash
npm install
npm run dev
```

