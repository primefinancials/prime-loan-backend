# API Documentation

Base URL: `/api`
Authentication: Bearer Token required for most endpoints (`Authorization: Bearer <token>`).

## Marketplace

### Vendor Application

#### Apply to become a Vendor
**POST** `/marketplace/vendor/apply`

**Request Body:**
```json
{
  "businessName": "Tech Haven",
  "description": "Premium electronics seller",
  "address": "123 Tech Street, Lagos"
}
```

**Response (201 Created):**
```json
{
  "status": "success",
  "message": "Vendor application submitted successfully",
  "data": {
    "userId": "60d5ec...",
    "businessName": "Tech Haven",
    "status": "PENDING",
    "_id": "60d5ed...",
    "createdAt": "2023-10-27T10:00:00Z"
  }
}
```

#### Get My Vendor Profile
**GET** `/marketplace/vendor/me`

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "businessName": "Tech Haven",
    "status": "APPROVED",
    "avgRating": 4.5,
    "reviewCount": 10,
    "createdAt": "..."
  }
}
```

### Products (Vendor)

#### Create Product
**POST** `/marketplace/products`

**Request Body:**
```json
{
  "name": "iPhone 15 Pro",
  "description": "Latest Apple flagship",
  "price": 1500000,
  "stock": 50,
  "category": "Electronics",
  "images": ["url1", "url2"]
}
```

**Response (201 Created):**
```json
{
  "status": "success",
  "message": "Product created successfully",
  "data": {
    "vendorId": "...",
    "name": "iPhone 15 Pro",
    "_id": "...",
    "slug": "iphone-15-pro"
  }
}
```

#### Update Product
**PUT** `/marketplace/products/:id`

**Request Body:**
```json
{
  "price": 1450000,
  "stock": 45
}
```

#### Delete Product
**DELETE** `/marketplace/products/:id`

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Product deleted successfully"
}
```

### Public Marketplace

#### List Products
**GET** `/marketplace/products`
Query Params: `?search=iphone&category=Electronics&minPrice=1000&maxPrice=5000000&page=1&limit=20`

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "data": [
      {
        "name": "iPhone 13",
        "price": 800000,
        "vendorId": "...",
        "vendor": { "businessName": "Tech Haven", "avgRating": 4.5 }
      }
    ],
    "total": 100,
    "page": 1,
    "pages": 5
  }
}
```

#### Get Product Details
**GET** `/marketplace/products/:id`

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "_id": "...",
    "name": "iPhone 13",
    "description": "...",
    "vendor": { ... }
  }
}
```

### Reviews

#### Add Review
**POST** `/marketplace/reviews`

**Request Body:**
```json
{
  "vendorId": "651a...",
  "productId": "651b...",  // Optional
  "rating": 5,
  "comment": "Fast delivery and great item!"
}
```

**Response (201 Created):**
```json
{
  "status": "success",
  "data": {
    "userId": "...",
    "vendorId": "...",
    "rating": 5,
    "comment": "Fast delivery...",
    "_id": "..."
  }
}
```

