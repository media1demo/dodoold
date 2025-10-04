// functions/[[path]].js
import DodoPayments from 'dodopayments';

// Initialize Dodo client
const getDodoClient = (env) => {
  return new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY,
    environment: env.DODO_PAYMENTS_ENVIRONMENT || 'test_mode',
  });
};

// In-memory storage (Note: This will reset on each deployment/cold start)
// For production, use Cloudflare KV, D1, or Durable Objects
let userSubscriptions = {};
let userProducts = {};

const EXISTING_PRODUCT_ID = 'pdt_Wi9yels9t5RHrfN4BjxNw';

// Helper function to generate HTML pages
function generateHtmlPage(title, bodyContent) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 40px; background-color: #f8f9fa; color: #333; }
            .container { max-width: 600px; margin: auto; background: #fff; border: 1px solid #ddd; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
            h1 { color: #28a745; }
            a { color: #007bff; text-decoration: none; font-weight: bold; }
            strong { color: #212529; }
            .button { background-color: #007bff; color: white; padding: 15px 25px; border-radius: 8px; display: inline-block; text-decoration: none; }
            input { padding: 10px; width: 250px; margin-bottom: 20px; border-radius: 5px; border: 1px solid #ccc; }
            .product-card { border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-top: 20px; text-align: left; }
        </style>
    </head>
    <body>
        <div class="container">
            ${bodyContent}
        </div>
    </body>
    </html>
  `;
}

// Webhook signature verification
function verifyWebhookSignature(body, signature, webhookKey) {
  // Implement your webhook verification logic here
  // This is a placeholder - adjust based on Dodo Payments webhook verification
  return true;
}

// Handle webhook events
async function handleWebhook(payload, env) {
  console.log('📦 Webhook Event:', payload.type);
  
  switch (payload.type) {
    case 'payment.succeeded':
      console.log('💰 Payment succeeded:', payload.data.payment_id);
      const customerEmail = payload.data.customer?.email;
      if (customerEmail) {
        if (!userProducts[customerEmail]) {
          userProducts[customerEmail] = [];
        }
        userProducts[customerEmail].push({
          payment_id: payload.data.payment_id,
          product_id: payload.data.product_id,
          purchased_at: new Date(),
          status: 'active',
          amount: payload.data.total_amount,
          currency: payload.data.currency
        });
        console.log(`✅ Product access granted to ${customerEmail}`);
      }
      break;
      
    case 'subscription.active':
      console.log('🔄 Subscription activated:', payload.data.subscription_id);
      const subEmail = payload.data.customer?.email;
      if (subEmail) {
        userSubscriptions[subEmail] = {
          subscription_id: payload.data.subscription_id,
          product_id: payload.data.product_id,
          status: 'active',
          next_billing_date: payload.data.next_billing_date,
          activated_at: new Date(),
          recurring_amount: payload.data.recurring_pre_tax_amount
        };
        console.log(`✅ Subscription activated for ${subEmail}`);
      }
      break;
      
    case 'subscription.renewed':
      console.log('🔄 Subscription renewed:', payload.data.subscription_id);
      const renewEmail = payload.data.customer?.email;
      if (renewEmail && userSubscriptions[renewEmail]) {
        userSubscriptions[renewEmail].next_billing_date = payload.data.next_billing_date;
        userSubscriptions[renewEmail].last_renewed = new Date();
        console.log(`✅ Subscription renewed for ${renewEmail}`);
      }
      break;
      
    case 'subscription.failed':
      console.log('❌ Subscription failed:', payload.data.subscription_id);
      const failEmail = payload.data.customer?.email;
      if (failEmail && userSubscriptions[failEmail]) {
        userSubscriptions[failEmail].status = 'failed';
        userSubscriptions[failEmail].failure_reason = payload.data.failure_reason;
      }
      break;
  }
}

// Main handler function
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  // Route: Home page
  if (pathname === '/' && method === 'GET') {
    const email = url.searchParams.get('email');

    if (email) {
      const subscription = userSubscriptions[email];
      const products = userProducts[email] || [];
      const hasActiveSubscription = subscription && subscription.status === 'active';
      const hasProducts = products.length > 0;

      if (hasActiveSubscription || hasProducts) {
        let accessHtml = '<h1>Welcome Back!</h1><p>You have access to the following:</p>';
        
        if (hasActiveSubscription) {
          accessHtml += `
            <div class="product-card">
              <h3>Active Subscription</h3>
              <p><strong>Product ID:</strong> ${subscription.product_id}</p>
              <p><strong>Status:</strong> ${subscription.status}</p>
              <p><strong>Next Billing Date:</strong> ${new Date(subscription.next_billing_date).toLocaleDateString()}</p>
            </div>
          `;
        }

        if (hasProducts) {
          products.forEach(product => {
            accessHtml += `
              <div class="product-card">
                <h3>One-Time Purchase</h3>
                <p><strong>Product ID:</strong> ${product.product_id}</p>
                <p><strong>Purchased On:</strong> ${new Date(product.purchased_at).toLocaleDateString()}</p>
              </div>
            `;
          });
        }
        
        return new Response(generateHtmlPage('Access Granted', accessHtml), {
          headers: { 'Content-Type': 'text/html' }
        });
      } else {
        return new Response(`
          <!DOCTYPE html>
          <html>
          <head><title>Buy Product</title></head>
          <body>
            <h1>Welcome, ${email}!</h1>
            <p>You do not have any active products or subscriptions.</p>
            <a href="/checkout/${EXISTING_PRODUCT_ID}?email=${encodeURIComponent(email)}" style="padding:15px 25px; background-color:#007bff; color:white; text-decoration:none; border-radius: 8px;">Buy Product Now</a>
          </body>
          </html>
        `, {
          headers: { 'Content-Type': 'text/html' }
        });
      }
    } else {
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Check Access</title>
          <style>
            body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f4f6f8;}
            .container { text-align: center; background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
            input { padding: 10px; width: 250px; margin-bottom: 20px; border-radius: 5px; border: 1px solid #ccc; }
            button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Check Your Access</h1>
            <p>Please enter your email to see your purchases.</p>
            <form action="/" method="GET">
              <input type="email" name="email" placeholder="Enter your email" required />
              <br/>
              <button type="submit">Check Access</button>
            </form>
          </div>
        </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' }
      });
    }
  }

  // Route: Checkout redirect
  if (pathname.startsWith('/checkout/') && method === 'GET') {
    const productId = pathname.split('/checkout/')[1];
    const email = url.searchParams.get('email');
    
    const baseUrl = env.DODO_PAYMENTS_ENVIRONMENT === 'live_mode' 
      ? 'https://checkout.dodopayments.com/buy' 
      : 'https://test.checkout.dodopayments.com/buy';
      
    const successUrl = new URL(env.DODO_PAYMENTS_RETURN_URL || `${url.origin}/success`);
    if (email) {
      successUrl.searchParams.append('email', email);
    }
    const returnUrl = encodeURIComponent(successUrl.toString());

    let checkoutUrl = `${baseUrl}/${productId}?quantity=1&redirect_url=${returnUrl}`;
    if (email) checkoutUrl += `&email=${encodeURIComponent(email)}`;
    
    return Response.redirect(checkoutUrl, 302);
  }

  // Route: Success page
  if (pathname === '/success' && method === 'GET') {
    const status = url.searchParams.get('status');
    const email = url.searchParams.get('email');

    if (status !== 'succeeded' && status !== 'active') {
      return new Response(generateHtmlPage(
        "Payment Failed",
        `<h1>Payment Not Successful</h1>
         <p>Your payment status is: <strong>${status || 'unknown'}</strong>.</p>
         <p>Please check your email or contact support if you believe this is an error.</p>
         <a href="/">← Back to Home</a>`
      ), {
        status: 400,
        headers: { 'Content-Type': 'text/html' }
      });
    }

    const customerEmail = email || 'your email';
    const successHtml = `
      <h1>Thank You!</h1>
      <h2>Your purchase is being processed.</h2>
      <p>Your access will be granted automatically in just a few moments. We've sent a confirmation to <strong>${customerEmail}</strong>.</p>
      <p>You can check your access status on the home page shortly.</p>
      <br>
      <a href="/?email=${encodeURIComponent(customerEmail)}" class="button">View My Access</a>
    `;
    
    return new Response(generateHtmlPage("Payment Successful", successHtml), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // Route: Webhook handler
  if (pathname === '/api/webhook' && method === 'POST') {
    try {
      const body = await request.text();
      const signature = request.headers.get('x-webhook-signature');
      
      // Verify webhook signature
      if (!verifyWebhookSignature(body, signature, env.DODO_PAYMENTS_WEBHOOK_KEY)) {
        return new Response('Invalid signature', { status: 401 });
      }
      
      const payload = JSON.parse(body);
      await handleWebhook(payload, env);
      
      return new Response(JSON.stringify({ received: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Webhook error:', error);
      return new Response('Webhook processing failed', { status: 500 });
    }
  }

  // Route: User access API
  if (pathname.startsWith('/api/user/') && pathname.endsWith('/access') && method === 'GET') {
    const email = pathname.split('/api/user/')[1].split('/access')[0];
    
    const userAccess = {
      email: email,
      subscriptions: userSubscriptions[email] || null,
      products: userProducts[email] || [],
      hasActiveAccess: false,
      accessType: []
    };
    
    if (userAccess.subscriptions && userAccess.subscriptions.status === 'active') {
      userAccess.hasActiveAccess = true;
      userAccess.accessType.push('subscription');
    }
    
    if (userAccess.products.length > 0) {
      userAccess.hasActiveAccess = true;
      userAccess.accessType.push('product');
    }
    
    return new Response(JSON.stringify(userAccess), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 404 - Not Found
  return new Response('Not Found', { status: 404 });
}
