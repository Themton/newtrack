# J&T EXPRESS production setup

J&T uses separate credentials for `VIP8530310123` and `VIP8530310124`. Store each account's `API_ACCOUNT`, `PRIVATE_KEY`, and 32-character business password in Cloudflare Worker secrets (`JT_23_*` and `JT_24_*`). The business password must come from J&T Signature Tools for that VIP; do not derive it from an assumed salt. Keep `JT_ACCESS_TOKEN` in the Worker too. Never commit credentials or customer passwords.

The Worker configuration sets `JT_API_BASE` to `https://ylopenapi.jtexpress.co.th`. The browser must send `environment: "production"` for order creation, cancellation, and label printing; the Worker rejects older UAT clients before calling J&T. Verify `GET /` returns `jntEnvironment: "production"` after deployment. Do not use production credentials against the sandbox API.

New J&T parcels use `source=jnt`. Existing `source=jnt_uat` parcels remain marked as test data and cannot be used for production J&T calls. Both sources are excluded from Flash sync, Flash pickup reports, and Flash public tracking. New J&T parcels must be tied to an active J&T shop with the correct `jt_app` VIP. No Supabase schema migration is needed if `fx_parcels.source` and `fx_shops.jt_app` already exist.

Read-only production authentication was confirmed for both VIPs using J&T tracking queries with nonexistent order IDs. This does **not** prove successful live order creation or label printing. Test one real parcel with the user's intended sender, receiver, and consent, then verify the returned waybill, saved database row, PDF label, and J&T tracking. Never create a fake production order for a smoke test.

Deployment order: publish the Worker with production base and request guard, confirm `GET /`, then publish the frontend. An old frontend cannot create, cancel, or print production J&T orders. Keep the Flash credentials and logic unchanged. J&T tracking push and public tracking are not enabled by this change; do not present Flash tracking data as J&T tracking.

Local checks:

```bash
node --test tests/jnt-routing.test.js
node jt-worker.test.mjs
npm run build
npx wrangler deploy --dry-run --config ./wrangler.toml
```
