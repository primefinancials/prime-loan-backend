"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
/**
 * Default configuration options for cross-origin requests.
 */
const DefaultCorsOptions = {
    /**
     * The allowed origin(s) for the request. Use '*' to allow all origins.
     */
    origin: ['*', 'http://localhost:5173', 'http://localhost:8081', 'https://prime-finance-admin.netlify.app', 'https://admin.primefinance.live'],
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
const crossOrigin = (options = DefaultCorsOptions) => (0, cors_1.default)(options);
exports.default = crossOrigin;
