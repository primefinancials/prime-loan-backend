/**
 * Normalized Bill Payment Provider Interface
 * -------------------------------------------
 * Unified contract that both Flutterwave and PayBeta implement.
 * The frontend receives identical data regardless of active provider.
 */

/* ---------- Unified Data Types ---------- */

export interface BillCategory {
  id: string;
  name: string;
  description: string;
}

export interface BillBiller {
  id: string;
  name: string;
  categoryId: string;
  logo?: string;
}

export interface BillProduct {
  id: string;
  name: string;
  billerId: string;
  amount: number;
  description?: string;
  duration?: string; // e.g. "7 days", "30 days", "1 month"
  item_code?: string; // Legacy field for frontend compatibility
}

export interface BillProviderResult {
  success: boolean;
  reference: string;
  status: string;
  message?: string;
  meta?: Record<string, any>;
}

export interface BillValidationResult {
  name: string;
  valid: boolean;
  meta?: Record<string, any>;
}

/* ---------- Unified Request Types ---------- */

export interface AirtimePurchaseParams {
  phone: string;
  amount: number;
  network?: string; // e.g., 'MTN', 'Glo', 'Airtel', '9mobile'
  reference: string;
}

export interface DataPurchaseParams {
  phone: string;
  amount: number;
  bundleCode: string;
  network?: string;
  reference: string;
}

export interface TVPurchaseParams {
  smartcardNo: string;
  amount: number;
  bouquetCode: string;
  provider: string; // e.g., 'dstv', 'gotv', 'startimes'
  reference: string;
}

export interface PowerPurchaseParams {
  meterNo: string;
  amount: number;
  meterType: string; // 'prepaid' | 'postpaid'
  provider: string;  // e.g., 'IKEDC', 'EKEDC', etc.
  reference: string;
}

export interface BettingPurchaseParams {
  customerId: string;
  amount: number;
  provider: string; // e.g., 'bet9ja', 'betking'
  reference: string;
}

export interface ValidationParams {
  serviceType: string;       // 'tv' | 'power' | 'betting'
  customerRef: string;       // smartcard/meter/customer ID
  provider?: string;         // biller code or provider name
  itemCode?: string;         // item/product code (Flutterwave)
}

/* ---------- Provider Interface ---------- */

export interface NormalizedBillProvider {
  /** Provider name for logging/identification */
  readonly providerName: string;

  /** Purchase airtime */
  purchaseAirtime(params: AirtimePurchaseParams): Promise<BillProviderResult>;

  /** Purchase data bundle */
  purchaseData(params: DataPurchaseParams): Promise<BillProviderResult>;

  /** Purchase TV subscription */
  purchaseTV(params: TVPurchaseParams): Promise<BillProviderResult>;

  /** Purchase electricity token */
  purchasePower(params: PowerPurchaseParams): Promise<BillProviderResult>;

  /** Fund betting wallet */
  purchaseBetting(params: BettingPurchaseParams): Promise<BillProviderResult>;

  /** Validate a customer account (meter, smartcard, etc.) */
  validateAccount(params: ValidationParams): Promise<BillValidationResult>;

  /** Fetch bill categories */
  getCategories(): Promise<BillCategory[]>;

  /** Fetch billers for a category */
  getBillers(categoryId: string): Promise<BillBiller[]>;

  /** Fetch products for a biller */
  getProducts(billerId: string): Promise<BillProduct[]>;

  /** Get provider wallet/balance */
  getBalance(): Promise<{ balance: number }>;

  /** Check if provider is reachable */
  healthCheck(): Promise<boolean>;
}
