import { TransactionModel } from '../model';
import { NotFoundError, } from '../exceptions';
import { CREATETRANSACTION, UPDATETRANSACTION, Transaction } from '../interfaces';

export class TransactionService {

  public async create(transactionData: CREATETRANSACTION): Promise<Transaction> {
    const newTransaction = await TransactionModel.create(transactionData);

    return newTransaction;
  };

  public async update(uid: string, updateFields: UPDATETRANSACTION,): Promise<Transaction | void | null> {

    const transaction = await TransactionModel.findById(uid);

    if (!transaction) throw new NotFoundError(`No transaction found with the id ${uid}`)

    return await TransactionModel.findByIdAndUpdate(uid, updateFields).then(transaction => transaction);
  };

  public async fetchAll(limitValue: number, offsetValue: number): Promise<Transaction[]> {
    const transactions = await TransactionModel.find().limit(limitValue).skip(offsetValue);

    return transactions;
  };

  public async find(fields: object, option: 'one' | 'many'): Promise<Transaction | null | Transaction[] | void> {
    if (option === 'one') {
      const transaction = await TransactionModel.findOne(fields).exec();

      return transaction;
    } else if (option === 'many') {
      const transactions = await TransactionModel.find(fields).lean();

      if (transactions.length < 1) return null

      return transactions;
    };
  };

  public async findById(uid: string): Promise<Transaction | null> {
    const transaction = await TransactionModel.findById(uid);
    // if (!transaction) throw new NotFoundError(`No transaction found with id ${uid}`)
    return transaction;
  };

  public async countDocuments(countQuery?: object): Promise<number> {
    const count = await TransactionModel.countDocuments(countQuery ?? {});
    return count;
  };

  public async deleteTransaction(uid: string): Promise<void> {
    await TransactionModel.deleteOne({
      _id: uid,
    });
  };
};