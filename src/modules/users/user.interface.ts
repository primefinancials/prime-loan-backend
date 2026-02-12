import { Document } from "mongoose";
import { ObjectId } from "mongodb";

export type USERROLES = "admin" | "user";
export type USERSTATUS = "active" | "inactive" | "pending_signup";

export interface Update {
  pin?: number; // Optional
  type: "pin" | "password"; // Enforced enum values
  status: "validated" | "invalid" | "awaiting_validation"; // Enforced enum values
  created_at: string;
}

// Define all possible admin permissions
export type AdminPermission =
  // Users
  | "view_users"
  | "manage_users"

  // Loans
  | "view_loans"
  | "view_overdue"
  | "view_pending"
  | "manage_loans"

  // Transactions
  | "view_transactions"
  | "manage_transactions"

  // Reports / Settings
  | "view_reports"
  | "view_profits"
  | "manage_settings"

  // Savings
  | "view_savings"
  | "manage_savings"

  // Bill payments
  | "view_bill_payments"
  | "manage_bill_payments"

  // Notifications
  | "view_notifications"
  | "send_notifications"
  | "manage_notifications";


export interface User extends Document {
  _id: ObjectId;
  confirmation_sent_at: string;
  confirmed_at: string;
  created_at: string;
  email: string;
  password: string;
  email_confirmed_at: string;
  refresh_tokens: string[];
  is_anonymous: boolean;
  last_sign_in_at?: string;
  phone: string;
  role: USERROLES;
  status: USERSTATUS;
  updated_at: string;
  user_metadata: {
    bvn?: string;
    nin?: string;
    sub?: string;
    email?: string;
    phone?: string;
    surname?: string;
    gender?: string;
    first_name?: string;
    dateOfBirth?: string;
    email_verified?: boolean;
    phone_verified?: boolean;
    signupBonusReceived: boolean;
    ladderIndex?: number;
    creditScore?: number;
    accountNo?: string;
    address?: string;
    wallet?: string;
    pin?: string;
    profile_photo?: string;
    file?: string;
    types?: string;
    verified_address?: "verified" | "pending" | "unverified";
    stats?: {
      totalSavings: number;
      totalLoans: number;
      totalInterestEarned: number;
      activeLoanCount: number;
    };
  };
  is_super_admin?: boolean;
  updates: Update[]; // Array of update objects
  linked_accounts?: {
    id: string;
    name: string;
    email: string;
    ref: string;
    bank: string;
    account_number: string;
  }[];
  permissions: AdminPermission[];
}

export interface CREATEUSER {
  confirmation_sent_at: string;
  confirmed_at: string;
  email: string;
  password: string;
  email_confirmed_at: string;
  is_anonymous: boolean;
  last_sign_in_at?: string;
  phone: string;
  role: USERROLES;
  status: USERSTATUS;
  user_metadata: {
    bvn?: string;
    nin?: string;
    sub?: string;
    email?: string;
    phone?: string;
    surname?: string;
    gender?: string;
    first_name?: string;
    dateOfBirth?: string;
    email_verified?: boolean;
    phone_verified?: boolean;
    accountNo?: string;
    address?: string;
    pin?: string;
    profile_photo?: string;
    file?: string;
    types?: string;
    verified_address?: "verified" | "pending" | "unverified";
  };
  is_super_admin?: boolean;
}

export interface UPDATEUSER {
  confirmed_at?: string;
  email_confirmed_at?: string;
  last_sign_in_at?: string;
  role?: USERROLES;
  status?: USERSTATUS;
  user_metadata?: {
    bvn?: string;
    nin?: string;
    sub?: string;
    email?: string;
    phone?: string;
    surname?: string;
    gender?: string;
    first_name?: string;
    dateOfBirth?: string;
    wallet?: string;
    email_verified?: boolean;
    phone_verified?: boolean;
    signupBonusReceived?: boolean;
    ladderIndex?: number;
    creditScore?: number;
    accountNo?: string;
    address?: string;
    pin?: string;
    profile_photo?: string;
    file?: string;
    types?: string;
    verified_address?: "verified" | "pending" | "unverified";
  };
  updates?: Update[]; // Array of update objects
  linked_accounts?: {
    id: string;
    name: string;
    email: string;
    ref: string;
    bank: string;
    account_number: string;
  }[]
}

export interface ActivityEvent {
  type: "loan" | "savings" | "bill_payment" | "transfer";
  id: string;
  amount?: number;
  status: string;
  date: Date;
  description: string;
  isUser: boolean;
  meta?: Record<string, any>;
}

