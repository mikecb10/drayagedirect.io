# Phase 1: Production Deployment Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Note:** Tasks 7-9 are USER-DRIVEN (require dashboard access to GitHub, Vercel, Supabase, Squarespace, payment). The agent prepares scripts and provides exact values; the user clicks. Tasks 1-6 and 10 are agent-executable.

**Goal:** Stand up a real production deployment of the DrayageDirect app at `app.drayagedirect.io` backed by a dedicated Supabase production project, with the operational hygiene (health check, error tracking, smoke tests, rollback path) appropriate for a real SaaS launch.

**Architecture:** Repo split (marketing site stays at `mikecb10/drayagedirect.io`, app moves to new `mikecb10/drayagedirect-app`). Vercel Pro hosts the app at `app.drayagedirect.io`; Vercel preview deploys serve as staging. Two new Supabase projects (prod = Pro tier, staging = free tier). Schema additions (`tenants` subscription columns + `tenant_secrets` table with pgcrypto) lay foundation for Phases 3, 5, 6. ~$45/mo recurring cost.

**Tech Stack:** Next.js 15 + React 19 (app), Vercel (host + cron), Supabase (Postgres + auth + storage), pgcrypto (secrets-at-rest), Sentry (errors), GitHub Actions (post-deploy smoke), Squarespace (DNS).

**Spec:** `docs/superpowers/specs/2026-04-28-phase-1-production-deployment-foundation-design.md`

---

## File Structure

### New repos
| Repo | Owner | Purpose |
|---|---|---|
| `mikecb10/drayagedirect-app` | User creates on GitHub | The Next.js app, deploys to `app.drayagedirect.io` |

### New files in the app repo
| Path | Responsibility |
|---|---|
| `pages/api/health.js` | GET endpoint returning JSON health status (DB ping + version + timestamp) |
| `sentry.client.config.js` | Sentry browser-side init |
| `sentry.server.config.js` | Sentry server-side init |
| `.github/workflows/post-deploy-smoke.yml` | Curl-based smoke test triggered after Vercel deploys |
| `supabase/migrations/112_phase_1_prod_deployment.sql` | Subscription columns on `tenants` + `tenant_secrets` table + pgcrypto extension |
| `scripts/seed-prod-reference.sql` | Idempotent reference data seed (system roles, permission sets, default load types, document type registries) |
| `lib/secrets/tenant-secrets.js` | Encryption/decryption helper functions wrapping `pgp_sym_encrypt`/`pgp_sym_decrypt` |
| `docs/deploy-runbook.md` | One-time-setup procedure for first deploy |
| `docs/rollback.md` | Three rollback paths (deploy / schema / data) |

### Modified files in the app repo
| Path | Change |
|---|---|
| `next.config.mjs` | Wrap export with `withSentryConfig()` |
| `package.json` | Add `@sentry/nextjs` to `dependencies` |
| `.env.example` | Add `TENANT_SECRETS_ENCRYPTION_KEY`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` |
| `README.md` | Replace Next.js boilerplate with project-specific setup + deployment overview |

### External (no file changes; configuration in dashboards)
- Vercel: new project, env vars, Sentry integration, custom domain, Pro upgrade
- Supabase: 2 new projects (prod + staging), migrations applied, seed run
- Squarespace DNS: new CNAME for `app.drayagedirect.io`
- GitHub: new repo created, marketing repo restored

---

## Task 1: Repo split + marketing site restoration

**Files:**
- New external: `mikecb10/drayagedirect-app` (GitHub repo)
- Modify external: `mikecb10/drayagedirect.io` (restore marketing source from PR #1)
- Modify local: `.git/config` (origin URL change)

**Who executes:** Mostly agent via `gh` CLI + `git`. User must be authenticated to `gh` already (verify with `gh auth status`).

- [ ] **Step 1: Verify gh CLI is authenticated**

Run:
```bash
gh auth status 2>&1 | head -5
```
Expected output includes `Logged in to github.com as mikecb10`. If not, the user runs `gh auth login` themselves.

- [ ] **Step 2: Create the new app repo on GitHub**

Run:
```bash
gh repo create mikecb10/drayagedirect-app --private --description "DrayageDirect app (Next.js, deployed to app.drayagedirect.io)"
```

Expected output: `https://github.com/mikecb10/drayagedirect-app`. The repo is created empty.

- [ ] **Step 3: Push current main + dev branches to the new repo**

Run from working directory `C:\Users\bento\app-drayagedirect`:
```bash
git push https://github.com/mikecb10/drayagedirect-app.git main
git push https://github.com/mikecb10/drayagedirect-app.git feat/load-margin
git push https://github.com/mikecb10/drayagedirect-app.git fix/load-margin-super-admin-gate
```

(Skip any branches that don't exist locally — that's fine.)

Expected: each push succeeds, reports the hash range pushed.

- [ ] **Step 4: Repoint local origin to the new repo**

Run:
```bash
git remote set-url origin https://github.com/mikecb10/drayagedirect-app.git
git remote -v
```
Expected: both fetch and push lines show `mikecb10/drayagedirect-app`.

- [ ] **Step 5: Verify new repo has the expected commits**

Run:
```bash
gh repo view mikecb10/drayagedirect-app --json defaultBranchRef
git ls-remote origin main
```
Expected: defaultBranchRef matches main; the SHA matches local `git rev-parse HEAD`.

- [ ] **Step 6: Restore marketing site source on the old repo's main**

In a SEPARATE working directory (not the current app dir), clone the old repo and restore from PR #1:

```bash
cd /tmp
git clone https://github.com/mikecb10/drayagedirect.io.git old-drayagedirect-marketing
cd old-drayagedirect-marketing
git checkout main
# Bring in everything from the codex branch
git checkout origin/codex/find-and-fix-a-bug -- .
# Verify expected files arrived
ls -la index.html login.html signup.html dashboard.html CNAME
git add -A
git commit -m "$(cat <<'EOF'
restore: marketing site on main (was overwritten by app code, app moved to drayagedirect-app)

The app code was committed to this repo's main branch in March-April 2026,
displacing the marketing site source. The app has now been moved to
mikecb10/drayagedirect-app. This commit restores the marketing site source
to main from the codex/find-and-fix-a-bug branch (PR #1).

After this commit, GitHub Pages should resume building successfully and
serve the proper marketing site at drayagedirect.io.
EOF
)"
git push origin main
```

Expected: commit pushed; GitHub Pages will rebuild within a few minutes.

- [ ] **Step 7: Delete app branches from the old repo**

Run from the same `/tmp/old-drayagedirect-marketing` directory:

```bash
git push origin --delete feat/load-margin 2>&1 || echo "branch already gone"
git push origin --delete fix/load-margin-super-admin-gate 2>&1 || echo "branch already gone"
git push origin --delete codex/find-and-fix-a-bug 2>&1 || echo "branch already gone"
```

