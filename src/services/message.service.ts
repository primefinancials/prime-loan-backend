import { MessageModel } from '../model';
import { NotFoundError, } from '../exceptions';
import { CREATEMESSAGE, UPDATEMESSAGE, Message } from '../interfaces';

export class MessageService {

  public async create(messageData: CREATEMESSAGE): Promise<Message> {
    const newMessage = await MessageModel.create(messageData);

    return newMessage;
  };

  public async update(uid: string, updateFields: UPDATEMESSAGE,): Promise<Message | void | null> {

    const message = await MessageModel.findById(uid);

    if (!message) throw new NotFoundError(`No message found with the id ${uid}`)

    return await MessageModel.findByIdAndUpdate(uid, updateFields).then(message => message);
  };

  public async fetchAll(limitValue: number, offsetValue: number): Promise<Message[]> {
    const messages = await MessageModel.find().limit(limitValue).skip(offsetValue);

    return messages;
  };

  public async find(fields: object, option: 'one' | 'many'): Promise<Message | null | Message[] | void> {
    if (option === 'one') {
      const message = await MessageModel.findOne(fields).exec();

      return message;
    } else if (option === 'many') {
      const messages = await MessageModel.find(fields).lean();

      if (messages.length < 1) return null

      return messages;
    };
  };

  public async findById(uid: string): Promise<Message | null> {
    const message = await MessageModel.findById(uid);
    // if (!message) throw new NotFoundError(`No message found with id ${uid}`)
    return message;
  };

  public async countDocuments(countQuery?: object): Promise<number> {
    const count = await MessageModel.countDocuments(countQuery ?? {});
    return count;
  };

  public async deleteMessage(uid: string): Promise<void> {
    await MessageModel.deleteOne({
      _id: uid,
    });
  };
};