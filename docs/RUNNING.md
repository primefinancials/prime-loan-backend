# Prime Loan V2 - Running Guide

## Prerequisites

- Node.js 18+
- MongoDB 4.4+
- Redis 6+
- TypeScript 4.5+

## Installation

```bash
npm install
npm run build
```

## Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
# Database
MONGODB_URI=mongodb://localhost:27017/prime-finance
REDIS_URL=redis://localhost:6379

# Server
PORT=3000
NODE_ENV=development

# Features
FEATURE_LEDGER=true
FEATURE_AUTO_APPROVAL=true
FEATURE_OCR=true

# Polling Configuration
POLL_INTERVAL_MS=30000
POLL_BATCH_SIZE=100
REFUND_TIMEOUT_MS=86400000

# Loan Configuration
LOAN_AUTO_APPROVAL_MAX_KOBO=5000000
LOAN_PENALTY_PCT_PER_DAY=1
AUTO_DEBIT_RETRY_SCHEDULE="3600000,21600000,86400000"

# Provider Configuration
CUSTOMER_KEY=your_vfd_key
CUSTOMER_SECRET=your_vfd_secret
BASE_URL=https://api.vfd.com
AUTH_URL=https://auth.vfd.com

# Storage
S3_BUCKET=prime-finance-images
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key

# Email
EMAIL_USERNAME=your_email
EMAIL_PASSWORD=your_password
```

## Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

## Running Workers

Each worker should be run as a separate process:

### Bill Payments Poller
```bash
node dist/workers/pollers/billPaymentsPoller.js
```

### Transfers Poller
```bash
node dist/workers/pollers/transfersPoller.js
```

### Loan Penalties Cron
```bash
node dist/workers/loans/penaltiesCron.js
```

### Savings Maturities Worker
```bash
node dist/workers/savings/maturitiesWorker.js
```

## API Endpoints

### V1 Endpoints (Existing)
- `POST /api/users/create-client` - User registration
- `POST /api/users/login` - User authentication
- `POST /api/loans/create-loan` - Loan application
- `POST /api/paybills/paybill` - Bill payments
- `POST /api/users/transfer` - Money transfers

### V2 Endpoints (New)
- `POST /v2/bill-payments/initiate` - Initiate bill payment
- `GET /v2/bill-payments/:id/status` - Check payment status
- `POST /v2/transfers` - Initiate transfer
- `GET /v2/transfers/:id/status` - Check transfer status
- `POST /v2/loans/request` - Request loan with OCR
- `POST /v2/loans/:id/repay` - Repay loan
- `POST /v2/savings/plans` - Create savings plan
- `POST /v2/savings/plans/:id/deposit` - Deposit to savings
- `POST /v2/savings/plans/:id/withdraw` - Withdraw from savings

### Admin Endpoints
- `GET /v2/admin/transactions/:traceId` - Transaction details
- `POST /v2/admin/transfers/:id/requery` - Requery transfer
- `GET /v2/admin/manual-reviews` - Manual review queue
- `GET /v2/admin/profits` - Profit reporting
- `GET /v2/admin/reconciliation/inconsistencies` - Find ledger issues

## Database Collections

### New V2 Collections
- `ledger_entries` - All financial transactions
- `idempotency_keys` - Duplicate operation prevention
- `outbox_events` - Reliable external communication
- `loan_ladders` - OCR-extracted income ladders
- `manual_reviews` - Items requiring admin review
- `savings_plans` - User savings accounts
- `savings_transactions` - Savings deposits/withdrawals
- `transfers_v2` - Enhanced transfer tracking
- `bill_payments` - Bill payment tracking

### Existing V1 Collections (Preserved)
- `users` - User accounts and authentication
- `loans` - Loan applications and status
- `transactions` - Transaction history
- `messages` - User notifications

## Monitoring

### Health Checks
- `GET /health` - Application health
- `GET /v2/admin/reconciliation/inconsistencies` - Ledger health

### Metrics (Prometheus)
Available at `/metrics`:
- `ledger_entries_created_total`
- `pending_counts`
- `poller_runs_total`
- `provider_errors_total`
- `manual_reviews_open_total`

### Logging
Structured JSON logs with:
- Request ID correlation
- Trace ID for transaction tracking
- PII redaction for compliance

## Troubleshooting

### Common Issues

1. **Ledger Inconsistencies**
   ```bash
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
        http://localhost:3000/v2/admin/reconciliation/inconsistencies
   ```

2. **Stuck Transfers**
   ```bash
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
        http://localhost:3000/v2/admin/transfers/$TRANSFER_ID/requery
   ```

3. **Manual Review Queue**
   ```bash
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
        http://localhost:3000/v2/admin/manual-reviews
   ```

### Worker Health
Check worker logs for:
- Connection errors
- Processing failures
- Circuit breaker states
- Timeout issues

### Database Maintenance
```bash
# Check ledger balance integrity
db.ledger_entries.aggregate([
  { $match: { status: "COMPLETED" } },
  { $group: { _id: "$traceId", debits: { $sum: { $cond: [{ $eq: ["$entryType", "DEBIT"] }, "$amount", 0] } }, credits: { $sum: { $cond: [{ $eq: ["$entryType", "CREDIT"] }, "$amount", 0] } } } },
  { $match: { $expr: { $ne: ["$debits", "$credits"] } } }
])
```

## Performance Tuning

### Database Indexes
Ensure these indexes exist:
```javascript
// Ledger entries
db.ledger_entries.createIndex({ "traceId": 1, "createdAt": -1 })
db.ledger_entries.createIndex({ "userId": 1, "category": 1, "createdAt": -1 })
db.ledger_entries.createIndex({ "status": 1, "category": 1, "createdAt": 1 })

// Idempotency
db.idempotency_keys.createIndex({ "key": 1 }, { unique: true })
db.idempotency_keys.createIndex({ "userId": 1 })

// Outbox
db.outbox_events.createIndex({ "processed": 1, "createdAt": 1 })
```

### Worker Scaling
- Run multiple poller instances with different batch sizes
- Use Redis clustering for high-throughput scenarios
- Monitor queue depths and processing times

## Security Considerations

### API Security
- All endpoints require authentication
- Admin endpoints require admin role
- Idempotency keys prevent replay attacks

### Data Security
- Images stored in S3 with private ACLs
- PII redacted from logs
- Audit trail for all admin actions

### Financial Security
- Circuit breakers prevent cascading failures
- Auto-refund mechanisms for stuck transactions
- Reconciliation monitoring and alerting