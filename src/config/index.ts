import dotenv from "dotenv";

dotenv.config();

export const SUPABASE_URL = process.env.SUPABASE_URL!;
export const SUPABASE_KEY = process.env.SUPABASE_KEY!;
export const PORT = process.env.PORT || 3000;
export const customerKey = process.env.CUSTOMER_KEY!;
export const customerSecret = process.env.CUSTOMER_SECRET!;
export const baseUrl = process.env.BASE_URL!;
export const authUrl = process.env.AUTH_URL!;