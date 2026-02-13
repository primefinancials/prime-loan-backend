# API Documentation

## Overview
**Base URL:** `/api` (User) | `/backoffice` (Admin)
**Authentication:** Bearer Token via `Authorization` header.

---
## User Routes (`/api`)

### Authentication & Profile

#### Register Client
`POST /users/create-client`
**Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "08012345678",
  "bvn": "1234567890",
  "pin": "1234",
  "dob": "MM/DD/YYYY"
}
```

#### Login
`POST /users/login`
**Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword"
}
```

#### Get Profile
`GET /users/profile`

#### Update User
`PUT /users/update`
**Body:**
```json
{
  "user": {
    "first_name": "John",
    "surname": "Doe",
    "phone": "080...",
    "address": "..."
  }
}
```

#### Change Password
`POST /users/change-password`
**Body:** `{"oldPassword": "...", "newPassword": "..."}`

#### Financial Summary
`GET /users/financial-summary`

---
### Transfers

#### Initiate Transfer
`POST /transfers/initiate`
**Body:**
```json
{
  "amount": 5000,
  "beneficiaryBankCode": "000...",
  "beneficiaryAccountNumber": "0123456789",
  "beneficiaryName": "Jane Doe",
  "narration": "Payment",
  "pin": "1234"
}
```

#### Get Transfer Status
`GET /transfers/status?reference=...`

#### Get Single Transfer
`GET /transfers/:id`

#### List Transfers
`GET /transfers?page=1&limit=20`

#### Get Banks
`GET /banks`

#### Account Lookup
`GET /account-info` (Self)
`GET /beneficiary-account-info` (Resolve external account)

---
### Bill Payments

#### Initiate Payment
`POST /bills/initiate`
**Body:** `{"amount": 100, "billerCode": "...", "itemCode": "...", "pin": "..."}`

#### Get Categories
`GET /bills/categories`

#### Get Billers
`GET /bills/billers/:categoryCode`

#### Get Bill Items
`GET /bills/items/:billerCode`

#### Validate Customer
`POST /bills/validate`

#### History
`GET /bills/user-payments`
`GET /bills/all`

---
### Loans

#### Request Loan
`POST /loans/request`
**Body:** `{"amount": 50000, "tenure": 30, "reason": "Business"}`

#### Repay Loan
`POST /loans/:id/repay`
**Body:** `{"amount": 50000}`

#### Cancel Loan
`POST /loans/:id/cancel`

#### Loan Status
`GET /loans/:id/status`

#### List My Loans
`GET /loans`

#### Loan Ladder
`GET /ladder`
`GET /ladder/:id`

---
### Savings

#### Create Fixed Plan
`POST /savings/create`
**Body:**
```json
{
    "planName": "Car Savings",
    "planType": "LOCKED",
    "targetAmount": 100000,
    "durationMonths": 6
}
```
**Response:** Plan object with `planId`, `maturityDate`, `interestRate`.

#### Create Flexible Plan
`POST /savings/create`
**Body:**
```json
{
    "planName": "Emergency Fund",
    "planType": "FLEXIBLE",
    "maturityDate": "2026-12-31",
    "contribution": {
        "frequency": "weekly",
        "amount": 5000,
        "dayOfWeek": 5
    }
}
```
**Response:** Plan object with `planId`, `contribution` config.

#### Withdraw
`POST /savings/:id/withdraw`
**Body:** `{"amount": 5000}`
**Response:** Success object or `{ "status": "scheduled", "message": "...", "earlyWithdrawalDate": "..." }` if a delay is enforced for fixed plans.

#### List Plans
`GET /savings`

#### Get Savings Configuration
`GET /savings/config`
**Response:** `{"fixed": {...}, "flexible": {...}, "autoSave": {...}}`

#### Delete Plan
`DELETE /savings/:id`
- **Condition**: Plan balance must be 0.
- **Response**: `{"status": "success", "message": "Plan deleted successfully"}`

---
### Escrow & Marketplace

#### Create P2P Escrow
`POST /escrow/p2p`
**Body:**
```json
{
    "sellerEmail": "seller@test.com",
    "amount": 5000,
    "description": "Item purchase",
    "expiryDays": 7,
    "type": "p2p"
}
```

#### Create Marketplace Order
`POST /escrow/marketplace`
**Body:**
```json
{
    "items": [{ "productId": "...", "quantity": 1 }],
    "description": "Order #1",
    "type": "marketplace"
}
```

#### Fund Escrow (Buyer)
`POST /escrow/:id/fund`

#### Confirm Delivery (Buyer)
`POST /escrow/:id/confirm`

#### Raise Dispute
`POST /escrow/:id/dispute`
**Body:** `{"reason": "Item broken"}`

#### List My Escrows
`GET /escrow`

---
### Chat System

#### Send Message
`POST /chat/:escrowId/message`
**Body:**
```json
{
    "content": "Hello",
    "attachments": []
}
```
*   **Note**: Admins can only send messages if status is `DISPUTED`.

#### Get Chat History
`GET /chat/:escrowId/history`

#### Upload Attachment
`POST /chat/upload`
**Body:** `multipart/form-data` with `file`.

---
### Marketplace (Vendor & Public)

#### Apply as Vendor
`POST /marketplace/vendor/apply`
**Body:** `{"businessName": "...", "description": "...", "address": "...", "contactEmail": "...", "contactPhone": "..."}`

#### My Vendor Profile
`GET /marketplace/vendor/me`

#### Update Vendor Profile
`PUT /marketplace/vendors/:id`
**Body:** `{"businessName": "...", "businessDescription": "...", "contactPhone": "..."}`

#### Public Product List
`GET /marketplace/products`
Query: `?page=1&limit=20&search=...&category=...`

#### Get Product
`GET /marketplace/products/:id`

#### Vendor: Create Product
`POST /marketplace/products`
**Body:** `{"name": "...", "price": 1000, "stock": 10, "description": "...", "category": "..."}`

#### Vendor: Update Product
`PUT /marketplace/products/:id`

#### Vendor: Get My Escrows
`GET /marketplace/vendors/:id/escrows`

#### Vendor: Reviews
`GET /marketplace/vendors/:id/reviews`

---
## Admin Routes (`/backoffice`)

### Admin Management
`POST /login`
`POST /create` (Super Admin)
`POST /activate` (Super Admin)
`GET /admins`
`GET /:adminId`
`PUT /:adminId/permissions`

### User Management
`GET /users?page=1&limit=20`
`POST /users/activate`

### Loan Management
`GET /loans`
`POST /loans/disburse`
`POST /loans/:id/reject`
`POST /loans/bulk-action`

### Savings Management
`GET /savings`
`GET /savings/stats`

### Transactions & Reconciliation
`GET /transactions`
`GET /transactions/flagged`
`GET /reconciliation/inconsistencies`
`POST /transfers/:id/requery`

### Marketplace Admin
`GET /marketplace/vendors?status=PENDING`
`POST /marketplace/vendors/:id/approve`
`POST /marketplace/vendors/:id/reject`
`GET /escrows` (Admin view of marketplace escrows)
`POST /escrow/:id/resolve` (Dispute resolution)

### Chat Management
`GET /chat/:escrowId/history`
`POST /chat/:escrowId/message`
`POST /chat/upload`

### Worker Management
`GET /workers`
`POST /workers/:name/start`
`POST /workers/:name/stop`
`POST /workers/:name/restart`

### Reports & Profits
`GET /dashboard`
`GET /system/health`
`GET /business-report`
`GET /profits`
`PATCH /profits/:reference/realize`