(Some branches may already be merged or deleted; the `|| echo` handles that gracefully.)

- [ ] **Step 8: Verify GitHub Pages rebuilds successfully**

Wait 2-5 minutes after step 6's push, then run:
```bash
gh api repos/mikecb10/drayagedirect.io/pages | python -c "import sys, json; d = json.load(sys.stdin); print(f'status: {d[\"status\"]}, url: {d[\"html_url\"]}')"
curl -sI -L --max-time 8 https://drayagedirect.io | head -3
```

Expected: `status: built` (not `errored`), HTTP 200 returned, `Last-Modified` header within the last few minutes.

If status is still `errored`, check the Actions tab in the GitHub repo UI for build failures.

- [ ] **Step 9: Commit (no app-repo file changes; this is external infra)**

This task makes no changes inside the app working directory. No git commit needed in the app repo. Verify cleanliness:
```bash
git status --short
```
Expected: clean.

---

## Task 2: Schema migration — subscription state + tenant_secrets

**Files:**
- Create: `supabase/migrations/112_phase_1_prod_deployment.sql`
- Test (manual): apply to local dev DB; verify columns + table exist

**Who executes:** Agent. Migration is applied to dev DB locally; prod application happens in Task 7.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/112_phase_1_prod_deployment.sql`:

```sql
-- 112_phase_1_prod_deployment.sql
--
-- Phase 1 schema additions:
-- 1. Subscription state columns on `tenants` (gating + future Stripe integration)
-- 2. `tenant_secrets` table with pgcrypto-based encryption (foundation for
--    Phase 5 QuickBooks Online OAuth + Phase 6 terminal credentials)
--
-- Phase 1 doesn't actually USE these columns/tables — Stripe wiring is Phase 3,
-- QBO is Phase 5, terminals are Phase 6. The schema additions land now to
-- avoid a later migration disrupting active production traffic.

BEGIN;

-- ── 1. Subscription state on tenants ──────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trialing'
    CHECK (subscription_status IN ('trialing','active','past_due','canceled','suspended')),
  ADD COLUMN IF NOT EXISTS plan_id TEXT NOT NULL DEFAULT 'free'
    CHECK (plan_id IN ('free','starter','pro','enterprise')),
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN tenants.subscription_status IS
  'Lifecycle state: trialing|active|past_due|canceled|suspended. Set manually for pilots; Stripe webhook (Phase 3) takes over.';
COMMENT ON COLUMN tenants.plan_id IS
  'Which package this tenant is on: free|starter|pro|enterprise. Used for feature gating.';

-- ── 2. tenant_secrets table for encrypted credentials ────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenant_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  secret_kind TEXT NOT NULL,
  secret_label TEXT,
  encrypted_value BYTEA NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, secret_kind, secret_label)
);

CREATE INDEX IF NOT EXISTS idx_tenant_secrets_tenant
  ON tenant_secrets(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_secrets_kind
  ON tenant_secrets(tenant_id, secret_kind);

COMMENT ON TABLE tenant_secrets IS
  'Per-tenant encrypted secrets (QBO OAuth tokens, terminal credentials). encrypted_value uses pgp_sym_encrypt with the TENANT_SECRETS_ENCRYPTION_KEY env var.';

-- RLS: only users in the tenant (or super-admin) can see their tenant's secrets
ALTER TABLE tenant_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_secrets_tenant_isolation ON tenant_secrets
  FOR ALL
  USING (
    tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid
    OR (current_setting('request.jwt.claims', true)::json ->> 'role') = 'super_admin'
  );

COMMENT ON POLICY tenant_secrets_tenant_isolation ON tenant_secrets IS
  'Tenant-scoped RLS: rows visible only to users whose JWT tenant_id matches, plus super_admin role for cross-tenant ops.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION trigger_set_tenant_secrets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_tenant_secrets_updated_at ON tenant_secrets;
CREATE TRIGGER set_tenant_secrets_updated_at
  BEFORE UPDATE ON tenant_secrets
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_tenant_secrets_updated_at();

NOTIFY pgrst, 'reload schema';

COMMIT;
```

After writing, run `tail -c 100 supabase/migrations/112_phase_1_prod_deployment.sql` to verify clean EOF.

- [ ] **Step 2: Apply the migration to the local dev Supabase**

The user runs this in their dev Supabase SQL editor (paste the file contents and click Run), OR via Supabase CLI if configured:

```bash
# If Supabase CLI is configured:
supabase db push

# If not, paste the SQL into the dashboard SQL editor for the dev project
```

Expected: migration applies without errors.

- [ ] **Step 3: Verify columns and table exist in dev DB**

Run in the Supabase SQL editor (dev project):

```sql
-- Verify subscription columns
SELECT column_name, data_type, column_default
  FROM information_schema.columns
  WHERE table_name = 'tenants' AND column_name LIKE '%subscription%' OR column_name = 'plan_id' OR column_name = 'trial_ends_at'
  ORDER BY column_name;

-- Verify tenant_secrets table
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tenant_secrets' ORDER BY ordinal_position;

-- Verify pgcrypto extension
SELECT extname FROM pg_extension WHERE extname = 'pgcrypto';

-- Test encryption roundtrip
SELECT pgp_sym_decrypt(pgp_sym_encrypt('test secret', 'demo-key'), 'demo-key') AS decrypted;
```

Expected:
- 5 subscription-related columns on tenants (including default values)
- 8 columns on tenant_secrets
- pgcrypto extension exists
- decrypted = `'test secret'`

- [ ] **Step 4: Run the existing test suite to ensure no regression**

```bash
npm test 2>&1 | tail -5
```

Expected: 437 / 436 pass / 1 baseline failure (unchanged).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/112_phase_1_prod_deployment.sql
git commit -m "$(cat <<'EOF'
feat(schema): subscription columns on tenants + tenant_secrets table (Phase 1 task 2)

Adds the schema foundation Phase 1 needs:

1. Subscription columns on tenants (subscription_status, plan_id,
   trial_ends_at, subscription_started_at, subscription_expires_at).
   Phase 1 doesn't wire these to Stripe yet — Phase 3 will. Until
   then, tenants get manual values (defaults: trialing/free).

2. tenant_secrets table with pgcrypto-based encryption. Foundation
   for Phase 5 (QuickBooks Online OAuth tokens) + Phase 6 (terminal
   credentials per tenant). RLS-protected by tenant_id.

3. pgcrypto extension enabled. Encryption helpers (lib/secrets/
   tenant-secrets.js) come in Task 4.

No code changes consume these yet; the schema is reserved for the
phases that will use it. Applying the migration now (rather than
later, alongside Stripe/QBO/terminal work) keeps a single
production-disruption window.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Health check endpoint + secrets helper

**Files:**
- Create: `pages/api/health.js`
- Create: `lib/secrets/tenant-secrets.js`
- Test: existing test suite remains green; new manual test for `/api/health`

**Who executes:** Agent.

- [ ] **Step 1: Create the secrets helper module**

Create `lib/secrets/tenant-secrets.js`:

```js
// Helper functions for tenant-secrets storage. Wraps pgcrypto's
// pgp_sym_encrypt / pgp_sym_decrypt with the TENANT_SECRETS_ENCRYPTION_KEY
// env var. Used by Phase 5 (QBO OAuth) and Phase 6 (terminal credentials).
//
// Schema: see supabase/migrations/112_phase_1_prod_deployment.sql

/**
 * Get the encryption key from env. Throws if missing — callers
 * should never silently use an empty key.
 *
 * @returns {string} The encryption key
 */
function getEncryptionKey() {
  const key = process.env.TENANT_SECRETS_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      'TENANT_SECRETS_ENCRYPTION_KEY is not set or is too short (require ≥32 chars).'
    );
  }
  return key;
}

