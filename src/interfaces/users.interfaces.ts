export type USERROLES = "admin" | "user";

export interface User {
  _id: string;
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
  updated_at: string; 
  user_metadata: {
    bvn?: string;
    nin?: string;
    sub?: string;
    email?: string;
    phone?: string;
    surname?: string;
    first_name?: string;
    dateOfBirth?: string;
    email_verified?: boolean;
    phone_verified?: boolean;
    accountNo?: string;
    address?: string;
    wallet?: string;
    pin?: string;
    profile_photo?: string;
    file?: string;
    types?: string;
    verified_address?: "verified" | "pending" | "unverified";
  };
  is_super_admin?: boolean;
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
    accountNo?: string;
    address?: string;
    pin?: string;
    profile_photo?: string;
    file?: string;
    types?: string;
    verified_address?: "verified" | "pending" | "unverified";
  };
}
