# User Management System

## Overview
The User module handles authentication, profile management, and aggregating financial data for the user dashboard.

## Security Features
- **Authentication**: JWT-based (Access + Refresh tokens).
- **Password Encryption**: Bcrypt/Scrypt/Argon2 (via `custom-password-utils`).
- **PIN**: 4-digit Transaction PIN for sensitive operations.
- **Permissions**: Role-based access control (Admin vs User).

## Logic Enhancements & Optimization

### 1. Stats Aggregation (`User.stats`)
To improve dashboard performance, financial totals are cached in the `User` document:
- `totalSavings`: Sum of active savings principals.
- `totalLoans`: Sum of outstanding loan balances.
- `activeLoanCount`: Number of active loans.
- `totalInterestEarned`: Cumulative interest gained.

**Strategy**:
- **Read**: `getUserFinancialSummary` checks `user.stats` first.
- **Write**: Background workers (or event listeners) update `user.stats` whenever a transaction (Loan/Savings) changes state. (Future Implementation: `UserStatsAggregator`).

### 2. Device Management (Planned)
- Track user devices to detect suspicious logins.
- Alert on "New Device Login".

### 3. Two-Factor Authentication (Planned)
- TOTP (Google Authenticator) for high-value transactions (> ₦50k).

## Schema
Active users have a `user_metadata` field containing profile info and the new `stats` object.

```typescript
user_metadata: {
  // ... profile fields
  stats: {
    totalSavings: number;
    totalLoans: number;
    totalInterestEarned: number;
    activeLoanCount: number;
  }
}
```
