import express from 'express';
import { checkoutHandler, Webhooks } from '@dodopayments/express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Checkout Routes - Static Payment Links
app.get('/api/checkout', checkoutHandler({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY,
    returnUrl: process.env.DODO_PAYMENTS_RETURN_URL,
    environment: process.env.DODO_PAYMENTS_ENVIRONMENT,
    type: "static"
}));



// Checkout Routes - Dynamic Payments
app.post('/api/checkout', checkoutHandler({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY,
    returnUrl: process.env.DODO_PAYMENTS_RETURN_URL,
    environment: process.env.DODO_PAYMENTS_ENVIRONMENT,
    type: "dynamic"
}));

// Webhook Handler - Payment Verification
app.post('/api/webhook', Webhooks({
    webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
    onPayload: async (payload) => {
        console.log('Webhook received:', payload);
        
        // Handle different payment events
        switch (payload.type) {
            case 'payment.succeeded':
                console.log('✅ Payment succeeded:', payload.data.payment_id);
                // Add your success logic here
                break;
            case 'payment.failed':
                console.log('❌ Payment failed:', payload.data.payment_id);
                // Add your failure logic here
                break;
            case 'subscription.active':
                console.log('🔄 Subscription activated:', payload.data.subscription_id);
                // Add subscription logic here
                break;
            default:
                console.log('📦 Other event:', payload.type);
        }
    },
    onSubscriptionActive: async (payload) => {
        console.log('✅ Subscription activated:', payload.data.subscription_id);
        // Update user's subscription status in your database
        // Grant access to premium features
    },
    
    onSubscriptionRenewed: async (payload) => {
        console.log('🔄 Subscription renewed:', payload.data.subscription_id);
        // Extend subscription period
        // Send renewal confirmation email
    },
    
    onSubscriptionFailed: async (payload) => {
        console.log('❌ Subscription failed:', payload.data.subscription_id);
        // Handle failed subscription
        // Send payment failure notification
    },
    
    onPaymentSucceeded: async (payload) => {
        console.log('💰 Payment succeeded:', payload.data.payment_id);
        // This fires with subscription.renewed for recurring payments
    },
    
    // Generic handler for all events
    onPayload: async (payload) => {
        console.log('📦 Webhook received:', payload.type, payload.data);
    }

}));

// Success page
app.get('/success', (req, res) => {
    res.send(`
        <h1>Payment Successful! ✅</h1>
        <p>Thank you for your payment.</p>
        <a href="/">Go back</a>
    `);
});

// Home page with payment button
app.get('/', (req, res) => {
    res.send(`
        <h1>Dodo Payments Demo</h1>
        <a href="/api/checkout?productId=pdt_COsUtqE6DCojdaBh7Ine1">
            <button>Pay Now</button>
        </a>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});