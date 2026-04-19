# Prime Loan V2 Reference Architecture

## Overview

Prime Loan V2 implements a clean architecture with ledger-first design, ensuring all financial operations are properly tracked and reconciled. The system maintains backward compatibility with V1 while introducing robust new features.

## Architecture Principles

### 1. Ledger-First Design
- Every money movement creates corresponding ledger entries
- Double-entry bookkeeping ensures balance integrity
- Ledger is the single source of truth for reconciliation

### 2. Clean Architecture
- **Domain**: Pure business logic (loan eligibility, savings calculations)
- **Application**: Use cases and orchestration (services)
- **Infrastructure**: External concerns (database, providers, OCR)
- **Presentation**: HTTP controllers and routes

### 3. Transactional Outbox Pattern
- External calls are made reliably using outbox events
- Database transactions include outbox entries
- Separate workers process outbox events asynchronously

### 4. Idempotency
- All money-changing operations require `Idempotency-Key` header
- Duplicate requests return cached responses
- Prevents accidental double-charges

## Core Components

### Ledger Service
- Manages all financial ledger entries
- Supports double-entry bookkeeping
- Provides balance calculations and reconciliation

### Polling Workers
- **Bill Payments Poller**: Checks pending bill payment status every 30s
- **Transfers Poller**: Monitors transfer completion and handles reconciliation
- **Loan Penalties Cron**: Applies daily penalties to overdue loans
- **Savings Maturities Worker**: Processes matured savings plans

### OCR Pipeline
- Extracts loan ladder amounts from calculator images
- Uses Sharp for image preprocessing and Tesseract.js for OCR
- Validates results and flags suspicious patterns for manual review

### Admin Tools
- Transaction details with full audit trail
- Manual review queue for flagged operations
- Profit reporting (realized vs unrealized)
- Reconciliation inconsistency detection

## Data Models

### Core Financial Models
- **LedgerEntry**: Single source of truth for all money movements
- **IdempotencyKey**: Prevents duplicate operations
- **OutboxEvent**: Reliable external communication

### Business Models
- **LoanLadder**: OCR-extracted income steps for loan eligibility
- **SavingsPlan**: Locked and flexible savings accounts
- **ManualReview**: Items requiring admin attention
- **Transfer**: Enhanced transfer tracking with reconciliation

## Security & Compliance

### Data Protection
- No PII in logs (structured logging with redaction)
- Secure image storage with S3 URLs in database
- Admin audit trail for all administrative actions

### Financial Controls
- Circuit breakers prevent cascading failures
- Auto-refund after 24h timeout
- Reconciliation monitoring and alerting

## Configuration

### Environment Variables
```
MONGODB_URI=mongodb://localhost:27017/prime-finance
REDIS_URL=redis://localhost:6379
FEATURE_LEDGER=true
POLL_INTERVAL_MS=30000
POLL_BATCH_SIZE=100
REFUND_TIMEOUT_MS=86400000
LOAN_AUTO_APPROVAL_MAX_KOBO=5000000
LOAN_PENALTY_PCT_PER_DAY=1
```

### Feature Flags
- `FEATURE_LEDGER`: Enable/disable ledger-first operations
- `FEATURE_AUTO_APPROVAL`: Enable/disable loan auto-approval
- `FEATURE_OCR`: Enable/disable OCR ladder extraction

## Migration Strategy

1. **Phase 1**: Deploy V2 alongside V1 (current)
2. **Phase 2**: Route percentage of traffic to V2 endpoints
3. **Phase 3**: Migrate remaining operations to V2
4. **Phase 4**: Deprecate V1 endpoints (future)

## Monitoring & Observability

### Metrics (Prometheus)
- `ledger_entries_created_total{category}`
- `pending_counts{service}`
- `poller_runs_total`
- `provider_errors_total`
- `manual_reviews_open_total`

### Logging
- Structured JSON logs with pino
- Request/trace ID correlation
- PII redaction for compliance

## Operational Procedures

### Daily Operations
1. Monitor reconciliation inconsistencies
2. Review manual review queue
3. Check poller health and error rates
4. Validate profit calculations

### Incident Response
1. Check ledger consistency first
2. Use admin requery tools for missing credits
3. Review outbox events for failed external calls
4. Apply manual adjustments through ledger entries