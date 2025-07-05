import { MessageEntity } from '../entities/Message';

export interface IMessageRepository {
  create(message: Omit<MessageEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<MessageEntity>;
  findById(id: string): Promise<MessageEntity | null>;
  update(id: string, updates: Partial<MessageEntity>): Promise<MessageEntity>;
  delete(id: string): Promise<void>;
  findMany(filters?: Partial<MessageEntity>): Promise<MessageEntity[]>;
  findByUserId(userId: string): Promise<MessageEntity[]>;
  count(filters?: Partial<MessageEntity>): Promise<number>;
}