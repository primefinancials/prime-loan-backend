export type MOBILENETWORKS = '01' | '02' | '04' | '03';
export type BONUSTYPE = '01' | '02';
export type CABLETV = 'dstv' | 'gotv' | 'startimes';
export type METERTYPE = "01" | "02";

// Enum for all possible status codes
export enum StatusCode {
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
    INVALID_CREDENTIALS3 = "INVALID_CREDENTIALS3",
    MISSING_CREDENTIALS = "MISSING_CREDENTIALS",
    MISSING_USERID = "MISSING_USERID",
    MISSING_APIKEY = "MISSING_APIKEY",
    MISSING_MOBILENETWORK = "MISSING_MOBILENETWORK",
    INVALID_MOBILENETWORK = "INVALID_MOBILENETWORK",
    MISSING_AMOUNT = "MISSING_AMOUNT",
    INVALID_AMOUNT = "INVALID_AMOUNT",
    MINIMUM_50 = "MINIMUM_50",
    MINIMUM_200000 = "MINIMUM_200000",
    INVALID_RECIPIENT = "INVALID_RECIPIENT",
    ORDER_RECEIVED = "ORDER_RECEIVED",
}
  
// Optional: A map of status codes to their human-readable descriptions
export const StatusDescriptions: Record<StatusCode, string> = {
    [StatusCode.INVALID_CREDENTIALS]: "The UserID and API key combination is not correct.",
    [StatusCode.INVALID_CREDENTIALS3]: "The UserID and API key combination is not correct.",
    [StatusCode.MISSING_CREDENTIALS]: "The URL format is not valid.",
    [StatusCode.MISSING_USERID]: "Username field is empty.",
    [StatusCode.MISSING_APIKEY]: "API Key field is empty.",
    [StatusCode.MISSING_MOBILENETWORK]: "Mobile network is empty.",
    [StatusCode.INVALID_MOBILENETWORK]: "Mobile network is invalid.",
    [StatusCode.MISSING_AMOUNT]: "Amount is empty.",
    [StatusCode.INVALID_AMOUNT]: "Amount is not valid.",
    [StatusCode.MINIMUM_50]: "Minimum amount is 50.",
    [StatusCode.MINIMUM_200000]: "Maximum amount is 200,000.",
    [StatusCode.INVALID_RECIPIENT]: "An invalid mobile phone number was entered.",
    [StatusCode.ORDER_RECEIVED]: "Your order has been received.",
};
  
// Interface using the enum
export interface QueryResponse {
    orderid?: string;
    statuscode: string;
    status: StatusCode;
};
  

export interface WalletBalance {
    date: string;
    id: string;
    phoneno: string;
    balance: string;
};

export interface QueryTransactionResponse extends QueryResponse {
    date: string;
    requestid?: string;
    remark: string;
  
    ordertype: string;
  
    // Common fields
    amountcharged: string;
    walletbalance: string;
  
    // Airtime / Data share
    mobilenetwork?: string;
    mobilenumber?: string;
  
    // Data Card or Education
    phoneno?: string;
    carddetails?: string;
  
    // Cable TV
    smartcardno?: string;
  
    // Electricity
    meterno?: string;
    metertoken?: string;
  
    // Betting or Gaming
    customerid?: string;
}; 

export type VerifySmileResponse = 
  | { customer_name: string } // successful
  | { customer_name: "INVALID_ACCOUNTNO" }; // error

export interface WAECCheckerResponse extends QueryResponse {
    date: string;                     // e.g., "17th-Mar-2019"
    remark: string;                  // e.g., "TRANSACTION SUCCESSFUL"
    ordertype: string;               // e.g., "WAEC Result Checker PIN"
    carddetails: string;            // e.g., "Serial No:WRN200343867, pin: 572871474684"
    phoneno: string;                 // e.g., "08149659347"
    amountcharged: string;          // e.g., "2000"
    walletbalance: string;          // e.g., "863210.1"
};

export interface JAMBCheckerResponse extends QueryResponse {
    date: string;                     // e.g., "17th-Mar-2019"
    remark: string;                  // e.g., "TRANSACTION SUCCESSFUL"
    ordertype: string;               // e.g., "utme"
    carddetails: string;            // e.g., "Serial No:WRN200343867, pin: 572871474684"
    phoneno: string;                 // e.g., "08149659347"
    amountcharged: string;          // e.g., "2000"
    walletbalance: string;          // e.g., "863210.1"
};

