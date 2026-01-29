# Savings System

## Overview
The Savings module allows users to save funds securely with interest-bearing accounts.

## Plan Types

### 1. Fixed (Locked) Savings
- **Strict Lock**: Funds cannot be withdrawn until `maturityDate`.
- **Higher Interest**: Earns the "Fixed" rate (e.g., 15% p.a.).
- **Penalty**: Early withdrawal (if permitted by admin override) attracts a **penalty** (e.g., 20% of interest or 5% of principal).
- **Minimum Duration**: Enforced by system settings (e.g., 30 days).

### 2. Flexible Savings
- **No Lock**: Funds can be withdrawn at any time without penalty.
- **Lower Interest**: Earns the "Flexible" rate (e.g., 10% p.a.).
- **Frequency**: Interest is calculated daily/monthly but compounded at maturity or payout.

## Features

### Auto-Save
- **Recurring Debits**: Users can set daily/weekly/monthly auto-debits.
- **Retry Logic**: If a debit fails (e.g., insufficient funds), the system enters a **Retry Mode**:
    - Retries once every 24 hours.
    - Max retries: Configurable (default 3).
    - After max retries: Skips that interval and waits for the next cycle.

### Rollover
- **Auto-Renew**: At maturity, plans can automatically renew (Principal + Interest or Principal only).

### Top-up
- **Manual Additions**: Users can add funds to any **ACTIVE** savings plan.
- **Effect**: Increases the principal amount immediately.
- **Ledger**: Debits user wallet and credits savings pool.

## Calculation
- **Simple Interest Formula**: `Principal * Rate * (Days / 365)`.
- **Penalty Formula**: `PenaltyRate * AmountWithdrawn`.

## Schema
```typescript
interface SavingsPlan {
    planType: 'LOCKED' | 'FLEXIBLE';
    principal: number;
    interestRate: number; // Stored as annualized rate at creation time
    maturityDate?: Date;
    meta: {
        penaltyRate: number;
        autoSaveConfig?: {
            enabled: boolean;
            amount: number;
            retryCount: number;
        }
    }
}
```
