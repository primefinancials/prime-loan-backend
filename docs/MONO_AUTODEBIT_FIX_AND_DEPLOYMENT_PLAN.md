# Prime Finance — Mono Auto‑Debit Stabilisation, Bug Fixes & Backend Re‑hosting Plan

**Status:** APPROVED 2026‑09‑02 — phases 1–5 in implementation. Phases 6–7 (AWS) pending credentials.
**Author:** Claude (pair‑engineering session)
**Date:** 2026‑09‑02
**Scope:** `prime-loan-backend`, `prime-loan-web-v2` (user app), `prime-finance-admin` (admin app)
**Environments:** current system is LIVE. Front‑ends stay on Vercel. Back‑end moves to a new AWS Elastic Beanstalk environment.

---

## CONFIRMED DECISIONS & WORKFLOW (2026‑09‑02)

1. **Branch flow (all 3 repos):** `dev` (`dev-v2` for backend) holds code only; **all testing happens on `staging`/`staging-v2`**, which is deployed to a **live staging server**, not a sandbox. I push feature work → `dev`/`dev-v2` → open PR → **user merges to `staging`/`staging-v2`** → user updates AWS/Vercel/provider config → I test against the live staging URLs via the cloud browser → iterate. **Production** (`main` / prod EB env) only after staging is signed off; **user personally merges to `main`**.
   - ⚠️ **Repo reality:** in every repo `dev`/`dev-v2` is *strictly behind* `staging`/`staging-v2` (backend −20, web‑v2 −4, admin −86 commits) and fast‑forwardable. All recent live work landed on `staging*`. Therefore each feature branch is **cut from `staging*`** (the real current code); `dev*` is fast‑forwarded up to `staging*` before my commits are added, so the PR `dev* → staging*` shows only my changes.
2. **AWS is set up early** (before functional testing) so tests run on a real staging server. Two backend servers exist: staging + live. I set up the **staging** EB env first; the **production** EB env after staging sign‑off.
3. **Region:** `eu-west-1` (Ireland — lower latency to Nigeria). **Instance:** my recommendation = **`t4g.small`** (single‑instance, no load balancer). **Redis:** my recommendation = **co‑located on the instance** (free); managed (Upstash) as fallback.
4. **Penalty logic: DO NOT CHANGE.** Client wants the current over‑penalisation (base = principal + interest + fees). Plan items **L4 and L5 are dropped.** Only L1 (clamp `outstanding ≥ 0` on *overpayment*), L2, L3 (reversal/settlement idempotency) remain in Phase 3 — these are repayment‑integrity, not penalty‑amount, changes.
5. **Credentials:** I request them in‑chat, concise, when needed (Mono dashboard, AWS, Vercel, provider webhook updates, current‑server env export). User provides and performs all Vercel / provider‑dashboard / merge actions.
6. **Mono discovery (Part 8): DONE** — verified against `docs.mono.co` (Sept 2026). See rewritten Part 8.

---

## IMPLEMENTATION STATUS (updated 2026‑09‑02)

Branches: `prime-loan-backend@feat/mono-autodebit-stabilisation` (off `staging-v2`), `prime-loan-web-v2@feat/mono-autodebit-stabilisation` (off `staging`), `prime-finance-admin@feat/mono-autodebit-stabilisation` (off `staging`). Not pushed yet.

| Phase | Status | Notes |
|---|---|---|
| 0 — safety net + Mono discovery | ✅ done | `mono.status.ts` mapper (+sanity checks pass), `webhook-event.model.ts` dedupe, `validateEnv.ts`, Part 8 rewritten from live docs |
| 1 — webhook correctness | ✅ done | `mono-webhook.controller.ts` rewritten: dedicated secret + constant‑time, dedupe, full verified event catalogue, `approved`≠debitable, debit match on `reference_number`, mandate cancel/reject syncs back |
| 2 — linking state sync | ✅ done | initiate persists `initiating` row + idempotent + cancels stale; `linkBankMono` verifies with Mono & returns real status (201/202/400); new `/mono/status` + `/mono/cancel`; `getLinkedMethods` exposes pending; `unlinkMethod` cancels on Mono; `monoReconcileCron` (15 min) + orphan sweep; shared `evaluateBankLink` |
| 3 — repayment integrity | ✅ done | `penaltiesCron` external‑debit block (~230 lines) → `AutoDebitService.chargeLoan`; async debits never optimistically reconciled; card stays sync; `reconcile()` unified + idempotent via `reconciledAt`. **Penalty logic untouched (client decision).** L1 clamp already present in current code. |
| 4 — admin auto‑debit feature | ✅ done | `AdminAutoDebitController` + `/backoffice` routes; `singleLoanHistory` returns `paymentMethods`; `test-integrations/auto-debit` delegates + requires `loanId`; admin UI Payment‑Methods panel; `AutomationIntegration` sends `loanId` + gains `voiceCall/sms` |
| 5 — balance feature | ✅ done | `MonoProvider.getMandateBalance`; `GET /backoffice/loans/:id/bank-balance` + legacy alias, 60 s cache; admin "Check Bank Balance" wired to real NGN + timestamp |
| 6 — AWS staging env | ✅ **LIVE** (2026‑09‑03) | New account `018088156887`, `eu-west-1`. EB app `prime-finance-backend` / env `pf-staging`, SingleInstance `t4g.small`, Node.js 22 / AL2023, co‑located `redis6`, Elastic IP **`3.254.126.43`**. `http://prime-finance-backend-staging.eu-west-1.elasticbeanstalk.com` — `/health` + `/health/ready` green, webhook auth verified. Env copied from old `prime-finance-staging-env` (`NODE_ENV=dev`, shared Atlas `_staging` collections, `REDIS_URL=redis://127.0.0.1:6379`). ~US$14–15/mo. |
| 7 — AWS prod + push to dev | ⏳ after staging sign‑off | Prod = a second EB env (`pf-prod`, `NODE_ENV=production`) in the same new account; user merges `main` themselves. |

### 6.8 — As‑built cutover checklist (staging)

**Done by Claude:** new account CLI profiles (`old-account` read‑only us‑east‑1, `new-account` admin eu‑west‑1); EB app + `pf-staging` env; env vars loaded; `dev-v2` pushed with the EB config commits; `/health` + webhook‑auth verified from the instance; outbound to Mono + Flutterwave confirmed egressing via `3.254.126.43`.

