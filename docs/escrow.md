# Escrow & Marketplace System

## Overview
Secure P2P and Marketplace transactions where funds are held by the platform until delivery is confirmed.

## Workflow

1.  **Creation**: Buyer initiates a transaction. Status: `PENDING`.
2.  **Funding**: Buyer tracks funds to the "Escrow Pool". Status: `LOCKED`.
3.  **Delivery**: Seller delivers item/service.
4.  **Confirmation**:
    - **Manual**: Buyer clicks "Confirm Delivery". Funds released to Seller.
    - **Auto-Resolution** (New): If Buyer is inactive for X days (e.g. 7 days) and no dispute raised, funds auto-release to Seller.
5.  **Dispute**:
    - Buyer raises dispute. Status: `DISPUTED`.
    - Admin intervenes to Refund Buyer or Pay Seller.

## Fees
- Platform charges a fee (e.g. 1.5% or Flat Fee) on transactions.
- Fee is calculated on creation but **Realized** (booked to Revenue) only upon successful completion (Payout).

## Schema
```typescript
interface EscrowTransaction {
    transactionId: string;
    type: 'p2p' | 'marketplace';
    buyerId: string;
    sellerId: string;
    amount: number;
    fee: number;
    totalAmount: number;
    status: 'PENDING' | 'LOCKED' | 'COMPLETED' | 'DISPUTED' | 'REFUNDED' | 'CANCELLED';
    expiryDate: Date; // For auto-resolution
    disputeReason?: string;
    resolutionNote?: string;
}
```
