import cors, { CorsOptions } from 'cors';

/**
 * List of allowed origins for frontend apps.
 * DO NOT use '*' when credentials: true.
 */
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:8081',
  'https://prime-finance-admin.netlify.app',
  'https://admin.primefinance.live',
  'https://primefinance.live',
  'https://prime-loan-web-init.vercel.app'
];

/**
 * Default CORS configuration
 */
const DefaultCorsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      // allow requests with no origin (like mobile apps, curl, Postman)
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },

  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  credentials: true,

  preflightContinue: false,
  optionsSuccessStatus: 200,

  maxAge: 60 * 60 * 24 * 30, // 30 days

  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'x-csrf-token',
    'Authorization',
    'X-App-Platform'
  ],

  exposedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'x-csrf-token',
    'Authorization',
    'X-App-Platform'
  ]
};

/**
 * Wrapper to apply CORS middleware
 */
const crossOrigin = (options: Partial<CorsOptions> = DefaultCorsOptions) =>
  cors(options);

export default crossOrigin;
