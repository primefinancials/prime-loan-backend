export interface UserEntity {
  id: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
  status: 'active' | 'inactive';
  isAnonymous: boolean;
  isSuperAdmin?: boolean;
  phone?: string;
  refreshTokens: string[];
  userMetadata: UserMetadata;
  updates: UserUpdate[];
  linkedAccounts?: LinkedAccount[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UserMetadata {
  bvn?: string;
  nin?: string;
  email?: string;
  phone?: string;
  surname?: string;
  firstName?: string;
  dateOfBirth?: string;
  accountNo?: string;
  wallet?: string;
  signupBonusReceived?: boolean;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  address?: string;
  pin?: string;
  profilePhoto?: string;
  verifiedAddress?: 'verified' | 'pending' | 'unverified';
}

export interface UserUpdate {
  pin?: number;
  type: 'pin' | 'password';
  status: 'validated' | 'invalid' | 'awaiting_validation';
  createdAt: string;
}

export interface LinkedAccount {
  id: string;
  name: string;
  email: string;
  ref: string;
  bank: string;
  accountNumber: string;
}