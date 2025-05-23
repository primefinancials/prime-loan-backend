import '../config/envConfig';
import { ConnectOptions } from 'mongoose';
import { CABLETV, METERTYPE, MOBILENETWORKS, BONUSTYPE } from '../interfaces';

const PORT = process.env.PORT || 3000;
export const customerKey = process.env.CUSTOMER_KEY!;
export const customerSecret = process.env.CUSTOMER_SECRET!;
export const baseUrl = process.env.BASE_URL!;
export const authUrl = process.env.AUTH_URL!;
const CRYPTOJS_KEY = process.env.CRYPTOJS_KEY;
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;
const EMAIL_VERIFICATION_CODE_EXPIRES_IN = process.env.EMAIL_VERIFICATION_CODE_EXPIRES_IN;
// Define specific types for the variables
const DB_URL = process.env.DB_URL;

const DB_OPTIONS: ConnectOptions = {
  autoIndex: true,
  minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE || '5'), // Maintain up to x socket connections
  maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE || '20'), // Maintain up to x socket connections
  connectTimeoutMS: 60000, // Give up initial connection after 60 seconds
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  // @ts-ignore
  //   useNewUrlParser: true,
  //   useUnifiedTopology: true,
  dbName: process.env.DATABASE_NAME,
};

const LOG_DIRECTORY = process.env.LOG_DIRECTORY || '';

const REDIS_CREDENTIALS = {
  host: process.env.REDIS_HOST || '',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || '',
};

const EMAIL_USERNAME = process.env.EMAIL_USERNAME;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT_NUMBER = process.env.EMAIL_PORT_NUMBER;
const EMAIL_INTERVAL = process.env.EMAIL_INTERVAL;

export const CLUB_KONNECT_API_KEY = process.env.CLUB_KONNECT_API_KEY;
export const CLUB_KONNECT_API_USER_ID = process.env.CLUB_KONNECT_API_USER_ID;
export const CLUB_KONNECT_API_URL = process.env.CLUB_KONNECT_API_URL;
export const APIAUTH = `?UserID=${CLUB_KONNECT_API_USER_ID}&APIKey=${CLUB_KONNECT_API_KEY}`;

