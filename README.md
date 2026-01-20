# Prime Finance Backend V2

A comprehensive financial services backend with clean architecture, ledger-first design, and robust reconciliation capabilities.

## Features

### V2 Architecture (New)
- **Ledger-First Design**: Every financial operation creates corresponding ledger entries
- **OCR Loan Ladder**: Extract income steps from calculator images for loan eligibility
- **Auto-Approval**: Loans up to ₦50,000 can be auto-approved based on eligibility
- **Polling & Reconciliation**: Automatic status checking and reconciliation for pending transactions
- **Savings Plans**: Locked and flexible savings with interest calculations and penalties
- **Admin Dashboard**: Comprehensive tools for manual reviews, profit reporting, and reconciliation
- **Idempotency**: Prevents duplicate operations with idempotency key enforcement
- **Circuit Breakers**: Prevents cascading failures with provider APIs
- **Rate Limiting**: Protects against abuse with configurable rate limits
- **Comprehensive Monitoring**: Prometheus metrics and health checks
- **API Documentation**: Complete Swagger/OpenAPI documentation

### V1 Features (Preserved)
- User registration and authentication
- Loan applications and management
- Bill payments and transfers
- Transaction history and notifications
- Admin user management

## Detailed Implementation Breakdown

### Modules
The system is modularized into specific business domains located in `src/modules`:

- **Admin**: Administrative controls, user management, and system oversight.
- **Bill Payments**: Handles utility bill payments (electricity, airtime, data) via provider integrations (e.g., Flutterwave).
- **Escrow**: Manages secure holding of funds for conditional transactions.
- **Ledger**: The core double-entry bookkeeping system. Records every financial movement with `DEBIT` and `CREDIT` entries to ensure zero-sum consistency.
- **Loans**: Manages the entire loan lifecycle:
    - Eligibility checks (including OCR income verification).
    - Application processing and approval workflows.
    - Disbursal and repayment tracking.
    - Interest calculation and penalty application.
- **Notifications**: System for sending emails, SMS, and push notifications to users.
- **Profits**: Tracks platform revenue (realized vs unrealized) from fees and interest.
- **Savings**: Manages user savings plans:
    - **Locked Savings**: Fixed-term deposits with higher interest.
    - **Flexible Savings**: Withdrawable savings with calculated interest.
    - Maturity handling and automated roll-overs.
- **Transfers**: Handles internal (user-to-user) and external (bank) money transfers with robust reconciliation.
- **Users**: User identity, authentication (JWT), profile management, and KYC verification.

### Workers & Background Jobs
Background processing is handled by dedicated workers in `src/workers` to ensure the main API remains responsive:

- **Bill Payments Poller** (`src/workers/pollers/billPaymentsPoller.ts`): 
    - Polls `PENDING` bill payments every 2 hours (configurable).
    - Verifies status with providers.
    - Automatically refunds users if the provider transaction failed or timed out.
- **Transfers Poller** (`src/workers/pollers/transfersPoller.ts`):
    - Monitors pending transfers.
    - Reconciles status with the banking provider.
    - Ensures ledger consistency upon completion or failure.
- **Loan Penalties Cron** (`src/workers/loans/penaltiesCron.ts`):
    - Runs daily (default: midnight).
    - Identifies overdue loans.
    - Applies late fees/penalties to the ledger and loan balance.
    - Triggers overdue notifications.
- **Savings Maturity Worker** (`src/workers/savings/maturitiesWorker.ts`):
    - Checks for savings plans that have reached their maturity date.
    - Calculates final interest.
    - Credits principal + interest to the user's wallet.
    - Closes or rolls over the plan.
- **Profits Cron** (`src/workers/profits/profitsCron.ts`):
    - Aggregates daily platform profits.
    - Generates reports for admin adjustments.

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Setup environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Build and start**
   ```bash
   npm run build
   npm start
   ```

4. **Start workers** (in separate terminals)
   ```bash
   npm run start:workers
   # Or individually:
   # node dist/workers/pollers/billPaymentsPoller.js
   # node dist/workers/pollers/transfersPoller.js
   # node dist/workers/loans/penaltiesCron.js
   # node dist/workers/savings/maturitiesWorker.js
   ```

5. **View API Documentation**
   ```
   http://localhost:3000/api-docs
   ```

## API Endpoint Overview

### V1 Endpoints (Existing)
- `POST /api/users/create-client` - User registration
- `POST /api/users/login` - Authentication
- `POST /api/loans/create-loan` - Loan application
- `POST /api/paybills/*` - Bill payment services
- `POST /api/users/transfer` - Money transfers

### V2 Endpoints (New)
- `POST /v2/bill-payments/initiate` - Initiate bill payment with ledger tracking
- `POST /v2/transfers` - Enhanced transfers with reconciliation
- `POST /v2/loans/request` - Loan request with OCR ladder extraction
- `POST /v2/savings/plans` - Create savings plans
- `GET /v2/admin/profits` - Profit reporting dashboard

### Admin Endpoints
- `GET /api/admin/users` - User management
- `GET /api/admin/loans` - Loan management
- `GET /api/admin/loans/stats` - Loan portfolio statistics
- `POST /api/admin/loans/disburse` - Disburse loans
- `GET /v2/admin/reconciliation/inconsistencies` - Ledger reconciliation

## Architecture

### Clean Architecture Layers
```
/src
  /app                 # Application layer (routes, middleware)
  /modules            # Business modules (loans, transfers, etc.)
    /{module}
      /domain         # Business logic
      /application    # Use cases
      /infrastructure # Data access
      /http          # Controllers
  /shared            # Shared utilities and services
  /workers           # Background job processors
  /tests             # Test suites
```

### Key Principles
- **Ledger-First**: All money movements create ledger entries
- **Idempotency**: Duplicate operations return cached responses
- **Polling**: Pending transactions are automatically reconciled
- **Circuit Breakers**: Provider failures are handled gracefully
- **Audit Trail**: Complete transaction history for compliance
- **Rate Limiting**: API protection against abuse
- **Comprehensive Testing**: Unit and integration tests

## Development

### Running in Development
```bash
npm run dev
```

### Building for Production
```bash
npm run build
```

### Running Tests
```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report
```

### Code Quality
```bash
npm run lint           # Check code style
npm run lint:fix       # Fix auto-fixable issues
```

### Database Migrations
New collections are created automatically. Existing data is preserved.

## Monitoring & Observability

### Health Checks
- Application: `GET /health`
- Ledger: `GET /v2/admin/reconciliation/inconsistencies`

### Metrics
Prometheus metrics available at `/metrics`:
- HTTP request metrics
- Business metrics (loans, transfers, etc.)
- System health metrics
- Custom application metrics

### Logging
Structured JSON logs with request correlation and PII redaction

## Security Features

### Authentication & Authorization
- JWT-based authentication
- Role-based access control (RBAC)
- Admin permission system
- Rate limiting on sensitive endpoints

### Data Protection
- Password encryption
- PII redaction in logs
- Secure API key management
- Input validation and sanitization

### Financial Security
- Idempotency key enforcement
- Double-entry bookkeeping
- Transaction reconciliation
- Audit trails

## Support

For technical support or questions about the V2 architecture, refer to:
- `docs/REFARCH.md` - Detailed architecture documentation
- `docs/RUNNING.md` - Operational procedures
- Admin dashboard at `/v2/admin/*` endpoints