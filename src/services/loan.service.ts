import { LoanModel } from '../model';
import { NotFoundError, } from '../exceptions';
import { CREATELOAN, UPDATELOAN, LoanApplication } from '../interfaces';

export class LoanService {

  public async create(loanData: CREATELOAN): Promise<LoanApplication> {
    const newLoan = await LoanModel.create(loanData);

    return newLoan;
  };

  public async update(uid: string, updateFields: UPDATELOAN,): Promise<LoanApplication | void | null> {

    const loan = await LoanModel.findById(uid);

    if (!loan) throw new NotFoundError(`No loan found with the id ${uid}`)

    return await LoanModel.findByIdAndUpdate(uid, updateFields).then(loan => loan);
  };

  public async fetchAll(limitValue: number, offsetValue: number): Promise<LoanApplication[]> {
    const loans = await LoanModel.find().limit(limitValue).skip(offsetValue);

    return loans;
  };

  public async find(fields: object, option: 'one' | 'many'): Promise<LoanApplication | null | LoanApplication[] | void> {
    if (option === 'one') {
      const loan = await LoanModel.findOne(fields).exec();

      return loan;
    } else if (option === 'many') {
      const loans = await LoanModel.find(fields).lean();

      if (loans.length < 1) return null

      return loans;
    };
  };

  public async findById(uid: string): Promise<LoanApplication | null> {
    const loan = await LoanModel.findById(uid);
    // if (!loan) throw new NotFoundError(`No loan found with id ${uid}`)
    return loan;
  };

  public async countDocuments(countQuery?: object): Promise<number> {
    const count = await LoanModel.countDocuments(countQuery ?? {});
    return count;
  };

  public async deleteLoan(uid: string): Promise<void> {
    await LoanModel.deleteOne({
      _id: uid,
    });
  };
};