import cors, { CorsOptions } from 'cors';


type CrossOrigin = Partial<typeof DefaultCorsOptions>;


/**
 * Default configuration options for cross-origin requests.
 */
const DefaultCorsOptions: CorsOptions = {
    /**
     * The allowed origin(s) for the request. Use '*' to allow all origins.
     */
    origin: [
        '*', 
        'http://localhost:5173', 
        'http://localhost:5174', 
        'http://localhost:8081', 
        'https://prime-finance-admin.netlify.app', 
        'https://admin.primefinance.live',
        'https://primefinance.live',
        'https://prime-loan-web-init.vercel.app'
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
    exposedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, x-csrf-token, Authorization, X-App-Platform',
    /**
     * The allowed headers for the request.
     */
    allowedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, x-csrf-token, Authorization, X-App-Platform',
};


const crossOrigin = (options: CrossOrigin = DefaultCorsOptions) => cors(options);

export default crossOrigin;