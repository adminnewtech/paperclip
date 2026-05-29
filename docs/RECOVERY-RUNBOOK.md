# Local Dev Recovery Runbook (NewTech AI / Business OS)

**When:** the local server returns `503 database_unreachable`, `ECONNRESET`, `too many clients`, or `57P03` — i.e. the embedded PostgreSQL got destabilized (usually after many `dev:once` restarts / forced process kills on Windows).

**Root cause:** repeatedly force-killing the embedded `postgres.exe` mid-write corrupts its data dir / leaves half-dead processes that get "reused" broken. The reliable reset is a **reboot** (clears all orphaned node + postgres processes at once).

---

## One-time clean recovery (after a reboot)

```bash
# 1. Reboot Windows (clears ~all orphaned node + postgres processes).

# 2. Move aside any damaged DB dirs (data is fully re-seedable — external sources are read-only & intact):
#    Keep them for forensics; the fresh start will init a new one.
cd ~/.paperclip/instances/default
# (optional) ls to see db, db.corrupted-*, db.bad2-* — leave them; a fresh `db` will be created if missing,
# OR if `db` exists and is healthy it will be reused.

# 3. Start ONE server (do NOT spawn multiple, do NOT kill it):
cd /c/Users/kthug/paperclip
BETTER_AUTH_SECRET=paperclip-local-dev-2026 SERVE_UI=true PAPERCLIP_MIGRATION_AUTO_APPLY=true pnpm dev:once

# 4. Wait for "Migrations complete" + "Server listening". Verify REAL health (not the SPA):
curl -s http://127.0.0.1:3100/api/health    # must be {"status":"healthy"} — 503 = DB still down
curl -s http://127.0.0.1:3100/api/companies # must be 200
```

## Re-seed NewTech AI (after health is green)

All data is re-derivable; scripts hold the real captured data:

```bash
# Create company + 16 agents + ecommerce modules, then:
cd /c/Users/kthug
# Edit the CID in these scripts to the new company id, then:
PYTHONIOENCODING=utf-8 python3 sync_real_data.py    # 10 products + 10 invoices + 8 customers (real Shopify/Zoho)
PYTHONIOENCODING=utf-8 python3 seed_connectors.py   # 6 connectors (read-only)
```

Then seed commerce products+stock for POS via the new endpoints:
```
POST /api/companies/{CID}/warehouses {name,location}
POST /api/companies/{CID}/products {name,sku,priceMinor,currency:"KWD",warehouseId,initialQty}
```

## Verify POS atomic checkout LIVE
```
POST /api/companies/{CID}/pos/checkout {warehouseId, lines:[{variantId,qty,unitPriceMinor}], paymentMethod:"cash", currency:"KWD", taxRatePct:0}
→ 200 + balanced order; stock decremented
POST same with qty > stock → 409 "Insufficient stock"; stock unchanged (atomic rollback)
```

## Golden rules to avoid re-breaking
- **Never force-kill `postgres.exe`.** Use `pnpm dev:stop` for graceful shutdown.
- Run **ONE** `dev:once` at a time. Don't spawn a second while one is up.
- If you must stop: `pnpm dev:stop`, then verify `postgres.exe` exited on its own before starting again.
- The server binds 3100 (or next free). Check the startup banner for the actual port.

## What is NOT lost (ever)
- All code: committed to `feature/upstream-sync-v2026.525` on GitHub.
- All migrations: 0001–0095 apply cleanly on any fresh DB ("Applying 96 pending migration(s)... Migrations complete").
- All real data: re-derivable from Shopify/Zoho (read-only, untouched) via the seed scripts.
- Tests: `pnpm --filter @paperclipai/server` pos-checkout.test.ts (3/3) + plugin policy tests (16/16) pass independently of the runtime.