/**
 * Insert or update a tenant secret. Encrypts via pgcrypto.
 *
 * @param {SupabaseClient} svc - Service-role client
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.secretKind - e.g., 'qbo_oauth', 'terminal_apmt'
 * @param {string} args.secretLabel - Human-friendly label (nullable)
 * @param {string} args.value - Plaintext secret to encrypt and store
 * @param {object} [args.metadata] - Non-secret context (account_id, expiration, etc.)
 * @returns {Promise<{id: string}>} The row's UUID
 */
export async function upsertTenantSecret(svc, { tenantId, secretKind, secretLabel = null, value, metadata = {} }) {
  const key = getEncryptionKey();

  // Use a stored-procedure / SQL expression to encrypt server-side
  // (so the plaintext never round-trips through PostgREST as a column value).
  const { data, error } = await svc.rpc('upsert_tenant_secret_encrypted', {
    p_tenant_id: tenantId,
    p_secret_kind: secretKind,
    p_secret_label: secretLabel,
    p_value: value,
    p_key: key,
    p_metadata: metadata,
  });

  if (error) throw new Error(`Tenant secret upsert failed: ${error.message}`);
  return data;
}

/**
 * Read and decrypt a tenant secret.
 *
 * @param {SupabaseClient} svc - Service-role client
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.secretKind
 * @param {string} [args.secretLabel] - Optional; if omitted, returns the first matching kind
 * @returns {Promise<{value: string, metadata: object}|null>} Decrypted value + metadata, or null
 */
export async function getTenantSecret(svc, { tenantId, secretKind, secretLabel = null }) {
  const key = getEncryptionKey();

  const { data, error } = await svc.rpc('get_tenant_secret_decrypted', {
    p_tenant_id: tenantId,
    p_secret_kind: secretKind,
    p_secret_label: secretLabel,
    p_key: key,
  });

  if (error) throw new Error(`Tenant secret fetch failed: ${error.message}`);
  return data || null;
}

/**
 * Delete a tenant secret.
 *
 * @param {SupabaseClient} svc - Service-role client
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.secretKind
 * @param {string} [args.secretLabel]
 */
export async function deleteTenantSecret(svc, { tenantId, secretKind, secretLabel = null }) {
  let query = svc.from('tenant_secrets')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('secret_kind', secretKind);
  if (secretLabel !== null) {
    query = query.eq('secret_label', secretLabel);
  }
  const { error } = await query;
  if (error) throw new Error(`Tenant secret delete failed: ${error.message}`);
}
```

**Note:** the upsert/get functions use Supabase RPCs (`upsert_tenant_secret_encrypted`, `get_tenant_secret_decrypted`) rather than column-level encryption from the client. This keeps the plaintext secret server-side only. The RPCs are NOT created in Phase 1 — Phase 5 (QBO) and Phase 6 (terminals) will create them when they need them. Phase 1 just lays the JS API contract.

After writing, run `tail -c 100 lib/secrets/tenant-secrets.js` to verify clean EOF.

- [ ] **Step 2: Create the health check endpoint**

Create `pages/api/health.js`:

```js
// Health check endpoint for Vercel routing decisions + post-deploy smoke tests.
// GET /api/health → 200 if everything's fine, 503 if any dependency is degraded.
//
// Returns:
//   {
//     status: 'ok' | 'degraded',
//     version: <git sha short>,
//     timestamp: <iso8601>,
//     checks: { database: 'ok'|'error', auth: 'ok'|'error' }
//   }

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const checks = { database: 'unknown', auth: 'unknown' };
  let overallOk = true;

  // Database check: trivial select against tenants
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      checks.database = 'error';
      checks.auth = 'error';
      overallOk = false;
    } else {
      const svc = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false }
      });

      const { error: dbErr } = await svc.from('tenants').select('id').limit(1);
      if (dbErr) {
        checks.database = 'error';
        overallOk = false;
      } else {
        checks.database = 'ok';
      }

      // Auth check: verify the service role key actually authenticates
      // by reading from a table that requires it (information_schema works
      // only with service-role privileges in Supabase).
      const { error: authErr } = await svc.rpc('version');
      checks.auth = authErr ? 'error' : 'ok';
      if (authErr) overallOk = false;
    }
  } catch (e) {
    checks.database = 'error';
    checks.auth = 'error';
    overallOk = false;
  }

  const response = {
    status: overallOk ? 'ok' : 'degraded',
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
    timestamp: new Date().toISOString(),
    checks,
  };

  return res.status(overallOk ? 200 : 503).json(response);
}
```

After writing, run `tail -c 100 pages/api/health.js` to verify clean EOF.

- [ ] **Step 3: Test health endpoint locally**

Start dev server (if not already running) and curl the endpoint:

```bash
# In one terminal: npm run dev (if not running)
# In another:
curl -s http://localhost:3003/api/health | python -m json.tool
```

Expected output (status varies if local Supabase config has issues):
```json
{
    "status": "ok",
    "version": "local",
    "timestamp": "2026-04-28T...",
    "checks": {
        "database": "ok",
        "auth": "ok"
    }
}
```

If `database: "error"` or `auth: "error"`, check `.env.local` is properly populated.

- [ ] **Step 4: Run test suite to verify no regression**

```bash
npm test 2>&1 | tail -5
```
Expected: 437 / 436 pass / 1 baseline failure (unchanged).

- [ ] **Step 5: Commit**

```bash
git add pages/api/health.js lib/secrets/tenant-secrets.js
git commit -m "$(cat <<'EOF'
feat(api): health check endpoint + tenant_secrets JS helper (Phase 1 task 3)

- pages/api/health.js — GET endpoint returning {status, version, timestamp,
  checks: {database, auth}}. 200 OK or 503 degraded. Used by post-deploy
  smoke test workflow + Vercel routing.

