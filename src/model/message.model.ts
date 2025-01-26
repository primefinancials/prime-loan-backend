import { Schema, model } from 'mongoose';
import { Message } from '../interfaces';

const messageSchema = new Schema<Message>(
  {
    name: {
      type: String,
      required: true, // Name of the notification
    },
    user: {
      type: String,
      required: true, // User ID (UUID)
    },
    message: {
      type: String,
      required: true, // Notification message
    },
    type: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

const MessageModel = model<Message>('messages', messageSchema);

// Sync indexes with the database
(async () => {
  await MessageModel.syncIndexes();
})();

export default MessageModel;
