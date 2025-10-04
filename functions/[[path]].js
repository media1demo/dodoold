// functions/[[path]].js - CORRECTED VERSION

import { Webhook } from 'standardwebhooks';
import DodoPayments from 'dodopayments';

const EXISTING_PRODUCT_ID = 'pdt_Wi9yels9t5RHrfN4BjxNw';

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const method = request.method;
    const kv = env.SUBSCRIPTIONS_KV;

    if (!kv) {
        console.error('[ERROR] KV storage is not bound!');
        return new Response("KV storage is not bound. Please check your Cloudflare settings.", { status: 500 });
    }

    // --- ROUTE 1: WEBHOOK HANDLER ---
    if (url.pathname === '/api/webhook' && method === 'POST') {
        try {
            const secret = env.DODO_PAYMENTS_WEBHOOK_KEY;
            if (!secret) {
                console.error('[ERROR] Webhook secret not configured');
                throw new Error("Webhook secret not configured.");
            }

            const bodyText = await request.text();
            console.log('[Webhook] Received webhook payload');
            
            const wh = new Webhook(secret);
            const payload = wh.verify(bodyText, request.headers);
            
            console.log(`[Webhook] ✅ Verified! Event: ${payload.type}`);
            console.log(`[Webhook] Full payload:`, JSON.stringify(payload, null, 2));
            
            const email = payload.data.customer?.email;
            
            if (!email) {
                console.warn('[Webhook] ⚠️ No email found in webhook payload!');
                return new Response(JSON.stringify({ status: 'success', warning: 'no email' }), { status: 200 });
            }

            console.log(`[Webhook] Processing for email: ${email}`);

            // Fetch existing user data
            const currentUserData = await kv.get(email, { type: "json" }) || { subscriptions: null, products: [] };
            console.log(`[KV] Current data for ${email}:`, JSON.stringify(currentUserData));

            // Handle different webhook events
            if (payload.type === 'payment.succeeded' && payload.data.product_cart?.length > 0) {
                currentUserData.products = currentUserData.products || [];
                currentUserData.products.push({
                    product_id: payload.data.product_cart[0].product_id,
                    purchased_at: new Date(payload.timestamp).toISOString()
                });
                console.log(`[KV] ✅ Added one-time product for ${email}`);
            } 
            else if (payload.type === 'subscription.active' || payload.type === 'subscription.renewed') {
                currentUserData.subscriptions = {
                    status: 'active',
                    next_billing_date: payload.data.next_billing_date,
                    product_id: payload.data.product_id
                };
                console.log(`[KV] ✅ Updated subscription status for ${email}`);
            } 
            else if (payload.type === 'subscription.cancelled' && currentUserData.subscriptions) {
                currentUserData.subscriptions.status = 'cancelled';
                console.log(`[KV] ℹ️ Marked subscription as cancelled for ${email}`);
            }
            else {
                console.log(`[Webhook] Event type ${payload.type} - no action taken`);
            }
            
            // Save to KV
            await kv.put(email, JSON.stringify(currentUserData));
            console.log(`[KV] ✅ Data saved for ${email}:`, JSON.stringify(currentUserData));
            
            // Verify the save
            const savedData = await kv.get(email, { type: "json" });
            console.log(`[KV] Verification - data retrieved:`, JSON.stringify(savedData));
            
            return new Response(JSON.stringify({ status: 'success', email: email }), { 
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (err) {
            console.error('❌ Webhook failed:', err);
            console.error('Error stack:', err.stack);
            return new Response(JSON.stringify({ error: err.message }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
    
    // --- ROUTE 2: HOME PAGE ---
    if (url.pathname === '/' && method === 'GET') {
        const email = url.searchParams.get('email');
        if (email) {
            console.log(`[Home] Checking access for: ${email}`);
            const userData = await kv.get(email, { type: "json" });
            console.log(`[Home] User data:`, JSON.stringify(userData));
            
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
            const emailFormHtml = `<h1>Check Your Access</h1><p>Enter your email.</p><form action="/" method="GET"><input type="email" name="email" required placeholder="your@email.com" /><br/><button type="submit">Check Access</button></form>`;
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
        
        console.log(`[Checkout] Redirecting to: ${checkoutUrl}`);
        return Response.redirect(checkoutUrl, 302);
    }
    
    // --- ROUTE 4: SUCCESS PAGE ---
    if (url.pathname === '/success' && method === 'GET') {
        const status = url.searchParams.get('status');
        const customerEmail = url.searchParams.get('email') || '';

        console.log(`[Success] Status: ${status}, Email: ${customerEmail}`);

        if (status !== 'succeeded' && status !== 'active') {
            const failureHtml = `<h1>Payment Not Successful</h1><p>Your payment status was: <strong>${status || 'unknown'}</strong></p><a href="/" class="button">Go Home</a>`;
            return new Response(generateHtmlPage("Payment Failed", failureHtml), { status: 400, headers: { 'Content-Type': 'text/html' } });
        }
        
        const homeUrl = new URL(url.origin);
        if (customerEmail) {
            homeUrl.searchParams.set('email', customerEmail);
        }
        return Response.redirect(homeUrl.toString(), 302);
    }

    return new Response('Page Not Found.', { status: 404 });
}

function generateHtmlPage(title, bodyContent) {
    return `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background-color:#f4f6f8;text-align:center}.container{max-width:600px;margin:auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1)}.button{background-color:#007bff;color:#fff;padding:15px 25px;text-decoration:none;border-radius:8px;display:inline-block;margin-top:20px;}button{background-color:#007bff;color:#fff;padding:15px 25px;border:none;border-radius:8px;cursor:pointer;font-size:16px;}input{padding:10px;width:250px;margin-bottom:20px;border-radius:5px;border:1px solid #ccc;font-size:16px;}.product-card{border:1px solid #ddd;border-radius:8px;padding:20px;margin-top:20px;text-align:left;background:#f9f9f9;}</style></head><body><div class="container">${bodyContent}</div></body></html>`;
}