#### Get Vendor Reviews
**GET** `/marketplace/vendors/:id/reviews?page=1&limit=20`

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "data": [
      {
        "rating": 5,
        "comment": "Great!",
        "userId": "..."
      }
    ],
    "total": 5
  }
}
```

---

## Escrow

### Transaction Management

#### Create P2P Escrow
**POST** `/escrow/p2p`

**Request Body:**
```json
{
  "sellerEmail": "seller@example.com",
  "amount": 50000,
  "description": "Web Design Services",
  "expiryDays": 7 
}
```

**Response (201 Created):**
```json
{
  "status": "success",
  "data": {
    "transactionId": "TRX-12345",
    "amount": 50000,
    "fee": 500,
    "totalAmount": 50500,
    "status": "PENDING",
    "_id": "..."
  }
}
```

#### Create Marketplace Order
**POST** `/escrow/marketplace`

**Request Body:**
```json
{
  "items": [
    { "productId": "...", "quantity": 1, "price": 150000 }
  ],
  "description": "Order #1234"
}
```

#### Fund Escrow
**POST** `/escrow/:id/fund`
*Action: Moves funds from Buyer Wallet to Escrow Pool. Status PENDING -> LOCKED.*

**Response (200 OK):**
```json
{
  "status": "success",
  "data": { "status": "LOCKED", ... }
}
```

#### Confirm Delivery
**POST** `/escrow/:id/confirm`
*Action: Releases funds to Seller. Status LOCKED -> COMPLETED.*

#### Raise Dispute
**POST** `/escrow/:id/dispute`

**Request Body:**
```json
{
  "reason": "Item not received"
}
```

### Admin Operations

#### Resolve Dispute
**POST** `/escrow/:id/resolve` (Admin)

**Request Body:**
```json
{
  "decision": "refund_buyer", // or "pay_seller"
  "note": "Tracking number invalid"
}
```

#### Admin List Escrows
**GET** `/admin/escrows`
Query Params: `?vendorId=...&status=DISPUTED&page=1`

---

## Admin Marketplace

#### List Vendors
**GET** `/admin/marketplace/vendors?status=PENDING`

#### Approve Vendor
**POST** `/admin/marketplace/vendors/:id/approve`

#### Reject Vendor
**POST** `/admin/marketplace/vendors/:id/reject`
**Request Body:** `{"reason": "Invalid documents"}`


---

## Core Banking & User

### Authentication

#### Create Client / Register
**POST** `/users/create-client`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePass123",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "08012345678",
  "bvn": "12345678901",
  "pin": "1234"
}
```

**Response (201 Created):**
```json
{
  "status": "success",
  "message": "Client created successfully",
  "data": { "token": "jwt...", "user": { ... } }
}
```

#### Login
**POST** `/users/login`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePass123"
}
```

### Transfers

#### Initiate Transfer
**POST** `/transfers/initiate`

**Request Body:**
```json
{
  "amount": 5000,
  "beneficiaryBankCode": "000013", // Bank Code (Get from /banks)
  "beneficiaryAccountNumber": "0123456789",
  "beneficiaryName": "Jane Doe",
  "narration": "Lunch money",
  "pin": "1234"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Transfer initiated",
  "data": { "reference": "...", "status": "PENDING" }
}
```

#### Get Banks
**GET** `/banks`

**Response:**
```json
{
  "status": "success",
  "data": [
    { "name": "GTBank", "code": "058" },
    { "name": "Access Bank", "code": "044" }
  ]
}
```

### Loans

#### Request Loan
**POST** `/loans/request`

**Request Body:**
```json
{
  "amount": 100000,
  "tenure": 30, // days
  "reason": "Business expansion"
}
```

#### Repay Loan
**POST** `/loans/:id/repay`

**Request Body:**
```json
{
  "amount": 102000 // Full or partial amount
}
```

### Savings

#### Create Savings Plan
**POST** `/savings/create`

**Request Body:**
```json
{
  "name": "Car Fund",
  "amount": 500000,
  "type": "fixed", // or "target"
  "duration": 6, // months
  "autoSave": true,
  "frequency": "monthly" // for target savings
}
```

#### Withdraw Savings
**POST** `/savings/:id/withdraw`

**Request Body:**
```json
{
  "amount": 50000 // Optional if closing full plan
}
```

---

## Admin Core

### User Management

#### List Users
**GET** `/admin/users?page=1&limit=50`

#### Monitor Workers
**GET** `/admin/workers`

**Response:**
```json
{
  "status": "success",
  "data": [
    { "workerName": "billPaymentsPoller", "status": "running", "lastRun": "..." },
    { "workerName": "transfersPoller", "status": "stopped", "lastRun": "..." }
  ]
}
```

#### Control Worker
**POST** `/admin/workers/:name/stop`
**POST** `/admin/workers/:name/start`
**POST** `/admin/workers/:name/restart`

