// Coinbase Apple Pay Integration - Vanilla JavaScript for iOS WKWebView

const form = document.getElementById('paymentForm');
const payButton = document.getElementById('payButton');
const statusDiv = document.getElementById('status');
const eventsContainer = document.getElementById('eventsContainer');
const paymentIframe = document.getElementById('paymentIframe');

let events = [];

// Listen for postMessage events from Coinbase iframe
window.addEventListener('message', (event) => {
    // Only accept messages from Coinbase
    if (!event.origin.includes('coinbase.com')) return;

    try {
        const data = typeof event.data === 'string'
            ? JSON.parse(event.data)
            : event.data;

        const { eventName, payload } = data;

        if (eventName && eventName.startsWith('onramp_api')) {
            console.log('Coinbase event:', eventName, payload);
            handleCoinbaseEvent(eventName, payload);
        }
    } catch (e) {
        console.error('Error parsing message:', e);
    }
});

// Handle form submission
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const amount = document.getElementById('amount').value;
    const currency = document.getElementById('currency').value;
    const network = document.getElementById('network').value;
    const address = document.getElementById('address').value;

    if (!address || !amount) {
        showStatus('Please fill in all fields', 'error');
        return;
    }

    payButton.disabled = true;
    payButton.textContent = 'Creating order...';
    clearEvents();
    showStatus('Calling API to create payment order...', 'info');

    try {
        // Call backend to create Coinbase order
        const response = await fetch('/api/create-order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                paymentAmount: amount,
                paymentCurrency: 'USD',
                purchaseCurrency: currency,
                destinationNetwork: network,
                destinationAddress: address,
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to create order');
        }

        const data = await response.json();

        if (data.paymentLink) {
            showStatus('✅ Payment link received! Loading...', 'success');
            logEvent('✅ Payment link received');
            logEvent('Loading payment URL: ' + data.paymentLink);

            // Load payment URL in iframe
            paymentIframe.src = data.paymentLink;
            paymentIframe.style.display = 'block';
        } else {
            throw new Error('No payment link in response');
        }

    } catch (error) {
        console.error('Error:', error);
        showStatus('❌ Error: ' + error.message, 'error');
        logEvent('❌ Error: ' + error.message);
        payButton.disabled = false;
        payButton.textContent = 'Buy Crypto with Apple Pay';
    }
});

// Handle Coinbase events
function handleCoinbaseEvent(eventName, payload) {
    logEvent(`🔔 ${eventName}`, getEventType(eventName));

    switch (eventName) {
        case 'onramp_api.load_pending':
            showStatus('⏳ Loading Apple Pay button...', 'info');
            break;

        case 'onramp_api.load_success':
            showStatus('✅ Apple Pay button loaded!', 'success');
            logEvent('✅ Apple Pay ready - button should be visible');
            payButton.textContent = 'Payment in progress...';
            break;

        case 'onramp_api.load_error':
            showStatus('❌ Failed to load Apple Pay button', 'error');
            payButton.disabled = false;
            payButton.textContent = 'Buy Crypto with Apple Pay';
            break;

        case 'onramp_api.commit_success':
            showStatus('✅ Payment authorized! Processing transaction...', 'success');
            logEvent('✅ Payment authorized by user');
            break;

        case 'onramp_api.polling_start':
            showStatus('🔄 Tracking blockchain transaction...', 'info');
            break;

        case 'onramp_api.polling_success':
            showStatus('🎉 Transaction complete! Crypto delivered to wallet.', 'success');
            logEvent('🎉 Crypto successfully delivered!');
            setTimeout(() => {
                payButton.disabled = false;
                payButton.textContent = 'Buy Crypto with Apple Pay';
                paymentIframe.style.display = 'none';
            }, 3000);
            break;

        case 'onramp_api.polling_error':
            showStatus('❌ Transaction failed on blockchain', 'error');
            logEvent('❌ Blockchain transaction error');
            payButton.disabled = false;
            payButton.textContent = 'Buy Crypto with Apple Pay';
            break;

        case 'onramp_api.commit_error':
            showStatus('❌ Payment authorization failed', 'error');
            logEvent('❌ Payment not authorized');
            payButton.disabled = false;
            payButton.textContent = 'Buy Crypto with Apple Pay';
            break;

        case 'onramp_api.cancel':
            showStatus('ℹ️ Payment cancelled by user', 'info');
            logEvent('ℹ️ User cancelled Apple Pay');
            payButton.disabled = false;
            payButton.textContent = 'Buy Crypto with Apple Pay';
            paymentIframe.style.display = 'none';
            break;

        default:
            logEvent(`ℹ️ Unknown event: ${eventName}`);
    }

    if (payload) {
        logEvent(`   Data: ${JSON.stringify(payload, null, 2)}`);
    }
}

// UI Helper Functions
function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
}

function logEvent(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const eventDiv = document.createElement('div');
    eventDiv.className = `event ${type}`;
    eventDiv.innerHTML = `
        <div class="event-time">${timestamp}</div>
        <div class="event-name">${message}</div>
    `;

    eventsContainer.appendChild(eventDiv);
    eventsContainer.scrollTop = eventsContainer.scrollHeight;

    events.push({ timestamp, message, type });
}

function clearEvents() {
    eventsContainer.innerHTML = '<p style="color: #999; font-size: 13px;">Events will appear here...</p>';
    events = [];
}

function getEventType(eventName) {
    if (eventName.includes('success')) return 'success';
    if (eventName.includes('error')) return 'error';
    if (eventName.includes('cancel')) return 'warning';
    return 'info';
}

// Log initial state
console.log('Coinbase Apple Pay Demo initialized');
logEvent('✅ App loaded - Ready to process payments');
