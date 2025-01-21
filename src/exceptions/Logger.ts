import fs from 'fs';
import path from 'path';
import { LOG_DIRECTORY } from '../config';
import DailyRotateFile from 'winston-daily-rotate-file';
import { createLogger, transports, format } from 'winston';

let dir = LOG_DIRECTORY;
if (!dir) dir = path.join(__dirname, '../../', 'logs');
console.log(`Log Dir: ${dir}`);
// create directory if it is not present
if (!fs.existsSync(dir)) {
  // Create the directory if it does not exist
  try {
    fs.mkdirSync(dir);
  } catch (e) {
    console.log(`Unable to create dir ${dir}`, (e as Error).message);
  }
}

const logLevel = 'warn';

const dailyRotateFile = new DailyRotateFile({
  level: logLevel,
  // @ts-ignore
  filename: dir + '/%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  handleExceptions: true,
  // maxSize: '20m', // 20MB
  maxFiles: '28d',
  format: format.combine(
    format.errors({ stack: true }),
    format.timestamp(),
    format.json()
  ),
});

export default createLogger({
  transports: [
    // new transports.Console({
    //   level: logLevel,
    //   format: format.combine(
    //     format.errors({ stack: true }),
    //     format.prettyPrint(),
    //   ),
    // }),
    new transports.File({
      filename: path.join(dir, 'mongoose-monitor.log'),
      handleExceptions: true,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    dailyRotateFile,
  ],
  exceptionHandlers: [dailyRotateFile],
  exitOnError: false, // do not exit on handled exceptions
});