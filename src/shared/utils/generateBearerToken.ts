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
      const response = await axios.post(authUrl, requestBody, {
        headers: { "Content-Type": "application/json" }
      });

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
