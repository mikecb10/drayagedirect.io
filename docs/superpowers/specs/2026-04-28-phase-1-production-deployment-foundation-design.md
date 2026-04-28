# Phase 1: Production Deployment Foundation — Design Spec

**Status:** Draft → user review pending
**Author:** Claude (brainstorming session 2026-04-28)
**Predecessor:** None — first deployment of this app
**Successor:** Phase 2 (CI/CD + observability + drayagedirect.io domain finalization), then Phases 3-7 per the SaaS roadmap

---

## 1. Goal

Stand up a real production deployment of the DrayageDirect app at `app.drayagedirect.io`, backed by a dedicated Supabase production project, with the operational hygiene (health check, error tracking, smoke tests, rollback path) appropriate for a "real SaaS" launch. Sufficient for taking on real trucking-carrier customers — not just a URL with a build deployed to it.

The output is **a working live URL** that:
- Serves the app at `app.drayagedirect.io` with auto-SSL
- Has a dedicated production database isolated from dev
- Auto-deploys on push to `main`
- Reports errors to a dashboard
- Has a documented rollback procedure
- Has a separate staging environment for testing changes before they hit prod

## 2. Non-Goals (deferred to later phases)

- **Stripe subscription billing** — Phase 3. Schema columns (`subscription_status`, `plan_id`, etc.) are added now so they exist; Stripe wiring comes later.
- **drayagedirect.io marketing site ↔ app SSO** — Phase 4. The marketing site stays a static GitHub Pages site at `drayagedirect.io` root; the app is at the `app.drayagedirect.io` subdomain. Login from the marketing site → app handoff is built later.
- **Self-serve carrier signup** — Phase 4. Phase 1 onboards pilot customers manually (you create their tenant in the admin dashboard).
- **QuickBooks Online integration** — Phase 5. The `tenant_secrets` table is added in Phase 1 to hold OAuth tokens later.
- **Terminal credential management + scrapers** — Phase 6. Most terminal portals have no public APIs; the scraper infrastructure (background workers + headless browser) is a Phase 6 problem. Phase 1's `tenant_secrets` table holds the credentials when they arrive.
- **Compliance docs (TOS, privacy policy)** — Phase 7. Required before public signup; not blocking for hand-onboarded pilots.
- **Multi-region / HA / failover** — Phase 7+. Single-region deployment is fine for early stage.
- **Live UI smoke beyond health check** — full E2E user-flow tests are deferred. Phase 1 ships health check + simple page-load smoke.

## 3. Architecture

### 3.1 Repo split

