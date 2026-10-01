# wd-failed-dashboard

Dashboard monitoring failed withdrawal dan pencairan.

## Deploy

Cloudflare Workers + D1. `wrangler` dipin ke versi 4.144.0 agar Workers Builds tidak otomatis mengambil versi Wrangler terbaru.

D1 production:
- Name: `wd-dashboard-db`
- Binding: `DB`
- ID: `8a28f6a8-5cc5-4714-a2c2-5aadd67f42ea`