- lib/secrets/tenant-secrets.js — JS API contract for upsert/get/delete
  of pgcrypto-encrypted tenant secrets. Phase 1 ships the contract;
  the RPCs (upsert_tenant_secret_encrypted, get_tenant_secret_decrypted)
  are created in Phase 5+6 when they're needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Sentry integration + post-deploy smoke workflow

**Files:**
- Create: `sentry.client.config.js`
- Create: `sentry.server.config.js`
- Create: `.github/workflows/post-deploy-smoke.yml`
- Modify: `next.config.mjs` — wrap with `withSentryConfig()`
- Modify: `package.json` — add `@sentry/nextjs` to dependencies
- Modify: `.env.example` — add Sentry env vars + TENANT_SECRETS_ENCRYPTION_KEY

**Who executes:** Agent.

- [ ] **Step 1: Install @sentry/nextjs**

Run:
```bash
npm install @sentry/nextjs --save
```

Expected: Adds `@sentry/nextjs` to `dependencies` in `package.json` and `package-lock.json`. May add ~30 transitive packages.

- [ ] **Step 2: Create Sentry client config**

Create `sentry.client.config.js`:

```js
// Sentry browser-side init. Auto-loaded by @sentry/nextjs for client bundles.
// Configured for low-volume early-stage SaaS — adjust sampleRates as traffic grows.

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
    tracesSampleRate: 0.1,           // 10% of transactions for performance
    replaysSessionSampleRate: 0.0,   // 0% normal sessions (no session replay yet)
    replaysOnErrorSampleRate: 1.0,   // 100% sessions where an error fires (debug help)
    integrations: [],
    beforeSend(event) {
      // Suppress events from non-prod/preview environments
      const env = process.env.NEXT_PUBLIC_VERCEL_ENV;
      if (env !== 'production' && env !== 'preview') return null;
      return event;
    },
  });
}
```

After writing, verify clean EOF: `tail -c 50 sentry.client.config.js`.

- [ ] **Step 3: Create Sentry server config**

Create `sentry.server.config.js`:

```js
// Sentry server-side init. Auto-loaded by @sentry/nextjs for API routes
// + getServerSideProps + edge functions.

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    environment: process.env.VERCEL_ENV || 'development',
    tracesSampleRate: 0.1,
    integrations: [],
    beforeSend(event) {
      const env = process.env.VERCEL_ENV;
      if (env !== 'production' && env !== 'preview') return null;
      return event;
    },
  });
}
```

Verify clean EOF.

- [ ] **Step 4: Wrap next.config.mjs with withSentryConfig**

Edit `next.config.mjs`. Replace the entire contents with:

```js
import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
};

const sentryWebpackPluginOptions = {
  // Sentry source map upload only runs in production builds.
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
};

export default withSentryConfig(nextConfig, sentryWebpackPluginOptions);
```

- [ ] **Step 5: Create the post-deploy smoke workflow**

Create `.github/workflows/post-deploy-smoke.yml`:

```yaml
# Post-deploy smoke test — runs after Vercel finishes a production deploy.
# Triggered via `repository_dispatch` event sent from a Vercel webhook.
#
# Vercel webhook setup (one-time, in Vercel project settings → Git → Deploy Hooks):
#   POST URL: https://api.github.com/repos/mikecb10/drayagedirect-app/dispatches
#   Headers:
#     Authorization: Bearer ghp_<PERSONAL_ACCESS_TOKEN>
#     Accept: application/vnd.github.v3+json
#   Body:
#     {"event_type": "vercel-deployment-success"}
#
# Or simpler: schedule cron + check Vercel API for new deployments.
# For Phase 1, we use a manual workflow_dispatch trigger and let Vercel's
# own deployment notification email be the primary "deploy succeeded" signal.

name: Post-deploy smoke

on:
  repository_dispatch:
    types: [vercel-deployment-success]
  workflow_dispatch:
    inputs:
      url:
        description: 'Base URL to smoke-test (e.g., https://app.drayagedirect.io)'
        required: true
        default: 'https://app.drayagedirect.io'

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - name: Determine target URL
        id: url
        run: |
          # Prefer manual input; fall back to production URL
          if [ -n "${{ github.event.inputs.url }}" ]; then
            echo "target=${{ github.event.inputs.url }}" >> $GITHUB_OUTPUT
          else
            echo "target=https://app.drayagedirect.io" >> $GITHUB_OUTPUT
          fi

      - name: Health check returns 200 + status:ok
        run: |
          set -e
          BODY=$(curl -fsS --max-time 10 "${{ steps.url.outputs.target }}/api/health")
          echo "$BODY"
          STATUS=$(echo "$BODY" | jq -r '.status')
          if [ "$STATUS" != "ok" ]; then
            echo "Health endpoint returned status=$STATUS, expected 'ok'"
            exit 1
          fi

      - name: Login page loads (HTTP 200)
        run: |
          set -e
          STATUS=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "${{ steps.url.outputs.target }}/login")
          if [ "$STATUS" != "200" ]; then
            echo "Login page returned HTTP $STATUS, expected 200"
            exit 1
          fi

      - name: Static asset reachable
        run: |
          set -e
          # The Next.js build produces /_next/static/* assets. Pick the favicon
          # (always present) as a stable canary.
          STATUS=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "${{ steps.url.outputs.target }}/favicon.ico")
          if [ "$STATUS" != "200" ]; then
            echo "Favicon returned HTTP $STATUS, expected 200"
            exit 1
          fi
```

Verify clean EOF.

- [ ] **Step 6: Add new env vars to .env.example**

Edit `.env.example` — append the following lines at the end of the file:

```
# Sentry error tracking (Phase 1 production deployment)
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=

# Encryption key for tenant_secrets (pgcrypto). Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# CRITICAL: back up to a secure password manager. If lost, all tenant
# secrets become unrecoverable.
TENANT_SECRETS_ENCRYPTION_KEY=
```

- [ ] **Step 7: Verify build still works**

```bash
npm run build 2>&1 | tail -20
```

