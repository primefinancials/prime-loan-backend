import { ApiResponse, Logger, } from '../exceptions';
import { DB_URL, DB_OPTIONS, } from '../config';
import mongoose, { disconnect, connect, } from 'mongoose';
import { ErrorRequestHandler, NextFunction, Request, Response, } from 'express';

mongoose.Promise = global.Promise;
mongoose.set('strictQuery', false);

let connectionTimeout = 5000
let trialThreshold = 3
export function connectToDB() {
  console.log('Connecting to MongoDB...')
  connect(
    DB_URL as string,
    DB_OPTIONS
  ).then(() => connectSuccessful())
    .catch(error => {
      console.log({ DB_error: error })
      if (trialThreshold < 1) {
        Logger.error('Unable to connect to database after several attempts\n');
        connectError(error);
        disconnectDB();
      } else {
        --trialThreshold;
        console.log(`MongoDB connection error. Retrying in ${connectionTimeout / 1000} seconds...`);
        setTimeout(connectToDB, connectionTimeout += 2000);
      }
    });
};

const connectSuccessful = () => {
  console.log(`DB Connection: Successful`);
};

const connectError = (error: any) => {
  // Logger.error({error});
  // console.log(`${chalk.italic.yellow('DB Connection')}: ${chalk.red('Error')}`);
  // console.log(`${chalk.red(error)}`);
};

export const disconnectDB = async () => {
  disconnect().then(() => {
    console.log('MongoDB disconnected successfully');
    process.exit(0); // exit with success code
  }).catch((error: any) => {
    console.error('Error disconnecting from MongoDB:', error);
    process.exit(1); // exit with error code
  });
};

process.on('SIGINT', () => {
  disconnectDB();
})

export const connectionStateCheck = () => (req: Request, res: Response) => {
  res.json({
    status: true,
    message: 'Prime-user-v1 health check passed ✅',
  });
};

export const requestErrorHandler = () => (
  err: ErrorRequestHandler,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.log({ err, })
  if ((err as any)?.status === 429) return res.status(429).json({
    message: 'Too many requests, please try again later.',
    retryAfter: (err as any)?.headers['Retry-After'],
  });
  if (err instanceof ApiResponse) return err.send(res);

  // @ts-expect-error
  return res.status(err?.status || 500).json(['development', 'local'].includes(ENV) ? err : {});
};

export const pageNotFound = () => (req: Request, res: Response) => {
  res.sendStatus(404);
};