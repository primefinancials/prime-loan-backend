# Upgrade & Optimization Report

## 1. Worker Efficiency & Scalability Issues

### Issue: Sequential Processing in Pollers
The current implementation of `BillPaymentsPoller` and `LoanPenaltiesCron` processes items sequentially, which is inefficient for high volumes.
- **File**: `src/workers/pollers/billPaymentsPoller.ts`
- **Problem**: `for (const payment of pendingPayments) { await ... }` blocks the loop for each HTTP request. If 100 payments are pending and each takes 1s, the batch takes 100s.
- **Impact**: High latency in updating payment statuses; potential for backing up if arrival rate > processing rate.
- **Recommendation**: Use `Promise.all` with a concurrency limit (e.g., `p-limit`) or leverage the Queue properly to dispatch individual jobs for each payment so multiple workers can process in parallel.

### Issue: Single-Threaded Cron Execution
The workers are currently running as single instances via `node dist/workers/...`.
- **Problem**: There is no mechanism to scale out. If you run multiple instances of the script, they might conflict or just do redundant work (though `bullmq`'s `repeat` might handle scheduling, the execution logic is still monolithic inside the processor).
- **Recommendation**:
    1.  Split the "Poller" into a "Scheduler" that just queries the DB and pushes jobs to a queue.
    2.  Create "Processors" that pick up single jobs (e.g., `process-bill-payment`) and execute them.
    3.  This allows horizontal scaling of processors.

### Issue: Limited Error Handling in Batch
- **Problem**: If the worker crashes mid-batch, the `removeOnFail` might apply to the whole batch job, potentially losing track of which specific sub-items were done vs failed (though they are read from DB so it's idempotent-ish).
- **Recommendation**: Job-per-item architecture solves this naturally.

## 2. Type Safety & Code Quality

### Issue: Usage of `any`
- **File**: `dist/workers/pollers/billPaymentsPoller.ts` (and others)
- **Problem**: `type FlutterwaveResponse<T = any>` and usage of `any` in try/catch blocks (`error: any`).
- **Recommendation**: Define proper interfaces for Provider responses. Use `unknown` for errors and type guard them.

### Issue: Hardcoded Config/Secrets
- **Problem**: Some configuration seems to be mixed with code or relying on specific environment variables without validation at startup.
- **Recommendation**: Use a strict configuration validation service (e.g., `joi` or `zod`) at application startup to fail fast if keys are missing.

## 3. Database & Architecture

### Issue: Polling vs Event-Driven
- **Observation**: The system relies heavily on polling (`BillPaymentsPoller`, `TransfersPoller`).
- **Recommendation**: Where possible, implement Webhooks from providers (Flutterwave, VFD) to update status in real-time. Polling should only be a fallback backup mechanism (safety net), not the primary driver.

### Issue: Indexing
- **Observation**: Ensure `status` and `createdAt` fields are indexed for all collections polled by workers to prevent full collection scans.
- **Action**: Verify `LoanSchema` and `BillPaymentSchema` indexes.

## 4. Specific Module Improvements

### Loans
- **OCR Ladder**: Currently seems to store raw steps.
- **Optimization**: Add logic to fuzzy-match steps if OCR is imperfect.

### Ledger
- **Reconciliation**: `findInconsistencies` is a good start.
- **Optimization**: Automate this check to run hourly and alert via Slack/Email if variance > 0.

## 5. Deployment
- **Docker**: The `DockerFile` exists but seems basic.
- **Recommendation**: Multi-stage build to reduce image size. Add `HEALTHCHECK` instruction.
