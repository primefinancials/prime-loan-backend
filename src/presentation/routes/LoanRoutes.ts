import { Router } from 'express';
import { LoanController } from '../controllers/LoanController';
import { AuthMiddleware } from '../../shared/middleware/AuthMiddleware';

export class LoanRoutes {
  private router: Router;

  constructor(
    private loanController: LoanController,
    private authMiddleware: AuthMiddleware
  ) {
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes() {
    this.router.post('/create-loan', 
      this.authMiddleware.authenticate(), 
      this.loanController.createLoan.bind(this.loanController)
    );
    
    this.router.post('/disburse-loan', 
      this.authMiddleware.authenticate(), 
      this.loanController.disburseLoan.bind(this.loanController)
    );
  }

  getRouter(): Router {
    return this.router;
  }
}