export type VerifyJAMBProfileResponse = 
  | { customer_name: string }  // valid response
  | { customer_name: "INVALID_ACCOUNTNO" }; // error response

export type VerifyCableTVResponse =
  | { customer_name: string }                    // Success
  | { customer_name: "INVALID_SMARTCARDNO" };    // Error

export interface ElectricityPurchaseResponse extends QueryResponse {
    meterno: string;       // Meter number used for the purchase
    metertoken: string;    // Token to be entered into the meter, e.g., "000123"
};

export type VerifyElectricityMeterResponse = 
  | { customer_name: string } // Valid response: customer's
  | { customer_name: "INVALID_METERNO" }; // Error response

export interface VerifyBettingCustomerResponse {
    customer_name: string | "Error, Invalid Customer ID"; // Either the actual name e.g., "BALOGUN SUNDAY (BKwise)" or "Error, Invalid Customer ID"
}

export interface DataProduct {
    PRODUCT_SNO: string;
    PRODUCT_CODE: string;
    PRODUCT_ID: string;
    PRODUCT_NAME: string;
    PRODUCT_AMOUNT: string;
}
  
export interface NetworkProduct {
    ID: string;
    PRODUCT: DataProduct[];
}
  
export interface MobileNetwork {
    MOBILE_NETWORK: {
      MTN: NetworkProduct[];
      Glo: NetworkProduct[];
      m_9mobile: NetworkProduct[];
      Airtel: NetworkProduct[];
    };
}

interface Package {
    PACKAGE_ID: string;
    PACKAGE_NAME: string;
    PACKAGE_AMOUNT: string;
    PRODUCT_DISCOUNT_AMOUNT: string;
    PRODUCT_DISCOUNT: string;
    MINAMOUNT: number;
    MAXAMOUNT: number;
}
  
interface ProductProvider {
    ID: string;
    PRODUCT: Package[];
}
  
interface TVProviders {
    DStv: ProductProvider[];
    GOtv: ProductProvider[];
    Startimes: ProductProvider[]; 
    Showmax: ProductProvider[];
}
  
export interface TV_ID_Interface {
    TV_ID: TVProviders;
}

export interface ElectricCompanyData {
    ELECTRIC_COMPANY: {
      [companyKey: string]: ElectricCompany[];
    };
}
  
export interface ElectricCompany {
    ID: string;
    NAME: string;
    PRODUCT: Product[];
}
  
export interface Product {
    PRODUCT_ID: string;
    PRODUCT_TYPE: 'prepaid' | 'postpaid';
    MINIMUN_AMOUNT: string; // Note: spelling should be 'MINIMUM_AMOUNT'
    MAXIMUM_AMOUNT: string;
    PRODUCT_DISCOUNT_AMOUNT: string;
    PRODUCT_DISCOUNT: string;
    MINAMOUNT?: number;
    MAXAMOUNT?: number;
}

export interface BettingCompanyData {
    BETTING_COMPANY: BettingCompany[];
}
  
export interface BettingCompany {
    PRODUCT_CODE: string;
    MINAMOUNT: number;
    MAXAMOUNT: number;
}
  
export interface InternetNetworkData {
    MOBILE_NETWORK: {
      [networkId: string]: MobileNetwork[];
    };
}
  
export interface InternetNetwork {
    ID: string;
    PRODUCT: InternetProduct[];
}
  
export interface InternetProduct {
    PACKAGE_ID: string;
    PACKAGE_NAME: string;
    PACKAGE_AMOUNT: string; // Can be number if parsed
    PRODUCT_DISCOUNT_AMOUNT: string; // Can be number if parsed
    PRODUCT_DISCOUNT: string; // Typically a decimal string like "0.07"
}

export interface ExamTypeData {
    EXAM_TYPE: ExamType[];
}
  
export interface ExamType {
    PRODUCT_CODE: string;
    PRODUCT_DESCRIPTION: string;
    PRODUCT_AMOUNT: string; // Can be changed to number if you prefer numeric handling
}
  
  
  
  
  
  
  
  

  
  
