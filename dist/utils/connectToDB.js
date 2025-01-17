"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pageNotFound = exports.requestErrorHandler = exports.connectionStateCheck = exports.disconnectDB = void 0;
exports.connectToDB = connectToDB;
const exceptions_1 = require("../exceptions");
const config_1 = require("../config");
const mongoose_1 = __importStar(require("mongoose"));
mongoose_1.default.Promise = global.Promise;
mongoose_1.default.set('strictQuery', false);
let connectionTimeout = 5000;
let trialThreshold = 3;
function connectToDB() {
    console.log('Connecting to MongoDB...');
    (0, mongoose_1.connect)(config_1.DB_URL, config_1.DB_OPTIONS).then(() => connectSuccessful())
        .catch(error => {
        console.log({ DB_error: error });
        if (trialThreshold < 1) {
            exceptions_1.Logger.error('Unable to connect to database after several attempts\n');
            connectError(error);
            (0, exports.disconnectDB)();
        }
        else {
            --trialThreshold;
            console.log(`MongoDB connection error. Retrying in ${connectionTimeout / 1000} seconds...`);
            setTimeout(connectToDB, connectionTimeout += 2000);
        }
    });
}
;
const connectSuccessful = () => {
    console.log(`DB Connection: Successful`);
};
const connectError = (error) => {
    // Logger.error({error});
    // console.log(`${chalk.italic.yellow('DB Connection')}: ${chalk.red('Error')}`);
    // console.log(`${chalk.red(error)}`);
};
const disconnectDB = () => __awaiter(void 0, void 0, void 0, function* () {
    (0, mongoose_1.disconnect)().then(() => {
        console.log('MongoDB disconnected successfully');
        process.exit(0); // exit with success code
    }).catch((error) => {
        console.error('Error disconnecting from MongoDB:', error);
        process.exit(1); // exit with error code
    });
});
exports.disconnectDB = disconnectDB;
process.on('SIGINT', () => {
    (0, exports.disconnectDB)();
});
const connectionStateCheck = () => (req, res) => {
    res.json({
        status: true,
        message: 'Prime-user-v1 health check passed ✅',
    });
};
exports.connectionStateCheck = connectionStateCheck;
const requestErrorHandler = () => (err, req, res, next) => {
    console.log({ err, });
    if ((err === null || err === void 0 ? void 0 : err.status) === 429)
        return res.status(429).json({
            message: 'Too many requests, please try again later.',
            retryAfter: err === null || err === void 0 ? void 0 : err.headers['Retry-After'],
        });
    if (err instanceof exceptions_1.ApiResponse)
        return err.send(res);
    // @ts-expect-error
    return res.status((err === null || err === void 0 ? void 0 : err.status) || 500).json(['development', 'local'].includes(ENV) ? err : {});
};
exports.requestErrorHandler = requestErrorHandler;
const pageNotFound = () => (req, res) => {
    res.sendStatus(404);
};
exports.pageNotFound = pageNotFound;
