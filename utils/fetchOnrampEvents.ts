import { BASE_URL } from "../constants/BASE_URL";

export type OnrampEvent = {
  eventType: string;
  transactionId: string | null;
  timestamp: string;
  amount?: string;
  currency?: string;
  network?: string;
  failureReason?: string;
};

export async function fetchOnrampEvents(accessToken: string): Promise<OnrampEvent[]> {
  const response = await fetch(`${BASE_URL}/events/onramp`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.error('❌ [EVENTS] Failed to fetch:', response.status);
    return [];
  }

  const data = await response.json();
  return data.events || [];
}
