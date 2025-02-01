"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = crossOrigin;
// import { ENV, } from '../config';
const cors_1 = __importDefault(require("cors"));
const ENV = process.env.ENV || 'dev';
/**
 * Default configuration options for cross-origin requests.
 */
const DefaultCorsOptions = {
    /**
     * The allowed origin(s) for the request. Use '*' to allow all origins.
     */
    origin: ENV === 'dev' ?
        ['*'] :
        // (Production)
        [
            '*',
            // Remove the above origin and add the expected ones as needed
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
function crossOrigin(options = DefaultCorsOptions) {
    return (0, cors_1.default)(options);
}
