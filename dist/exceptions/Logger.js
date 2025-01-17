"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
const winston_daily_rotate_file_1 = __importDefault(require("winston-daily-rotate-file"));
const winston_1 = require("winston");
let dir = config_1.LOG_DIRECTORY;
if (!dir)
    dir = path_1.default.join(__dirname, '../../', 'logs');
console.log(`Log Dir: ${dir}`);
// create directory if it is not present
if (!fs_1.default.existsSync(dir)) {
    // Create the directory if it does not exist
    try {
        fs_1.default.mkdirSync(dir);
    }
    catch (e) {
        console.log(`Unable to create dir ${dir}`, e.message);
    }
}
const logLevel = 'warn';
const dailyRotateFile = new winston_daily_rotate_file_1.default({
    level: logLevel,
    // @ts-ignore
    filename: dir + '/%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    handleExceptions: true,
    // maxSize: '20m', // 20MB
    maxFiles: '28d',
    format: winston_1.format.combine(winston_1.format.errors({ stack: true }), winston_1.format.timestamp(), winston_1.format.json()),
});
exports.default = (0, winston_1.createLogger)({
    transports: [
        // new transports.Console({
        //   level: logLevel,
        //   format: format.combine(
        //     format.errors({ stack: true }),
        //     format.prettyPrint(),
        //   ),
        // }),
        new winston_1.transports.File({
            filename: path_1.default.join(dir, 'mongoose-monitor.log'),
            handleExceptions: true,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        dailyRotateFile,
    ],
    exceptionHandlers: [dailyRotateFile],
    exitOnError: false, // do not exit on handled exceptions
});
