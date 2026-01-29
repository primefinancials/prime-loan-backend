# System Settings Configuration

## Overview
This document defines the dynamic configuration parameters managed via the **Admin Settings**. The system allows admins to tweak financial parameters (Interest rates, penalties, limits) without redeploying code.

## 1. Savings Configuration

### 1.1 Fixed Savings (`savings.fixed`)
Savings plans where funds are locked for a specific duration.
| Parameter | Default | Description |
| :--- | :--- | :--- |
| `minDuration` | `30 days` | Minimum lock-in period for Fixed Savings to earn interest. |
| `interestRate` | `10%` | Annual Interest Rate for Fixed Savings (if duration met). |
| `penaltyRate` | `5%` | Percentage of Principal deducted for premature withdrawal. |

### 1.2 Flexible (Target) Savings (`savings.flexible`)
Savings plans that are accessible anytime.
| Parameter | Default | Description |
| :--- | :--- | :--- |
| `interestRate` | `0%` | Interest Rate for Flexible/Target Savings. |

### 1.3 Auto-Save (`savings.autoSave`)
Smart retry logic for failed auto-debits.
| Parameter | Default | Description |
| :--- | :--- | :--- |
| `retryEnabled` | `true` | If true, system attempts to retry failed auto-saves when wallet is funded. |
| `maxRetries` | `3` | Limit on retry attempts per cycle. |

## 2. Loan Configuration

### 2.1 Collateralized Loans (`loan.collateral`)
Loans backed by User Savings.
| Parameter | Default | Description |
| :--- | :--- | :--- |
| `percentage` | `50%` | Percentage of active Savings balance a user can borrow. |

### 2.2 Ladder Loans (`loan.ladder`)
Unsecured loans based on credit ladder/history.
| Parameter | Default | Description |
| :--- | :--- | :--- |
| `levels` | `[]` | List of Ladder Levels defining `minScore`, `maxAmount`, `interestRate`, `duration`. |
| `defaultInterest`| `5%` | Fallback interest rate. |

### 2.3 Penalties (`loan.penalty`)
| Parameter | Default | Description |
| :--- | :--- | :--- |
| `dailyRate` | `10%` | Daily penalty rate for overdue loans (Applied to Principal). |
| `gracePeriod` | `1 day` | Days after due date before penalty logic kicks in. |

## 3. System Configuration (`system`)
| Parameter | Default | Description |
| :--- | :--- | :--- |
| `currency` | `NGN` | Base currency (Default: NGN). |
| `maintenanceMode`| `false` | If true, disables user-facing writes (applications, transfers). |

## 4. Feature Toggles
Simple boolean flags to enable/disable entire modules.
- `loanEnabled`: Enable/Disable Loan features.
- `savingsEnabled`: Enable/Disable Savings features.
- `transferEnabled`: Enable/Disable Transfers.
- `billPaymentEnabled`: Enable/Disable Bill Payments.
