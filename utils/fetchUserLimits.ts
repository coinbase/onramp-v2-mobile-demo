import { BASE_URL } from "../constants/BASE_URL";

export interface UserLimit {
  limitType: "weekly_spending" | "lifetime_transactions";
  currency?: string;
  limit: string;
  remaining: string;
}

export interface UserLimitsResponse {
  limits: UserLimit[];
}

export async function fetchUserLimits(
  phoneNumber: string,
  accessToken?: string
): Promise<UserLimitsResponse> {
  try {
    const apiUrl = 'https://api.cdp.coinbase.com/platform/v2/onramp/limits';

    const requestBody = {
      paymentMethodType: "GUEST_CHECKOUT_APPLE_PAY",
      userId: phoneNumber,
      userIdType: "phone_number"
    };

    console.log('User limits request →', {
      url: apiUrl,
      phoneNumber,
      method: "POST",
      hasToken: !!accessToken
    });

    const response = await fetch(`${BASE_URL}/server/api`, {
      method: "POST", // Calling local proxy with POST
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        url: apiUrl,
        method: "POST",
        body: requestBody
      })
    });

    const responseClone = response.clone();
    const responseText = await responseClone.text().catch(() => '<non-text body>');
    console.log('User limits response ←', {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
      bodyPreview: responseText.slice(0, 1000)
    });

    if (!response.ok) {
      console.error('❌ User limits failed:', {
        status: response.status,
        statusText: response.statusText,
        body: responseText.slice(0, 500)
      });
      throw new Error(`HTTP error! status: ${response.status} - ${responseText.slice(0, 200)}`);
    }

    const responseJson = await response.json();

    console.log('✅ [USER LIMITS] Parsed response:', {
      limitsCount: responseJson.limits?.length || 0,
      limits: responseJson.limits,
      responseKeys: Object.keys(responseJson)
    });

    return {
      limits: responseJson.limits || []
    };
  } catch (error) {
    console.error("User limits API request failed:", error);
    console.error('API request failed (details):', {
      name: (error as any)?.name,
      message: (error as any)?.message,
      stack: (error as any)?.stack
    });
    throw error;
  }
}
