import { UserModel } from '../model';
import { NotFoundError, } from '../exceptions';
import { CREATEUSER, UPDATEUSER, User } from '../interfaces';

export class UserService {

  public async create(userData: CREATEUSER): Promise<User> {
    const newUser: User = await UserModel.create(userData);

    return newUser;
  };

  public async update(uid: string, updateFields: string, data: any ): Promise<User | void | null> {

    const user = await UserModel.findById(uid);

    if (!user) throw new NotFoundError(`No user found with the id ${uid}`)

    const updatedUser = await UserModel.findByIdAndUpdate(uid, { $set: { [updateFields]: data } }, { new: true }) // Ensures the updated document is returned);

    return updatedUser;
  };

  public async fetchAll(limitValue: number, offsetValue: number): Promise<User[]> {
    const users = await UserModel.find().limit(limitValue).skip(offsetValue);

    return users;
  };

  public async find(fields: object, option: 'one' | 'many'): Promise<User | null | User[] | void> {
    if (option === 'one') {
      const user = await UserModel.findOne(fields).exec();

      return user;
    } else if (option === 'many') {
      const users = await UserModel.find(fields).lean();

      if (users.length < 1) return null

      return users;
    };
  };

  public async findById(uid: string): Promise<User | null> {
    const user = await UserModel.findById(uid);
    // if (!user) throw new NotFoundError(`No user found with id ${uid}`)
    return user;
  };

  public async findByEmail(email: string): Promise<User | null> {
    const foundUser = await UserModel.findOne({ email }).exec();

    return foundUser;
  };

  public async findByRefreshToken(refreshToken: string): Promise<User | null> {
    const foundUser = await UserModel.findOne({
      refresh_tokens: refreshToken,
    });

    return foundUser;
  };

  public async countDocuments(countQuery?: object): Promise<number> {
    const count = await UserModel.countDocuments(countQuery ?? {});
    return count;
  };

  public async appendRefreshToken(uid: string, refreshToken?: string): Promise<void> {
    await UserModel.updateOne(
      { _id: uid, },
      { $push: { refresh_tokens: refreshToken }, }
    ).exec();
  };

  public async deleteRefreshToken(uid: string, refreshToken?: string): Promise<User | null | void> {
    return await UserModel.updateOne(
      { _id: uid, },
      { $pull: { refresh_tokens: refreshToken, }, },
      { new: true, }
    ).exec() as unknown as User;
  };

  public async deleteUser(uid: string): Promise<void> {
    await UserModel.deleteOne(
      { _id: uid, }
    )
  };
};