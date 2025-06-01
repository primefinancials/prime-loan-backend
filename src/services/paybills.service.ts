import axios from "axios";
import { CLUB_KONNECT_API_URLs } from "../config";
import { APIError } from "../exceptions";
import { 
    StatusCode, 
    StatusDescriptions, 
    QueryResponse, 
    WalletBalance, 
    MOBILENETWORKS, 
    BONUSTYPE, 
    CABLETV, 
    METERTYPE,
    QueryTransactionResponse,
    VerifySmileResponse,
    WAECCheckerResponse,
    JAMBCheckerResponse,
    VerifyCableTVResponse,
    VerifyElectricityMeterResponse,
    ElectricityPurchaseResponse,
    VerifyBettingCustomerResponse,
    VerifyJAMBProfileResponse,
    MobileNetwork,
    TV_ID_Interface,
    ElectricCompanyData,
    BettingCompanyData,
    InternetNetworkData,
    ExamTypeData
} from "../interfaces";

function addEightPercent(value: number) {
  return String(value + (value * 0.03));
}
export class PaybillsService {
    private handleResponse<T>(response: { data: T & { statuscode?: string; status?: StatusCode } }): T {
        console.log("Response:", response);
        console.log("Response data:", response.data);
        console.log("Response status code:", response.data.statuscode);
        console.log("Response status:", response.data.status);

        if (response.data && response.data.status && response.data.status !== StatusCode.ORDER_RECEIVED) {
            throw new APIError(Number(response.data.statuscode), StatusDescriptions[response.data.status as StatusCode] || "System busy, try again later");
        }

        return { ...response.data, status: response.data.status as StatusCode };
    };

    public async CheckWalletBalance(): Promise<WalletBalance> {
        const response = await axios.get<WalletBalance>(CLUB_KONNECT_API_URLs.check_wallet_balance());

        return response.data;
    };

    public async QueryTransaction(orderId: number): Promise<QueryTransactionResponse> {
        const response = await axios.get<QueryTransactionResponse>(
          CLUB_KONNECT_API_URLs.query_transaction(orderId)
        );
        return this.handleResponse(response);
    };

    public async CancelTransaction(orderId: number): Promise<QueryResponse> {
        const response = await axios.get<QueryResponse>(CLUB_KONNECT_API_URLs.cancel_transaction(orderId));

        return this.handleResponse(response);
    };

    public async BuyAirtime(
        amount: number,
        mobileNumber: number,
        mobileNetwork: MOBILENETWORKS,
        bonusType?: BONUSTYPE
    ): Promise<QueryResponse> {
        const response = await axios.get<QueryResponse>(
          CLUB_KONNECT_API_URLs.buy_airtime(amount, mobileNumber, mobileNetwork, bonusType)
        );

        return this.handleResponse(response);
    }; 

    public async GetDataPlans(): Promise<MobileNetwork> {
        const response = await axios.get<MobileNetwork>(CLUB_KONNECT_API_URLs.data_plans());

        return ({
            MOBILE_NETWORK: {
                Airtel: [{
                    ID: response.data.MOBILE_NETWORK.Airtel[0].ID,
                    PRODUCT: response.data.MOBILE_NETWORK.Airtel[0].PRODUCT.map((atl) => ({ ...atl, PRODUCT_AMOUNT: addEightPercent(Number(atl.PRODUCT_AMOUNT)) }))
                }],
                Glo: [{
                    ID: response.data.MOBILE_NETWORK.Glo[0].ID,
                    PRODUCT: response.data.MOBILE_NETWORK.Glo[0].PRODUCT.map((atl) => ({ ...atl, PRODUCT_AMOUNT: addEightPercent(Number(atl.PRODUCT_AMOUNT)) }))
                }],
                m_9mobile: [{
                    ID: response.data.MOBILE_NETWORK.m_9mobile[0].ID,
                    PRODUCT: response.data.MOBILE_NETWORK.m_9mobile[0].PRODUCT.map((atl) => ({ ...atl, PRODUCT_AMOUNT: addEightPercent(Number(atl.PRODUCT_AMOUNT)) }))
                }],
                MTN: [{
                    ID: response.data.MOBILE_NETWORK.MTN[0].ID,
                    PRODUCT: response.data.MOBILE_NETWORK.MTN[0].PRODUCT.map((atl) => ({ ...atl, PRODUCT_AMOUNT: addEightPercent(Number(atl.PRODUCT_AMOUNT)) }))
                }],
            }
        });
    };

    public async BuyData(dataPlan: number, mobileNumber: number, mobileNetwork: MOBILENETWORKS): Promise<QueryResponse> {
        const response = await axios.get<QueryResponse>(CLUB_KONNECT_API_URLs.buy_data(dataPlan, mobileNumber, mobileNetwork));

        return this.handleResponse(response);
    };

