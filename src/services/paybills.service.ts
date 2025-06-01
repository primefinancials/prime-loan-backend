import {
    OAuthClient,
    InterswitchAuthClient
} from "../utils/interswitch.auth";

interface Biller {
    Id: number;
    Name: string;
    ShortName: string;
    CategoryId: number;
    CategoryName: string;
    PaymentCode?: string;
}

interface Category {
    Id: number;
    Name: string;
    Description: string;
    Billers: Biller[];
}

interface PaymentItem {
    Id: string;
    Name: string;
    PaymentCode: string;
    Amount: number;
    BillerId: string;
}

interface CustomerValidationItem {
    PaymentCode: string;
    CustomerId: string;
}

interface CustomerValidationResult {
    BillerId: number;
    PaymentCode: string;
    CustomerId: string;
    ResponseCode: string;
    FullName: string;
    Amount: number;
    AmountType: number;
    AmountTypeDescription: string;
    Surcharge: number;
}

interface CustomerValidationResponse {
    Customers: CustomerValidationResult[];
    ResponseCode: string;
    ResponseCodeGrouping: string;
}

interface PaymentRequest {
    paymentCode: string;
    customerId: string;
    amount: string;
    customerMobile?: string;
    customerEmail?: string;
    requestReference: string;
}

interface TransactionStatus {
    status: string;
    transactionRef: string;
    amount: string;
    responseCode: string;
}

const oauthClient = new OAuthClient(
  'YOUR_CLIENT_ID',
  'YOUR_SECRET_KEY',
  'https://passport.k8.isw.la/passport/oauth/token',
  'https://api.interswitchng.com'
);

export class PaybillsService {
    private oauthClient: any;
    private terminalId: string;
    private baseUrl = "https://qa.interswitchng.com/quicktellerservice/api/v5";

    constructor(oauthClient: any, terminalId: string) {
        this.terminalId = terminalId;
    }

    private async makeRequest(config: { method: string; url: string; data?: any }) {
        try {
            const response = await this.oauthClient.request({
                ...config,
                headers: {
                    'TerminalID': this.terminalId,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error: any) {
            throw new Error(`API request failed: ${error.message}`);
        }
    }

    async getBillers(): Promise<Biller[]> {
        const response = await this.makeRequest({
            method: 'GET',
            url: `${this.baseUrl}/services`
        });
        return response.BillerList.Category.flatMap((c: Category) => c.Billers);
    }

    async getBillerCategories(): Promise<Category[]> {
        const response = await this.makeRequest({
            method: 'GET',
            url: `${this.baseUrl}/services/categories`
        });
        return response.BillerCategories;
    }

    async getBillerPaymentItems(billerId: string): Promise<PaymentItem[]> {
        const response = await this.makeRequest({
            method: 'GET',
            url: `${this.baseUrl}/services/options?serviceid=${billerId}`
        });
        return response.PaymentItems;
    }

    async validateCustomer(request: {
        customers: CustomerValidationItem[];
        TerminalId: string;
    }): Promise<CustomerValidationResponse> {
        return this.makeRequest({
            method: 'POST',
            url: `${this.baseUrl}/Transactions/validatecustomers`,
            data: {
                ...request,
                TerminalId: this.terminalId
            }
        });
    }

    async makePayment(request: PaymentRequest): Promise<TransactionStatus> {
        return this.makeRequest({
            method: 'POST',
            url: `${this.baseUrl}/Transactions`,
            data: request
        });
    }

    async getTransactionStatus(requestRef: string): Promise<TransactionStatus> {
        return this.makeRequest({
            method: 'GET',
            url: `${this.baseUrl}/Transactions?requestRef=${requestRef}`
        });
    }
}

const billsClient = new PaybillsService(oauthClient, '3PBL0001');

// Example Controller Usage
async function processDSTVPayment() {
    try {
        // Step 1: Get Billers
        const billers = await billsClient.getBillers();
        const dstvBiller = billers.find(b => b.Name === 'DSTV');
        
        // Step 2: Get Payment Items
        const paymentItems = await billsClient.getBillerPaymentItems(dstvBiller?.Id.toString() || '');
        
        // Step 3: Validate Customer
        const validation = await billsClient.validateCustomer({
            customers: [{
                PaymentCode: paymentItems[0].PaymentCode,
                CustomerId: '0000000001'
            }],
            TerminalId: '3PBL'
        });
        
        // Step 4: Make Payment
        const paymentResponse = await billsClient.makePayment({
            paymentCode: paymentItems[0].PaymentCode,
            customerId: '0000000001',
            amount: '1460000',
            requestReference: '1453' + Date.now().toString()
        });
        
        // Step 5: Check Status
        const status = await billsClient.getTransactionStatus(paymentResponse.transactionRef);
        return status;
    } catch (error) {
        console.error('Payment processing failed:', error);
    }
}
