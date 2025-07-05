import { UserEntity } from '../../entities/User';
import { IUserRepository } from '../../repositories/IUserRepository';
import { IPasswordService } from '../../services/IPasswordService';
import { IWalletService } from '../../services/IWalletService';
import { ConflictError } from '../../../shared/errors/AppError';

export interface CreateUserRequest {
  email: string;
  name: string;
  surname: string;
  password: string;
  phone: string;
  bvn: string;
  nin: string;
  dateOfBirth: string;
}

export interface CreateUserResponse {
  user: UserEntity;
  accountData: any;
}

export class CreateUserUseCase {
  constructor(
    private userRepository: IUserRepository,
    private passwordService: IPasswordService,
    private walletService: IWalletService
  ) {}

  async execute(request: CreateUserRequest): Promise<CreateUserResponse> {
    // Check for existing user
    const existingUser = await this.userRepository.findByEmail(request.email);
    if (existingUser) {
      throw new ConflictError(`A user already exists with the email ${request.email}`);
    }

    // Check for existing phone number
    const existingPhone = await this.userRepository.findMany({
      userMetadata: { phone: request.phone }
    } as any);
    if (existingPhone.length > 0) {
      throw new ConflictError(`A user already exists with the phone number ${request.phone}`);
    }

    // Create wallet account
    const walletAccount = await this.walletService.createAccount(request.bvn, request.dateOfBirth);

    // Hash password
    const hashedPassword = await this.passwordService.hash(request.password);

    // Create user
    const userData: Omit<UserEntity, 'id' | 'createdAt' | 'updatedAt'> = {
      email: request.email,
      password: hashedPassword,
      role: 'user',
      status: 'active',
      isAnonymous: false,
      isSuperAdmin: false,
      phone: request.phone,
      refreshTokens: [],
      userMetadata: {
        email: request.email,
        firstName: request.name,
        surname: request.surname,
        phone: request.phone,
        bvn: request.bvn,
        nin: request.nin,
        dateOfBirth: request.dateOfBirth,
        accountNo: walletAccount.accountNo,
      },
      updates: [],
      linkedAccounts: [],
    };

    const user = await this.userRepository.create(userData);

    return {
      user,
      accountData: walletAccount,
    };
  }
}