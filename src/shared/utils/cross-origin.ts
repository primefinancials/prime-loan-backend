import cors, { CorsOptions } from 'cors';

type CrossOrigin = Partial<typeof DefaultCorsOptions>;

/**
 * Default configuration options for cross-origin requests.
 *
 * NOTE: `'*'` is intentionally REMOVED from the origin list.
 * When `credentials: true` is set, browsers reject wildcard origins.
 * Instead, all expected client origins are listed explicitly, and
 * a regex covers *.avasa.app subdomains.
 *
 * Railway/Vercel preview URLs are covered by the regex patterns.
 */
const DefaultCorsOptions: CorsOptions = {
  /**
   * The allowed origin(s) for the request.
   * Each origin is checked against this list.
   */
  origin: [
    // Local development
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:8081',

    // Production domains
    'https://prime-finance-admin.netlify.app',
    'https://admin.primefinance.live',
    'https://primefinance.live',
    'https://www.primefinance.live',

    // Vercel deployments (exact + preview)
    'https://prime-loan-web-init.vercel.app',
    'https://prime-loan-web.vercel.app',
    'https://prime-loan-web-v2-staging.vercel.app',
    'https://prime-finance-admin-staging.vercel.app',

    // Vercel preview URLs (auto-generated per branch/commit)
    /^https:\/\/prime-loan-web-v2-[a-z0-9-]+\.vercel\.app$/,
    /^https:\/\/prime-finance-admin-[a-z0-9-]+\.vercel\.app$/,

    // Avasa platform (any subdomain)
    /^https:\/\/(.*\.)?avasa\.app$/
  ],

  /**
   * The allowed HTTP methods for the request.
   */
  methods: 'PUT, GET, PATCH, DELETE, POST, OPTIONS',

  /**
   * Whether to continue with the preflight request if the initial request is successful.
   */
  preflightContinue: false,

  /**
   * The HTTP status code to use for successful OPTIONS requests.
   */
  optionsSuccessStatus: 200,

  /**
   * Whether to include credentials (such as cookies or authorization headers) with the request.
   */
  credentials: true,

  /**
   * The maximum age (in seconds) to cache the preflight response.
   */
  maxAge: 30 * 60 * 60 * 24 * 1000, // 30 days

  /**
   * The headers that are exposed to the browser in the response.
   */
  exposedHeaders:
    'Origin, X-Requested-With, Content-Type, Accept, x-csrf-token, Authorization, X-App-Platform, Idempotency-Key',

  /**
   * The allowed headers for the request.
   */
  allowedHeaders:
    'Origin, X-Requested-With, Content-Type, Accept, x-csrf-token, Authorization, X-App-Platform, Idempotency-Key',
};

const crossOrigin = (options: CrossOrigin = DefaultCorsOptions) => cors(options);

export default crossOrigin;
