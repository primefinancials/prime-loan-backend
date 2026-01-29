# Profit & Settings

## Overview
Manages system-wide configuration and profit realization logic.

## Profit Realization
Profits (Fees, Interest) are initially credited to a generic `platform_revenue` account.
To ensure financial health, a **Profit Distribution** process runs (periodically or event-based) to allocate funds to specific sub-ledgers.

### Distribution Logic (Default)
- **70% Operational**: For OPEX (Salaries, Servers, etc.). Account: `revenue_operational`.
- **20% Reserve**: Retained Earnings for growth. Account: `revenue_reserve`.
- **10% Risk Fund**: Provision for bad debt / insurance. Account: `revenue_risk_fund`.

## Settings Structure
Settings are stored in a singleton document in MongoDB.

```typescript
interface Settings {
    savings: {
        fixed: { interestRate: number; minDuration: number; ... };
        flexible: { interestRate: number; ... };
        autoSave: { retryEnabled: true; ... };
    };
    loan: {
        collateral: { percentage: number; ... }; // e.g., 50%
        ladder: { ... };
    };
    system: {
        maintenanceMode: boolean;
        currency: string;
    };
    profitRange: [
        { category: 'transfer', minAmount: 0, maxAmount: 5000, fee: 10, type: 'flat' },
        { category: 'loan', ... }
    ]
}
```