    public async GetTvPackages(): Promise<TV_ID_Interface> {
        const response = await axios.get<TV_ID_Interface>(CLUB_KONNECT_API_URLs.tv_packages());

        return ({
            TV_ID: {
                DStv: [{
                    ID: response.data.TV_ID.DStv[0].ID,
                    PRODUCT: response.data.TV_ID.DStv[0].PRODUCT.map((atl) => ({ ...atl, PACKAGE_AMOUNT: addEightPercent(Number(atl.PACKAGE_AMOUNT)) }))
                }],
                GOtv: [{
                    ID: response.data.TV_ID.GOtv[0].ID,
                    PRODUCT: response.data.TV_ID.GOtv[0].PRODUCT.map((atl) => ({ ...atl, PACKAGE_AMOUNT: addEightPercent(Number(atl.PACKAGE_AMOUNT)) }))
                }],
                Showmax: [{
                    ID: response.data.TV_ID.Showmax[0].ID,
                    PRODUCT: response.data.TV_ID.Showmax[0].PRODUCT.map((atl) => ({ ...atl, PACKAGE_AMOUNT: addEightPercent(Number(atl.PACKAGE_AMOUNT)) }))
                }],
                Startimes: [{
                    ID: response.data.TV_ID.Startimes[0].ID,
                    PRODUCT: response.data.TV_ID.Startimes[0].PRODUCT.map((atl) => ({ ...atl, PACKAGE_AMOUNT: addEightPercent(Number(atl.PACKAGE_AMOUNT)) }))
                }],
            }
        });
    };

    public async VerifyTvNumber(cableTV: CABLETV, smartCardNo: number): Promise<VerifyCableTVResponse> {
        const response = await axios.get<VerifyCableTVResponse>(CLUB_KONNECT_API_URLs.verify_tv_no(cableTV, smartCardNo));

        return response.data;
    };

    public async BuyTv(cableTV: CABLETV, pkg: string, smartCardNo: number, phoneNo: number): Promise<QueryResponse> {
        const response = await axios.get<QueryResponse>(CLUB_KONNECT_API_URLs.buy_tv(cableTV, pkg, smartCardNo, phoneNo));

        return this.handleResponse(response);
    };

    public async GetPowerSubscriptions(): Promise<ElectricCompanyData> {
        const response = await axios.get<ElectricCompanyData>(CLUB_KONNECT_API_URLs.power_subscriptions());

        return response.data;
    };

    public async VerifyPowerNumber(electricCompany: string, meterNo: number): Promise<VerifyElectricityMeterResponse> {
        const response = await axios.get<VerifyElectricityMeterResponse>(CLUB_KONNECT_API_URLs.verify_power_no(electricCompany, meterNo));

        return response.data;
    };

    public async BuyPower(electricCompany: string, meterType: METERTYPE, meterNo: number, amount: number, phoneNo: number): Promise<ElectricityPurchaseResponse> {
        const response = await axios.get<ElectricityPurchaseResponse>(CLUB_KONNECT_API_URLs.buy_power(electricCompany, meterType, meterNo, amount, phoneNo));

        return this.handleResponse(response);
    };

    public async GetBettingPlatforms(): Promise<BettingCompanyData> {
        const response = await axios.get<BettingCompanyData>(CLUB_KONNECT_API_URLs.betting_platforms());

        return response.data;
    }

    public async VerifyBettingNumber(bettingCompany: string, customerId: number): Promise<VerifyBettingCustomerResponse> {
        const response = await axios.get<VerifyBettingCustomerResponse>(CLUB_KONNECT_API_URLs.verify_betting_no(bettingCompany, customerId));

        return response.data;
    }

    public async BuyBetting(bettingCompany: string, customerId: number, amount: number): Promise<QueryResponse> {
        const response = await axios.get<QueryResponse>(CLUB_KONNECT_API_URLs.buy_betting(bettingCompany, customerId, amount));

        return this.handleResponse(response);
    }

    public async GetInternetPlans(mobileNetwork: "smile-direct" | "spectranet"): Promise<InternetNetworkData> {
        const response = await axios.get<InternetNetworkData>(CLUB_KONNECT_API_URLs.internet_plans(mobileNetwork));

        return response.data;
    }

    public async VerifySmileNumber(mobileNumber: number): Promise<VerifySmileResponse> {
        const response = await axios.get<VerifySmileResponse>(CLUB_KONNECT_API_URLs.verify_smile_no("smile-direct", mobileNumber));

        return response.data;
    }

    public async BuyInternet(mobileNetwork: "smile-direct" | "spectranet", dataPlan: string, mobileNumber: number): Promise<QueryResponse> {
        const response = await axios.get<QueryResponse>(CLUB_KONNECT_API_URLs.buy_internet(mobileNetwork, dataPlan, mobileNumber));

        return this.handleResponse(response);
    }

    public async GetWaecTypes(): Promise<ExamTypeData> {
        const response = await axios.get<ExamTypeData>(CLUB_KONNECT_API_URLs.waec_types());

        return response.data;
    }

    public async BuyWaec(examType: string, phoneNo: number): Promise<WAECCheckerResponse> {
        const response = await axios.get<WAECCheckerResponse>(CLUB_KONNECT_API_URLs.buy_waec(examType, phoneNo));

        return this.handleResponse(response);
    }

    public async GetJambTypes(): Promise<ExamTypeData> {
        const response = await axios.get<ExamTypeData>(CLUB_KONNECT_API_URLs.jamb_types());

        return response.data;
    }

    public async VerifyJambNumber(examType: string, profileId: number): Promise<VerifyJAMBProfileResponse> {
        const response = await axios.get<VerifyJAMBProfileResponse>(CLUB_KONNECT_API_URLs.verify_jamb_no(examType, profileId));

        return response.data;
    }

    public async BuyJamb(examType: string, phoneNo: number): Promise<JAMBCheckerResponse> {
        const response = await axios.get<JAMBCheckerResponse>(CLUB_KONNECT_API_URLs.buy_jamb(examType, phoneNo));

        return this.handleResponse(response);
    }
}