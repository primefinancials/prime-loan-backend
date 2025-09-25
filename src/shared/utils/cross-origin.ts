import cors, { CorsOptions } from "cors";

/**
 * List of allowed origins for frontend apps.
 * DO NOT use '*' when credentials: true.
 */
const allowedOrigins: string[] = [
  "*",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:8081",
  "https://admin.primefinance.live",
  "https://primefinance.live",
  "https://prime-loan-web-init.vercel.app",
];

const commonHeaders = [
  "Origin",
  "X-Requested-With",
  "Content-Type",
  "Accept",
  "x-csrf-token",
  "Authorization",
  "X-App-Platform",
];

/**
 * Default CORS configuration
 */
const DefaultCorsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // More explicit error message for easier debugging
    return callback(
      new Error(`CORS blocked: origin '${origin}' is not allowed.`)
    );
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 200,
  maxAge: 60 * 60 * 24 * 30, // 30 days
  allowedHeaders: commonHeaders,
  exposedHeaders: commonHeaders,
};

/**
 * Wrapper to apply CORS middleware
 */
const crossOrigin = (options: CorsOptions = DefaultCorsOptions) => cors(options);

export default crossOrigin;