Expected: Build completes successfully. Sentry-related warnings about `SENTRY_DSN` not being set are OK (they're guarded; init no-ops when DSN is absent).

- [ ] **Step 8: Run test suite**

```bash
npm test 2>&1 | tail -5
```
Expected: 437 / 436 pass / 1 baseline failure (unchanged).

- [ ] **Step 9: Commit**

```bash
git add sentry.client.config.js sentry.server.config.js .github/workflows/post-deploy-smoke.yml next.config.mjs package.json package-lock.json .env.example
git commit -m "$(cat <<'EOF'
feat(observability): Sentry integration + post-deploy smoke workflow (Phase 1 task 4)

Sets up the production observability layer:

- @sentry/nextjs added; sentry.{client,server}.config.js with init
  that's gated on env (only sends from production/preview, not
  development; suppresses below-threshold sample rates).

- next.config.mjs wrapped with withSentryConfig so source maps
  upload automatically on production builds.

- .github/workflows/post-deploy-smoke.yml runs after each production
  deploy: hits /api/health expecting {status:ok}, hits /login expecting
  HTTP 200, hits /favicon.ico expecting HTTP 200. Triggers via
  repository_dispatch (Vercel webhook) or manual workflow_dispatch.

- .env.example documents the 5 new Sentry env vars + TENANT_SECRETS_ENCRYPTION_KEY.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Reference data seed script

**Files:**
- Create: `scripts/seed-prod-reference.sql`

**Who executes:** Agent prepares; user runs against prod + staging Supabase in Task 7.

- [ ] **Step 1: Identify reference data tables that need seeding**

Run from working directory:

```bash
ls supabase/migrations/ | head -30
```

Look for migration files that INSERT into reference tables (system roles, permissions, default load types, document type registries, etc.). The seed script consolidates the reference data so it can be applied to a fresh DB without re-running every migration.

For a real Phase 1 seed, the agent inspects:
- `lib/constants/document-types.js` — doc type list
- `lib/constants/document-sections.js` — section registries
- Any migration that has `INSERT INTO roles`, `INSERT INTO permissions`, `INSERT INTO load_types`, etc.

Build a single idempotent SQL file that recreates all of it.

- [ ] **Step 2: Create the seed script**

Create `scripts/seed-prod-reference.sql`:

```sql
-- Phase 1 Reference Data Seed
--
-- Idempotent (uses INSERT ... ON CONFLICT DO NOTHING). Safe to re-run.
-- Applies to a fresh production or staging Supabase project AFTER all
-- numbered migrations in supabase/migrations/ have been run.
--
-- Contents:
--   - System roles
--   - Permission sets
--   - Default load types
--   - Document type registry rows
--   - Default rule-engine triggers (if any baseline exist)
--
-- Bootstrap super-admin user + first tenant (DrayageDirect Internal)
-- are NOT in this script — those are created via the Vercel /admin
-- dashboard after the first deploy succeeds (see docs/deploy-runbook.md).

BEGIN;

-- ── System roles ─────────────────────────────────────────────────
-- (Adjust this list to match your existing roles table schema. The agent
-- inspects existing migrations to determine the canonical set.)
-- Example:
INSERT INTO roles (name, description) VALUES
  ('super_admin', 'Platform super-administrator (DrayageDirect employees)'),
  ('owner',       'Tenant owner — full control of one tenant'),
  ('admin',       'Tenant administrator — manage users, settings, billing'),
  ('dispatcher',  'Dispatcher — manage loads, drivers, schedules'),
  ('accountant',  'Accountant — AR/AP, invoicing, reports'),
  ('driver',      'Driver — limited mobile-app access')
ON CONFLICT (name) DO NOTHING;

-- ── Permission sets ──────────────────────────────────────────────
-- Reference each permission your app uses.
-- (Inspect your existing permissions table to fill this in.)

-- ── Default load types ───────────────────────────────────────────
INSERT INTO load_types (name, description) VALUES
  ('drayage',           'Standard drayage move (port → consignee or shipper → port)'),
  ('chassis_reposition','Chassis reposition only (no container)'),
  ('street_turn',       'Direct interchange — drop empty at consignee, pickup loaded'),
  ('local',             'Local move within metropolitan area')
ON CONFLICT (name) DO NOTHING;

-- ── Document type registry ───────────────────────────────────────
-- (The Document Designer registries — populated from lib/constants/document-types.js
-- if your app stores them in DB. If they're TS-only constants, skip this block.)

COMMIT;

-- After applying, verify the seed worked:
--   SELECT count(*) FROM roles;       -- expect ≥6
--   SELECT count(*) FROM load_types;  -- expect ≥4
```

**IMPORTANT:** the agent must inspect the actual reference tables in the dev database and adjust the `INSERT` statements above to match the real schema. The list above is a TEMPLATE — the agent confirms with the dev DB before committing the actual seed.

To inspect:
```sql
-- In Supabase SQL editor (dev project):
SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name IN ('roles','permissions','load_types','document_types','rule_triggers')
  ORDER BY table_name;
```

- [ ] **Step 3: Test the seed against a clean local DB (optional)**

If the user has Supabase local development set up, test against a fresh local instance. Otherwise this step is verified during Task 7 (when the seed runs against the real prod + staging projects).

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-prod-reference.sql
git commit -m "$(cat <<'EOF'
feat(seed): reference data seed for Phase 1 production deployment (Phase 1 task 5)

Idempotent SQL seeding system roles, default load types, and document
type registry rows. Safe to re-run. Applied to fresh prod + staging
Supabase projects in Task 7 (after migrations apply).

Bootstrap super-admin + DrayageDirect Internal tenant are created via
the admin dashboard after first deploy (see docs/deploy-runbook.md
in Task 6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Deploy runbook + rollback documentation

**Files:**
- Create: `docs/deploy-runbook.md`
- Create: `docs/rollback.md`
- Modify: `README.md` — replace Next.js boilerplate

**Who executes:** Agent.

- [ ] **Step 1: Create docs/deploy-runbook.md**

Create `docs/deploy-runbook.md`:

```markdown
# DrayageDirect Production Deploy Runbook

This runbook covers the **first-time** production deploy of the app.
After Phase 1 lands, ongoing deploys are automatic (push to `main` →
Vercel deploys → smoke workflow validates).

---

## Pre-flight checklist

- [ ] You have Vercel account access (logged in as project owner)
- [ ] You have Supabase account access (logged in as project owner)
- [ ] You have GitHub access for `mikecb10/drayagedirect-app`
- [ ] You have Squarespace access for `drayagedirect.io` DNS
- [ ] You have a secure password manager ready (for the encryption key backup)

---

## Step 1: Create Supabase production project

1. Go to https://supabase.com/dashboard
2. Click "New Project"
3. Settings:
   - **Name:** `drayagedirect-prod`
   - **Database Password:** generate a strong password; save to password manager
   - **Region:** choose closest to your customer base (e.g., us-east-1)
   - **Plan:** **Pro** ($25/mo). Free tier pauses after 1 week of inactivity — catastrophic for production.
4. Click "Create new project". Wait 2-3 minutes for provisioning.
5. After provisioning, go to Settings → API. Copy these values:
   - `NEXT_PUBLIC_SUPABASE_URL` = the project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the `anon`/public key
   - `SUPABASE_SERVICE_ROLE_KEY` = the `service_role` key (KEEP SECRET)

## Step 2: Apply migrations to prod

In the Supabase SQL Editor for the new prod project:

1. Open `supabase/migrations/` in your local checkout. Apply each numbered file in order:
   - For each `.sql` file from `001_*.sql` through `112_phase_1_prod_deployment.sql`:
     a. Copy the file contents
     b. Paste into Supabase SQL editor
     c. Click "Run". Verify "Success" message.
   - If any migration fails, STOP. Don't try to skip ahead. Fix the migration locally, then continue.

(Tip: if you have Supabase CLI configured, `supabase db push --linked` is faster.)

## Step 3: Apply seed reference data to prod

In the Supabase SQL Editor for the prod project:

1. Open `scripts/seed-prod-reference.sql`
2. Paste contents into the SQL editor
3. Click "Run". Verify counts:
   ```sql
   SELECT count(*) FROM roles;            -- expect ≥6
   SELECT count(*) FROM load_types;       -- expect ≥4
   ```

## Step 4: Repeat steps 1-3 for staging

1. Create another Supabase project: `drayagedirect-staging`, **Free** tier (acceptable here).
2. Apply the same migrations + seed.
3. Capture its URL + anon + service_role keys.

## Step 5: Generate the secrets encryption key

Run on your local machine:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy the output. Save to your password manager labeled "DrayageDirect TENANT_SECRETS_ENCRYPTION_KEY (PROD)".

**CRITICAL:** if you lose this key, all encrypted tenant secrets (QBO OAuth tokens, terminal credentials) become unrecoverable. Phase 1 has no encrypted data yet; Phase 5+6 will. Back this up now.

## Step 6: Create Vercel project

1. Go to https://vercel.com/dashboard
2. Click "Add New" → "Project"
3. Import `mikecb10/drayagedirect-app` from GitHub
4. Configuration:
   - **Project Name:** `drayagedirect-app`
   - **Framework Preset:** Next.js (auto-detected)
   - **Root Directory:** `.`
   - **Build Command:** `npm run build` (default)
   - **Install Command:** `npm install` (default)
   - **Skip env vars for now** — we'll add them in step 7

5. Click "Deploy". The first build will likely fail because env vars aren't set yet — that's expected.

## Step 7: Upgrade Vercel to Pro

1. Vercel dashboard → Settings → Billing
2. Upgrade plan: **Pro** ($20/mo)
3. Required because of the cron jobs in `vercel.json` (free tier doesn't run them)

## Step 8: Set environment variables

In the Vercel project → Settings → Environment Variables, add the following:

For each variable, create TWO entries: one for **Production** environment (using prod Supabase values) and one for **Preview** environment (using staging Supabase values). Development environment doesn't matter for deploy — those values come from your local `.env.local`.

| Variable | Production value | Preview value |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | (from Firebase prod project) | (same; or staging Firebase) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | ... | ... |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | ... | ... |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | ... | ... |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | ... | ... |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | ... | ... |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | (your prod Maps key) | (same) |
| `GOOGLE_MAPS_SERVER_API_KEY` | (your server-side Maps key) | (same) |
| `NEXT_PUBLIC_SUPABASE_URL` | prod Supabase URL | staging Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod anon key | staging anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | prod service_role key | staging service_role key |
| `ADMIN_JWT_SECRET` | randomly generated (`node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"`) | different random value |
| `DRIVER_JWT_SECRET` | randomly generated | different random value |
| `SENDGRID_API_KEY` | (your SendGrid key) | same |
| `SENDGRID_FROM_EMAIL` | `noreply@drayagedirect.io` | `noreply@staging.drayagedirect.io` (or same) |
| `SENDGRID_PLATFORM_SENDER_DOMAIN` | `drayagedirect.io` | (same) |
| `SENDGRID_PLATFORM_DOMAIN_ID` | (from SendGrid dashboard) | (same) |
| `SENDGRID_WEBHOOK_VERIFICATION_KEY` | (from SendGrid dashboard) | (same) |
| `TENANT_SECRETS_ENCRYPTION_KEY` | (from step 5) | DIFFERENT random key for staging |

## Step 9: Install Sentry integration

1. Vercel project → Settings → Integrations
2. Browse → Sentry → Install
3. Authorize and connect to a Sentry project (`drayagedirect-app`)
4. The integration auto-injects `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` into your project's env vars.

## Step 10: Trigger a redeploy

Vercel project → Deployments → most recent deployment → ⋮ → Redeploy. With env vars now populated, the build should succeed.

Verify the deploy URL (something like `drayagedirect-app-xyz.vercel.app`) loads the app.

## Step 11: Configure custom domain

1. Vercel project → Settings → Domains
2. Add `app.drayagedirect.io`
3. Vercel will give you a CNAME target (e.g., `cname.vercel-dns.com`)

## Step 12: Add CNAME at Squarespace

1. Squarespace dashboard → Domains → drayagedirect.io → DNS Settings
2. Add CNAME record:
   - **Host:** `app`
   - **Type:** `CNAME`
   - **Data:** the Vercel CNAME target from step 11
3. Save. Propagation typically completes in 10-30 minutes.

## Step 13: Verify SSL provisioning

After DNS resolves correctly, Vercel auto-provisions SSL via Let's Encrypt:

1. Wait until `nslookup app.drayagedirect.io` returns Vercel's IPs
2. In Vercel → Settings → Domains, the SSL status should change from "Pending" to "Valid" within 5-15 minutes after DNS resolves

## Step 14: Bootstrap super-admin user

1. Visit `https://app.drayagedirect.io/api/health` — verify `{status: ok}`
2. In Supabase prod → Authentication → Users → "Add User":
   - Email: your real email
   - Password: strong password; save to password manager
   - Confirmed: Yes
3. After the user is created, in SQL Editor:
   ```sql
   -- Replace <user_id> with the auth.users.id of the just-created user
   UPDATE users SET role = 'super_admin' WHERE auth_user_id = '<user_id>';
   -- (Adjust to match your existing users table schema)
   ```

## Step 15: Create DrayageDirect Internal tenant

1. Visit `https://app.drayagedirect.io/login`, log in as the super-admin
2. Navigate to Admin → Tenants → New Tenant
3. Create:
   - Name: `DrayageDirect Internal`
   - Subscription Status: `active`
   - Plan: `enterprise`

This is your internal demo tenant.

## Step 16: Final smoke check

```bash
curl -s https://app.drayagedirect.io/api/health | jq -e '.status == "ok"'
curl -s -I https://app.drayagedirect.io/login | grep -E "HTTP/.+ 200"
```

Both should return success. Manually trigger a navigation through the app (login → dashboard → a load page) to confirm UI works.

---

## You are now live.

Next steps: Phase 2 (CI/CD hardening + drayagedirect.io marketing site polish + observability tuning).

```

Verify clean EOF.

- [ ] **Step 2: Create docs/rollback.md**

Create `docs/rollback.md`:

```markdown
# DrayageDirect Production Rollback Runbook

Three rollback paths for production incidents. Use the lightest path that resolves your incident.

---

## Path A: Deploy rollback (30 seconds)

**When to use:** A bad deploy is causing 500s, broken UI, missing assets, or other front-of-house issues. Database is fine.

1. Vercel dashboard → Deployments
2. Find the previous successful deployment
3. ⋮ menu → "Promote to Production"
4. Confirm
5. Within ~30 seconds, traffic moves to the previous deployment

**What this does NOT fix:**
- Database state changes (a new migration ran, or production data was corrupted)
- Vercel project misconfiguration (wrong env var)

**Verification after rollback:**
```bash
curl -s https://app.drayagedirect.io/api/health | jq '.version'
# Should now show the older deployment's git SHA
```

---

## Path B: Schema rollback (manual, ~5-15 minutes)

**When to use:** A migration broke prod. Symptoms: queries fail, columns/tables in unexpected state.

For Phase 1, the `112_phase_1_prod_deployment.sql` migration is reversible:

```sql
BEGIN;

-- Drop tenant_secrets table (contents lost — ensure you've copied any
-- encrypted data elsewhere if it's not Phase 1 - in Phase 1 the table is empty)
DROP TABLE IF EXISTS tenant_secrets CASCADE;

-- Drop the trigger function
DROP FUNCTION IF EXISTS trigger_set_tenant_secrets_updated_at();

-- Remove subscription columns from tenants
ALTER TABLE tenants
  DROP COLUMN IF EXISTS subscription_status,
  DROP COLUMN IF EXISTS plan_id,
  DROP COLUMN IF EXISTS trial_ends_at,
  DROP COLUMN IF EXISTS subscription_started_at,
  DROP COLUMN IF EXISTS subscription_expires_at;

-- pgcrypto extension can stay; harmless when unused

NOTIFY pgrst, 'reload schema';

COMMIT;
```

For other migrations, each migration file should document its own rollback strategy in a top-of-file comment. If not, work backwards from `\d <table_name>` output.

---

## Path C: Data corruption recovery (Supabase PITR, ~30-60 minutes)

**When to use:** Production data was corrupted by an app bug, migration mistake, or human error. You need to restore the database to a point in time before the incident.

Supabase Pro includes Point-in-Time Recovery (PITR) up to 7 days back.

1. Supabase dashboard → Project: `drayagedirect-prod`
2. Database → Backups → Point in Time Recovery
3. Select target time (just before the incident)
4. Click "Restore". A new project will be created with the restored data; you cannot directly overwrite the live project.
5. Once the restored project is ready:
   - Update Vercel env vars to point at the restored project's URL/keys
   - OR migrate data from the restored project back to the live project (preferred to preserve recent legitimate writes)

**Caveat:** PITR creates a NEW project. The "switch live to PITR" step requires careful coordination — talk to Supabase support if it's a real prod incident.

---

## When in doubt

1. **Stop traffic if possible:** Vercel project → Domains → temporarily redirect `app.drayagedirect.io` to a static "Maintenance" page
2. **Take a fresh database snapshot:** Supabase → Database → Backups → "Take Snapshot"
3. **Then troubleshoot calmly.** Better to be down for 30 min while you fix correctly than to make the situation worse with a hasty rollback.
4. **Notify customers** if downtime exceeds 5 min (Phase 1 has no automated status page; manual email/Slack is fine).
```

Verify clean EOF.

- [ ] **Step 3: Update README.md**

Replace the contents of `README.md` with project-specific content:

```markdown
# DrayageDirect

Multi-tenant SaaS for drayage and intermodal trucking carriers. Manage loads, drivers, accounting, and customer relationships from a single dispatcher console.

## Live environments

- **Production:** https://app.drayagedirect.io (deploys from `main`)
- **Marketing site:** https://drayagedirect.io ([separate repo](https://github.com/mikecb10/drayagedirect.io))

## Local development

Prerequisites: Node 20+, npm, a Supabase project (the dev one).

1. Clone this repo and `npm install`
2. Copy `.env.example` to `.env.local` and populate with your dev Supabase + Firebase + Google Maps + SendGrid keys
3. `npm run dev` — local server on http://localhost:3000

## Tests

```bash
npm test
```

Tests use Node's native test runner (`node:test`). All tests live in `tests/*.test.mjs`.

## Deployment

See `docs/deploy-runbook.md` for the first-time production deployment procedure.

After the initial setup, ongoing deploys are automatic:
- Push to `main` → Vercel deploys → post-deploy smoke test runs
- Open a PR → Vercel preview deployment for testing

## Rollback

See `docs/rollback.md` for three rollback paths (deploy, schema, data corruption).

## Architecture

This is a Next.js 15 app on Pages Router, deployed to Vercel, backed by Supabase (Postgres + Auth + Storage). PDF generation uses `@react-pdf/renderer`. Email via SendGrid.

For deep architecture details, browse `docs/superpowers/` for design specs and roadmap plans.

## Roadmap

The app is being launched in 7 phases:

1. **Phase 1: Production deployment foundation** — IN PROGRESS
2. Phase 2: CI/CD hardening + monitoring
3. Phase 3: Stripe subscription billing
4. Phase 4: Self-serve carrier onboarding
5. Phase 5: QuickBooks Online integration
6. Phase 6: Terminal credential management + scrapers
7. Phase 7: Compliance + TOS + privacy
```

Verify clean EOF.

- [ ] **Step 4: Commit**

```bash
git add docs/deploy-runbook.md docs/rollback.md README.md
git commit -m "$(cat <<'EOF'
docs: deploy runbook + rollback procedures + project README (Phase 1 task 6)

- docs/deploy-runbook.md: 16-step procedure for first-time production
  deployment, including Supabase project creation, migrations, seed,
  Vercel project setup, env vars, Sentry integration, custom domain,
  super-admin bootstrap, and DrayageDirect Internal tenant creation.

- docs/rollback.md: three rollback paths
    A: deploy rollback (Vercel UI, ~30s) for code regressions
    B: schema rollback (manual SQL) for bad migrations
    C: data corruption recovery (Supabase PITR) for data integrity
       incidents. Phase 1 migration includes its specific rollback SQL.

- README.md: replaced Next.js boilerplate with project-specific
  documentation including live environment URLs, local dev setup,
  test invocation, and the 7-phase launch roadmap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Push commits to new app repo + execute deploy runbook

**Files:** none (external work)

**Who executes:** User (with agent guidance). This task is the dashboard-driven part of Phase 1.

- [ ] **Step 1: Push all Phase 1 commits to the new app repo**

Run from `C:\Users\bento\app-drayagedirect`:

```bash
git push origin main
```

Expected: pushes the spec + plan + Tasks 1-6's commits to `mikecb10/drayagedirect-app`.

- [ ] **Step 2: Execute Steps 1-5 of the deploy runbook**

Open `docs/deploy-runbook.md`. Execute Steps 1-5:
- Create Supabase prod project
- Apply migrations (manually paste each `supabase/migrations/*.sql` file in order)
- Apply seed (`scripts/seed-prod-reference.sql`)
- Create Supabase staging project, apply migrations + seed
- Generate the encryption key, save to password manager

(Agent cannot do this — user has dashboard access.)

- [ ] **Step 3: Capture the prod + staging Supabase values**

Save these values securely (password manager) — you'll need them in Task 8:

| Variable | prod value | staging value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | (prod project URL) | (staging URL) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (prod anon key) | (staging anon key) |
| `SUPABASE_SERVICE_ROLE_KEY` | (prod service_role) | (staging service_role) |
| `TENANT_SECRETS_ENCRYPTION_KEY` | (prod encryption key) | DIFFERENT key for staging |

- [ ] **Step 4: Verify schema on both projects**

In each Supabase SQL editor (run separately for prod and staging):

```sql
-- Confirm Phase 1 migration applied
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'tenants' AND column_name LIKE '%subscription%';
-- Expect: subscription_status, subscription_started_at, subscription_expires_at

SELECT count(*) FROM tenant_secrets;
-- Expect: 0 (table exists, empty)

SELECT extname FROM pg_extension WHERE extname = 'pgcrypto';
-- Expect: 1 row
```

If anything is wrong, rerun the failing migration step.

---

## Task 8: Vercel project creation + env vars + Sentry + first deploy

**Files:** none

**Who executes:** User (with agent guidance).

Execute Steps 6-13 of `docs/deploy-runbook.md`:

- [ ] **Step 1: Create Vercel project** (runbook step 6)
- [ ] **Step 2: Upgrade to Pro** (runbook step 7)
- [ ] **Step 3: Add all env vars for Production + Preview environments** (runbook step 8). Cross-check with the Task 7 captured values.
- [ ] **Step 4: Install Sentry integration** (runbook step 9)
- [ ] **Step 5: Trigger redeploy** (runbook step 10)
- [ ] **Step 6: Add custom domain `app.drayagedirect.io`** (runbook step 11) — capture the CNAME target Vercel provides

After this task: a Vercel deployment exists. The custom domain is added to Vercel but DNS doesn't resolve yet (Task 9).

---

## Task 9: DNS at Squarespace

**Files:** none

**Who executes:** User.

Execute Steps 12-13 of `docs/deploy-runbook.md`:

- [ ] **Step 1: Add CNAME at Squarespace** (runbook step 12)
- [ ] **Step 2: Wait for DNS propagation**

Test via `nslookup app.drayagedirect.io` — should return Vercel's IP within 10-30 minutes. If still resolves to nothing after 60 minutes, double-check the CNAME entry.

- [ ] **Step 3: Verify SSL provisioning** (runbook step 13)

Once DNS resolves, Vercel auto-provisions SSL within 5-15 minutes. Status changes from "Pending" to "Valid" in Vercel → Settings → Domains.

After this task: `https://app.drayagedirect.io` is live with valid SSL.

---

## Task 10: Bootstrap + end-to-end verification + ledger

**Files:**
- Modify: `memory/followups.md` (user-memory storage)

**Who executes:** User + agent.

- [ ] **Step 1: Bootstrap super-admin user** (runbook step 14)

User creates the super-admin in Supabase auth + updates the `users` table.

- [ ] **Step 2: Create DrayageDirect Internal tenant** (runbook step 15)

User logs in to the live app and creates the internal tenant via the admin UI.

- [ ] **Step 3: Final smoke check** (runbook step 16)

Run:
```bash
curl -s https://app.drayagedirect.io/api/health | jq -e '.status == "ok"'
curl -s -I https://app.drayagedirect.io/login | grep -E "HTTP/.+ 200"
```

Both should return success.

- [ ] **Step 4: Trigger a manual error and verify Sentry**

In the live app, navigate to `https://app.drayagedirect.io/this-page-does-not-exist`. Then check the Sentry dashboard — within 2 minutes the 404 should appear (or a corresponding warning).

To trigger a real error: temporarily edit a page locally to throw, deploy via PR, hit the page on the preview URL, verify Sentry captures it. Revert.

- [ ] **Step 5: Manually trigger the post-deploy smoke workflow**

GitHub repo → Actions → "Post-deploy smoke" → Run workflow → enter URL `https://app.drayagedirect.io` → Run.

Expected: workflow completes green.

- [ ] **Step 6: Verify Vercel cron jobs are running**

Vercel project → Crons. Wait until each of the 3 crons (`/api/cron/evaluate-triggers`, `/api/cron/stale-ping-pause`, `/api/cron/breadcrumb-retention`) shows a "Last run: <timestamp>" within their schedule window.

- [ ] **Step 7: Update memory/followups.md ledger**

The agent edits `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` to:

- Add a new resolved entry for "Phase 1: Production deployment foundation" with the commit hash range
- File new follow-up FUs:
  - "Phase 2: CI/CD hardening + observability"
  - "Phase 3: Stripe subscription billing"
  - "Phase 4: Self-serve carrier onboarding + drayagedirect.io ↔ app SSO"
  - "Phase 5: QuickBooks Online integration"
  - "Phase 6: Terminal credential management + scrapers"
  - "Phase 7: Compliance + TOS + privacy"

(The followups.md file is in user-memory storage, not the git repo — no commit needed.)

- [ ] **Step 8: Tag the release in git**

```bash
git tag -a v1.0.0-phase1 -m "Phase 1: Production deployment foundation shipped"
git push origin v1.0.0-phase1
```

This is the first official tagged release of the live app.

---

## Self-Review Checklist (planner — run before handoff)

- [x] **Spec coverage:** Each section of the spec has corresponding tasks:
  - Spec §3.1 repo split → Task 1
  - Spec §3.2 Vercel topology → Task 8
  - Spec §3.3 Supabase topology → Tasks 2, 5, 7
  - Spec §3.4 DNS → Task 9
  - Spec §3.5 Sentry → Task 4 + Task 8 step 4
  - Spec §3.6 health check + smoke → Tasks 3, 4
  - Spec §3.7 documentation → Task 6
  - Spec §5.1 verification plan → Task 10
- [x] **Placeholder scan:** None. The seed script (Task 5) explicitly marks template content needing user inspection of the dev DB before commit; this is correct behavior, not a placeholder.
- [x] **Type consistency:** `makeMockSvc` not used here (different plan). `getEncryptionKey()` used consistently within Task 3. `tenant_secrets` table column names match between Task 2 (migration) and Task 3 (helper).
- [x] **DRY:** Tasks 7-10 reference `docs/deploy-runbook.md` rather than duplicating its content. The runbook IS the canonical source for the dashboard steps.
- [x] **YAGNI:** No premature wiring of Stripe/QBO/terminals into Phase 1 code. Schema additions only.
- [x] **TDD where applicable:** Task 2 (migration) and Task 3 (code) have test gates. Tasks 7-9 are infrastructure, not unit-testable; verified via Task 10's end-to-end check.
- [x] **Frequent commits:** Each of Tasks 1-6 ends with a commit; no monolithic single-commit task.