**User to do before functional testing:**
1. **Stop / scale‑to‑zero the OLD `prime-finance-staging-env`** (us‑east‑1). Both servers otherwise run the same crons against the same `_staging` MongoDB (they use different Redis, so BullMQ can't coordinate). Money paths are idempotent + date‑guarded, but stop the old one to be clean.
2. **Vercel (staging projects, web‑v2 + admin):** set `BACKEND_URL` → `http://prime-finance-backend-staging.eu-west-1.elasticbeanstalk.com`. Leave `NEXT_PUBLIC_API_URL` unset (socket.io over `ws://` from an HTTPS page is mixed‑content‑blocked — already the case on the current HTTP‑only staging, so no regression; HTTPS is a prod task).
3. **Mono dashboard → Webhooks:** point the *staging* webhook URL at `http://prime-finance-backend-staging.eu-west-1.elasticbeanstalk.com/webhooks/mono`, keep the **same secret** as today's staging webhook (24‑char `sec_…`).
4. **Flutterwave dashboard:** add `3.254.126.43` to the IP allow‑list. (Not needed for Mono testing.)
5. **Give Claude:** the exact staging front‑end URLs (user app + admin) so CORS and browser testing line up.

**HTTPS:** the new env is HTTP‑only (like the current one). Mono/Flutterwave both accept HTTP webhooks, and the Vercel proxy reaches it server‑side, so functional testing is unblocked. For prod we'll add TLS — options: a Hostinger subdomain (`api.primefinance.live`) A‑record → the EIP + nginx/certbot on the instance, or an ALB + ACM cert (+~US$16/mo), or Cloudflare in front (free, needs the zone on Cloudflare).

Builds: backend `npm run build` ✅ · admin `vite build` ✅ · web‑v2 `next build` ✅ (pre‑existing unrelated TS errors in both front‑ends left as‑is).

Deferred hardening (folded where cheap; rest is low‑risk cleanup): M12 partial unique index (skipped — risk on live data with existing dupes), M18 raw‑body webhook (not needed — Mono uses header secret, no HMAC), D3 CORS→env / D12 `/health/ready` / Procfile / `.platform` hooks (Phase 6 deploy prep).

---

## ROUND 2 — CLIENT + USER REPORTED ISSUES (2026‑09‑04)

Five further issues raised after the staging cutover. All fixed on `dev-v2` /
`dev`; backend deployed to `pf-staging`.

| # | Report | Root cause | Fix | Repos |
|---|---|---|---|---|
| 1 | Loan interest shows **"200%"** in the user wizard, **"0.1"** in admin | Wizard rendered `amount × rate` (a naira figure) with a `%` suffix. Backend stored `loan.percentage` as the *fraction* `value/100` (0.1), and the admin renders `` `${loan.percentage}%` `` | Wizard: show configured rate as **Interest Rate** (`10%`) + computed **Interest Charge** in ₦ as a separate line. Backend: store the human percentage (`10`). Display‑only field — no effect on repayment maths (interest amount is computed separately at disbursement). `scripts/fix-loan-percentage.ts` backfills old rows. | backend, web‑v2 |
| 2 | Influencer payout — no threshold; anyone with > ₦0 gets paid | `processPayouts` queried `pendingPayout > 0`; `requestWithdrawal` had no floor | Admin‑configurable `settings.influencer.minPayoutAmount` (default **₦100**, was 1000). Batch pays everyone `≥ threshold` and reports how many are still below; withdrawal blocked until balance reaches the threshold. Admin label → "Payout Threshold". | backend, admin |
| 3 | Account statement — **wrong opening / closing balance** | `generateAccountStatement` filtered `transfers_v2` by `{ userId }` (drops money *received* via intra‑bank transfer — those rows carry the **sender's** userId) and printed an unreliable per‑row `walletBalance` snapshot with **no opening/closing at all** | Rewritten: anchor to the user's current wallet balance (live VFD, synced fallback) → pull every COMPLETED movement for their **account number** from the period start → roll back through post‑period rows for the closing balance → walk in‑period rows backwards for a per‑line running balance and the opening balance. Adds a credits/debits/net summary. | backend |
| 4 | Escrow chat "not working"; WebSocket front‑end ↔ back‑end not connecting; images show the **URL, not the image** | (a) sockets pointed at the Vercel `/api` proxy, which doesn't forward WS upgrades; from an `https://` page `ws://` is mixed‑content‑blocked. (b) **No multer** anywhere — `POST /chat/upload` always returned "No file uploaded" (admin could never attach; the user app only worked because it uploads straight to Cloudinary). (c) REST `sendMessage` hard‑coded `attachments: []`. (d) attachments with a missing/bare `type` made the UI fall through to rendering the raw link. | Clients: strip trailing `/api`, upgrade `http→https`, `websocket`+`polling` transports, reconnection, surface `connect_error`. Backend: multer disk‑storage middleware on both `/chat/upload` routes; REST handler now reads `attachments` from the body; persist `name`/`size`; **normalise every attachment's `type` on write and read** (infer MIME from the URL extension). Frontends: resolve image/video by MIME **or** extension, render inline in admin too, `<img onError>` → link fallback. **REST fallback**: if the socket is down the user app now sends via `POST /chat/:id/message` instead of dropping the message. | backend, web‑v2, admin |
| 5 | (folded into #4) admin real‑time worker updates | Same `/api`‑proxy / transport issue as the chat socket | Same client fixes applied to `websocket-provider.tsx` + `socketService.ts` | admin |

**Still blocked on the user (unchanged from Round 1):** real WebSocket delivery
needs the backend on **HTTPS**. Until then the chat REST fallback (#4) keeps
messaging working; live typing indicators and instant delivery stay degraded.

**User action for #4 (chat attachments) to work on the new backend:** set
`CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` on
`pf-staging` (copy from the old env), and on the Vercel projects
`NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` + `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET`.

**Migration (#1): DONE 2026‑09‑04.** `scripts/fix-loan-percentage.ts` ran against
the shared cluster. `loans_staging`: 20 rows corrected (0.1→10 ×19, 0.2→20 ×1).
`loans` (LIVE): all 482 rows were already `10` — nothing to change.

---

## ROUND 3 — GITHUB SYNC + PRODUCTION CUTOVER (2026‑09‑04)

### Trigger

`api.primefinance.live` (old AWS account `570064588032`, us‑east‑1,
`prime-finance-prod-env`) has been **down since ~2026‑07‑30** — the last
successful deploy — and its autoscaling group has been unable to launch
instances since 2026‑08‑17 (account vCPU quota exhausted). HTTP requests time
out. Claude has **read‑only** access to that account, so it can't be fixed
there. The fix is to stand production up on the **new** account alongside
`pf-staging`.

### Git — all three backend branches are now in sync

| Branch | Role | State |
|---|---|---|
| `dev-v2` | dev | head of the work |
| `staging-v2` | staging (→ `pf-staging`) | merged from `dev-v2` |
| `v2` | **production** (→ `pf-prod`) | merged from `staging-v2` |

`v2` was ~5 weeks / 35 commits behind and only carried the old production code
plus one hotfix (`1ac41da` "handle mono direct debit hangs and mandate
cancellation"). The merge brought the **entire Mono‑stabilisation rewrite +
Rounds 1–2** into production. Two conflicts (`mono.provider.ts`,
`auto-debit.controller.ts`) resolved in favour of the rewrite — `1ac41da` is
fully subsumed by it. `tsc` + `npm run build` clean on all three. There is **no
CI/CD** in any repo (no CodePipeline, no GitHub Actions), so a git push deploys
nothing on its own.

### New: `WORKERS_AUTOSTART` env flag

`startBackgroundWorkers()` unconditionally calls `WorkerControlService.startAll()`
on boot — it ignores each worker's stored `WorkerStatus`. Bringing a
long‑down environment back would immediately resume penalty accrual, Mono
reconcile/debits and **defaulter phone calls**. New flag: `WORKERS_AUTOSTART=false`
registers every worker (so the admin panel can start them) but skips `startAll()`.
`pf-prod` boots with this set.

### `pf-prod` — as built

| | |
|---|---|
| Account / region | new account `018088156887` / `eu-west-1` |
| EB app / env | `prime-finance-backend` / `pf-prod` (id `e-r2vcpbecxq`) |
| Instance | SingleInstance `t4g.small`, Node.js 22 / AL2023, co‑located `redis6` |
| **Elastic IP** | **`108.133.54.91`** (auto‑created by `eb create`, tagged `pf-prod`) |
| CNAME | `prime-finance-backend-prod.eu-west-1.elasticbeanstalk.com` |
| Code | `v2` @ `04b7643` (`app-04b7…`) |
| Database | **same** Atlas `cluster0.9ohvk` / db `prime-loan` / **unsuffixed** collections (real prod data) — `NODE_ENV=production` |
| Env vars | cloned from `pf-staging` (45), with prod overrides: `NODE_ENV`/`ENV`/`ENVIRONMENT=production`, `FRONTEND_URL=https://primefinance.live`, `CORS_ORIGINS=` primefinance.live domains, `MONO_SKIP_NAME_MATCH` removed, `WORKERS_AUTOSTART=false` |
| Mono | same live key + webhook secret (`sec_9MYA…`) as staging |
| Health | `/health` + `/health/ready` green — mongo up, redis up; boot log shows `⏸️ WORKERS_AUTOSTART=false - workers registered but NOT started` |
| Serving live traffic? | **No** — DNS not cut over yet |

### Cutover checklist — USER

1. **DNS (Vercel → primefinance.live → DNS Records):** replace the `api` record
   (currently `CNAME → prime-finance-prod-env…us-east-1…`, dead) with
   **`A  api  108.133.54.91`**.
2. **Provider allow‑lists:** add `108.133.54.91` to **VFD** and **Flutterwave**
   (VFD returns "Access Denied" / 202‑empty from an un‑whitelisted IP).
3. **Mono dashboard → Webhooks:** production URL →
   `https://api.primefinance.live/webhooks/mono` (or the EB CNAME over http until
   HTTPS is on). Secret unchanged (`sec_9MYA…`).
4. **`pf-prod` env vars still missing:** `CLOUDINARY_CLOUD_NAME` /
   `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` (chat/KYC uploads),
   `EMAIL_PASSWORD` (SMTP 535 today), `TERMII_API_KEY` (SMS 401 today).
5. **Turn workers on** once the overdue‑loan backlog has been reviewed: set
   `WORKERS_AUTOSTART=true` and restart, or start them individually from the
   admin worker panel. Until then: no penalties, no auto‑debits, no defaulter
   calls, no profit realization, no savings maturity processing.
6. **HTTPS** (same as staging): once `api.primefinance.live` A‑records to
   `108.133.54.91`, Claude runs `eb setenv API_DOMAIN=api.primefinance.live
   LETSENCRYPT_EMAIL=info@primefinance.live` on `pf-prod` and the instance
   issues the cert.
7. **Frontends:** merge `dev → main` on `prime-loan-web-v2` and
   `prime-finance-admin` for the Round‑2 UI fixes, and set the production
   Vercel env (`NEXT_PUBLIC_SOCKET_URL` / `VITE_WS_URL` → the HTTPS backend).
8. **Old account:** once `api.primefinance.live` points at the new IP and is
   verified, terminate `prime-finance-prod-env` and `prime-finance-staging-env`
   in us‑east‑1 to stop paying for them.

### Cutover checklist — CLAUDE (after the user does 1–2)

- Verify `https`/`http` reachability of `api.primefinance.live` → `pf-prod`.
- `eb setenv API_DOMAIN=…` for the cert (step 6).
- Smoke‑test an authenticated read (loans list, wallet, mandate status) against
  prod once the user provides a prod session.
- Flip `WORKERS_AUTOSTART` when the user gives the go‑ahead.

---

## 0. How the Mono flow works today (so the bugs make sense)

### 0.1 Components

| Layer | File(s) | Responsibility |
|---|---|---|
| Mono API wrapper | `prime-loan-backend/src/shared/providers/mono.provider.ts` | `initiateMandate`, `getMandateStatus`, `chargeAccount`, `getAccountInfo` |
| Link endpoints | `prime-loan-backend/src/modules/loans/auto-debit.controller.ts` | `checkAccount`, `initiateBankMono`, `linkBankMono`, `getLinkedMethods`, `unlinkMethod` |
| Storage | `prime-loan-backend/src/modules/loans/auto-debit.model.ts` (`AutoDebit`), `auto-debit-log.model.ts` (`AutoDebitLog`) | linked method + debit attempt records |
| Webhook | `prime-loan-backend/src/modules/webhooks/mono-webhook.controller.ts` (route `POST /webhooks/mono`) | mandate activation + debit reconciliation |
| Repayment cron | `prime-loan-backend/src/workers/loans/penaltiesCron.ts` | overdue → wallet deduct → card → **bank (Mono)** → fintech wallet |
| Admin trigger | `prime-loan-backend/src/modules/admin/test-integrations.controller.ts` (`testAutoDebit`, `getMonoBalance`) | manual debit + balance check |
| User UI | `prime-loan-web-v2/components/loans/wizard-steps/bank-link-step.tsx`, `prime-loan-web-v2/app/loans/mono-callback/page.tsx` | initiate Mono, poll popup, "Skip & Verify" |
| Admin UI | `prime-finance-admin/src/modals/loanDetails.tsx`, `prime-finance-admin/src/pages/AutomationIntegration.tsx` | "Automatic Bank Debit Mandate" button, "Check Bank Balance" button |

### 0.2 Happy‑path sequence (Mono provider = `bankLinkingProvider: 'mono'`)

1. User reaches the **Bank Account** step of the loan wizard.
2. `initMonoWidget()` calls `POST /api/loans/link-bank/check-account` then `POST /api/loans/link-bank/mono/initiate`.
3. Backend `initiateBankMono` calls `MonoProvider.initiateMandate()` → Mono `POST /v2/payments/initiate` → returns `{ paymentId, monoUrl }`. **Nothing is persisted.**
4. Front‑end opens `monoUrl` in a popup. User makes the ₦50 verification transfer on Mono's page.
5. Mono redirects the popup to `…/loans/mono-callback?…`. That page `postMessage({type:'MONO_SUCCESS', code})` to the opener and tries `window.close()`.
6. Front‑end receives the message (or its 1‑second `checkPopup` interval detects the popup returned to our origin) and calls `POST /api/loans/link-bank/mono` with `code`.
7. Backend `linkBankMono` deletes existing bank methods, inserts a new `AutoDebit` row with `status:'pending'`, returns it.
8. Later, Mono sends `POST /webhooks/mono` `events.mandates.approved` → webhook flips the row to `status:'active'`.
9. When a loan is overdue, `penaltiesCron` finds the row, calls `MonoProvider.chargeAccount()` and (optimistically) reconciles the loan; `events.mandates.debit.successful` / `.failed` webhooks confirm or reverse.

Every one of steps 3–9 has at least one defect. They are catalogued below.

---

## PART 1 — THE THREE REPORTED ISSUES

---

## ISSUE A — "User cannot cancel the initiation; re‑initiating causes errors and bugs"

### A.1 Root cause

**A.1.1 — Initiation creates state on Mono but nothing on our side.**
`AutoDebitController.initiateBankMono` (`auto-debit.controller.ts:262‑317`) calls Mono and returns `{ paymentId, monoUrl }` **without writing any record**. There is:
- no `AutoDebit` row in `status:'initiating'`,
- no idempotency middleware on `POST /api/loans/link-bank/mono/initiate` (`userRoutes.ts:326‑330` — unlike every sibling route),
- no rate‑limit / dedupe.

Each time the user taps **"Continue to Mono"** (`bank-link-step.tsx:690`), a brand‑new Mono payment/mandate is created. If they abandon it, Mono keeps that mandate in `pending`/`initiated` forever. There is no "cancel" button and no server object to cancel.

**A.1.2 — Re‑initiation is blocked by `checkAccount` when a stale `pending` row exists.**
Once step 7 has run at least once, an `AutoDebit` row exists with `provider:'mono'`, `status:'pending'`. On the next attempt `AutoDebitController.checkAccount` (`auto-debit.controller.ts:44‑64`) does:

```ts
if (mandate.status === 'pending') {
  if (mandate.provider === 'mono' && mandate.token) {
    const mandateStatus = await monoProvider.getMandateStatus(mandate.token);
    const statusStr = mandateStatus?.data?.status || mandateStatus?.status;
    const isActive = mandateStatus?.data?.active || mandateStatus?.active;
    if (isActive === false || statusStr === 'cancelled' || statusStr === 'initiated') {
      continue;                       // allow replace
    } else {
      return res.status(400)…'Account has already been linked for the debit mandate.'
    }
  }
  return res.status(400)…'Account has already been linked for the debit mandate.'
}
```

Mono's mandate status vocabulary is `pending | approved | active | rejected | revoked` (exact set to be confirmed against the dashboard — see §8). It does **not** return `'initiated'`. So a mandate that is genuinely stuck at `pending` on Mono falls into the `else` branch → **the user is permanently blocked from re‑linking and has no way to cancel.** Exactly the reported symptom.

**A.1.3 — The saved `accountNumber` is inconsistent, so `checkAccount` sometimes can't even find the row.**
- Popup‑close path: `bank-link-step.tsx:310‑315` calls `linkBankMono({ code, accountNumber: "mono-mandate", … })` — literal string.
- `postMessage` / "Skip & Verify" path: `bank-link-step.tsx:194‑199` calls `linkBankMono({ code, accountNumber: monoAccountNumber || "mono-mandate", … })` — the real number.

`checkAccount` searches `AutoDebit.find({ accountNumber, type: 'bank' })` by the **real** number. If the row was saved as `"mono-mandate"`, the lookup misses it and a **duplicate** mandate is created; if it was saved with the real number, the user is blocked (A.1.2). Non‑determinism = "sometimes it works, sometimes it errors."

**A.1.4 — `mono-callback` can persist a garbage token.**
`mono-callback/page.tsx:16`: `const code = urlParams.get('code') || urlParams.get('reference') || 'success';`
If Mono redirects without `code`/`reference`, the literal string `'success'` is sent to `linkBankMono` and stored as the mandate `token`. Every later `getMandateStatus('success')` / `chargeAccount('success')` 404s forever. The row looks "pending" and can never be cleared by the user.

**A.1.5 — No user‑facing disconnect.**
`DELETE /api/loans/linked-methods/:id` exists (`auto-debit.controller.ts:468‑484`) but:
- it is **not** exposed in the SDK (`client-sdk.ts` has no `unlinkMethod`),
- there is **no UI** anywhere in `prime-loan-web-v2` (grep: zero matches for unlink/disconnect/revoke on payment methods),
- it only sets `status:'revoked'` locally and **never calls Mono** to cancel the mandate.

### A.2 Fix design

**A.2.1 — Introduce an explicit mandate lifecycle and persist on initiate.**

Extend `AutoDebit` status enum:
`'initiating' | 'pending' | 'active' | 'revoked' | 'expired' | 'failed' | 'cancelled'`

`initiateBankMono` becomes:
1. `checkAccount`‑style validation (fold `checkAccount` logic into a shared helper so init and check agree).
2. **Cancel/replace any previous non‑active Mono mandate for this user** (call Mono cancel — see A.2.3 — best‑effort, then delete/replace locally).
3. Create `AutoDebit { userId, type:'bank', provider:'mono', status:'initiating', token: paymentId, accountNumber: <real>, accountName, reference }` **before** returning.
4. Return `{ paymentId, monoUrl, autoDebitId }`.

Add `idempotencyMiddleware()` to `POST /api/loans/link-bank/mono/initiate` keyed on `userId + accountNumber` so double‑taps reuse the same mandate for a short window.

**A.2.2 — `linkBankMono` verifies with Mono and updates the existing row (no blind insert).**
- Look up the `initiating` row by `token === code` (or `autoDebitId`).
- Call `MonoProvider.getMandateStatus(code)`.
- Map Mono status → local status via a **single shared mapper** (§B.2.1).
- Update the row in place; return the **real** status. Never hard‑code `'pending'`.
- If no `initiating` row exists (mobile deep‑link case), create one but still verify first.

**A.2.3 — Add `MonoProvider.cancelMandate()` + wire it into every cancel path.**

```ts
// mono.provider.ts
async cancelMandate(mandateId: string): Promise<any> {
  // Endpoint to confirm in Mono dashboard/docs — likely PATCH /v3/payments/mandates/{id}/cancel
  const res = await axios.patch(`${this.baseUrl}/v3/payments/mandates/${mandateId}/cancel`,
    { reason: 'User disconnected auto-debit on Prime Finance' },
    { headers: this.getHeaders(), httpsAgent: this.httpsAgent });
  return res.data;
}
```

Call sites:
- New `POST /api/loans/link-bank/mono/cancel` (body `{ autoDebitId? }`) — used by a **"Cancel setup"** button shown in `bank-link-step.tsx` whenever `status === 'initiating' | 'pending'`. Best‑effort Mono cancel + local `status:'cancelled'` + allow immediate re‑initiate.
- `unlinkMethod` (`DELETE /api/loans/linked-methods/:id`) — if `provider === 'mono'`, call `cancelMandate(token)` first, then set `status:'revoked'`. Make Mono failure non‑fatal but logged + surfaced.
- Admin equivalent (Issue C).

**A.2.4 — Front‑end: real cancel + safe token handling.**
- `bank-link-step.tsx`: the `checkPopup` interval and the `handleSkipAndVerify` button both get a **"Cancel setup"** action that calls the new cancel endpoint, clears `monoPaymentId`, resets `isLinking`, and re‑enables "Continue to Mono".
- Guard against garbage codes: if `code` is falsy or `=== 'success'`, do **not** call `linkBankMono`; show "We couldn't confirm your mandate — tap Cancel and try again."
- `mono-callback/page.tsx:16`: drop the `|| 'success'` fallback; if no code, post `{type:'MONO_ERROR'}` instead.
- Add `apiClient.loans.unlinkMethod(id)` and `apiClient.loans.cancelMonoMandate(body)` to `client-sdk.ts`.

**A.2.5 — Sweeper for orphaned mandates.**
New light cron (or fold into `penaltiesCron`): any `AutoDebit` in `status:'initiating'` older than 30 min → `getMandateStatus`; if still not approved, `cancelMandate` + mark `cancelled`. Prevents Mono‑side mandate pile‑up from abandoned flows.

### A.3 Acceptance criteria
- A user who abandons the Mono popup can immediately restart, with the previous Mono mandate cancelled.
- A user with a stuck `pending` mandate sees a **Cancel** button and can re‑link.
- No path can persist a mandate token of `'success'` or `'mono-mandate'`.
- `getLinkedMethods` and the wizard agree on "is the bank linked?".

---

## ISSUE B — "Front‑end says connected when Mono says not connected" (state desync, both directions)

### B.1 Root cause

**B.1.1 — The wizard marks the bank "linked" on an unverified HTTP 200.**
Popup‑close path (`bank-link-step.tsx:316‑319`):

```ts
if (res.status === "success") {           // <-- only checks the envelope
  toast({ title: "Bank Linked", … });
  handleSuccess("bank", res.data?.id);    // sets linkedMethods.bank = true
}
```

`linkBankMono` **always** returns `status:"success"` with `data.status:"pending"` (`auto-debit.controller.ts:351‑360`). So the wizard shows "Bank Linked ✓", lets the user press **Continue**, and submits the loan — even though on Mono the mandate may never have been approved (network drop mid‑transfer, "Contact Support" error, etc.).

**B.1.2 — The other path can *never* succeed.**
"Skip & Verify" / `postMessage` path (`bank-link-step.tsx:200‑205`):

```ts
if (res.status === "success" && res.data?.status === "active") { … }
else { toast("Verification Pending") }
```

`linkBankMono` never returns `data.status:"active"` → this path **always** shows "Verification Pending" even when the mandate really is approved on Mono. Users bounce between the two buttons getting contradictory results.

**B.1.3 — Optimistic loan reconciliation on a *pending* Mono debit.**
`penaltiesCron.ts:332‑340`:

```ts
} else if (bankMethod.provider === 'mono') {
  result = await monoProvider.chargeAccount({…});
  const accepted = result?.status === 'successful' || result?.data?.status === 'successful'
                || result?.status === 'pending'   || result?.data?.status === 'pending';
  status = accepted ? 'successful' : 'failed';   // <-- 'pending' treated as 'successful'
}
…
if (status === 'successful') {
  await AutoDebitLog.create({ …, status: 'successful' });
  await LoanService.repayLoan({ …, internalOnly:true, autoDeduct:true });   // loan marked (partly) repaid NOW
}
```

Mono direct‑debit is **asynchronous**: `chargeAccount` returning `2xx` means "accepted for processing," not "money moved." We immediately reduce `loan.outstanding` and write a ledger entry. Reconciliation depends entirely on the `events.mandates.debit.successful` / `.failed` webhook arriving. If it doesn't (see B.1.4), the loan is permanently, silently mis‑stated as repaid. This is the core "our end shows approved / ready to sync, Mono end shows nothing" symptom.

**B.1.4 — The webhook is probably being rejected in production.**
`mono-webhook.controller.ts:15‑25`:

```ts
const providedSecret = req.headers['mono-webhook-secret'];
const secret = process.env.MONO_WEBHOOK_SECRET || process.env.MONO_SECRET_KEY;
if (!secret || providedSecret !== secret) return res.status(401)…;
```

- If `MONO_WEBHOOK_SECRET` is unset on the live server, it falls back to `MONO_SECRET_KEY` — which Mono will **never** send in that header → **every webhook 401s** → no `mandates.approved` (mandates never auto‑activate), no `debit.successful`/`.failed` (no reconciliation, no reversal).
- Even when set, plain `!==` string compare is fragile (whitespace / encoding). Mono's documented scheme should be re‑checked (some Mono products sign the body; DirectDebit uses the dashboard "webhook secret" header — confirm in §8).

**B.1.5 — Missing webhook event handlers.**
`handleWebhook` (`mono-webhook.controller.ts:32‑110`) handles only `mandates.ready|approved|active`, `debit.successful`, `debit.failed`. It ignores:
- `mandates.created`
- `mandates.rejected` / `mandates.failed`
- `mandates.cancelled` / `mandates.revoked` / `mandates.reinstated`

So when a mandate is rejected or cancelled **on Mono's side** (or by the bank), our `AutoDebit` row stays `pending`/`active` forever. Desync in the opposite direction.

**B.1.6 — No periodic reconciliation.**
Nothing ever re‑queries Mono for the truth on a schedule. The only status refreshes happen opportunistically inside `checkAccount` / the cron / `testAutoDebit`, each with **different, inconsistent** status interpretation logic (compare `auto-debit.controller.ts:51‑53`, `penaltiesCron.ts:210`, `test-integrations.controller.ts:211`).

**B.1.7 — `linkBankMono` write races.**
`bank-link-step.tsx` can fire `linkBankMono` up to 3 times for one linking (the `message` listener, the `checkPopup` interval, and `handleSkipAndVerify`), each with a **different idempotency key** (`client-sdk.ts:479` generates a fresh UUID per call). `linkBankMono` does `deleteMany` then `create`, so concurrent calls interleave into duplicate/rapidly‑replaced rows. The `if (!isLinking)` guard at `bank-link-step.tsx:238` reads a stale closure value.

### B.2 Fix design

**B.2.1 — One canonical Mono status mapper (single source of truth).**

New `src/shared/providers/mono.status.ts`:

```ts
export type LocalMandateStatus = 'initiating'|'pending'|'active'|'rejected'|'cancelled'|'expired'|'failed';

export function mapMonoMandateStatus(monoResponse: any): {
  local: LocalMandateStatus;
  raw: string;
  readyToDebit: boolean;
} {
  const d = monoResponse?.data ?? monoResponse ?? {};
  const raw = String(d.status ?? '').toLowerCase();
  const active = d.active === true || d.ready_to_debit === true || raw === 'active' || raw === 'approved' || raw === 'ready';
  if (active)                                   return { local:'active',    raw, readyToDebit:true };
  if (raw === 'rejected' || raw === 'declined') return { local:'rejected',  raw, readyToDebit:false };
  if (raw === 'cancelled' || raw === 'revoked') return { local:'cancelled', raw, readyToDebit:false };
  if (raw === 'expired')                        return { local:'expired',   raw, readyToDebit:false };
  if (raw === 'failed')                         return { local:'failed',    raw, readyToDebit:false };
  return { local:'pending', raw: raw || 'pending', readyToDebit:false };
}
```

Every consumer (`checkAccount`, `linkBankMono`, `initiateBankMono`, `penaltiesCron`, `testAutoDebit`, the new reconciliation cron, the new `getMonoBalance`) uses **only** this function.

**B.2.2 — `linkBankMono` returns the truth.**
After verifying with `getMandateStatus`:
- `local === 'active'` → row `active`, response `{ status:'success', data:{ status:'active', … } }`.
- `local === 'pending'` → row `pending`, response `{ status:'success', data:{ status:'pending' } }` **+ HTTP 202** so the front‑end can distinguish.
- `rejected|cancelled|failed|expired` → row set accordingly, response `{ status:'failed', message, data:{ status } }`.

**B.2.3 — Front‑end trusts only `data.status === 'active'`.**
Collapse the two paths in `bank-link-step.tsx` into one `confirmMono(code)`:
- `data.status === 'active'` → `handleSuccess('bank')`.
- `data.status === 'pending'` → keep the linking UI open, start a **bounded poll** (`GET /api/loans/linked-methods` or a new `GET /api/loans/link-bank/mono/status?code=`) every 5 s for up to ~90 s, plus the manual "I've completed the transfer — re‑check" button. Never call `handleSuccess`.
- failure statuses → show the specific reason + **Cancel & retry**.
- Idempotency: pass a **stable** idempotency key `mono-link-${code}` for all `linkBankMono` calls of one attempt; add an in‑component `linkingRef = useRef(false)` mutex.

**B.2.4 — `getLinkedMethods` exposes pending + real Mono state.**
Return `bank` even when `status:'pending'` with a `needsAction` flag and `providerStatus`, so the wizard and the account page can show "Bank setup incomplete — finish or cancel." Keep `hasBank` = `status==='active'` only, so downstream eligibility logic is unchanged.

**B.2.5 — Kill optimistic reconciliation for async providers.**

In `penaltiesCron.ts` (and `testAutoDebit`), Mono/Monnify/OPay bank+wallet debits become **two‑phase**:
1. `chargeAccount` accepted → write `AutoDebitLog { status:'pending' }`. **Do not** call `repayLoan`. Log "awaiting Mono webhook confirmation."
2. `events.mandates.debit.successful` webhook → flip log to `successful` **and** call `repayLoan` (idempotency key `webhook-mono-${reference}` — already present at `mono-webhook.controller.ts:64`).
3. `events.mandates.debit.failed` → flip log to `failed`; **no** reversal needed because we never optimistically repaid.
4. Safety net: reconciliation cron (B.2.7) re‑queries any `AutoDebitLog` stuck `pending` > 2 h via a Mono "get transaction / mandate debits" endpoint and settles it.

Card via Flutterwave stays synchronous (`result.data.status === 'successful'` is real).

**B.2.6 — Fix + harden the webhook.**
- Require `MONO_WEBHOOK_SECRET` explicitly; **remove** the `|| MONO_SECRET_KEY` fallback; if unset, log a loud startup warning.
- Constant‑time compare (`crypto.timingSafeEqual`) with length guard.
- Implement handlers for `mandates.created` (attach mandate id if we only stored a payment id), `mandates.rejected`/`failed` (→ row `rejected`, notify user), `mandates.cancelled`/`revoked` (→ row `revoked`/`cancelled`, notify user, stop future debits), `mandates.reinstated` (→ `active`).
- Idempotency: store `event.id` (or `event.data.id + event.event`) in a `webhook_events` collection; ignore duplicates. Return `200` fast; process async where possible.
- Add structured `WorkerLogService.log('mono-webhook', …)` for every event so admin can see webhook traffic.

**B.2.7 — Periodic Mono reconciliation cron (`monoReconcileCron`).**
Every 15 min:
- `AutoDebit` rows `provider:'mono'`, `status in ['initiating','pending']` and age > X → `getMandateStatus` → map → update; if `active` and there's a pending loan, allow next cron cycle to debit; if terminal, mark + notify + (for `initiating`) `cancelMandate`.
- `AutoDebitLog` rows `provider:'mono'`, `status:'pending'`, age > 2 h → query Mono debit status → settle (`successful` → `repayLoan`; `failed` → mark failed).
- Emits an admin‑visible summary to `WorkerLog`.

**B.2.8 — Cancel propagates both directions (shared with A.2.3).**
User cancel/disconnect → `MonoProvider.cancelMandate` → local `revoked/cancelled`. Mono cancel/reject webhook → local `revoked/cancelled`. Admin disconnect (Issue C) → same path.

### B.3 Acceptance criteria
- The wizard shows "Bank linked" **only** after Mono reports the mandate `active` (verified server‑side).
- A mandate approved on Mono is reflected within one webhook or ≤ 15 min via reconciliation.
- A mandate rejected/cancelled on Mono flips our row within one webhook or ≤ 15 min.
- No loan is ever marked repaid before `events.mandates.debit.successful` (or reconciliation) confirms money moved.
- Webhook 200‑rate visible in admin logs; 401s alert.

---

## ISSUE C — "Admin cannot properly carry out the debit mandate; shows 'user not connected', bugs & errors"

### C.1 Root cause

**C.1.1 — Admin has zero visibility into the mandate.**
`LoanController.singleLoanHistory` (`loan.controller.ts:370‑393`) returns `{ loan, user, history }`. It does **not** include the user's `AutoDebit` methods, their provider, their local status, or the live Mono mandate status. The admin clicks **"Automatic Bank Debit Mandate"** (`loanDetails.tsx:152‑165`) completely blind.

**C.1.2 — The admin button reuses a *test* endpoint with fragile success detection.**
`loanDetails.tsx:61` → `POST /backoffice/test-integrations/auto-debit`. In `testAutoDebit` (`test-integrations.controller.ts:206‑227`):

```ts
if (bankMethod && bankMethod.provider === 'mono' && bankMethod.status === 'pending') {
  const mandateStatus = await monoProvider.getMandateStatus(bankMethod.token);
  if (mandateStatus?.data && (mandateStatus.data.ready_to_debit || mandateStatus.data.approved
      || mandateStatus.data.status === "approved")) {
    …activate…
  } else {
    results.push({ …status:'failed', error:'Mandate is still pending on Mono' });
    bankMethod = undefined;                       // nothing else to try
  }
}
```

If the user's only method is a not‑yet‑active Mono mandate, the response is a single `failed` result → the admin UI renders a red "user not connected"‑style error. The status keys checked here (`ready_to_debit`, `approved`, `status==='approved'`) differ from those checked in `checkAccount` (`active`, `cancelled`, `initiated`) and the cron (`status==='active'`), so the three surfaces disagree about the same mandate.

**C.1.3 — Admin manual debit does not create an `AutoDebitLog`.**
`testAutoDebit`'s `processTestResult` (`test-integrations.controller.ts:229‑245`) calls `LoanService.repayLoan(…)` on "success" but **never** `AutoDebitLog.create(...)`. Consequences:
- No audit trail of admin‑triggered debits.
- When `events.mandates.debit.failed` arrives later, the webhook does `AutoDebitLog.findOne({ reference })` (`mono-webhook.controller.ts:81`), finds nothing, and **cannot reverse** the optimistic repayment. → loan shows repaid, money never left the user. This is a money‑integrity bug, admin‑triggered.

**C.1.4 — `AutomationIntegration.tsx` sends the wrong payload.**
`AutomationIntegration.tsx:462`:

```ts
mutationFn: () => automationApi.autoDebit({ userId: adUserId, amount: adAmount ? Number(adAmount) : undefined }),
```

`adLoanId` **is captured** (`:535‑538`) but **not sent**. Without `loanId`, `testAutoDebit` → `processTestResult` → `LoanService.repayLoan({ userId, loanId: undefined, … })` → `repayLoan` runs `requiredParam("loanId", …)` → **throws**. So on this screen, a *successful Mono charge* is followed by a hard failure at reconciliation. (The loan‑detail modal at `loanDetails.tsx:61` does send `loanId`, so behaviour differs by screen — confusing for the admin.)

**C.1.5 — Optimistic reconciliation on `pending` (same as B.1.3) applies here too**, via the shared `processTestResult`/`chargeAccount` treatment of `pending` as success.

**C.1.6 — Dead code / latent runtime errors in the admin automation page.**
`AutomationIntegration.tsx:420` and `:434` call `automationApi.voiceCall(...)` / `automationApi.sms(...)`, but the `automationApi` object (`:36‑70`) defines neither. These mutations are currently unrendered (no card in the JSX), so it's latent, but any future wiring throws `automationApi.voiceCall is not a function`.

**C.1.7 — No admin "cancel / disconnect mandate" capability at all.**
The user explicitly wants: *when admin (or user) cancels the auto‑debit mandate / disconnects, it must cancel on both ends.* There is no admin endpoint or button for this.

### C.2 Fix design

**C.2.1 — Promote auto‑debit to a first‑class admin feature (out of "test‑integrations").**

New controller `src/modules/loans/admin-auto-debit.controller.ts` + routes under `/backoffice/loans/:loanId/auto-debit/*`:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/backoffice/users/:userId/payment-methods` | list `AutoDebit` rows + **live** Mono/Monnify status via the shared mapper + `AutoDebitLog` history |
| `GET` | `/backoffice/loans/:loanId/auto-debit/preview` | show which method would be used, its readiness, last error, mandate max amount vs outstanding |
| `POST` | `/backoffice/loans/:loanId/auto-debit/charge` | **real** debit: writes `AutoDebitLog{status:'pending'}`, calls provider, waits for webhook; supports `amount`, `methodId` |
| `POST` | `/backoffice/loans/:loanId/auto-debit/refresh-mandate` | force `getMandateStatus` + map + persist |
| `POST` | `/backoffice/users/:userId/payment-methods/:id/cancel` | admin disconnect: `MonoProvider.cancelMandate` + local `revoked` + user notification |

`checkPermission(admin, ['manage_loans'])` on all. Full `AdminActivityLog` entries (who, when, amount, result).

**C.2.2 — Admin debit is logged & reconciled exactly like the cron.**
Reuse a shared `AutoDebitService.chargeLoan({ loanId, userId, amount, methodId, source: 'admin'|'cron'|'webhook', actorId })` used by cron, admin, and (future) user "pay now". It always:
1. resolves method → validates readiness via mapper,
2. `AutoDebitLog.create({ status:'pending', source, reference })`,
3. calls provider,
4. for sync (card): settle now; for async (Mono/Monnify/OPay): leave `pending`, webhook/reconcile settles,
5. returns a structured result the admin UI renders (state machine, not red/green guess).

**C.2.3 — Admin UI (`prime-finance-admin`).**
- `loanDetails.tsx`: replace the single opaque button with a **Payment Methods panel**:
  - list each method: type, provider, masked account, **local status badge**, **live Mono status badge**, last debit attempt + error,
  - actions: **Refresh status**, **Charge now (₦ amount)**, **Disconnect** (with confirm),
  - if no method / not active → explicit "User has no active auto‑debit mandate" empty state (not an error toast).
- `AutomationIntegration.tsx`: send `loanId` in the auto‑debit mutation; require loan selection; remove the dead `voiceCall`/`sms` refs or implement them on `automationApi`.
- New endpoints added to `prime-finance-admin/src/api/endpoints.ts`.

**C.2.4 — Consistent status vocabulary.**
All admin surfaces use `mapMonoMandateStatus` (B.2.1). Kill the ad‑hoc checks in `test-integrations.controller.ts:211`.

### C.3 Acceptance criteria
- Admin can see, for any loan, exactly which methods exist and their real Mono state.
- "Charge now" produces an `AutoDebitLog`, is reconciled by webhook, and never marks the loan repaid before confirmation.
- Admin "Disconnect" cancels the mandate on Mono and locally.
- No admin screen throws on a normal debit; "no method" is a clean empty state.

---

## PART 2 — NEW FEATURE: Admin views the user's bank balance via Mono (for an existing loan)

### 2.1 Current state
`GET /backoffice/test-integrations/mono-balance/:userId` (`test-integrations.controller.ts:676‑706`) requires `user.mono_account.id`. **Nothing in the v2 codebase ever sets `user.mono_account`** — it is explicitly deprecated (`user.model.ts:123`, `auto-debit.model.ts:3`). So the endpoint **always** returns *"User does not have a Mono Connect account ID … Balance check requires full Mono Connect linking."* The admin "Check Bank Balance" button (`loanDetails.tsx:142‑149`) is dead on arrival. Also `loanDetails.tsx:139` divides the returned balance by 100 assuming kobo — needs to match whatever the chosen endpoint returns.

### 2.2 Design

Mono **Direct Debit** mandates expose the linked account and (for eligible contracts) a **balance enquiry** on the mandate itself — we do **not** need separate Mono Connect linking. Two implementation options; pick based on what your Mono contract enables (confirm in §8):

**Option 1 (preferred) — Mandate balance enquiry.**
`MonoProvider.getMandateBalance(mandateId)` → `GET /v3/payments/mandates/{id}/balance` (endpoint name to confirm). Returns the linked account's available/current balance.

**Option 2 — Account object via mandate.**
`getMandateStatus(mandateId)` already returns linked `account` details; if it includes an `id`, call `getAccountInfo(accountId)` (`GET /v2/accounts/{id}`) — the wrapper already exists (`mono.provider.ts:98‑109`). Persist that `accountId` on the `AutoDebit` row (new field `providerAccountId`) when the `mandates.approved` webhook fires.

**Backend changes:**
- New field `AutoDebit.providerAccountId?: string`; populate from `mandates.created`/`approved` webhook payload and from `getMandateStatus`.
- New route `GET /backoffice/loans/:loanId/bank-balance` (and/or `/backoffice/users/:userId/bank-balance`):
  1. find the user's active `provider:'mono'` `AutoDebit`,
  2. if none active → `404 { message: 'No active Mono mandate for this user' }`,
  3. Option 1: `getMandateBalance(token)`; Option 2: `getAccountInfo(providerAccountId)`,
  4. normalise to `{ balance: number /* NGN */, currency: 'NGN', accountName, accountNumber, bankName, asOf: ISO, source: 'mono' }`,
  5. cache 60 s per mandate (Mono bills per call — avoid hammering) via `redis.service.ts`,
  6. `AdminActivityLog` entry ("viewed bank balance").
- `checkPermission(admin, ['view_loans','manage_loans'])`.
- Keep the old `/test-integrations/mono-balance/:userId` as a thin alias to the new logic (so nothing breaks) or 301 it.

**Admin UI:**
- `loanDetails.tsx`: "Check Bank Balance" calls the new endpoint; render `formatCurrency(data.balance)` (no `/100` unless the endpoint returns kobo — normalise server‑side to NGN and drop the client division); show `asOf` timestamp + "via Mono"; disable when no active mandate with a tooltip.

### 2.3 Cost note
Mono charges per balance enquiry. Gate the button behind a confirm dialog, cache 60 s, and log every call. Do **not** auto‑fetch on modal open.

### 2.4 Acceptance criteria
- For a user with an active Mono mandate, the admin sees a real, recent balance with timestamp.
- For a user without one, a clean "no active mandate" message (no stack trace, no "test" wording).

---

## PART 3 — OTHER BUGS & ISSUES FOUND

Severity: **P0** money/data integrity · **P1** breaks a core flow · **P2** degraded UX / latent · **P3** cleanup.

### 3.A Mono / auto‑debit (beyond Issues A–C)

| # | Sev | File:line | Problem | Effect | Fix |
|---|---|---|---|---|---|
| M1 | P0 | `penaltiesCron.ts:339‑340` | `pending` Mono debit counted as `successful` → `repayLoan` called | Loan marked repaid before money moves; if webhook never lands, permanent mis‑statement | Two‑phase (B.2.5) |
| M2 | P0 | `mono-webhook.controller.ts:17` | `MONO_WEBHOOK_SECRET || MONO_SECRET_KEY` fallback | If unset → all webhooks 401 → no activation, no reconciliation | Require dedicated secret; startup check (B.2.6) |
| M3 | P0 | `test-integrations.controller.ts:229‑245` | admin debit path creates no `AutoDebitLog` | No audit; webhook cannot reverse failed optimistic repay | Shared `AutoDebitService.chargeLoan` (C.2.2) |
| M4 | P1 | `auto-debit.controller.ts:343‑349` | `linkBankMono` blind‑inserts `status:'pending'` without calling Mono | DB state diverges from Mono | Verify + map + upsert (B.2.2) |
| M5 | P1 | `mono-webhook.controller.ts:32‑110` | no `rejected`/`cancelled`/`revoked`/`created` handlers | Mono‑side terminal states never sync back | Add handlers (B.2.6) |
| M6 | P1 | `bank-link-step.tsx:227‑245,299‑338` | up to 3 concurrent `linkBankMono` calls, distinct idempotency keys, stale‑closure guard | Duplicate/replaced rows, race | Stable key + `useRef` mutex (B.2.3) |
| M7 | P1 | `mono-callback/page.tsx:16` | `code` falls back to literal `'success'` | Garbage mandate token persisted | Remove fallback; error path (A.2.4) |
| M8 | P2 | `mono.provider.ts:44‑48` | `start_date`/`end_date` from `new Date().toISOString()` (UTC) | In WAT evening, `start_date` can be "yesterday" → Mono may reject | Compute in `Africa/Lagos`; `start_date = today`, clamp |
| M9 | P2 | `mono.provider.ts:85‑86` | `paymentId` parsed from a 6‑way `||` fallback chain; `monoUrl` from 2‑way | If Mono nests differently, silently `undefined` → later 404s | Parse the documented shape explicitly; throw if missing; log raw response once |
| M10 | P2 | `mono.provider.ts:13,67` | base URL & redirect default to **staging** (`prime-loan-web-v2-staging.vercel.app`) | If env unset in prod → mandates redirect to staging | Fail fast if `FRONTEND_URL`/`MONO_BASE_URL` unset in prod |
| M11 | P2 | `auto-debit.controller.ts:333‑337`, `linkBankMonnify:381‑384` | `linkBankMono` does `deleteMany` (hard delete) but `linkBankMonnify` does `updateMany→revoked` | Inconsistent history retention; Mono mandates deleted locally are never cancelled on Mono | Standardise: soft‑revoke + cancel on provider |
| M12 | P2 | `auto-debit.model.ts` | no unique index on `{userId, type, status:'active'}` | Multiple "active" methods of same type possible under races | Partial unique index |
| M13 | P2 | `auto-debit-log.model.ts:8‑21` vs `:27,32` | interface says `type:'card'\|'bank'`, `provider:'flutterwave'`; schema allows `wallet` + any provider; cron writes `mono`/`opay`/`monnify` | Type lies; future `.ts` consumers mis‑handle | Align interface to schema; add `source`, `mandateId` |
| M14 | P2 | `bank-link-step.tsx:355‑358` | init blocked unless `NEXT_PUBLIC_MONO_PUBLIC_KEY` set, but flow uses backend `monoUrl` (key unused) | Misconfig blocks a working flow | Drop the check or make it a soft warning |
| M15 | P3 | `bank-link-step.tsx:16` | `import Connect from "@mono.co/connect.js"` unused | Dead dep on both front‑ends (`@mono.co/connect.js` in both `package.json`) | Remove import (and dep if truly unused) |
| M16 | P2 | `auto-debit.controller.ts:278‑285` | name‑match validation only when `NODE_ENV==='production'` | Staging accepts mismatched names → tests don't catch real failure mode | Always validate; make strictness configurable |
| M17 | P1 | `auto-debit.controller.ts:262‑317` | `initiateBankMono` ignores `req.body.amount`, hard‑codes `5_000_000` | Mandate max may be below a large loan + fees + penalties → debit rejected later | Compute max from settings (max loan × ladder × buffer) or accept validated `amount` |
| M18 | P2 | `webhookRoutes.ts` + `app.ts:23` | `express.json()` global; no raw‑body capture | If Mono (or FLW/Monnify) ever needs HMAC‑of‑raw‑body verification, it's impossible | Add `express.raw()` on `/webhooks/*` and keep parsed copy |

### 3.B Repayment / ledger / loan business logic

| # | Sev | File:line | Problem | Effect | Fix |
|---|---|---|---|---|---|
| L1 | P0 | `loan.service.ts:664‑665` (standard path) vs `:653‑654` (internal path) | standard path sets `loan.outstanding = newOutstanding` **without clamping ≥ 0** and doesn't set `loan.status='completed'` | Overpayment → negative outstanding; completed loans keep `status:'accepted'` (also breaks admin stats) | Clamp `max(0, …)`; set `status='completed'` on `paidInFull` (matches `bug_fix.txt` Fix #1 — still unfixed here) |
| L2 | P1 | `mono-webhook.controller.ts:88‑99` | reversal only if `log.status==='successful'` **and** a prior optimistic repay happened | After B.2.5 (no optimistic repay) this branch is dead; before it, double `debit.failed` handled but `debit.successful` after a `failed` isn't | Rework to: settle from `pending` only; ignore terminal→terminal transitions |
| L3 | P1 | `loan.service.ts:541‑613` `reverseRepayment` | not idempotent against duplicate webhooks beyond ledger key; recomputes `outstanding + amount` each call | Double reversal if `debit.failed` delivered twice and log wasn't `successful` yet | Guard on `AutoDebitLog.reversedAt`; make transfer + ledger + loan update one transaction keyed by `reference` |
| L4 | P2 | `penaltiesCron.ts:87` | `penaltyRate` ternary: `settings.loan?.penalty?.percentage ? (dailyRate||1)/100 : (dailyRate||10)` | If `percentage` falsy, rate becomes `10` (1000%/day) fed to `applyPenaltyToLoan` | Sanitise; cap; unit test |
| L5 | P2 | `penaltiesCron.ts:516` | penalty base uses `loan.amount` (principal), not `loan.outstanding` | Over‑penalises users who nearly repaid (also flagged in `bug_fix.txt` #W2, unfixed) | Use `outstanding` per business decision |
| L6 | P2 | `penaltiesCron.ts:138‑161` | wallet auto‑repay calls `repayLoan` **without** `internalOnly`, using cached `user_metadata.wallet` as amount | Triggers a real VFD transfer against a possibly‑stale balance → VFD failures (also `bug_fix.txt` #W3) | Decide internal vs VFD; if VFD, read live balance first |
| L7 | P2 | `penaltiesCron.ts:112‑464` | one giant `for` loop, per‑loan `await` in series, external calls (Mono/FLW/VFD) inside | With many overdue loans a single cron tick can exceed BullMQ lock / stall | `p-limit` concurrency, per‑loan timeout, chunk |
| L8 | P3 | `penaltiesCron.ts:339` | `result?.status === true` compared (boolean) alongside string checks | Confusing, provider never returns boolean `true` here | Normalise provider result shape |

### 3.C Deployment / infra / config

| # | Sev | File | Problem | Effect | Fix |
|---|---|---|---|---|---|
| D1 | P1 | `.elasticbeanstalk/config.yml` | platform `Node.js 20`; `package.json` `prestart` runs `tsc` on the instance; `aws-sdk` v2 (maintenance) | Build on tiny instance is slow/OOM‑prone; v2 EOL | Prebuild `dist/` in CI or `predeploy` hook; pin Node 20; plan `aws-sdk` → v3 later |
| D2 | P1 | `src/shared/queue/index.ts` | BullMQ needs Redis; `.env.example` has only `redis://localhost` | New EB env has no Redis | Co‑locate Redis on the instance (free) **or** managed (Upstash/Redis Cloud) — see §6 |
| D3 | P1 | `src/shared/utils/cross-origin.ts:20‑46` | CORS allow‑list is static | New backend URL + any new front‑end preview origins must be added; socket.io CORS separate (`src/shared/sockets.ts`) | Add new origins; move list to env var |
| D4 | P1 | `next.config.mjs` (web‑v2) + `prime-finance-admin/api/proxy.js` | both front‑ends proxy via `BACKEND_URL` env | Moving backend = update `BACKEND_URL` in **both** Vercel projects + socket URL (`NEXT_PUBLIC_API_URL`) | Coordinated env cutover (§6.4) |
| D5 | P1 | Mono/Flutterwave/Monnify dashboards | webhook URLs point at the **old** backend | After cutover, webhooks 404/timeout → no reconciliation | Update webhook URLs to new host as part of cutover; keep old host warm during transition |
| D6 | P2 | `server.ts:110‑129` | workers run **in‑process** with the API | EB rolling deploy / autoscale would run duplicate crons | Use **single‑instance** EB env (also cheapest) OR split workers into their own env with a leader lock |
| D7 | P2 | `DockerFile` present + `.elasticbeanstalk` present | two deployment models half‑configured | Ambiguity | Pick **EB native Node platform** (no Docker) for cost + simplicity; delete/ignore `DockerFile` for this env |
| D8 | P2 | `.ebignore` | ignores `node_modules`, `.env*` | Good, but `dist/` not guaranteed present; `deploy.zip` (356 KB, stale) is in the repo | Ensure `dist/` built pre‑deploy; remove `deploy.zip` from VCS |
| D9 | P2 | `config/index.ts:6‑9` | `customerKey`, `baseUrl`, etc. use `!` non‑null assertions | Missing VFD env on new host → silent `undefined` in URLs | Add a startup env validator (fail fast, list missing keys) |
| D10 | P2 | `envConfig.ts` | loads `.env` from `../../.env` relative to `dist` | On EB, env comes from EB config not a file → fine, but local `dist` run needs `.env` at repo root | Document; keep `dotenv` no‑op if file missing |
| D11 | P3 | `.env.example:80‑82` | `MONO_SECRET_KEY=live_sk_xxxx` etc. | Encourages committing live keys | Keep placeholders; add secrets to EB only |
| D12 | P2 | `server.ts:47‑53` | health check `/health` returns 200 as soon as port binds (before DB) | EB health check may mark healthy during a broken boot | Add `/health/ready` that checks DB+Redis; point EB at it after warm‑up window |

### 3.D Admin app (`prime-finance-admin`)

| # | Sev | File:line | Problem | Effect | Fix |
|---|---|---|---|---|---|
| AD1 | P1 | `AutomationIntegration.tsx:462` | auto‑debit mutation omits `loanId` | `repayLoan` throws `requiredParam('loanId')` after a real charge | Send `loanId`; require selection |
| AD2 | P2 | `AutomationIntegration.tsx:420,434` | `automationApi.voiceCall`/`.sms` undefined | Latent `TypeError` if those cards get rendered | Implement or remove |
| AD3 | P2 | `loanDetails.tsx:74,139` | assumes `res.data.data.balance` exists and is kobo | Wrong/blank balance, `NaN` | Normalise server‑side to NGN; defensive parse |
| AD4 | P2 | `loanDetails.tsx:45‑49` | `useQuery({ queryKey: [] })` for ladders — empty key | Cache collisions / refetch storms across modals | Real query key |
| AD5 | P2 | `loanDetails.tsx:60‑68` | button enabled purely on `loan.status==='accepted'` regardless of a linked method | Admin clicks, gets opaque failure | Gate on live method readiness (Issue C panel) |
| AD6 | P3 | `loanDetails.tsx:52‑55` | admin profile query keyed on `["loans", _id, page, adminId]` | Odd key, minor over‑fetch | Tidy |

### 3.E User app (`prime-loan-web-v2`)

| # | Sev | File:line | Problem | Effect | Fix |
|---|---|---|---|---|---|
| U1 | P1 | `bank-link-step.tsx:600` | `const allLinked = linkedMethods.bank` where `linkedMethods.bank` is set optimistically by `handleSuccess` | User proceeds with an unconfirmed mandate | Derive from server truth (B.2.4) |
| U2 | P2 | `bank-link-step.tsx:285‑295` | popup blocked → `window.location.href = monoUrl` navigates whole SPA away | Wizard state only survives via localStorage draft; fragile | Use a dedicated `/loans/link-bank` route or a same‑tab return contract |
| U3 | P2 | `mono-callback/page.tsx:23‑44` | fake progress bar + `window.close()` + `setCloseFailed` race | Confusing "DO NOT CLOSE" vs auto‑close; some browsers block `close()` | Simplify: post message, show "you can close this tab", no fake progress |
| U4 | P2 | `bank-link-step.tsx:267` | mandate amount sent as `amount + interest + fee + amount*10` | Arbitrary ×10 buffer; backend ignores it anyway (M17) | Align with backend policy |
| U5 | P3 | `bank-link-step.tsx:76` | `isStaging` also true on `localhost` → shows "Bank BVN (Staging Only)" field locally | Fine, but note for testing | Keep, document |
| U6 | P2 | `client-sdk.ts` | no `unlinkMethod`, no mono `cancel`, no mono `status` | Can't build the cancel/disconnect UX | Add methods (A.2.4) |

---

## PART 4 — IMPLEMENTATION SEQUENCE (PR by PR)

All backend work on `dev-v2`; user app on `dev`; admin app on `dev`. Small, reviewable PRs. Nothing to `staging*`/`main`.

### Phase 0 — Safety net & discovery (no behaviour change)
- **P0.1** Add `webhook_events` collection + idempotency wrapper (unused yet).
- **P0.2** Add `src/shared/providers/mono.status.ts` mapper + unit tests.
- **P0.3** Add startup env validator (warn only).
- **P0.4** **Mono discovery task** (§8): confirm exact endpoints (cancel, balance), webhook event names, webhook auth scheme, mandate status vocabulary, whether `initiate` `id` == mandate id on v3. Update this doc with findings before P2.
- **P0.5** Add `AdminActivityLog` + `WorkerLog` breadcrumbs around all Mono calls (observability first).

### Phase 1 — Webhook correctness (P0)
- **P1.1** Harden `verifySignature` (M2): dedicated secret, constant‑time, startup assertion.
- **P1.2** Idempotent `handleWebhook` + new handlers: `mandates.created|rejected|cancelled|revoked|reinstated` (M5, B.2.6).
- **P1.3** `debit.successful` path: settle `AutoDebitLog` from `pending` → `successful` → `repayLoan` (keeps existing idempotency key).
- **P1.4** `debit.failed`: settle `pending` → `failed`, no reversal; keep legacy reversal branch guarded for in‑flight optimistic rows.
- **P1.5** Webhook traffic visible in admin worker logs.

### Phase 2 — Linking state sync (Issues A + B)
- **P2.1** `MonoProvider.cancelMandate`, `getMandateBalance` (or account‑id path).
- **P2.2** `initiateBankMono`: persist `initiating` row, idempotency, cancel previous non‑active (A.2.1).
- **P2.3** `linkBankMono`: verify → map → upsert → return real status + 202 for pending (B.2.2).
- **P2.4** New `GET /api/loans/link-bank/mono/status`, `POST /api/loans/link-bank/mono/cancel`.
- **P2.5** `getLinkedMethods`: expose pending + `providerStatus` + `needsAction` (B.2.4).
- **P2.6** `unlinkMethod`: cancel on Mono then revoke (A.2.3, M11).
- **P2.7** `monoReconcileCron` (B.2.7) — register in `server.ts`, admin‑controllable via `WorkerControlService`.
- **P2.8** Orphan sweeper for `initiating` rows (A.2.5) — fold into reconcile cron.
- **P2.9** SDK: `unlinkMethod`, `cancelMonoMandate`, `getMonoLinkStatus`.
- **P2.10** `bank-link-step.tsx`: single `confirmMono`, mutex, bounded poll, **Cancel setup** button, garbage‑code guard, derive `allLinked` from server (U1, U2‑lite, U6, M6, M7, M14).
- **P2.11** `mono-callback/page.tsx`: drop `'success'` fallback, `MONO_ERROR` message, simplify UI (U3).

### Phase 3 — Repayment integrity (P0)
- **P3.1** `AutoDebitService.chargeLoan` shared service (C.2.2).
- **P3.2** `penaltiesCron` bank/wallet path → two‑phase, no optimistic `repayLoan` (M1, B.2.5); card stays sync.
- **P3.3** `reverseRepayment` idempotency guard (L3); `repayLoan` standard‑path clamp + `status='completed'` (L1).
- **P3.4** Penalty sanitisation (L4, L5) — **needs product decision** (base = principal vs outstanding).

### Phase 4 — Admin auto‑debit feature (Issue C)
- **P4.1** `admin-auto-debit.controller.ts` + routes (C.2.1) using `AutoDebitService`.
- **P4.2** `singleLoanHistory` (or a new endpoint) returns payment methods + live status.
- **P4.3** Admin UI: Payment Methods panel in `loanDetails.tsx`; fix `AutomationIntegration.tsx` payload (AD1); remove dead refs (AD2).

### Phase 5 — Balance feature (Part 2)
- **P5.1** `AutoDebit.providerAccountId`; populate from webhook + status.
- **P5.2** `GET /backoffice/loans/:loanId/bank-balance` + 60 s cache + activity log.
- **P5.3** Admin UI wiring (AD3).

### Phase 6 — Hardening & cleanup
- Timezone (M8), response parsing (M9), prod‑guard defaults (M10), name validation (M16), mandate amount policy (M17/U4), indexes (M12), model typing (M13), CORS→env (D3), health/ready split (D12), env validator → fail‑fast (D9), remove `deploy.zip` (D8), remove unused `@mono.co/connect.js` (M15).

### Phase 7 — Deploy (Part 6) then push front‑ends to `dev`.

> **Order rationale:** webhooks first (nothing else can be trusted without them), then linking sync, then repayment integrity, then admin/balance features, then infra. Each phase is independently shippable to `dev-v2`.

---

## PART 5 — LOCAL TEST PLAN (run everything, verify, before deploy)

### 5.1 Prerequisites
- **Node 20**, **pnpm** (admin + web‑v2 have `pnpm-lock`), **MongoDB** (local `mongod` or a disposable Atlas DB — **do not** point at prod), **Redis** (local `redis-server` / Docker `redis:7`).
- Backend `.env` at `prime-loan-backend/.env` with: Mongo, Redis, JWT secrets, **Mono sandbox** keys + `MONO_WEBHOOK_SECRET`, Flutterwave test keys, VFD sandbox, Cloudinary, `FRONTEND_URL=http://localhost:3000`, `NODE_ENV=development`.
- `web-v2/.env.local`: `BACKEND_URL=http://localhost:3001`, `NEXT_PUBLIC_API_BASE_URL=/api`, `NEXT_PUBLIC_API_URL=http://localhost:3001`, `NEXT_PUBLIC_MONO_PUBLIC_KEY=<sandbox pk>`, `NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY=<test>`.
- `admin/.env`: `VITE_API_BASE_URL=http://localhost:3001/` (note trailing slash — `apiClient.ts:4` concatenates `backoffice`), plus `BACKEND_URL` for the proxy fn if run via `vercel dev`.
- **Mono webhook to localhost:** use `cloudflared tunnel` / `ngrok http 3001`; set the tunnel URL + `/webhooks/mono` in the Mono **sandbox** dashboard; set the same `MONO_WEBHOOK_SECRET`.

### 5.2 Start order
```bash
# 1. infra
mongod --dbpath .data/mongo        # or docker
redis-server                       # or docker run -p 6379:6379 redis:7

# 2. backend  (prime-loan-backend)
npm install
npm run dev                        # ts-node-dev, PORT from .env (set PORT=3001)

# 3. user app (prime-loan-web-v2)
pnpm install
pnpm dev                           # http://localhost:3000

# 4. admin app (prime-finance-admin)
pnpm install
pnpm dev                           # http://localhost:5173
```
Confirm: `GET http://localhost:3001/health` → 200; backend logs show Mongo + Redis connected + "Background workers started".

### 5.3 Test matrix

**T‑A · Cancel / re‑initiate (Issue A)**
1. Set `autoDebit.bankLinkingProvider = 'mono'` (admin → settings, or seed).
2. Wizard → Bank step → enter name/number → **Continue to Mono** → on Mono sandbox, **close the tab without paying**.
3. ✅ Wizard shows "Setup cancelled", **Cancel setup** available, **Continue to Mono** re‑enabled.
4. Re‑initiate → complete the ₦50 sandbox transfer → ✅ mandate approved, bank shows linked.
5. Re‑enter the step, **Continue to Mono** again → ✅ previous mandate cancelled on Mono (check dashboard), new one created; no "already linked" dead‑end.
6. Force a stuck state: approve on Mono but block the webhook (stop tunnel) → row stays `pending` → ✅ **Cancel setup** works; ✅ `monoReconcileCron` flips it within 15 min once tunnel restored.

**T‑B · State sync (Issue B)**
1. Complete a Mono link with webhook **enabled** → ✅ row `active` within one webhook; wizard shows linked only after `data.status==='active'`.
2. Complete the Mono transfer but kill the tunnel before the webhook → ✅ wizard stays on "finishing…", does **not** show linked; poll + manual re‑check available; reconcile cron settles it later.
3. In Mono sandbox, cancel/revoke the mandate → ✅ `mandates.cancelled` webhook flips row to `revoked`; user + admin see "disconnected".
4. Trigger a debit (T‑C) then have Mono send `debit.failed` → ✅ `AutoDebitLog` `failed`, loan outstanding **unchanged** (never optimistically repaid).

**T‑C · Admin debit (Issue C)**
1. Admin → Loans → open an accepted loan with an active Mono mandate → ✅ Payment Methods panel lists it with local + live status.
2. **Charge now ₦1,000** → ✅ `AutoDebitLog{status:'pending', source:'admin'}` created; UI shows "processing — awaiting confirmation".
3. Mono sends `debit.successful` → ✅ log → `successful`, `repayLoan` runs once (idempotent), outstanding drops by ₦1,000, repayment history entry.
4. User with **no** method → ✅ clean "No active auto‑debit mandate" empty state, no error toast, no throw.
5. `AutomationIntegration` page → select user **and loan** → trigger → ✅ no `requiredParam('loanId')` crash.
6. Admin **Disconnect** → ✅ Mono mandate cancelled + local `revoked` + user notified.

**T‑D · Balance (Part 2)**
1. Loan with active Mono mandate → **Check Bank Balance** → ✅ real NGN balance + "as of <time> · via Mono"; 2nd click within 60 s served from cache (one Mono call in logs).
2. Loan without mandate → ✅ "No active Mono mandate for this user".

**T‑E · Regression (must not break)**
- Flutterwave **card** link + cron card debit still sync‑settle.
- Flutterwave **e‑mandate** bank + **Monnify** + **OPay** flows unchanged.
- Wallet deduction, penalty application, reminders, savings, transfers, escrow, bill payments — smoke test each once.
- `npx tsc --noEmit` clean in all 3 repos; `pnpm build` (web‑v2 + admin) succeeds; `npm run build` (backend) succeeds.
- Existing jest suites: `npm test` (backend), `pnpm test` (admin).

**T‑F · Webhook security**
- Wrong `mono-webhook-secret` → 401; correct → 200; replayed event id → 200 but no double processing.

### 5.4 Exit criteria
All T‑A…T‑F pass; no P0/P1 open; `tsc` + builds green; 30‑min soak of the backend with workers running shows no unhandled rejections.

---

## PART 6 — MOVE BACKEND TO A NEW AWS ELASTIC BEANSTALK ENVIRONMENT (cost‑optimised)

**Front‑ends stay on Vercel. Only `prime-loan-backend` moves.**

### 6.1 Target architecture (cheapest that meets the needs)

```
Mono / Flutterwave / Monnify ──(HTTPS webhooks)──►  ┌─────────────────────────────┐
Vercel (web-v2)  ──BACKEND_URL──► Cloudflare (free) ─►│  Elastic Beanstalk           │
Vercel (admin)   ──BACKEND_URL──► TLS at edge        │  SingleInstance (no ALB)     │
                                                     │  t4g.small (ARM) Amazon Linux│
                                                     │  Node.js 20 platform         │
                                                     │  - API (express)             │
                                                     │  - in-process BullMQ workers │
                                                     │  - Redis co-located (systemd)│
                                                     └──────────────┬──────────────┘
                                                                    │
                                                         MongoDB Atlas (unchanged)
```

**Why these choices:**
- **SingleInstance** (not load‑balanced): no ALB → saves ~US$16–18/mo; also avoids duplicate in‑process crons (D6). One Elastic IP (free while attached).
- **t4g.small** (2 vCPU, 2 GiB, Graviton): ~US$0.0168/hr ≈ **US$12/mo**. `t4g.micro` (1 GiB) is ~US$6/mo but `sharp` + `tesseract.js` + workers + Node can OOM at 1 GiB — **t4g.small recommended**; can trial `t4g.micro` with swap.
- **EBS**: gp3 10 GiB ≈ US$0.80/mo.
- **Redis co-located** on the instance via a `.platform/hooks/prebuild` script (`dnf install redis6` + enable) → **US$0**. Trade‑off: queue state lost if the instance is replaced (acceptable — jobs are repeatable/idempotent). Managed alternative: **Upstash** (pay‑as‑you‑go, ~US$0–5/mo at this volume) or **Redis Cloud free 30 MB**.
- **Cloudflare (free)** in front for HTTPS (webhooks require TLS; SingleInstance EB has no ALB to terminate TLS). Alternative: `.platform` nginx + certbot on the instance. Cloudflare also gives caching/DDoS for free.
- **No RDS, no ElastiCache, no NAT Gateway** (NAT GW alone is ~US$32/mo — avoid; keep instance in a public subnet with a security group).
- **Logs**: EB → CloudWatch Logs, 7‑day retention (a few cents).

**Estimated monthly cost: ~US$13–16** (t4g.small + EBS + minimal egress + logs). Add ~US$0–5 if you choose managed Redis.

### 6.2 Repo changes needed before deploy (part of Phase 6/7)
1. `Procfile`:
   ```
   web: node dist/server.js
   ```
2. Build `dist/` **before** upload (don't build on the instance — slow/OOM). Options:
   - GitHub Actions: `npm ci && npm run build` → `eb deploy` with `dist/` included, `src/` optional.
   - or `.platform/hooks/prebuild/01_build.sh` running `npm run build` (only if staying on t4g.small+).
   - Adjust `.ebignore` to **include** `dist/` and exclude `src/`, `docs/`, `scratch/`, `logs/`, `deploy.zip`, tests.
3. `.platform/hooks/prebuild/00_redis.sh` (if co‑locating Redis): install + enable `redis`, bind `127.0.0.1`.
4. `.ebextensions/`:
   - `option_settings` → `aws:elasticbeanstalk:environment:proxy` keep nginx; `aws:autoscaling:asg` min=max=1; instance type `t4g.small`; `aws:elasticbeanstalk:application:environment` **not** used for secrets — use EB "Configuration → Environment properties" or SSM.
   - health check path `/health` (or `/health/ready` after D12).
5. `crossOrigin` allow‑list: add the new public origin(s) (`https://api2.primefinance.live` isn't an *origin* for CORS — but add the front‑end origins you'll actually serve; if you introduce a new admin/user domain, add it). Move to `CORS_ORIGINS` env (comma‑separated) — D3.
6. `src/shared/sockets.ts`: ensure socket.io CORS uses the same env list.
7. Env validator (D9) → **fail fast** so a misconfigured EB env crashes visibly instead of running half‑broken.
8. Remove committed `deploy.zip`; keep `DockerFile` out of the deployment bundle (native platform).

### 6.3 Deploy steps (EB CLI)
```bash
cd prime-loan-backend

# one-time
eb init prime-finance-backend-v2 \
  --platform "Node.js 20 running on 64bit Amazon Linux 2023" \
  --region us-east-1                       # or eu-west-1 (closer to NG) — your call

eb create prime-finance-backend-v2-env \
  --single \                               # SingleInstance, no ALB
  --instance-types t4g.small \
  --envvars $(cat eb.env | xargs)          # or set in console / SSM afterwards

# subsequent
npm ci && npm run build
eb deploy prime-finance-backend-v2-env
eb health ; eb logs
```

### 6.4 Cutover runbook (zero/low downtime)
1. Deploy backend to the new EB env; point Cloudflare `api.primefinance.live` (or a new host) → EB public DNS; verify `/health/ready` over HTTPS.
2. Load env: copy **every** var from the current live server (list in §6.5). Verify with the env validator + `eb ssh` `node -e "require('./dist/config')"`.
3. Smoke test the new backend directly (curl a public read endpoint, run T‑F webhook test with a manual POST).
4. **Point provider webhooks at the new host** (Mono, Flutterwave, Monnify dashboards) — but keep the **old** backend running.
5. In **Vercel → web‑v2**: set `BACKEND_URL` + `NEXT_PUBLIC_API_URL` to the new host → redeploy. Repeat for **Vercel → admin** (`BACKEND_URL`).
6. Watch new‑backend logs + admin worker logs for 30–60 min: webhook 200s, cron ticks, auth working.
7. Once stable for 24–48 h, decommission the old server (snapshot first).
8. Rollback = revert the two Vercel env vars + provider webhook URLs to the old host.

### 6.5 Environment variables to migrate (from current live server → EB env properties / SSM)
`MONGODB_URI` / `DB_URL` / `DATABASE_NAME` · `REDIS_URL` (or `REDIS_HOST/PORT/PASSWORD`) · `PORT` (EB sets `PORT`; app already reads it) · `NODE_ENV=production` · `ENV=production` · `LOG_LEVEL` · `ACCESS_TOKEN_SECRET` · `REFRESH_TOKEN_SECRET` · `CRYPTOJS_KEY` · `FRONTEND_URL=https://primefinance.live` · `CORS_ORIGINS=…` (new) · `MONO_BASE_URL` · `MONO_SECRET_KEY` · `MONO_PUBLIC_KEY` · `MONO_WEBHOOK_SECRET` · `FLUTTERWAVE_SECRET_KEY` (+ any FLW encryption/public keys) · `MONNIFY_BASE_URL/API_KEY/SECRET_KEY/CONTRACT_CODE` · `OPAY_MERCHANT_ID/SECRET_KEY/PUBLIC_KEY` · VFD: `CUSTOMER_KEY/CUSTOMER_SECRET/BASE_URL/AUTH_URL` · `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` · S3: `S3_BUCKET/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY` · email: `EMAIL_USERNAME/PASSWORD/HOST/PORT_NUMBER` · `PAYBETA_API_KEY/PAYBETA_API_URL` · voice: `VOICE_CALL_PROVIDER/TERMII_API_KEY/TERMII_SENDER_ID`, `AT_USERNAME/AT_API_KEY/AT_VOICE_CALLBACK_URL/AT_CALL_FROM`, Twilio `*` · ClubConnect `CLUB_KONNECT_API_KEY/USER_ID/URL` · loan config `LOAN_AUTO_APPROVAL_MAX_KOBO`, `AUTO_DEBIT_RETRY_SCHEDULE`, poll config.
> ⚠️ Also update `AT_VOICE_CALLBACK_URL` and any provider callback URLs that embed the backend host.

### 6.6 MongoDB Atlas
- Add the EB instance's Elastic IP to the Atlas IP access list (or confirm `0.0.0.0/0` is already set). No data migration — same cluster.

### 6.7 What I need FROM YOU to do the deploy

**AWS (you create; do not paste secret values into chat):**
1. An **AWS account** with billing active.
2. An **IAM user** (or IAM Identity Center user) for deployment with programmatic access. Simplest: attach `AdministratorAccess` for the initial `eb create` (it creates IAM roles), then scope down later. Scoped alternative — attach: `AWSElasticBeanstalkFullAccess` (or `AdministratorAccess-AWSElasticBeanstalk`), `AmazonEC2FullAccess`, `AmazonS3FullAccess`, `AWSCloudFormationFullAccess`, `IAMFullAccess` (needed once to create `aws-elasticbeanstalk-ec2-role` / `-service-role`), `CloudWatchLogsFullAccess`.
3. Provide the **Access Key ID + Secret Access Key** to me **via a secure channel** (not this chat) so I can run `aws configure --profile prime-eb` locally — **or** you run `aws configure` / `eb init` yourself and I drive `eb deploy`. I will **not** type secret keys into any web form.
4. Preferred **region** (default `us-east-1` for parity; `eu-west-1` is lower‑latency to Nigeria).
5. Confirm **instance size** choice: `t4g.small` (recommended) vs `t4g.micro` (cheaper, riskier).
6. Confirm **Redis choice**: co‑located on instance (free) vs Upstash/Redis Cloud (managed).

**DNS / TLS:**
7. Whether `primefinance.live` DNS is on **Cloudflare** (free plan is enough). If yes, I need either delegated access or you add the CNAME I give you. Decide the backend hostname (e.g. `api2.primefinance.live`).

**Providers:**
8. **Mono dashboard** access (or you): to (a) run the discovery in §8, (b) update the webhook URL at cutover, (c) confirm the webhook secret, (d) confirm the account‑balance product is enabled.
9. Same for **Flutterwave** and **Monnify** webhook URL updates.

**Vercel:**
10. Access to **both** Vercel projects (web‑v2 + admin) to change `BACKEND_URL` / `NEXT_PUBLIC_*`, or you make the changes I specify.

**Current server:**
11. The current live **env var values** (all of §6.5) — export from the existing host.
12. Read access to the current MongoDB Atlas project (to confirm IP allow‑list).

**GitHub:**
13. Confirm the **dev branch names** (`dev-v2` for backend, `dev` for both front‑ends) and that I should push there (not open PRs to `staging`/`main`).

---

## PART 7 — GIT / BRANCH STRATEGY

| Repo | Work branch | Push target | Notes |
|---|---|---|---|
| `prime-loan-backend` | feature branches off `dev-v2` | **`dev-v2`** | current checked‑out branch is `staging-v2` — switch to `dev-v2` first |
| `prime-loan-web-v2` | feature branches off `dev` | **`dev`** | currently on `dev` |
| `prime-finance-admin` | feature branches off `dev` | **`dev`** | currently on `dev` |

- One PR per Phase (or sub‑phase) with a checklist mapping to §4.
- Commit messages: conventional style already in use (`feat:`, `fix:`, `chore:`).
- **No** direct commits to `staging*` / `main`. You merge `dev → staging → main` on your own schedule.
- Tag the pre‑change state on each repo (`pre-mono-stabilisation`) before Phase 1 for easy rollback.
- The deploy itself (Part 6) happens from `dev-v2` of the backend once tests pass.

---

## PART 8 — MONO DIRECT DEBIT API — VERIFIED FACTS (docs.mono.co, Sept 2026)

> Source pages: Direct Debit Overview, Integration Guide, Mandate Setup (Variable), Debit an Account, Webhook Events, Cancel/Pause/Reinstate Mandate, Balance Inquiry, Initiate Mandate Authorisation. Base URL `https://api.withmono.com`. Auth header `mono-sec-key: <MONO_SECRET_KEY>`.

### 8.0 — CORRECTIONS FROM THE LIVE API (probed 3 real staging mandates, 2026‑09‑03)

- **`ready_to_debit` is NOT reliable on its own.** The live `GET /v3/payments/mandates/{id}` returns `ready_to_debit: true` **even on a `status:"cancelled"` mandate** (observed: `{status:"cancelled", approved:false, ready_to_debit:true}`). → `mapMonoMandateStatus` matches terminal `status` FIRST; `AutoDebitService.chargeLoan` re‑syncs every Mono mandate against the live API before `/debit` and gates on the mapper's `readyToDebit`; `monoReconcileCron` also re‑checks locally‑`active` mono rows (≤ every 6 h).
- **Debitable state = `status:"approved"` + `approved:true` + `ready_to_debit:true`.** There is no distinct `"active"`/`"ready"` **status string** in the payload — `ready_to_debit` is the gate, `status` stays `"approved"`.
- **Balance = `GET /v3/payments/mandates/{id}/balance-inquiry?amount=<kobo>` and `amount` is REQUIRED** (`400 "Amount is required to check balance"` without it). It answers "can the account cover ₦X?" (may also echo the balance). `getMandateBalance(id, amountNaira)` now requires the amount; admin endpoints pass the loan outstanding.
- **Webhook `debit.successful` match key = `data.reference_number`** (verified end‑to‑end on staging). `data.mandate` carries the `mmc_…` id.
- Mandate GET also returns `account_name` / `account_number` / `institution.{name,bank_code}` — `syncMonoMandate` backfills these onto legacy `accountNumber:"mono-mandate"` rows.

### 8.1 Initiate (hosted authorisation flow) — what we use
`POST /v2/payments/initiate` → *"returns a link for your customers to authorise their mandate … when you don't need to customise the flow."*
Response (verified sample):
```json
{ "status": "successful", "message": "Payment Initiated Successfully",
  "data": {
    "mandate_id": "mmc_682b977203c0b7360787b46g",     // <-- THE id for all /v3/payments/mandates/{id}/* calls
    "type": "recurring-debit", "method": "mandate", "mandate_type": "emandate",
    "amount": 9190030,                                  // kobo
    "mono_url": "https://authorise.mono.co/RD3044259",  // customer authorisation link
    "reference": "test-...", "customer": "65eb...",
    "start_date": "2024-03-19", "end_date": "2024-08-04" } }
```
→ **Fix M9:** parse `data.mandate_id` + `data.mono_url` explicitly; the id is `mmc_…`. Current 6‑way `|| data.id` chain happens to still land on `mandate_id` but is fragile.

### 8.2 Retrieve a mandate
`GET /v3/payments/mandates/{mandate_id}` (headers `accept: application/json`, `mono-sec-key`).
Returns `status`, **`ready_to_debit`** (boolean), **`approved`** (boolean), account details, and a new **`balance`** field = *"the outstanding amount that can be debited from the user's account for that mandate"* (NOT the real bank balance; no fee).

**Mandate status lifecycle:** `awaiting_authorization` → `initiated` → `approved` → *(ready‑to‑debit)* → then `paused` / `cancelled` / `rejected` / `expired`.
- `approved` = the ₦50 NIBSS e‑mandate transfer completed. **Not yet debitable.**
- **`ready_to_debit: true`** (delivered by `events.mandates.ready`, 5 min–24 h, rarely >48 h; **sandbox ≈ 1 h**) = the account can actually be debited.
- → **Fix:** our local `active` must mean `ready_to_debit === true` (or status `approved` **and** `ready_to_debit`), not merely `approved`. Add a local `approved` state distinct from `active`.

### 8.3 Debit an account (variable mandate) — ASYNC
`POST /v3/payments/mandates/{mandate_id}/debit` body `{ amount /* kobo */, reference, narration, fee_bearer? }`.
Immediate response `status:"successful", response_code:"00"` **only means accepted** — money has not moved. Verified response `data`: `{ success, status:"successful", event, amount, mandate:"mmc_…", reference_number:"ref…", date, live_mode, fee, session_id, account_details, beneficiary, meta }`.
- **The webhook/settlement key is `data.reference_number` (and `data.mandate`), NOT `data.reference`.** Our webhook currently reads `event.data.reference` → **never matches** → this is a real reconciliation bug.
- **Fix:** on `chargeAccount`, capture `data.reference_number` + `data.session_id` from the immediate response and store on `AutoDebitLog` (`providerReference`, `sessionId`). Webhook match = `{ $or: [ {reference: X}, {providerReference: X} ] }` for `X ∈ {event.data.reference, event.data.reference_number}`.
- **Retrieve a debit** ("Retrieve a Debit" / "Get all Debits" endpoints exist; exact path TBC via dashboard/API explorer — used by the reconcile cron).

### 8.4 Balance inquiry (Part 2 feature)
`GET /v3/payments/mandates/{mandate_id}/balance-inquiry` → real‑time balance, **₦50 fee**.
`GET /v3/payments/mandates/{mandate_id}/balance-inquiry?amount={kobo}` → sufficiency check, **₦10 fee**.
Returns **₦0 by default when the account balance is below ₦1,000.**
→ Admin "Check Bank Balance" uses the full inquiry; the cron pre‑debit check uses the cheaper sufficiency check. Cache 60 s. Confirm units in the response (kobo vs naira) against a live call.

### 8.5 Mandate actions
- Cancel: `PATCH /v3/payments/mandates/{id}/cancel` — headers only, **no body**, `200` on success.
- Pause: `PATCH /v3/payments/mandates/{id}/pause`
- Reinstate: `PATCH /v3/payments/mandates/{id}/reinstate`
→ `MonoProvider.cancelMandate(id)` = the cancel call. Use **cancel** (not pause) for user/admin disconnect.

### 8.6 Webhook events (exact strings) + payloads
Header **`mono-webhook-secret`** must equal the dashboard webhook secret. **No HMAC** / no raw‑body signature. Payload carries **`event_id`** (a.k.a. `id`) — store it, dedupe (same id on every retry). Retries: exp backoff 30 s → 4 h cap, up to **25 attempts over 48 h**. Must return `2xx` fast.

| Event string | Fires | `data` id field | Key `data` fields |
|---|---|---|---|
| `events.mandates.created` | mandate created | `data.id` | `status:"initiated"`, `reference`, `account_number`, `account_name`, `bank`, `amount`, `debit_type`, `start_date`, `end_date` |
| `events.mandates.approved` | customer approved (₦50 done) | `data.id` | `status:"approved"`, `approved:true`, `reference`, `account_details`, `amount` |
| `events.mandates.ready` | **ready to debit** | `data.id` | `ready_to_debit:true`, `status:"approved"`, `nibss_code`, `amount` |
| `events.mandates.rejected` | rejected by bank | `data.id` | `status:"rejected"`, `approved:false` |
| `events.mandates.expired` | past end_date | `data.id` | `status:"expired"` |
| `events.mandate.action.pause` | paused | `data.mandate` | `status:"success"` |
| `events.mandate.action.cancel` | cancelled/deleted | `data.mandate` | `status:"success"` |
| `events.mandate.action.reinstate` | reinstated | `data.mandate` | `status:"success"` |
| `events.mandates.debit.processing` | debit pending | `data.mandate` | `response_code:"99"`, `amount`, `reference_number`, `account_details` |
| `events.mandates.debit.successful` | account debited | `data.mandate` | `success:true`, `response_code:"00"`, `amount`, `fee`, `reference_number`, `account_details` |
| `events.mandates.debit.failed` | debit failed | `data.mandate` | `success:false`, `response_code` (e.g. "96"), `amount` |
| `events.mandates.debit_attempt.successful` | partial‑sweep leg | `data.mandate` | `type:"partial"`, `amount`, `reference_number` |

**Current webhook handler defects vs this table** (`mono-webhook.controller.ts`):
- cases `events.mandates.active` — **does not exist**; the real "debitable" signal is `events.mandates.ready`.
- misses `ready`, `rejected`, `expired`, `mandate.action.cancel|pause|reinstate`, `debit.processing`.
- reads `event.data.reference` for debit reconciliation — should be `event.data.reference_number` (+ fallback).
- `event.data.mandate_id || event.data.id` — wrong for `mandate.action.*` (id is `data.mandate`) and for debit events (`data.mandate`).
- treats `approved` as fully active/debitable — it is not.

### 8.7 Still to confirm on a LIVE call / dashboard (non‑blocking, do during staging test)
1. Exact "Retrieve a Debit" path + response (reconcile cron can fall back to `getMandateStatus` + `AutoDebitLog` age heuristic until confirmed).
2. `balance-inquiry` response units + exact field name (`balance` vs `data.balance`, kobo vs naira).
3. Whether `events.mandates.debit.*` payloads also echo the original `reference` we sent (belt‑and‑suspenders match already handles both).
4. Sandbox base URL + whether staging should point at sandbox or Mono live. (Plan assumes **staging → Mono live** per the "test on live staging server" decision — confirm Mono allows a second live webhook URL, or use a Mono "test mode" key.)
5. Mono per‑call pricing (initiate / debit / balance) to finalise cron cadence.

---

## APPENDIX — Full issue index (quick reference)

**Reported:** A (cancel/re‑initiate) · B (state desync) · C (admin debit) · Part 2 (balance feature).

**Found — P0:** M1, M2, M3, L1, L2/L3 (repayment reversal), + the webhook‑rejection cascade (M2 → no activation, no reconciliation).
**Found — P1:** M4, M5, M6, M7, M17, L6, L7, D1–D5, AD1, U1, U6.
**Found — P2:** M8–M13, M16, M18, L4, L5, L8, D6–D12, AD3–AD5, U2–U4.
**Found — P3:** M14, M15, AD6, U5, D8, D11, `bug_fix.txt` items still unfixed (Fix #1/#W2/#W3 overlap L1/L5/L6).

> Note: `docs/bug_fix.txt` lists 32 earlier issues; several (Fix #1 negative outstanding, #W2 penalty base, #W3 wallet VFD path, #19 hardcoded Mono key) overlap this plan and appear **still unfixed** in the current code — folded into Phase 3 / Phase 6.
