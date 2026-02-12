# WebSocket & Real-Time Events

## Overview
We use `socket.io` to handle real-time communication for:
1.  **Dispute Chat**: Instant messaging between Buyer, Seller, and Admin.
2.  **Escrow Updates**: Status changes (e.g. Seller accepts Request).
3.  **Worker Monitoring**: Admin live view of background worker health.

## Namespaces
The WebSocket server is divided into namespaces for logical separation:

| Namespace | Endpoint | Purpose |
| :--- | :--- | :--- |
| **Chat** | `/chat` | Dispute resolution rooms, messaging, typing indicators. |
| **Admin** | `/admin` | Worker stats, system alerts, admin dashboards. |
| **Notifications** | `/notifications` | General user notifications (e.g. "Escrow Funded"). |

## 1. Chat System (`/chat`)

### Connection
Connect to the `/chat` namespace using a valid JWT.

```javascript
const chatSocket = io(`${BASE_URL}/chat`, {
  auth: { token: `Bearer ${token}` },
  transports: ['websocket']
});
```

### Events

#### Client -> Server

| Event | Payload | Description |
| :--- | :--- | :--- |
| `join_room` | `{ escrowId: string }` | Joins the socket room for that escrow. |
| `send_message` | `{ escrowId, content, attachments }` | Sends a message. Server saves to DB and broadcasts. |
| `typing` | `{ escrowId, isTyping: boolean }` | Broadcasts typing status to room. |

#### Server -> Client

| Event | Payload | Description |
| :--- | :--- | :--- |
| `message_received` | *See JSON below* | Received when a new message is sent to the room. |
| `user_typing` | `{ userId, isTyping }` | Received when someone in room types. |

**`message_received` Payload:**
```json
{
  "_id": "650...",
  "roomId": "650...",
  "senderId": "650...",
  "sender": {
    "_id": "650...",
    "firstName": "John",
    "lastName": "Doe",
    "photo": "https://...",
    "email": "john@example.com"
  },
  "content": "Hello world",
  "attachments": [],
  "readBy": ["650..."],
  "createdAt": "2023-09-16T10:00:00Z"
}
```

## 2. Admin & Worker Monitoring (`/admin`)

### Connection
Connect to the `/admin` namespace. Requires Admin privileges.

```javascript
const adminSocket = io(`${BASE_URL}/admin`, {
  auth: { token: `Bearer ${token}` }
});
```

### Events

#### Server -> Client

| Event | Payload | Description |
| :--- | :--- | :--- |
| `worker_status` | `{ workerName, status, lastActivity }` | Live updates of background workers. |

## Configuration Notes

### Double Slashes in URL
**Important**: Ensure your `SOCKET_URL` does **NOT** end with a slash `/`.
*   **Incorrect**: `http://localhost:5000/` -> Results in `http://localhost:5000//chat` (Invalid Namespace)
*   **Correct**: `http://localhost:5000` -> Results in `http://localhost:5000/chat`

