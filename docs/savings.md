# Savings System

## Overview
The Savings module allows users to save funds securely with interest-bearing accounts. Both plan types are **locked** and attract penalties for early withdrawal.

## Plan Types

### 1. Fixed (Locked) Savings
- **One-Time Deposit**: Target amount is deducted once at creation.
- **No Contributions**: No recurring deposits after initial funding.
- **Duration**: Specified in **months** (minimum 3 months to earn interest).
- **Higher Interest**: Earns the "Fixed" rate (e.g., 15% p.a.).
- **Penalty**: Early withdrawal attracts a **penalty** (e.g., 5% of principal).
- **Delayed Withdrawal**: Admin can configure a delay (e.g., 2 days) for early withdrawals.
- **No AutoSave**: Fixed plans do not support auto-save.

### 2. Flexible Savings
- **No Initial Deposit**: Plan is created without upfront funding.
- **Recurring Contributions**: System deducts a specified amount on specified days:
    - **Weekly**: Every specified day (e.g., Friday = dayOfWeek 5).
    - **Monthly**: Every specified date (e.g., 25th = dayOfMonth 25).
- **Retry Logic**: If wallet is empty on deduction day, deduction remains pending and is attempted when funds are available.
- **Locked**: Penalty applies on early withdrawal.
- **No Interest**: Earns no inter.
- **Maturity Date**: User specifies an end date.

## Withdrawal Rules
- **Both Plan Types**: Penalty applies if withdrawn before maturity.
- **Fixed Plans (Early)**: User **MUST withdraw the entire principal**. Partial withdrawals are not allowed.
- **Flexible Plans (Early)**: User can withdraw any amount up to balance; penalty is calculated on withdrawn amount.
- **Delete Plan**: Plans with 0 balance can be deleted by the user.

## Settings (Admin Configurable)
| Setting | Fixed | Flexible |
|---------|-------|----------|
| `minDurationMonths` | ✓ (default: 3) | N/A |
| `interestRate` | ✓ | ✓ |
| `penaltyRate` | ✓ | ✓ |
| `locked` | Always true | ✓ (default: true) |
| `earlyWithdrawal.type` | ✓ (immediate/delayed) | Always immediate |
| `earlyWithdrawal.delayDays` | ✓ | N/A |

## Schema
```typescript
interface SavingsPlan {
    planType: 'LOCKED' | 'FLEXIBLE';
    principal: number;
    interestRate: number;
    durationMonths?: number; // Fixed only
    maturityDate?: Date;
    contribution?: {
        frequency: 'weekly' | 'monthly';
        amount: number;
        dayOfWeek?: number; // 0-6 for weekly
        dayOfMonth?: number; // 1-31 for monthly
        pendingDeduction: boolean;
        lastDeductionDate?: Date;
    };
    meta: {
        penaltyRate: number;
    }
}
```

## Workers
- **ContributionWorker**: Runs daily at 6 AM. Marks pending deductions and attempts withdrawal when funds available.
- **EarlyWithdrawalWorker**: Processes scheduled fixed plan early withdrawals after delay period.
- **MaturitiesWorker**: Processes matured plans and disburses funds + interest.
