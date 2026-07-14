import { BASE_URL } from "../constants/BASE_URL";
import { authenticatedFetch } from "./authenticatedFetch";

export async function fetchBuyOptions(payload: any) {
  try {
    const params = new URLSearchParams(payload);
    const url = `${BASE_URL}/onramp/options?${params.toString()}`;

    const response = await authenticatedFetch(url, {
      method: "GET",
    });
    // Log response early (without consuming it)
    const responseClone = response.clone();
    const responseText = await responseClone.text().catch(() => '<non-text body>');

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseJson = await response.json();

    // Return the hosted URL from Coinbase response
    return responseJson;
  } catch (error) {
    throw error;
  }
}
