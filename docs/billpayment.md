# Bill Payment System

## Overview
The Bill Payment module integrates with **Flutterwave** to provide Airtime, Data, TV, Power, and Internet services. It follows a "Ledger-First" approach, ensuring funds are reserved before contacting the provider.

## Architecture
1.  **Direct Request**: User initiates payment -> Internal Transfer (Pending) -> Provider API Call.
2.  **Poller**: `BillPaymentsPoller` checks status of pending transactions periodically.

## Optimization & Robustness

### 1. Polling Logic for "Hanging" Transactions
- **Success Handling**: If Provider = `SUCCESS` but Internal = `PENDING`, the poller **completes** the transaction (No refund).
- **Failure Handling**: If Provider = `FAILED`, the poller initiates an auto-refund.
- **Stale Transactions**: If a payment remains `PENDING` for > 24 hours (Stuck), it is moved to `MANUAL_REVIEW` to prevent "Double Spend" or "Free Service" fraud (getting service later + refund now).

### 2. Caching Strategy
To reduce latency and API rate limits, static data is cached in-memory (NodeCache) for **24 hours**:
- `getSupportedCategories`: List of bill types (Airtime, Power, etc).
- `getBillersByCategory`: List of providers (MTN, DSTV, Ikeja Electric).
- `getBillItems`: List of plans/packages.

### 3. Service Types
- **Airtime**: Direct top-up.
- **Data**: Requires `item_code` (Plan ID).
- **Power**: Requires `customerReference` (Meter No) + `meterType` (Prepaid/Postpaid).
- **TV**: Requires `customerReference` (Smartcard) + `item_code` (Bouquet).

## Error Handling
- **Idempotency**: All requests use `idempotencyKey` mapped to `tx_ref`.
- **Downtime Checks**: (Planned) System can flag billers as "Down" based on recent failure rates.
