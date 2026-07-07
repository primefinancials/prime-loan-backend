import axios from "axios";
import { authUrl } from "../../config";

let cachedToken: string | null = null;
let tokenPromise: Promise<string> | null = null;

export const clearBearerToken = () => {
  cachedToken = null;
  tokenPromise = null;
};

interface TokenRequestBody {
  consumerKey: string;
  consumerSecret: string;
  validityTime: string;
}

export const generateBearerToken = async (consumerKey: string, consumerSecret: string): Promise<string> => {
  if (!consumerKey || !consumerSecret) {
    throw new Error("Consumer Key or Consumer Secret is missing.");
  }

  if (cachedToken) {
    return cachedToken;
  }

  // Prevent multiple concurrent token requests
  if (tokenPromise) {
    return tokenPromise;
  }

  const requestBody: TokenRequestBody = {
    consumerKey,
    consumerSecret,
    validityTime: "-1",
  };

  tokenPromise = (async () => {
    try {
      const config: any = {
        headers: { 
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*"
        }
      };

      if (process.env.FORWARD_PROXY_URL) {
        const { HttpsProxyAgent } = require("https-proxy-agent");
        config.httpsAgent = new HttpsProxyAgent(process.env.FORWARD_PROXY_URL);
      }

      const response = await axios.post(authUrl, requestBody, config);

      if (response.status !== 200) {
        throw new Error(`Service Unavailable, Try Again in a Few Minutes: ${response?.data?.message}`);
      }

      cachedToken = response?.data?.data?.access_token || response?.data?.access_token || "";
      tokenPromise = null;
      
      if (!cachedToken) {
        console.warn("VFD Token generation returned an empty token!", response.data);
      }
      
      return cachedToken as string;
    } catch (error: any) {
      tokenPromise = null;
      console.error("Error generating token:", error.response?.data?.message || error.message || error);
      throw new Error("Service Unavailable, Try Again in a Few Minutes.");
    }
  })();

  return tokenPromise;
};
