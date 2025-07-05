export interface MessageEntity {
  id: string;
  name: string;
  userId: string;
  message: string;
  type: 'loan';
  status: 'unread' | 'read';
  createdAt: Date;
  updatedAt: Date;
}