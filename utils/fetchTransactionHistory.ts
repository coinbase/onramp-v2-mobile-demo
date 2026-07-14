import { BASE_URL } from "../constants/BASE_URL";

export async function fetchTransactionHistory(
  pageKey?: string,
  pageSize: number = 10,
  accessToken?: string
) {
  try {
    let url = `${BASE_URL}/onramp/transactions?pageSize=${pageSize}`;
    if (pageKey) {
      url += `&pageKey=${encodeURIComponent(pageKey)}`;
    }

    console.log('Transaction history request →', { url, pageSize, hasToken: !!accessToken });

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    });

    const responseClone = response.clone();
    const responseText = await responseClone.text().catch(() => '<non-text body>');
    console.log('Transaction history response ←', {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
      bodyPreview: responseText.slice(0, 1000)
    });

    if (!response.ok) {
      console.error('❌ Transaction history failed:', {
        status: response.status,
        statusText: response.statusText,
        body: responseText.slice(0, 500)
      });
      throw new Error(`HTTP error! status: ${response.status} - ${responseText.slice(0, 200)}`);
    }

    const responseJson = await response.json();

    // API returns snake_case (next_page_key), not camelCase (nextPageKey)
    const nextPageKey = responseJson.next_page_key;

    console.log('✅ [TX HISTORY] Parsed response:', {
      transactionsCount: responseJson.transactions?.length || 0,
      totalCount: responseJson.total_count,
      hasNextPageKey: !!nextPageKey,
      nextPageKey: nextPageKey,
      responseKeys: Object.keys(responseJson)
    });

    return {
      transactions: responseJson.transactions || [],
      nextPageKey: nextPageKey // For next page
    };
  } catch (error) {
    console.error("Transaction history API request failed:", error);
    console.error('API request failed (details):', {
      name: (error as any)?.name,
      message: (error as any)?.message,
      stack: (error as any)?.stack
    });
    throw error;
  }
}