export const CLUB_KONNECT_API_URLs = {
  check_wallet_balance: () => `${CLUB_KONNECT_API_URL}/APIWalletBalanceV1.asp${APIAUTH}`,

  query_transaction: (OrderID: number) => `${CLUB_KONNECT_API_URL}/APIQueryV1.asp${APIAUTH}&OrderID=${OrderID}`,
  cancel_transaction: (OrderID: number) => `${CLUB_KONNECT_API_URL}/APICancelV1.asp${APIAUTH}&OrderID=${OrderID}`,

  buy_airtime: (Amount: number, MobileNumber: number, MobileNetwork: MOBILENETWORKS, BOnusType?: BONUSTYPE) => 
    `${CLUB_KONNECT_API_URL}/APIAirtimeV1.asp${APIAUTH}&Amount=${Amount}&MobileNumber=${MobileNumber}&MobileNetwork=${MobileNetwork}${BOnusType ? `&BonusType=${BOnusType}` : ''}`
  ,

  data_plans: () => `${CLUB_KONNECT_API_URL}/APIDatabundlePlansV2.asp?UserID=${CLUB_KONNECT_API_USER_ID}`,
  buy_data: (DataPlan: number, MobileNumber: number, MobileNetwork: MOBILENETWORKS) => 
    `${CLUB_KONNECT_API_URL}/APIDatabundleV1.asp${APIAUTH}&DataPlan=${DataPlan}&MobileNumber=${MobileNumber}&MobileNetwork=${MobileNetwork}`
  ,

  tv_packages: () => `${CLUB_KONNECT_API_URL}/APICableTVPackagesV2.asp`,
  verify_tv_no: (CableTV: CABLETV, SmartCardNo: number) =>
    `${CLUB_KONNECT_API_URL}/APIVerifyCableTVV1.0.asp${APIAUTH}&CableTV=${CableTV}&SmartCardNo=${SmartCardNo}`
  ,
  buy_tv: (CableTV: CABLETV, Package: string, SmartCardNo: number, PhoneNo: number) =>
    `${CLUB_KONNECT_API_URL}/APICableTVV1.asp${APIAUTH}&CableTV=${CableTV}&Package=${Package}&SmartCardNo=${SmartCardNo}&PhoneNo=${PhoneNo}`
  ,

  power_subscriptions: () => `${CLUB_KONNECT_API_URL}/APIElectricityDiscosV1.asp`,
  verify_power_no: (ElectricCompany: string, meterno: number) =>
    `${CLUB_KONNECT_API_URL}/APIVerifyElectricityV1.asp${APIAUTH}&ElectricCompany=${ElectricCompany}&meterno=${meterno}`
  ,
  buy_power: (ElectricCompany: string, MeterType: METERTYPE, MeterNo: number, Amount: number, PhoneNo: number) =>
    `${CLUB_KONNECT_API_URL}/APIElectricityV1.asp${APIAUTH}&ElectricCompany=${ElectricCompany}&MeterType=${MeterType}&MeterNo=${MeterNo}&Amount=${Amount}&PhoneNo=${PhoneNo}`
  ,

  betting_platforms: () => `${CLUB_KONNECT_API_URL}/APIBettingCompaniesV2.asp`,
  verify_betting_no: (BettingCompany: string, CustomerID: number) =>
    `${CLUB_KONNECT_API_URL}/APIVerifyBettingV1.asp${APIAUTH}&BettingCompany=${BettingCompany}&CustomerID=${CustomerID}`
  ,
  buy_betting: (BettingCompany: string, CustomerID: number, Amount: number) =>
    `${CLUB_KONNECT_API_URL}/APIBettingV1.asp${APIAUTH}&BettingCompany=${BettingCompany}&CustomerID=${CustomerID}&Amount=${Amount}`
  ,

  internet_plans: (MobileNetwork: "smile-direct" | "spectranet") => `${CLUB_KONNECT_API_URL}/${MobileNetwork == "smile-direct"? "APISmilePackagesV2" : "APISpectranetPackagesV2"}.asp`,
  verify_smile_no: (MobileNetwork: "smile-direct", MobileNumber: number) =>
    `${CLUB_KONNECT_API_URL}/APIVerifySmileV1.asp${APIAUTH}&MobileNetwork=${MobileNetwork}&MobileNumber=${MobileNumber}`
  ,
  buy_internet: (MobileNetwork: "smile-direct" | "spectranet", DataPlan: string, MobileNumber: number) =>
    `${CLUB_KONNECT_API_URL}/${MobileNetwork == "smile-direct"? "APIElectricityV1": "APISpectranetV1"}.asp${APIAUTH}&MobileNetwork=${MobileNetwork}&DataPlan=${DataPlan}&MobileNumber=${MobileNumber}`
  ,

  waec_types: () => `${CLUB_KONNECT_API_URL}/APIWAECPackagesV2.asp`,
  buy_waec: (ExamType: string, PhoneNo: number) =>
    `${CLUB_KONNECT_API_URL}/APIWAECV1.asp${APIAUTH}&ExamType=${ExamType}&PhoneNo=${PhoneNo}`
  ,

  jamb_types: () => `${CLUB_KONNECT_API_URL}/APIJAMBPackagesV2.asp`,
  verify_jamb_no: (ExamType: string, ProfileID: number) =>
    `${CLUB_KONNECT_API_URL}/APIVerifyJAMBV1.asp${APIAUTH}&ExamType=${ExamType}&ProfileID=${ProfileID}`
  ,
  buy_jamb: (ExamType: string, PhoneNo: number) =>
    `${CLUB_KONNECT_API_URL}/APIJAMBV1.asp${APIAUTH}&ExamType=${ExamType}&PhoneNo=${PhoneNo}`
  ,
};

export {
  PORT,
  DB_URL,
  DB_OPTIONS,
  CRYPTOJS_KEY,
  REDIS_CREDENTIALS,
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
  LOG_DIRECTORY,
  EMAIL_USERNAME,
  EMAIL_PASSWORD,
  EMAIL_HOST,
  EMAIL_PORT_NUMBER,
  EMAIL_INTERVAL,
  EMAIL_VERIFICATION_CODE_EXPIRES_IN,
};