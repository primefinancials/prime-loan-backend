export type NotificationType = "loan";
export type NotificationStatus = "unread" | "read";

export interface Message {
  _id: string; // Unique identifier (UUID)
  created_at: string; // Timestamp in ISO format
  updated_at: string; // Timestamp of when the transaction was updated
  name: string; // Name of the notification
  user: string; // User ID (UUID)
  message: string; // Notification message
  type: NotificationType; // Restricted to "loan"
  status: NotificationStatus; // Restricted to "unread" or "read"
}

export interface CREATEMESSAGE {
  name: string; // Name of the notification
  user: string; // User ID (UUID)
  message: string; // Notification message
  type: NotificationType; // Restricted to "loan"
  status: NotificationStatus; // Restricted to "unread" or "read"
}

export interface UPDATEMESSAGE {
  name?: string; // Name of the notification
  message?: string; // Notification message
  status?: NotificationStatus; // Restricted to "unread" or "read"
}
