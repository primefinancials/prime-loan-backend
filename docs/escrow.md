# Escrow & Marketplace System

## Overview
Secure P2P and Marketplace transactions where funds are held by the platform until delivery is confirmed. This system includes a 3-way Dispute Resolution Chat and dynamic status updates via WebSockets.

## 1. Escrow Creation & Funding

### P2P Escrow
1.  **Initiation**: Buyer creates an escrow.
    *   **Input**: Seller's Email, Amount, Description/Items.
    *   **Logic**:
        *   System checks if Seller Email exists.
        *   **If Exists**: Email sent to Seller to accept. Push Notification sent.
        *   **If New**: Email Invite sent to Seller to join platform and accept.
2.  **Funding (Immediate)**:
    *   Buyer is **deducted immediately** upon creation.
    *   Status: `PENDING`.
3.  **Seller Acceptance**:
    *   Seller views "Pending Escrow".
    *   **Action**: `Accept` or `Reject`.
    *   **If Accepted**: Status -> `LOCKED` (Funds moved to Escrow Pool).
    *   **If Rejected**: Status -> `CANCELLED`. Funds are **refunded** to Buyer.

### Marketplace Escrow
1.  **Initiation**: Buyer purchases product from Vendor.
    *   Funds **deducted immediately**.
    *   Status: `PENDING` (or auto-accepted if immediate stock confirmation logic exists, but default to PENDING for consistency).
2.  **Vendor Acceptance**:
    *   Vendor dashboard shows new order.
    *   **Action**: `Accept` (Confirm Stock) or `Reject`.
    *   **If Accepted**: Status -> `LOCKED`.
    *   **If Rejected**: Status -> `CANCELLED`. Refund Buyer.
    *   **Narration**: Transaction clearly marked as "Purchase from [VendorName]".

## 2. Core Workflow (LOCKED State)
1.  **Delivery**: Seller/Vendor delivers item/service.
2.  **Confirmation**:
    *   **Manual**: Buyer clicks "Confirm Delivery".
        *   Funds released to Seller/Vendor.
        *   Status: `COMPLETED`.
    *   **Auto-Resolution**:
        *   If Buyer is inactive for X days (e.g. 7 days) post-delivery claim (or just expiry), funds auto-release.
3.  **Dispute**:
    *   Buyer raises dispute. Status: `DISPUTED`.
    *   Chat Room created.

## 3. Dispute Resolution & Chat System
A dedicated 3-way chat system for resolving disputes.

*   **Parties**: Buyer, Seller, Admin.
*   **Technology**: WebSockets for live chat + REST for file uploads.
*   **Features**:
    *   **Live Messaging**: Real-time updates.
    *   **File Uploads**: PDF, JPG, PNG, Video evidence.
    *   **Notifications**:
        *   Push notification on new message.
        *   **Email Nudge**: If a user hasn't replied in 2-5 minutes, send an email digest/alert.
        *   **Tags**: Support `@user` tagging to specifically notify parties.
    *   **Access**:
        *   **Buyer/Seller**: Can chat when status is `LOCKED` or `DISPUTED`.
        *   **Admin**:
            *   **View**: Can view chat history at any time (Monitoring).
            *   **Chat**: Can ONLY send messages when status is `DISPUTED`.

## 4. Admin & Workers Management
*   **Worker Monitoring**:
    *   Admins need a live view of Worker health/status using WebSockets.
    *   Fix existing issues where workers are not reporting correctly.

## 5. Technical Requirements
*   **WebSockets**: Implement socket.io (or similar) for:
    *   Chat messages.
    *   Escrow Status updates (P2P invite accepted, etc).
    *   Worker Status live feed.
*   **File Uploads**: Implementation for Evidence (S3/Local).
*   **Notifications**:
    *   Email (SendGrid/Nodemailer).
    *   Push (Firebase/OneScope - *To Be Decided*).

## Schema Updates
```typescript
interface EscrowTransaction {
    // ... existing fields ...
    status: 'PENDING' | 'LOCKED' | 'COMPLETED' | 'DISPUTED' | 'REFUNDED' | 'CANCELLED';
    inviteEmail?: string; // If P2P and user didn't exist
    disputeChatId?: string; // Link to ChatRoom
    rejectionReason?: string;
}

interface ChatRoom {
    _id: string;
    escrowId: string;
    participants: string[]; // [BuyerId, SellerId, AdminId]
    status: 'OPEN' | 'RESOLVED';
}

interface ChatMessage {
    roomId: string;
    senderId: string;
    content: string;
    attachments: { type: 'image'|'pdf'|'video', url: string }[];
    readBy: string[];
    createdAt: Date;
}
```
