import '../config/envConfig';
import { ConnectOptions } from 'mongoose';

const PORT = process.env.PORT || 3000;
export const customerKey = process.env.CUSTOMER_KEY!;
export const customerSecret = process.env.CUSTOMER_SECRET!;
export const baseUrl = process.env.BASE_URL!;
export const authUrl = process.env.AUTH_URL!;
const CRYPTOJS_KEY = process.env.CRYPTOJS_KEY;
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;
const EMAIL_VERIFICATION_CODE_EXPIRES_IN = process.env.EMAIL_VERIFICATION_CODE_EXPIRES_IN;
// Define specific types for the variables
const DB_URL = process.env.DB_URL;

const DB_OPTIONS: ConnectOptions = {
  autoIndex: true,
  minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE || '5'), // Maintain up to x socket connections
  maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE || '20'), // Maintain up to x socket connections
  connectTimeoutMS: 60000, // Give up initial connection after 60 seconds
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  // @ts-ignore
  //   useNewUrlParser: true,
  //   useUnifiedTopology: true,
  dbName: process.env.DATABASE_NAME,
};

const LOG_DIRECTORY = process.env.LOG_DIRECTORY || '';

const REDIS_CREDENTIALS = {
  host: process.env.REDIS_HOST || '',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || '',
};

const EMAIL_USERNAME = process.env.EMAIL_USERNAME;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT_NUMBER = process.env.EMAIL_PORT_NUMBER;
const EMAIL_INTERVAL = process.env.EMAIL_INTERVAL;

export {
  PORT,
  DB_URL,
  DB_OPTIONS,
  CRYPTOJS_KEY,
  REDIS_CREDENTIALS,
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
  LOG_DIRECTORY,
  EMAIL_USERNAME,
  EMAIL_PASSWORD,
  EMAIL_HOST,
  EMAIL_PORT_NUMBER,
  EMAIL_INTERVAL,
  EMAIL_VERIFICATION_CODE_EXPIRES_IN,
};