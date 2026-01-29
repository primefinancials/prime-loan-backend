# Marketplace Module

## Overview
A platform for Vendors to sell products/services to Users, secured by Escrow.

## Features

### 1. Vendor Management
- **Application**: Users apply to become vendors with business details.
- **Approval**: Admins review and approve/reject applications.
- **Profile**: Vendors have a public profile with ratings and reviews.

### 2. Product Listings
- **CRUD**: Vendors manage their inventory directly.
- **Search**: Users scan products via `Fuzzy Search` (Name/Description) and Filters (Category, Price Range, Vendor).
- **Sort**:
  - `relevance`: Default if search term provided.
  - `newest`: Default if no search term.
  - `price_asc`: Low to High.
  - `price_desc`: High to Low.

### 3. Orders (Escrow Integration)
- Purchases automatically create an **Escrow Transaction**.
- **No Direct Payment**: Funds are always routed to the Escrow Pool first.
- **Fulfillment**: Vendor marks "Shipped" -> Buyer marks "Received" (or Auto-confirmation) -> Funds Released.

## Schema
```typescript
interface Product {
    vendorId: string; // Link to Vendor Profile
    name: string;
    description: string;
    price: number;
    category: string;
    images: string[];
    stock: number;
    status: 'active' | 'out_of_stock' | 'draft';
}

interface Vendor {
    userId: string;
    businessName: string;
    status: 'pending' | 'approved' | 'rejected';
    avgRating: number;
    reviewCount: number;
}
```
