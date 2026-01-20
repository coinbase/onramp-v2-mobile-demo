import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { generateJwt } from '@coinbase/cdp-sdk/auth';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Create Coinbase Onramp Order
app.post('/api/create-order', async (req, res) => {
    try {
        const {
            paymentAmount,
            paymentCurrency,
            purchaseCurrency,
            destinationNetwork,
            destinationAddress
        } = req.body;

        // Validate required fields
        if (!paymentAmount || !purchaseCurrency || !destinationNetwork || !destinationAddress) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['paymentAmount', 'purchaseCurrency', 'destinationNetwork', 'destinationAddress']
            });
        }

        // Generate sandbox user reference (MUST start with "sandbox-")
        const partnerUserRef = `sandbox-ios-user-${Date.now()}`;

        // Prepare order payload
        const orderPayload = {
            paymentAmount: paymentAmount,
            paymentCurrency: paymentCurrency || 'USD',
            purchaseCurrency: purchaseCurrency,
            paymentMethod: 'GUEST_CHECKOUT_APPLE_PAY',
            destinationNetwork: destinationNetwork,
            destinationAddress: destinationAddress,
            email: 'reviewer@coinbase-demo.app', // Test email
            phoneNumber: '+12345678901', // Test phone
            phoneNumberVerifiedAt: new Date().toISOString(),
            partnerUserRef: partnerUserRef, // IMPORTANT: sandbox- prefix for testing
            agreementAcceptedAt: new Date().toISOString(),
            isQuote: false
        };

        console.log('Creating Coinbase order with payload:', orderPayload);

        // Call Coinbase API with JWT authentication
        const coinbaseResponse = await callCoinbaseAPI(orderPayload);

        if (coinbaseResponse.error) {
            throw new Error(coinbaseResponse.error);
        }

        // Extract payment link from response
        const paymentLink = coinbaseResponse.paymentLink?.url;

        if (!paymentLink) {
            throw new Error('No payment link in Coinbase response');
        }

        console.log('✅ Order created successfully');
        console.log('Payment link:', paymentLink);
        console.log('Order ID:', coinbaseResponse.order?.orderId);

        res.json({
            success: true,
            paymentLink: paymentLink,
            orderId: coinbaseResponse.order?.orderId,
            partnerUserRef: partnerUserRef
        });

    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({
            error: 'Failed to create order',
            message: error.message
        });
    }
});

// Call Coinbase API with JWT authentication
async function callCoinbaseAPI(payload) {
    const apiKeyId = process.env.CDP_API_KEY_ID;
    const apiKeySecret = process.env.CDP_API_KEY_SECRET;

    if (!apiKeyId || !apiKeySecret) {
        console.error('❌ Missing Coinbase API credentials!');
        console.log('Please set CDP_API_KEY_ID and CDP_API_KEY_SECRET in .env file');
        return {
            error: 'Server configuration error: Missing API credentials. Check .env file.'
        };
    }

    try {
        // Generate JWT token for authentication
        const jwt = await generateJWT(apiKeyId, apiKeySecret, 'POST', '/platform/v2/onramp/orders');

        // Call Coinbase API
        const response = await fetch('https://api.cdp.coinbase.com/platform/v2/onramp/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwt}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Coinbase API error:', response.status, errorText);
            throw new Error(`Coinbase API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data;

    } catch (error) {
        console.error('Error calling Coinbase API:', error);
        return { error: error.message };
    }
}

// Generate JWT for Coinbase CDP API authentication using official SDK
async function generateJWT(apiKeyId, apiKeySecret, method, path) {
    try {
        // Use Coinbase CDP SDK to generate JWT (same as working demo)
        const jwt = await generateJwt({
            apiKeyId: apiKeyId,
            apiKeySecret: apiKeySecret,
            requestMethod: method,
            requestHost: 'api.cdp.coinbase.com',
            requestPath: path,
            expiresIn: 120
        });

        return jwt;
    } catch (error) {
        console.error('JWT generation error:', error);
        throw error;
    }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    const hasCredentials = !!(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);

    res.json({
        status: 'ok',
        hasCredentials,
        message: hasCredentials
            ? 'Server is ready to process payments'
            : 'Missing API credentials - set CDP_API_KEY_ID and CDP_API_KEY_SECRET'
    });
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`\nOpen http://localhost:${PORT} in your browser`);

    if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
        console.log('\n⚠️  WARNING: Missing Coinbase API credentials');
        console.log('Please create a .env file with:');
        console.log('CDP_API_KEY_ID=your_api_key_id');
        console.log('CDP_API_KEY_SECRET=your_api_key_secret\n');
    } else {
        console.log('\n✅ Coinbase API credentials loaded');
    }
});
