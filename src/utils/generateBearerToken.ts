import axios from "axios";

interface TokenRequestBody {
  consumerKey: string;
  consumerSecret: string;
  validityTime: string;
}

export const generateBearerToken = async (consumerKey: string, consumerSecret: string): Promise<string> => {
  if (!consumerKey || !consumerSecret) {
    throw new Error("Consumer Key or Consumer Secret is missing.");
  }

  const url = "https://api-apps.vfdbank.systems/vfd-tech/baas-portal/v1.1/baasauth/token";
  const requestBody: TokenRequestBody = {
    consumerKey,
    consumerSecret,
    validityTime: "-1",
  };

  try {
    const response = await axios.post(url, requestBody, {
      headers: { "Content-Type": "application/json" },
    });

    if (response.status !== 200) {
      throw new Error(`Failed to generate access token: ${response.data.message}`);
    }

    return response.data.data.access_token;
  } catch (error: any) {
    console.error("Error generating token:", error.message || error);
    throw new Error("Failed to generate bearer token.");
  }
};
