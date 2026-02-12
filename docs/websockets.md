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

## Frontend Integration Guide

### 1. Installation
Install the socket.io client library:
```bash
npm install socket.io-client
```

### 2. Connection & Authentication
You must connect to the specific namespace you need. Authentication is handled via the `auth` object in the handshake.

```javascript
import { io } from "socket.io-client";

const SOCKET_URL = "https://your-backend-url.com"; // e.g. http://localhost:5000
const token = "YOUR_JWT_TOKEN"; // Get from auth state

// Connect to the Chat Namespace
const chatSocket = io(`${SOCKET_URL}/chat`, {
  auth: {
    token: `Bearer ${token}`
  },
  transports: ['websocket'] // Recommended
});

chatSocket.on("connect", () => {
  console.log("Connected to Chat Namespace:", chatSocket.id);
});

chatSocket.on("connect_error", (err) => {
  console.error("Connection Error:", err.message);
});
```

### 3. Usage: Dispute Chat
The chat system uses "rooms" corresponding to the `escrow_id` (or `dispute_id`).

#### Joining a Chat Room
When a user opens a dispute or escrow chat, they must join the room.
```javascript
const escrowId = "60d5ec..."; // ID of the escrow/dispute

// Join the room
chatSocket.emit("join_room", { escrowId });
```

#### Sending a Message
*Note: Messages are typically sent via a REST API call (`POST /api/chat/:escrowId/message`) which saves to DB and then broadcasts via socket. However, typing indicators are sent directly via socket.*

```javascript
// Typing Indicator
chatSocket.emit("typing", { 
  escrowId, 
  isTyping: true 
});
```

#### Listening for Messages & Events
```javascript
// Receive new message
chatSocket.on("message_received", (message) => {
  console.log("New Message:", message);
  // message: { content, senderId, timestamp, attachments }
  // Update UI list
});

// Receive typing indicator
chatSocket.on("user_typing", (data) => {
  // data: { userId, isTyping }
  if (data.isTyping) {
    showTypingIndicator(data.userId);
  } else {
    hideTypingIndicator(data.userId);
  }
});
```

## Admin / Worker Monitoring
Connect to the `/admin` namespace to receive live worker updates.

```javascript
const adminSocket = io(`${SOCKET_URL}/admin`, {
  auth: { token: `Bearer ${token}` } // Must have Admin role
});

adminSocket.on("worker_status", (stats) => {
  console.log("Worker Update:", stats);
  // stats: { workerName, status, lastActivity, ... }
});
```

## Event Reference

### Namespace: `/chat`

| Event Name | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `join_room` | Client -> Server | `{ escrowId: string }` | Joins the socket room for that escrow. |
| `typing` | Client -> Server | `{ escrowId: string, isTyping: boolean }` | Broadcasts typing status to room. |
| `user_typing` | Server -> Client | `{ userId: string, isTyping: boolean }` | Received when someone in room types. |
| `message_received`| Server -> Client | `{ message object }` | Received when a new message is sent to the room. |

### Namespace: `/admin`

| Event Name | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `worker_status` | Server -> Client | `{ workerName, status... }` | Live updates of background workers. |

## Troubleshooting

### "WebSocket is closed before the connection is established"
This error usually means the handshake failed.
1.  **Check Protocol**: Ensure you are using `http` or `https` correctly in the URL.
2.  **Check Token**: The server requires a valid JWT in `auth.token`. If missing or invalid, the server disconnects immediately.
3.  **Check Server Logs**: The server now logs all incoming connection attempts. Look for "Incoming socket connection attempt" in the backend logs to see if your request is reaching the server and if the token is present.
4.  **CORS**: If running on different ports (e.g. React on 3000, Node on 5000), ensured `cors` is enabled on backend (it is set to `*`).
5.  **Namespace**: Ensure you are connecting to `/chat` or `/admin`, not just `/`.
6.  **Double Slashes**: Check your `SOCKET_URL`. If it ends with `/` (e.g., `http://localhost:5000/`), joining it with `/chat` might result in `//chat`, which is an **Invalid Namespace**. Ensure `SOCKET_URL` does NOT match the pattern `.../`.

