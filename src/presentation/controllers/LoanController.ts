import { Request, Response, NextFunction } from 'express';
import { CreateLoanUseCase } from '../../core/use-cases/loan/CreateLoanUseCase';
import { DisburseLoanUseCase } from '../../core/use-cases/loan/DisburseLoanUseCase';
import { createLoanSchema, disburseLoanSchema } from '../../shared/validation/ValidationSchemas';
import { AuthenticatedRequest } from '../../shared/middleware/AuthMiddleware';

export class LoanController {
  constructor(
    private createLoanUseCase: CreateLoanUseCase,
    private disburseLoanUseCase: DisburseLoanUseCase
  ) {}

  async createLoan(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { error, value } = createLoanSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: 'error',
          message: error.details[0].message,
        });
      }

      if (!req.user?.id) {
        return res.status(401).json({
          status: 'error',
          message: 'User not authenticated',
        });
      }

      const loan = await this.createLoanUseCase.execute({
        userId: req.user.id,
        firstName: value.firstName,
        lastName: value.lastName,
        email: value.email,
        phone: value.phone,
        dateOfBirth: value.dateOfBirth,
        bvn: value.bvn,
        nin: value.nin,
        address: value.address,
        company: value.company,
        companyAddress: value.companyAddress,
        annualIncome: value.annualIncome,
        guarantor1Name: value.guarantor1Name,
        guarantor1Phone: value.guarantor1Phone,
        guarantor2Name: value.guarantor2Name,
        guarantor2Phone: value.guarantor2Phone,
        amount: value.amount,
        reason: value.reason,
        category: value.category,
        type: value.type,
        duration: value.duration,
        repaymentAmount: value.repaymentAmount,
        percentage: value.percentage,
        loanDate: value.loanDate,
        repaymentDate: value.repaymentDate,
        base64Image: value.base64Image,
        acknowledgment: value.acknowledgment,
        debitAccount: value.debitAccount,
      });

      res.status(201).json({
        status: 'success',
        data: { loan },
      });
    } catch (error) {
      next(error);
    }
  }

  async disburseLoan(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { error, value } = disburseLoanSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: 'error',
          message: error.details[0].message,
        });
      }

      if (!req.admin?.id) {
        return res.status(401).json({
          status: 'error',
          message: 'Admin access required',
        });
      }

      const result = await this.disburseLoanUseCase.execute({
        loanId: value.loanId,
        userId: value.userId,
        amount: value.amount,
        duration: value.duration,
      });

      res.status(200).json({
        status: 'success',
        data: {
          loan: result.loan,
          transferData: result.transferData,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}