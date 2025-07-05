import { DB_URL, DB_OPTIONS, } from '../config';
import mongoose, { disconnect, connect, } from 'mongoose';
import { NextFunction, Request, Response, } from 'express';

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
        console.error('Unable to connect to database after several attempts\n');
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
  console.error('Database connection error:', error);
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