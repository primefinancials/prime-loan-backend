"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMAIL_VERIFICATION_CODE_EXPIRES_IN = exports.EMAIL_INTERVAL = exports.EMAIL_PORT_NUMBER = exports.EMAIL_HOST = exports.EMAIL_PASSWORD = exports.EMAIL_USERNAME = exports.LOG_DIRECTORY = exports.REFRESH_TOKEN_SECRET = exports.ACCESS_TOKEN_SECRET = exports.REDIS_CREDENTIALS = exports.CRYPTOJS_KEY = exports.DB_OPTIONS = exports.DB_URL = exports.PORT = exports.authUrl = exports.baseUrl = exports.customerSecret = exports.customerKey = void 0;
require("../config/envConfig");
const PORT = process.env.PORT || 3000;
exports.PORT = PORT;
exports.customerKey = process.env.CUSTOMER_KEY;
exports.customerSecret = process.env.CUSTOMER_SECRET;
exports.baseUrl = process.env.BASE_URL;
exports.authUrl = process.env.AUTH_URL;
const CRYPTOJS_KEY = process.env.CRYPTOJS_KEY;
exports.CRYPTOJS_KEY = CRYPTOJS_KEY;
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
exports.ACCESS_TOKEN_SECRET = ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;
exports.REFRESH_TOKEN_SECRET = REFRESH_TOKEN_SECRET;
const EMAIL_VERIFICATION_CODE_EXPIRES_IN = process.env.EMAIL_VERIFICATION_CODE_EXPIRES_IN;
exports.EMAIL_VERIFICATION_CODE_EXPIRES_IN = EMAIL_VERIFICATION_CODE_EXPIRES_IN;
// Define specific types for the variables
const DB_URL = process.env.DB_URL;
exports.DB_URL = DB_URL;
const DB_OPTIONS = {
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
exports.DB_OPTIONS = DB_OPTIONS;
const LOG_DIRECTORY = process.env.LOG_DIRECTORY || '';
exports.LOG_DIRECTORY = LOG_DIRECTORY;
const REDIS_CREDENTIALS = {
    host: process.env.REDIS_HOST || '',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || '',
};
exports.REDIS_CREDENTIALS = REDIS_CREDENTIALS;
const EMAIL_USERNAME = process.env.EMAIL_USERNAME;
exports.EMAIL_USERNAME = EMAIL_USERNAME;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
exports.EMAIL_PASSWORD = EMAIL_PASSWORD;
const EMAIL_HOST = process.env.EMAIL_HOST;
exports.EMAIL_HOST = EMAIL_HOST;
const EMAIL_PORT_NUMBER = process.env.EMAIL_PORT_NUMBER;
exports.EMAIL_PORT_NUMBER = EMAIL_PORT_NUMBER;
const EMAIL_INTERVAL = process.env.EMAIL_INTERVAL;
exports.EMAIL_INTERVAL = EMAIL_INTERVAL;
