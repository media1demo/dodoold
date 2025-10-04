// functions/[[path]].js  -- COMPLETE AND FINAL VERSION

import { Webhook } from 'standardwebhooks';
import DodoPayments from 'dodopayments';

// In-memory storage for this demo.
// IMPORTANT: This data will be lost whenever Cloudflare redeploys or restarts your function.
// For a real application, you must use a persistent database like Cloudflare D1 or KV.
let userSubscriptions = {};
let userProducts = {};

// Your product ID from the Dodo Payments dashboard
const EXISTING_PRODUCT_ID = 'pdt_Wi9yels9t5RHrfN4BjxNw';

// This is the main function Cloudflare will run for every single request to your site.
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const method = request.method;

    // --- ROUTE 1: WEBHOOK HANDLER ---
    // This is the most important route for backend logic.
    if (url.pathname === '/api/webhook' && method === 'POST') {
        console.log("[Webhook] Request received.");
        try {
            const secret = env.DODO_PAYMENTS_WEBHOOK_KEY;
            if (!secret) {
                console.error("[Webhook] CRITICAL ERROR: DODO_PAYMENTS_WEBHOOK_KEY is not set in environment variables.");
                return new Response("Webhook secret not configured.", { status: 500 });
            }

            const headers = {
                'webhook-id': request.headers.get('webhook-id'),
                'webhook-timestamp': request.headers.get('webhook-timestamp'),
                'webhook-signature': request.headers.get('webhook-signature'),
            };

            const payloadText = await request.text();
            const wh = new Webhook(secret);
            
            // This verifies the signature. It will throw an error if it's invalid.
            const payload = wh.verify(payloadText, headers);
            
            console.log(`[Webhook] Signature verified! Event Type: ${payload.type}`);

            const email = payload.data.customer?.email;

            // Handle the specific events we care about
            switch (payload.type) {
                case 'payment.succeeded':
                    if (email && payload.data.product_cart && payload.data.product_cart.length > 0) {
                        if (!userProducts[email]) userProducts[email] = [];
                        userProducts[email].push({
                            payment_id: payload.data.payment_id,
                            product_id: payload.data.product_cart[0].product_id,
                            purchased_at: new Date(payload.timestamp),
                        });
                        console.log(`[Webhook] SUCCESS: One-time product access granted to ${email}`);
                    }
                    break;
                case 'subscription.active':
                case 'subscription.renewed':
                    if (email) {
                        userSubscriptions[email] = {
                            subscription_id: payload.data.subscription_id,
                            product_id: payload.data.product_id,
                            status: 'active',
                            next_billing_date: payload.data.next_billing_date,
                        };
                        console.log(`[Webhook] SUCCESS: Subscription is active/renewed for ${email}`);
                    }
                    break;
                case 'subscription.cancelled':
                case 'subscription.failed':
                     if (email && userSubscriptions[email]) {
                        userSubscriptions[email].status = payload.type.split('.')[1]; // sets status to 'cancelled' or 'failed'
                        console.log(`[Webhook] INFO: Subscription status for ${email} updated to ${userSubscriptions[email].status}`);
                    }
                    break;
                default:
                    console.log(`[Webhook] INFO: Ignoring unhandled event type: ${payload.type}`);
            }

            // Acknowledge receipt to Dodo Payments
            return new Response(JSON.stringify({ status: 'success' }), { status: 200 });

        } catch (error) {
            console.error("[Webhook] FAILED:", error.message);
            // Let Dodo Payments know it failed so it can retry
            return new Response(`Webhook Error: ${error.message}`, { status: 400 });
        }
    }
    
    // --- ROUTE 2: HOME PAGE ---
    if (url.pathname === '/' && method === 'GET') {
        const email = url.searchParams.get('email');
        if (email) {
            const subscription = userSubscriptions[email];
            const products = userProducts[email] || [];
            const hasAccess = (subscription && subscription.status === 'active') || products.length > 0;

            if (hasAccess) {
                let accessHtml = `<h1>Welcome Back, ${email}!</h1><p>You have access to the following:</p>`;
                if (subscription) {
                    accessHtml += `<div class="product-card"><h3>Active Subscription</h3><p><strong>Status:</strong> ${subscription.status}</p><p><strong>Next Billing:</strong> ${new Date(subscription.next_billing_date).toLocaleDateString()}</p></div>`;
                }
                if (products.length > 0) {
                    products.forEach(p => { accessHtml += `<div class="product-card"><h3>One-Time Purchase</h3><p><strong>Purchased On:</strong> ${new Date(p.purchased_at).toLocaleDateString()}</p></div>`; });
                }
                return new Response(generateHtmlPage("Access Granted", accessHtml), { headers: { 'Content-Type': 'text/html' } });
            } else {
                const buyHtml = `<h1>Welcome, ${email}!</h1><p>You have no active products.</p><a href="/checkout/${EXISTING_PRODUCT_ID}?email=${encodeURIComponent(email)}" class="button">Buy Product Now</a>`;
                return new Response(generateHtmlPage("Buy Product", buyHtml), { headers: { 'Content-Type': 'text/html' } });
            }
        } else {
            const emailFormHtml = `<h1>Check Your Access</h1><p>Enter your email to see your purchases.</p><form action="/" method="GET"><input type="email" name="email" placeholder="Enter your email" required /><br/><button type="submit">Check Access</button></form>`;
            return new Response(generateHtmlPage("Check Access", emailFormHtml), { headers: { 'Content-Type': 'text/html' } });
        }
    }

    // --- ROUTE 3: CHECKOUT REDIRECT ---
    if (url.pathname.startsWith('/checkout/') && method === 'GET') {
        const productId = url.pathname.split('/')[2];
        const email = url.searchParams.get('email');
        const baseUrl = (env.DODO_PAYMENTS_ENVIRONMENT === 'live_mode') ? 'https://checkout.dodopayments.com/buy' : 'https://test.checkout.dodopayments.com/buy';
        
        // **FIX for req.get() error**: Use `url.origin` which is provided by the Cloudflare environment
        const successUrl = new URL(env.DODO_PAYMENTS_RETURN_URL || `${url.origin}/success`);
        if (email) {
            successUrl.searchParams.append('email', email);
        }
        const returnUrl = encodeURIComponent(successUrl.toString());

        let checkoutUrl = `${baseUrl}/${productId}?quantity=1&redirect_url=${returnUrl}`;
        if (email) checkoutUrl += `&email=${encodeURIComponent(email)}`;
        
        return Response.redirect(checkoutUrl, 302);
    }
    
    // --- ROUTE 4: SUCCESS PAGE (NO API CALLS) ---
    if (url.pathname === '/success' && method === 'GET') {
        const { payment_id, subscription_id, status } = url.searchParams;
    
        if (status.get('status') !== 'succeeded' && status.get('status') !== 'active') {
            const failureHtml = `<h1>Payment Not Successful</h1><p>Your payment status was: <strong>${status.get('status') || 'unknown'}</strong></p>`;
            return new Response(generateHtmlPage("Payment Failed", failureHtml), { status: 400, headers: { 'Content-Type': 'text/html' } });
        }
    
        let customerEmail = 'your email'; // Default
        let accessDetails = '<p>Your purchase is being processed.</p>';
    
        // We will try to fetch the customer email to provide a seamless redirect.
        // This is for user experience only. The webhook is the source of truth for granting access.
        try {
            const dodoClient = new DodoPayments({
                bearerToken: env.DODO_PAYMENTS_API_KEY,
                environment: env.DODO_PAYMENTS_ENVIRONMENT || 'test_mode',
            });
    
            // Small delay to help avoid the race condition
            await new Promise(resolve => setTimeout(resolve, 1500)); // Wait 1.5 seconds
    
            if (subscription_id.get('subscription_id')) {
                const subscription = await dodoClient.subscriptions.retrieve(subscription_id.get('subscription_id'));
                customerEmail = subscription.customer?.email || customerEmail;
                accessDetails = `<p>Your subscription is now active!</p>`;
                console.log(`[Success Page] Verified subscription for: ${customerEmail}`);
            } else if (payment_id.get('payment_id')) {
                const payment = await dodoClient.payments.retrieve(payment_id.get('payment_id'));
                customerEmail = payment.customer?.email || customerEmail;
                accessDetails = `<p>Your purchase was successful!</p>`;
                console.log(`[Success Page] Verified one-time payment for: ${customerEmail}`);
            }
        } catch (error) {
            console.error(`[Success Page] Non-critical error fetching details (race condition likely): ${error.message}`);
            // If it fails, we still show a success message and rely on the webhook.
        }
    
        // Now, we redirect the user to the home page with their email automatically included.
        // This prevents them from having to type it again.
        const homeUrl = new URL(url.origin);
        homeUrl.searchParams.set('email', customerEmail);
        
        // Instead of showing a page, we immediately redirect.
        return Response.redirect(homeUrl.toString(), 302);
    }
    

    // If no route matches, return a 404
    return new Response('Page Not Found.', { status: 404 });
}

// Helper function to generate full HTML pages
function generateHtmlPage(title, bodyContent) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background-color:#f4f6f8;text-align:center}.container{max-width:600px;margin:auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1)}h1{color:#333}p{color:#666}a.button,button{background-color:#007bff;color:#fff;padding:15px 25px;text-decoration:none;border:none;border-radius:8px;font-weight:700;cursor:pointer;display:inline-block}input{padding:10px;width:250px;margin-bottom:20px;border-radius:5px;border:1px solid #ccc}.product-card{border:1px solid #ddd;border-radius:8px;padding:20px;margin-top:20px;text-align:left}strong{color:#212529}</style></head><body><div class="container">${bodyContent}</div></body></html>`;
}
