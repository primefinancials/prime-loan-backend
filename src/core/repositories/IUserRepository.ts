import { UserEntity } from '../entities/User';

export interface IUserRepository {
  create(user: Omit<UserEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserEntity>;
  findById(id: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<UserEntity | null>;
  findByRefreshToken(refreshToken: string): Promise<UserEntity | null>;
  update(id: string, updates: Partial<UserEntity>): Promise<UserEntity>;
  delete(id: string): Promise<void>;
  findMany(filters?: Partial<UserEntity>): Promise<UserEntity[]>;
  count(filters?: Partial<UserEntity>): Promise<number>;
}