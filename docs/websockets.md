# WebSocket & Real-Time Events

## Overview
We will use `socket.io` to handle real-time communication for:
1.  **Dispute Chat**: Instant messaging between Buyer, Seller, and Admin.
2.  **Escrow Updates**: Status changes (e.g. Seller accepts Request).
3.  **Worker Monitoring**: Admin live view of background worker health.

## Events Configuration

### Namespaces
*   `/chat`: For dispute resolution rooms.
*   `/admin`: For worker stats and system alerts.
*   `/notifications`: General user notifications.

### Chat Events (`/chat`)
*   `join_room`: Client joins specific `escrow_id` room.
*   `new_message`: Client sends message.
    *   Payload: `{ content: string, attachments: [] }`
*   `message_received`: Server broadcasts message to room.
*   `typing`: User typing indicator.

### Worker Events (`/admin`)
*   `worker_status`: Broadcasts `{ workerName: string, status: 'running'|'error'|'stopped', lastActivity: Date }`.

## Authentication
*   Socket connection must be authenticated using the standard JWT token passed in the handshake auth object.

## Fallback
*   If user is offline, messages are stored in DB.
*   "Smart Notification": If message unread for >2 mins, trigger Email/Push.
