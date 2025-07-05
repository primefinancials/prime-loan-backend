import { UserEntity } from '../../core/entities/User';
import { IUserRepository } from '../../core/repositories/IUserRepository';
import { UserModel } from '../database/models/UserModel';

export class MongoUserRepository implements IUserRepository {
  async create(userData: Omit<UserEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserEntity> {
    const user = await UserModel.create(userData);
    return this.mapToEntity(user);
  }

  async findById(id: string): Promise<UserEntity | null> {
    const user = await UserModel.findById(id);
    return user ? this.mapToEntity(user) : null;
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    const user = await UserModel.findOne({ email });
    return user ? this.mapToEntity(user) : null;
  }

  async findByRefreshToken(refreshToken: string): Promise<UserEntity | null> {
    const user = await UserModel.findOne({ refreshTokens: refreshToken });
    return user ? this.mapToEntity(user) : null;
  }

  async update(id: string, updates: Partial<UserEntity>): Promise<UserEntity> {
    const user = await UserModel.findByIdAndUpdate(id, updates, { new: true });
    if (!user) {
      throw new Error('User not found');
    }
    return this.mapToEntity(user);
  }

  async delete(id: string): Promise<void> {
    await UserModel.findByIdAndDelete(id);
  }

  async findMany(filters?: Partial<UserEntity>): Promise<UserEntity[]> {
    const users = await UserModel.find(filters || {});
    return users.map(user => this.mapToEntity(user));
  }

  async count(filters?: Partial<UserEntity>): Promise<number> {
    return await UserModel.countDocuments(filters || {});
  }

  private mapToEntity(user: any): UserEntity {
    return {
      id: user._id.toString(),
      email: user.email,
      password: user.password,
      role: user.role,
      status: user.status,
      isAnonymous: user.is_anonymous,
      isSuperAdmin: user.is_super_admin,
      phone: user.phone,
      refreshTokens: user.refresh_tokens || [],
      userMetadata: {
        bvn: user.user_metadata?.bvn,
        nin: user.user_metadata?.nin,
        email: user.user_metadata?.email,
        phone: user.user_metadata?.phone,
        surname: user.user_metadata?.surname,
        firstName: user.user_metadata?.first_name,
        dateOfBirth: user.user_metadata?.dateOfBirth,
        accountNo: user.user_metadata?.accountNo,
        wallet: user.user_metadata?.wallet,
        signupBonusReceived: user.user_metadata?.signupBonusReceived,
        emailVerified: user.user_metadata?.email_verified,
        phoneVerified: user.user_metadata?.phone_verified,
        address: user.user_metadata?.address,
        pin: user.user_metadata?.pin,
        profilePhoto: user.user_metadata?.profile_photo,
        verifiedAddress: user.user_metadata?.verified_address,
      },
      updates: user.updates || [],
      linkedAccounts: user.linked_accounts || [],
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}