The current repo (`mikecb10/drayagedirect.io`) was originally created for the marketing site. App code was committed to its `main` branch in March-April 2026, displacing the marketing source. The marketing source still exists on the `codex/find-and-fix-a-bug` branch (PR #1, never merged). GitHub Pages builds from `main` have been failing since the app code arrived; the live drayagedirect.io is serving a stale cached build.

**Decision:** split into two repos.

| Repo | Purpose | Source of truth |
|---|---|---|
| `mikecb10/drayagedirect.io` (existing) | Marketing site at `drayagedirect.io` root domain | Restore from PR #1's `codex/find-and-fix-a-bug` branch onto `main`. Delete app branches. |
| `mikecb10/drayagedirect-app` (new) | The Next.js app at `app.drayagedirect.io` subdomain | Push current `main` of the existing repo as-is (preserves 4-week dev history). Local working tree's `origin` repointed at the new repo. |

**Migration mechanics:**
1. Create new GitHub repo `mikecb10/drayagedirect-app` (private).
2. From a fresh clone of the current repo, push `main` to the new repo. Push other dev branches (`feat/load-margin`, `fix/load-margin-super-admin-gate`) too — they belong with the app, not the marketing site.
3. In the local working tree at `C:\Users\bento\app-drayagedirect`: `git remote set-url origin https://github.com/mikecb10/drayagedirect-app.git`. Future pushes go to the new repo.
4. In the old `drayagedirect.io` repo: `git checkout codex/find-and-fix-a-bug -- .`, commit to main as a "restore marketing site" commit, push. Pages builds resume.
5. Delete app-related branches from the old repo (they're preserved in the new repo).

**Estimated migration time:** 30-60 minutes including DNS propagation waits.

### 3.2 Vercel topology

**Production project:** `drayagedirect-app` on Pro tier ($20/mo).
- Deploys from `main` of the new app repo. Auto-deploy on push.
- Custom domain: `app.drayagedirect.io` with auto-SSL.
- Environment variables: production values for all 16 env vars (Firebase, Supabase prod URL+keys, Google Maps, JWT secrets, SendGrid).
- Cron jobs: the 3 existing crons in `vercel.json` (rules engine eval every 15min, stale-ping pause every 1min, breadcrumb retention daily) — Pro tier required to run them.
- Sentry integration installed via Vercel's native one-click integration.

**Staging:** Vercel preview deployments. Every non-`main` branch + every PR gets an auto-deployed preview URL (e.g., `drayagedirect-app-abc123.vercel.app`).
- No separate Vercel project needed.
- No custom domain (use Vercel's auto-generated URL).
- Environment variables: staging values, pointed at the staging Supabase project.

**Why this is enough staging for Phase 1:** Vercel previews give us per-PR isolated deployments at zero additional cost. They auto-tear-down when the PR closes. Combined with a separate staging Supabase project, this gives "test on real infrastructure with fake data" — which is the staging value.

### 3.3 Supabase topology

Three isolated databases:

| Project | Tier | Purpose | Pause-on-inactivity? |
|---|---|---|---|
| `drayagedirect-prod` (new) | Pro ($25/mo) | Real customer data | No (always-on, PITR enabled) |
| `drayagedirect-staging` (new) | Free ($0) | Test data, exercises preview deploys | Yes — acceptable; un-pause when needed |
| Existing dev Supabase project | (whatever it is) | Local `npm run dev` | Whatever it is — unchanged |

**Migrations:** all `supabase/migrations/*.sql` files apply cleanly to a fresh DB. The existing project has been built up incrementally; we run them from scratch on the new prod and staging projects.

**Phase 1 schema additions** (one new migration file):

#### 3.3.1 Subscription state on `tenants`

```sql
ALTER TABLE tenants
  ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'trialing'
    CHECK (subscription_status IN ('trialing','active','past_due','canceled','suspended')),
  ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'free'
    CHECK (plan_id IN ('free','starter','pro','enterprise')),
  ADD COLUMN trial_ends_at TIMESTAMPTZ,
  ADD COLUMN subscription_started_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN subscription_expires_at TIMESTAMPTZ;
```

Used in Phase 1 only for manual gating ("set this tenant to `suspended` if they don't pay"). Stripe webhook handler in Phase 3 takes over the writes.

#### 3.3.2 `tenant_secrets` table (foundation for Phase 5+6)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenant_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  secret_kind TEXT NOT NULL,             -- e.g., 'qbo_oauth', 'terminal_apmt'
  secret_label TEXT,                     -- human-friendly name
  encrypted_value BYTEA NOT NULL,        -- pgp_sym_encrypt() output
  metadata JSONB DEFAULT '{}',           -- non-secret context
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, secret_kind, secret_label)
);

CREATE INDEX idx_tenant_secrets_tenant ON tenant_secrets(tenant_id);

-- RLS: tenant_secrets readable only by users in the same tenant (and super-admin).
ALTER TABLE tenant_secrets ENABLE ROW LEVEL SECURITY;
-- (Specific RLS policy mirrors existing tenant-scoped policy patterns; auditor verifies.)

NOTIFY pgrst, 'reload schema';
```

Encryption key (`TENANT_SECRETS_ENCRYPTION_KEY`) lives in Vercel env vars. Key generation:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Encryption: `pgp_sym_encrypt(secret_text, key_text)`. Decryption: `pgp_sym_decrypt(encrypted_value, key_text)`. Wrapper helpers in `lib/secrets/tenant-secrets.js` exposed for Phase 5+6.

#### 3.3.3 RLS verification (no schema change)

Audit pass: confirm RLS is enabled and tenant-scoped on every table with a `tenant_id` column. Document any gaps as Phase 1 follow-ups. Memory says this is largely complete; a verification script is part of Phase 1.

### 3.4 DNS configuration

**At Squarespace (the registrar):**

| Record | Type | Target | Purpose |
|---|---|---|---|
| `drayagedirect.io` (apex) | A / ALIAS | GitHub Pages IPs (`185.199.108-111.153`) | Marketing site (existing, unchanged) |
| `app.drayagedirect.io` | CNAME | Vercel-provided target (`cname.vercel-dns.com`) | App (NEW) |

Squarespace DNS UI exposes both A and CNAME record editing. SSL for `app.drayagedirect.io` is provisioned automatically by Vercel (Let's Encrypt) once DNS resolves correctly. Propagation typically completes within 10-30 minutes.

**No changes to:**
- The apex record (drayagedirect.io stays on GitHub Pages, points at the marketing site).
- Email MX / DKIM records (SendGrid domain auth already configured per the env var `SENDGRID_PLATFORM_DOMAIN_ID`).

### 3.5 Sentry integration

Use Vercel's native Sentry integration:
1. Vercel dashboard → Settings → Integrations → Sentry → Install.
2. Connect to a Sentry project (`drayagedirect-app`) on the free tier.
3. Vercel auto-injects `SENTRY_AUTH_TOKEN`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` into the project's env vars.
4. Add `@sentry/nextjs` as a devDep + create `sentry.client.config.js` + `sentry.server.config.js` with minimal init (auto-import via `next.config.mjs` `withSentryConfig` wrapper).

Critical config:
- `Sentry.init({ release: process.env.VERCEL_GIT_COMMIT_SHA, ... })` — tags errors with the deploy SHA.
- Source maps uploaded automatically by `@sentry/nextjs`.
- `tracesSampleRate: 0.1` — 10% of transactions sampled for performance monitoring; sufficient for early stage.
- `environment: process.env.VERCEL_ENV` — `production` / `preview` / `development`. Lets us filter Sentry views.

### 3.6 Health check + post-deploy smoke

#### `pages/api/health.js`

```js
import { getSupabaseServiceRole } from '../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const checks = { database: 'unknown', auth: 'unknown' };
  let overallOk = true;

  try {
    const svc = getSupabaseServiceRole();
    const { error: dbErr } = await svc.from('tenants').select('id').limit(1);
    checks.database = dbErr ? 'error' : 'ok';
    if (dbErr) overallOk = false;
  } catch (e) {
    checks.database = 'error';
    overallOk = false;
  }

  // 'auth' check: confirms the service-role key works (separate from a generic DB ping)
  // omitted for brevity; mirrors database check shape.

  res.status(overallOk ? 200 : 503).json({
    status: overallOk ? 'ok' : 'degraded',
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'unknown',
    timestamp: new Date().toISOString(),
    checks,
  });
}
```

#### `.github/workflows/post-deploy-smoke.yml`

Triggered on Vercel deployment success (via Vercel webhook → GitHub repo dispatch event). Runs:

```bash
curl -fsS https://app.drayagedirect.io/api/health | jq -e '.status == "ok"'
curl -fsS -I https://app.drayagedirect.io/login | grep -E "HTTP/.+ 200"
```

If either fails: workflow fails, GitHub notifies (email + GitHub UI). The deploy stays live (Vercel doesn't auto-rollback on smoke failure) — manual rollback per `docs/rollback.md`.

### 3.7 Documentation

Two new files in `docs/`:

- `docs/deploy-runbook.md` — one-time-setup procedure: create Supabase projects → run migrations → seed reference data → bootstrap super-admin → create internal tenant → configure Vercel project → set env vars → connect domain → first deploy → verify.
- `docs/rollback.md` — three rollback paths: deploy rollback (Vercel UI, 30s), schema rollback (migration-by-migration), data corruption recovery (Supabase PITR).

## 4. File Touch List

### New repo
- `mikecb10/drayagedirect-app` — created on GitHub, current `main` of the existing repo pushed to it.

### Restored content in existing repo (`mikecb10/drayagedirect.io`)
- `index.html`, `login.html`, `signup.html`, `dashboard.html`, `CNAME`, logo files — restored from PR #1.
- All app branches deleted.

### New files in the app repo
| Path | Purpose |
|---|---|
| `pages/api/health.js` | Health check endpoint |
| `sentry.client.config.js` | Sentry browser init |
| `sentry.server.config.js` | Sentry server-side init |
| `.github/workflows/post-deploy-smoke.yml` | Post-deploy smoke test |
| `supabase/migrations/<NNN>-phase-1-prod-deployment.sql` | Subscription columns + tenant_secrets + pgcrypto |
| `scripts/seed-prod-reference.sql` | Idempotent reference data seed |
| `lib/secrets/tenant-secrets.js` | Encryption/decryption helpers (stubs in Phase 1; consumed in Phase 5+6) |
| `docs/deploy-runbook.md` | Initial deploy procedure |
| `docs/rollback.md` | Rollback runbook |

### Modified files in the app repo
| Path | Change |
|---|---|
| `next.config.mjs` | Wrap with `withSentryConfig()` |
| `package.json` | Add `@sentry/nextjs` to dependencies |
| `.env.example` | Add `TENANT_SECRETS_ENCRYPTION_KEY`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` |
| `README.md` | Replace Next.js boilerplate with project-specific setup + deployment overview |

### External (no file changes; configuration in dashboards)
- Vercel: new project, env vars, Sentry integration, custom domain, Pro upgrade
- Supabase: 2 new projects (prod + staging), migrations applied, seed run
- Squarespace DNS: new CNAME for `app.drayagedirect.io`
- GitHub: new repo created, marketing repo restored

**Total:** 9 new files, 4 modified files, plus extensive external configuration.

## 5. Verification & Risks

### 5.1 Verification plan

1. **Repo migration succeeded:**
   - `mikecb10/drayagedirect-app/main` shows the same HEAD as the current local main (`dbbb3f9`).
   - `mikecb10/drayagedirect.io/main` shows the marketing site index.html from PR #1.
   - GitHub Pages build for the marketing repo succeeds (status `built`, not `errored`).
   - Local `git remote -v` shows `origin` → `drayagedirect-app`.
2. **Supabase prod project ready:**
   - All migrations applied (verify via Supabase SQL editor: `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'` matches dev).
   - Seed reference data present (system roles, permission sets, default load types — counts match dev's reference rows).
   - Super-admin user can log in via Supabase auth.
   - DrayageDirect Internal tenant exists.
3. **Vercel deploys cleanly:**
   - First deploy completes with no build errors.
   - All 16 env vars present in production env (Vercel dashboard → Settings → Environment Variables).
   - Crons enabled and visible in Vercel dashboard → Crons.
4. **Live URL works:**
   - `https://app.drayagedirect.io` loads the login page.
   - `https://app.drayagedirect.io/api/health` returns `{ status: 'ok' }`.
   - Logging in as the super-admin succeeds; dashboard loads.
   - Creating a test load in the DrayageDirect Internal tenant works end-to-end.
5. **Observability working:**
   - Manually trigger an error (e.g., visit a non-existent page that throws). Confirm it appears in Sentry within 2 minutes.
   - Check Sentry release shows the deploy SHA.
6. **Smoke test workflow runs:**
   - Make a trivial PR (a comment change), merge to main.
   - Confirm `.github/workflows/post-deploy-smoke.yml` runs and passes.
7. **Staging works:**
   - Open a PR to the new repo. Confirm Vercel preview URL deploys.
   - Confirm preview URL points at staging Supabase (different data than prod).
8. **Rollback verified:**
   - In Vercel dashboard, "Promote to Production" the previous deployment.
   - Live URL changes within 30s.
   - Promote back to current to restore.

### 5.2 Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Repo migration loses git history | Very Low | Push as-is preserves all commits; the migration is non-destructive (old repo isn't deleted, just refocused on marketing) |
| Marketing site stays broken (PR #1 source is stale) | Medium | The PR #1 source might not match the live cached site. Acceptable risk: even if the restored site is slightly older, it's consistent and rebuildable. Future Phase 2 can update the marketing copy. |
| Migrations fail on fresh DB | Low-Medium | Each migration in `supabase/migrations/` should be idempotent and self-contained; if any fails, fix in a follow-up commit and re-run. Test by applying to staging first. |
| Sentry source maps not uploaded correctly | Low | `@sentry/nextjs` handles this via Vercel integration; verify by checking a test error has resolved file paths in Sentry dashboard |
| DNS propagation delays | Low | 10-30 min typical for CNAME; up to 48h worst case. Schedule the DNS change for off-hours. Vercel SSL provisioning waits for DNS. |
| Vercel cron jobs don't fire correctly in prod | Low | Verify in Vercel dashboard → Crons after deploy that all 3 crons show "Last run: <timestamp>" within their schedule window. |
| Supabase Pro project hits hidden limits | Low | $25/mo Pro tier: 8 GB DB, 250 GB egress, 100K MAU. Plenty for early stage. Monitor in Supabase dashboard. |
| Encryption key gets lost | Medium-High (long-term) | Document the key generation procedure + store in a secure password manager before deploying. **Critical:** if the key is lost, all encrypted secrets are unrecoverable. Phase 1 has no encrypted data yet, but Phase 5+6 onwards depends on this. |
| Reference data seed conflicts with existing migrations | Low | Seed is idempotent (`INSERT ... ON CONFLICT DO NOTHING`). Test on staging first. |
| Vercel preview URLs leak production-like data via wrong env vars | Low | Strictly separate Vercel "Production" and "Preview" environment variable scopes. Verify after setup that preview env's `NEXT_PUBLIC_SUPABASE_URL` points at staging, not prod. |

### 5.3 Rollback plan (per-step)

Each step of the deploy runbook has a documented rollback. The most consequential:

- **DNS change rollback:** revert the CNAME at Squarespace; propagation 10-30 min. Marketing site at apex unaffected.
- **First-deploy bug:** Vercel UI → Promote previous deployment (30s).
- **Migration broke prod:** `pgcrypto` extension creation is reversible (`DROP EXTENSION pgcrypto`); column adds are reversible (`ALTER TABLE tenants DROP COLUMN ...`); `tenant_secrets` table can be `DROP TABLE`'d. All explicit in `docs/rollback.md` with copy-pasteable SQL.
- **Repo migration mistake:** the old repo is preserved as-is; we can re-migrate or fix in place.

## 6. Implementation Sequencing

Phase 1 has natural ordering. Each step has its own verification gate.

| Order | Task | Estimated time | Verification |
|---|---|---|---|
| 1 | Repo split: create new repo, push main, restore marketing repo | 30-60 min | Both repos build (Pages + clone) |
| 2 | Schema additions (new migration file in app repo) | 1 hr | Migration applies cleanly to local dev DB; tests still pass |
| 3 | Health check endpoint + Sentry config files + smoke test workflow | 2 hr | Health endpoint returns 200 in dev; Sentry init compiles; workflow YAML lints |
| 4 | Supabase prod + staging projects: create, migrate, seed | 2 hr | Both DBs have full schema + reference data; super-admin login works |
| 5 | Vercel project: create, configure, env vars, Sentry, domain, Pro upgrade | 1-2 hr | First deploy succeeds; live URL serves the app |
| 6 | DNS: CNAME at Squarespace; verify cert provisioning | 30 min + propagation wait | `app.drayagedirect.io` resolves; HTTPS green |
| 7 | End-to-end verification: log in as super-admin, create test load, trigger error, confirm Sentry, run smoke test | 1 hr | All §5.1 items green |
| 8 | Documentation: runbook + rollback | 1-2 hr | Both files committed |

**Total: ~10-15 hours.** Single-session is possible but spreading across 2-3 sessions is more realistic given the dashboard-clicking nature of steps 4-6.

Subagent dispatch makes sense for steps 2 + 3 (code-heavy, well-bounded). Steps 1, 4, 5, 6, 7 are dashboard-driven and easier inline. Step 8 (docs) can be subagent.

## 7. Success Criteria

- [ ] `https://app.drayagedirect.io` loads the login page
- [ ] Super-admin can log in and see admin dashboard
- [ ] DrayageDirect Internal tenant exists with full feature access
- [ ] `https://app.drayagedirect.io/api/health` returns `{ status: 'ok', version: <sha>, ... }`
- [ ] Errors in production are reported to Sentry within 2 min, tagged with deploy SHA
- [ ] Vercel preview deploys work for non-main branches; pointed at staging Supabase
- [ ] `.github/workflows/post-deploy-smoke.yml` runs after each prod deploy and passes
- [ ] All 3 cron jobs in `vercel.json` are running on their schedules in Vercel dashboard
- [ ] Marketing site at `drayagedirect.io` (root) is restored and rebuilds cleanly on PR merges to its repo
- [ ] `docs/deploy-runbook.md` and `docs/rollback.md` are committed and accurate
- [ ] Encryption key is generated, set in Vercel, and backed up to a secure password manager
- [ ] Followups.md ledger updated with Phase 1 resolution + Phase 2 entry
