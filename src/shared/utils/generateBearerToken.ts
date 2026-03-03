import axios from "axios";
import { authUrl } from "../../config";

interface TokenRequestBody {
  consumerKey: string;
  consumerSecret: string;
  validityTime: string;
}

export const generateBearerToken = async (consumerKey: string, consumerSecret: string): Promise<string> => {
  if (!consumerKey || !consumerSecret) {
    throw new Error("Consumer Key or Consumer Secret is missing.");
  }

  const requestBody: TokenRequestBody = {
    consumerKey,
    consumerSecret,
    validityTime: "-1",
  };

  try {
    const response = await axios.post(authUrl, requestBody, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });

    if (response.status !== 200) {
      throw new Error(`Service Unavailable, Try Again in a Few Minutes: ${response?.data?.message}`);
    }

    return response?.data?.data?.access_token || "";
  } catch (error: any) {
    console.error("Error generating token:", error.response?.data?.message || error.message || error);
    throw new Error("Service Unavailable, Try Again in a Few Minutes.");
  }
};
