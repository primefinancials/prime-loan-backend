# Loan System

## Overview
The Loan System is designed to be **Data-Driven** rather than purely Credit-Score based. It prioritizes the safety of funds (via collateral) while still offering opportunities for users to build credit.

## Eligibility Logic

### 1. Collateral-First Approach
- **Rule**: If `Total Savings > 50% of Requested Loan`, the loan is **Approved** (regardless of Credit Score).
- **Rationale**: The user has sufficient "Skin in the game".
- **Safety**: In case of default, the lien on savings can be exercised.

### 2. Credit Score Fallback
- If collateral is insufficient, the system checks the `Credit Score` (derived from repayment history, platform activity, etc.).
- **Min Score**: Configurable (default 0.4 / 400).
- **Blacklists**: Users with active defaults or fraud flags are rejected immediately.

### 3. Ladder System
- Users progress through "Steps" (Levels) by successfully repaying loans.
- **Level 1**: Max ₦10,000
- **Level 2**: Max ₦50,000
- ...
- **Level N**: Max ₦1,000,000
- **Constraint**: Users cannot request > Max Amount for their current Level, even with collateral.

## Repayment
- **Waterfall**:
    1.  **Wallet Deduction** (Auto-debit on due date).
    2.  **Card Charge** (Tokenized card).
    3.  **Collateral Liquidation** (If overdue > Grace Period).
    4.  **Guarantor Deduction** (If applicable).

## Schema
```typescript
interface Loan {
    userId: string;
    amount: number;
    ladderLevelAtCreation: number;
    status: 'pending' | 'active' | 'completed' | 'defaulted';
    loan_date: Date;
    due_date: Date;
    collateral: {
        savingsPlanId?: string; // If specific plan locked
        amountLocked: number;
    }
}
```
