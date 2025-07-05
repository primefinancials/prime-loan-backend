import { UserEntity } from '../../entities/User';
import { IUserRepository } from '../../repositories/IUserRepository';
import { IPasswordService } from '../../services/IPasswordService';
import { ITokenService } from '../../services/ITokenService';
import { UnauthorizedError } from '../../../shared/errors/AppError';

export interface AuthenticateUserRequest {
  email: string;
  password: string;
}

export interface AuthenticateUserResponse {
  user: Omit<UserEntity, 'password'>;
  accessToken: string;
  refreshToken: string;
}

export class AuthenticateUserUseCase {
  constructor(
    private userRepository: IUserRepository,
    private passwordService: IPasswordService,
    private tokenService: ITokenService
  ) {}

  async execute(request: AuthenticateUserRequest): Promise<AuthenticateUserResponse> {
    // Find user by email
    const user = await this.userRepository.findByEmail(request.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email address');
    }

    // Check if user is active
    if (user.status !== 'active') {
      throw new UnauthorizedError('Account has been suspended! Contact admin for revert action.');
    }

    // Verify password
    const isPasswordValid = await this.passwordService.verify(request.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Incorrect password');
    }

    // Generate tokens
    const payload = {
      accountType: user.role,
      id: user.id,
    };

    const accessToken = this.tokenService.generateAccessToken(payload);
    const refreshToken = this.tokenService.generateRefreshToken(payload);

    // Update user with refresh token
    const updatedRefreshTokens = [...user.refreshTokens, refreshToken];
    await this.userRepository.update(user.id, {
      refreshTokens: updatedRefreshTokens,
    });

    // Remove password from response
    const { password, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      accessToken,
      refreshToken,
    };
  }
}