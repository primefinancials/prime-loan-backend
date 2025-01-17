import axios, { AxiosRequestConfig } from "axios";
import { customerKey, customerSecret, baseUrl } from "../config";
import { generateBearerToken } from "./generateBearerToken";
import { APIError } from "../exceptions";

export const httpClient = async (endpoint: string, method: string = "GET", body?: object) => {
  const url = `${baseUrl}${endpoint}`;
  const accessToken = await generateBearerToken(customerKey, customerSecret);

  const headers = {
    "Content-Type": "application/json",
    "AccessToken": accessToken || "",
  };

  const options: AxiosRequestConfig = {
    url,
    method,
    headers,
    data: body,
  };

  console.log({ body })

  try {
    const response = await axios(options);

    console.log({ response })

    if (![200, 202].includes(response.status)) {
        throw new Error(`Client creation failed: ${response.data.message}`);
    }

    console.log({ httpClient: "passed" })

    return response;
  } catch (error: any) {
    throw new APIError(error.status, error.response.data.message || error.message);
  }
};
