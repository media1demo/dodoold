// functions/[[path]].js -- THE COMPLETE AND CORRECTED FINAL VERSION

import { Webhook } from 'standardwebhooks';
import DodoPayments from 'dodopayments';

// Your product ID from the Dodo Payments dashboard
const EXISTING_PRODUCT_ID = 'pdt_Wi9yels9t5RHrfN4BjxNw';

// This is the main function Cloudflare runs for every request.
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const method = request.method;
    
    // **CRITICAL FIX**: Define the KV namespace from the environment context
    const kv = env.SUBSCRIPTIONS_KV;

    // --- ROUTE 1: WEBHOOK HANDLER (Writes to KV) ---
    if (url.pathname === '/api/webhook' && method === 'POST') {
        try {
            const secret = env.DODO_PAYMENTS_WEBHOOK_KEY;
            if (!secret) throw new Error("Webhook secret not configured in Cloudflare environment variables.");

            const wh = new Webhook(secret);
            const payload = wh.verify(await request.text(), request.headers);
            
            console.log(`[Webhook] Verified! Event: ${payload.type}`);
            const email = payload.data.customer?.email;

            if (email) {
                const currentUserData = await kv.get(email, { type: "json" }) || { subscriptions: null, products: [] };

                if (payload.type === 'payment.succeeded' && payload.data.product_cart?.length > 0) {
                    currentUserData.products.push({
                        product_id: payload.data.product_cart[0].product_id,
                        purchased_at: new Date(payload.timestamp)
                    });
                    console.log(`[KV] SUCCESS: One-time product for ${email} saved.`);
                } else if (payload.type === 'subscription.active' || payload.type === 'subscription.renewed') {
                    currentUserData.subscriptions = {
                        status: 'active',
                        next_billing_date: payload.data.next_billing_date,
                        product_id: payload.data.product_id
                    };
                    console.log(`[KV] SUCCESS: Subscription status for ${email} saved.`);
                } else if (payload.type === 'subscription.cancelled' && currentUserData.subscriptions) {
                    currentUserData.subscriptions.status = 'cancelled';
                     console.log(`[KV] INFO: Subscription for ${email} marked as cancelled.`);
                }
                
                await kv.put(email, JSON.stringify(currentUserData));
            }
            return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
        } catch (err) {
            console.error('❌ Webhook failed:', err.message);
            return new Response(`Webhook Error: ${err.message}`, { status: 400 });
        }
    }
    
    // --- ROUTE 2: HOME PAGE (Reads from KV) ---
    if (url.pathname === '/' && method === 'GET') {
        const email = url.searchParams.get('email');
        if (email) {
            const userData = await kv.get(email, { type: "json" });
            const hasActiveSubscription = userData?.subscriptions?.status === 'active';
            const hasProducts = userData?.products?.length > 0;
    
            if (hasActiveSubscription || hasProducts) {
                let accessHtml = `<h1>Welcome Back!</h1><p>You have access to the following:</p>`;
                if (hasActiveSubscription) {
                    const sub = userData.subscriptions;
                    accessHtml += `<div class="product-card"><h3>Active Subscription</h3><p><strong>Product:</strong> ${sub.product_id}</p><p><strong>Status:</strong> ${sub.status}</p><p><strong>Next Billing:</strong> ${new Date(sub.next_billing_date).toLocaleDateString()}</p></div>`;
                }
                if (hasProducts) {
                    userData.products.forEach(p => { 
                        accessHtml += `<div class="product-card"><h3>One-Time Purchase</h3><p><strong>Product:</strong> ${p.product_id}</p><p><strong>Purchased On:</strong> ${new Date(p.purchased_at).toLocaleDateString()}</p></div>`; 
                    });
                }
                return new Response(generateHtmlPage("Access Granted", accessHtml), { headers: { 'Content-Type': 'text/html' } });
            } else {
                const buyHtml = `<h1>Welcome, ${email}!</h1><p>You have no active subscription or products.</p><a href="/checkout/${EXISTING_PRODUCT_ID}?email=${encodeURIComponent(email)}" class="button">Buy Now</a>`;
                return new Response(generateHtmlPage("Buy Product", buyHtml), { headers: { 'Content-Type': 'text/html' } });
            }
        } else {
            const emailFormHtml = `<h1>Check Your Access</h1><p>Enter your email.</p><form action="/" method="GET"><input type="email" name="email" required /><br/><button type="submit">Check Access</button></form>`;
            return new Response(generateHtmlPage("Check Access", emailFormHtml), { headers: { 'Content-Type': 'text/html' } });
        }
    }

    // --- ROUTE 3: CHECKOUT REDIRECT ---
    if (url.pathname.startsWith('/checkout/') && method === 'GET') {
        const productId = url.pathname.split('/')[2];
        const email = url.searchParams.get('email');
        const baseUrl = (env.DODO_PAYMENTS_ENVIRONMENT === 'live_mode') ? 'https://checkout.dodopayments.com/buy' : 'https://test.checkout.dodopayments.com/buy';
        const successUrl = new URL(env.DODO_PAYMENTS_RETURN_URL || `${url.origin}/success`);
        if (email) successUrl.searchParams.append('email', email);
        const returnUrl = encodeURIComponent(successUrl.toString());
        let checkoutUrl = `${baseUrl}/${productId}?quantity=1&redirect_url=${returnUrl}`;
        if (email) checkoutUrl += `&email=${encodeURIComponent(email)}`;
        return Response.redirect(checkoutUrl, 302);
    }
    
    // --- ROUTE 4: SUCCESS PAGE (Redirects to Home) ---
    if (url.pathname === '/success' && method === 'GET') {
        // **CRITICAL FIX**: Use .get() to read from URLSearchParams
        const status = url.searchParams.get('status');
        const customerEmail = url.searchParams.get('email') || '';

        if (status !== 'succeeded' && status !== 'active') {
            const failureHtml = `<h1>Payment Not Successful</h1><p>Your payment status was: <strong>${status || 'unknown'}</strong></p>`;
            return new Response(generateHtmlPage("Payment Failed", failureHtml), { status: 400, headers: { 'Content-Type': 'text/html' } });
        }
        
        // Immediately redirect to the home page with the email.
        // This provides the seamless experience you wanted.
        const homeUrl = new URL(url.origin);
        if (customerEmail) {
            homeUrl.searchParams.set('email', customerEmail);
        }
        return Response.redirect(homeUrl.toString(), 302);
    }

    // If no other route matches, return a 404
    return new Response('Page Not Found.', { status: 404 });
}

// Helper function to generate full HTML pages
function generateHtmlPage(title, bodyContent) {
    return `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background-color:#f4f6f8;text-align:center}.container{max-width:600px;margin:auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1)}.button{background-color:#007bff;color:#fff;padding:15px 25px;text-decoration:none;border-radius:8px;}input{padding:10px;width:250px;margin-bottom:20px;border-radius:5px;border:1px solid #ccc;}.product-card{border:1px solid #ddd;border-radius:8px;padding:20px;margin-top:20px;text-align:left}</style></head><body><div class="container">${bodyContent}</div></body></html>`;
}
