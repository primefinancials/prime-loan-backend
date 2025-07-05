import { IUserRepository } from '../../core/repositories/IUserRepository';
import { ILoanRepository } from '../../core/repositories/ILoanRepository';
import { IPasswordService } from '../../core/services/IPasswordService';
import { ITokenService } from '../../core/services/ITokenService';
import { IWalletService } from '../../core/services/IWalletService';
import { ICreditCheckService } from '../../core/services/ICreditCheckService';
import { IEmailService } from '../../core/services/IEmailService';

import { MongoUserRepository } from '../repositories/MongoUserRepository';
import { MongoLoanRepository } from '../repositories/MongoLoanRepository';
import { CryptoPasswordService } from '../services/CryptoPasswordService';
import { JwtTokenService } from '../services/JwtTokenService';
import { VfdWalletService } from '../services/VfdWalletService';
import { MonoCreditCheckService } from '../services/MonoCreditCheckService';
import { NodemailerEmailService } from '../services/NodemailerEmailService';

import { CreateUserUseCase } from '../../core/use-cases/user/CreateUserUseCase';
import { AuthenticateUserUseCase } from '../../core/use-cases/user/AuthenticateUserUseCase';
import { CreateLoanUseCase } from '../../core/use-cases/loan/CreateLoanUseCase';
import { DisburseLoanUseCase } from '../../core/use-cases/loan/DisburseLoanUseCase';

import { UserController } from '../../presentation/controllers/UserController';
import { LoanController } from '../../presentation/controllers/LoanController';
import { AuthMiddleware } from '../../shared/middleware/AuthMiddleware';

export class Container {
  private static instance: Container;
  private services: Map<string, any> = new Map();

  private constructor() {
    this.registerServices();
  }

  static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container();
    }
    return Container.instance;
  }

  private registerServices() {
    // Repositories
    this.services.set('userRepository', new MongoUserRepository());
    this.services.set('loanRepository', new MongoLoanRepository());

    // Services
    this.services.set('passwordService', new CryptoPasswordService());
    this.services.set('tokenService', new JwtTokenService());
    this.services.set('walletService', new VfdWalletService());
    this.services.set('creditCheckService', new MonoCreditCheckService());
    this.services.set('emailService', new NodemailerEmailService());

    // Use Cases
    this.services.set('createUserUseCase', new CreateUserUseCase(
      this.get<IUserRepository>('userRepository'),
      this.get<IPasswordService>('passwordService'),
      this.get<IWalletService>('walletService')
    ));

    this.services.set('authenticateUserUseCase', new AuthenticateUserUseCase(
      this.get<IUserRepository>('userRepository'),
      this.get<IPasswordService>('passwordService'),
      this.get<ITokenService>('tokenService')
    ));

    this.services.set('createLoanUseCase', new CreateLoanUseCase(
      this.get<ILoanRepository>('loanRepository'),
      this.get<ICreditCheckService>('creditCheckService')
    ));

    this.services.set('disburseLoanUseCase', new DisburseLoanUseCase(
      this.get<ILoanRepository>('loanRepository'),
      this.get<IUserRepository>('userRepository'),
      this.get<IWalletService>('walletService')
    ));

    // Middleware
    this.services.set('authMiddleware', new AuthMiddleware(
      this.get<ITokenService>('tokenService'),
      this.get<IUserRepository>('userRepository')
    ));

    // Controllers
    this.services.set('userController', new UserController(
      this.get('createUserUseCase'),
      this.get('authenticateUserUseCase')
    ));

    this.services.set('loanController', new LoanController(
      this.get('createLoanUseCase'),
      this.get('disburseLoanUseCase')
    ));
  }

  get<T>(serviceName: string): T {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service ${serviceName} not found`);
    }
    return service;
  }
}