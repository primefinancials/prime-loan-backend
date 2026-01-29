# Transfers & Ledger System

## Overview
The system processes Intra-bank (Internal) and Inter-bank (External) transfers using a double-entry ledger system.

## Core Features
1.  **Double Entry**: Every transaction has a Credit and Debit leg.
2.  **Immutability**: `COMPLETED` transactions cannot be edited. Corrections require "Contra-Entries".
3.  **Name Enquiry**:
    - **Enforcement**: Mandatory for all Inter-bank transfers to prevent user error.
    - **Endpoint**: `GET /transfers/name-enquiry` resolves beneficiary details.
    - **Validation**: Backend re-verifies details during transfer initiation.

## Optimization Strategy

### 1. Transfer Polling & Resilience
- **Status Handling**:
    - **Success** at Provider + **Pending** Internally → Auto-Complete (No Refund).
    - **Failed** at Provider → Auto-Refund.
- **Timeouts**:
    - Transactions stuck in `PENDING` for > 24 hours are moved to `MANUAL_REVIEW` to allow support team investigation (Prevents fraud).

### 2. Reconciliation
- **Trace IDs**: Every leg of a transaction shares a unique `traceId`.
- **Worker**: `ReconciliationPoller` (Planned) scans for traceIds where `Sum(Credits) != Sum(Debits)`.

### 3. Bank List Caching
- VFD bank list is cached in-memory/Redis to speed up the "Select Bank" UI flow.

## Ledger Schema
```typescript
interface LedgerEntry {
    traceId: string;
    userId: string;
    entryType: 'CREDIT' | 'DEBIT';
    amount: number;
    account: string; // e.g., 'user_wallet:123' or 'platform_revenue'
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
}
```
