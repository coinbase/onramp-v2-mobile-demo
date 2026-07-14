import { BASE_URL } from "../constants/BASE_URL";
import { authenticatedFetch } from "./authenticatedFetch";

export async function createOnrampSession(payload: any) {
try {
  console.log('📤 [API] createOnrampSession');

  console.log('API request →', payload);

  const res = await authenticatedFetch(`${BASE_URL}/onramp/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  console.log('📥 [RESPONSE] Status:', res.status, res.statusText);
  console.log('📥 [RESPONSE] Headers:', {
    'content-type': res.headers.get('content-type'),
    'x-request-id': res.headers.get('x-request-id')
  });

  // Log response
  const responseClone = res.clone();
  const responseText = await responseClone.text().catch(() => '<non-text body>');

  if (!res.ok) {
    console.error('❌ [RESPONSE] Request failed!');
    console.error('❌ [RESPONSE] Status:', res.status);
    console.error('❌ [RESPONSE] Body:', responseText);

    const errorData = await res.json().catch(() => null);
    const errorMessage = errorData?.errorMessage
      ? `${errorData.errorType}: ${errorData.errorMessage}`
      : errorData?.message || `HTTP error! status: ${res.status}`;
    throw new Error(errorMessage);
  }

  console.log('✅ [RESPONSE] Request succeeded!');
  return res.json(); // { session: { onrampUrl }, quote?: {...} }
} catch (error) {
    console.error("API request failed:", error);
    // Enhanced error logging
    console.error('API request failed (details):', {
      name: (error as any)?.name,
      message: (error as any)?.message,
      stack: (error as any)?.stack
    });
    throw error;
  }
}