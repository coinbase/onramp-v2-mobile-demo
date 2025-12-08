
import { BASE_URL } from '@/constants/BASE_URL';
import { authenticatedFetch } from './authenticatedFetch';
import { createApplePayOrder } from './createApplePayOrder';
import { demoAddressForNetwork } from './randomAddresses';
import { getCountry, getSubdivision, getCurrentWalletAddress, getSandboxMode } from './sharedState';

export async function fetchBuyQuote(payload: {
  paymentCurrency: string;
  purchaseCurrency: string;
  paymentAmount: string;
  destinationNetwork: string;
  paymentMethod: string;
}) {
  // In sandbox mode, use the current wallet address (could be manual override)
  // In production, fall back to demo address for quote purposes
  const isSandbox = getSandboxMode();
  const userAddress = getCurrentWalletAddress();
  const destinationAddress = (isSandbox && userAddress) ? userAddress : demoAddressForNetwork(payload.destinationNetwork);

  // If we couldn't generate a demo address for this network, return null instead of erroring
  if (!destinationAddress) {
    console.log(`No demo address available for network: ${payload.destinationNetwork}`);
    return null;
  }

  const isApplePay = payload.paymentMethod === 'GUEST_CHECKOUT_APPLE_PAY';

  if (isApplePay) {
    const response = await createApplePayOrder({
      ...payload,
      isQuote: true,
      paymentMethod: "GUEST_CHECKOUT_APPLE_PAY",
      email: 'testquote@test.com',
      phoneNumber: '+12345678901',
      agreementAcceptedAt: new Date().toISOString(),
      phoneNumberVerifiedAt: new Date().toISOString(),
      partnerUserRef: 'testquote',
      destinationAddress,
    });
      
    const order = response?.order ?? response;
    
    const coinbaseFee = order?.fees?.find((f: any) => f.type === 'FEE_TYPE_EXCHANGE');
    const networkFee  = order?.fees?.find((f: any) => f.type === 'FEE_TYPE_NETWORK');
    
    return {
      purchase_amount:  { value: order?.purchaseAmount ?? '0', currency: order?.purchaseCurrency },
      payment_subtotal: { value: order?.paymentSubtotal ?? '0', currency: order?.paymentCurrency },
      payment_total:    { value: order?.paymentTotal ?? '0',    currency: order?.paymentCurrency },
      coinbase_fee:     { value: coinbaseFee?.amount ?? '0',    currency: coinbaseFee?.currency ?? order?.paymentCurrency },
      network_fee:      { value: networkFee?.amount ?? '0',     currency: networkFee?.currency ?? order?.paymentCurrency },
      exchange_rate:    order?.exchangeRate,
      raw:              order,
    };
  } else {
    const country = getCountry();
    const subdivision = getSubdivision();

    const v2Payload = {
      country,
      subdivision,
      paymentCurrency: payload.paymentCurrency,
      purchaseCurrency: payload.purchaseCurrency,
      destinationNetwork: payload.destinationNetwork,
      paymentAmount: payload.paymentAmount,
      destinationAddress,
      paymentMethod: payload.paymentMethod === 'COINBASE_WIDGET' ? 'CARD' : payload.paymentMethod
    };

    console.log('📤 [API] fetchBuyQuote (Widget)');

    // v2 quote for Coinbase Widget (session endpoint)
    const response = await authenticatedFetch(`${BASE_URL}/server/api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://api.cdp.coinbase.com/platform/v2/onramp/sessions',
        method: 'POST',
        body: v2Payload,
      }),
    });
  
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const quote = data?.quote;
    const fees = quote?.fees || [];
    const coinbaseFee = fees.find((f: any) => f.type === 'FEE_TYPE_EXCHANGE');
    const networkFee = fees.find((f: any) => f.type === 'FEE_TYPE_NETWORK');
    
  
    return {
      purchase_amount: { value: quote?.purchaseAmount ?? '0', currency: quote?.purchaseCurrency },
      payment_subtotal: { value: quote?.paymentSubtotal ?? '0', currency: quote?.paymentCurrency },
      payment_total: { value: quote?.paymentTotal ?? '0', currency: quote?.paymentCurrency },
      coinbase_fee: { value: coinbaseFee?.amount ?? '0', currency: coinbaseFee?.currency ?? quote?.paymentCurrency },
      network_fee: { value: networkFee?.amount ?? '0', currency: networkFee?.currency ?? quote?.paymentCurrency },
      exchange_rate: quote?.exchangeRate,
      raw: data,
    };
  }
}