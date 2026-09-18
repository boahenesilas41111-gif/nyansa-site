// Receives payment events from Paystack and grants 30 days of unlimited
// access when a one-time payment succeeds.
//
// Needs three environment variables in Netlify:
//   PAYSTACK_SECRET_KEY        — same key used in create-checkout-session.js.
//                                 Paystack uses this same key to sign
//                                 webhooks, so no separate webhook secret
//                                 is needed.
//   SUPABASE_URL               — same one used elsewhere in this project
//   SUPABASE_SERVICE_ROLE_KEY  — the SECRET Supabase key (never the anon
//                                 one) — lets the server write to any
//                                 user's row, bypassing row-level security.

const crypto = require('crypto');
const ACCESS_DAYS = 30;

exports.handler = async (event) => {
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!paystackSecret || !supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: 'Missing required environment variables (PAYSTACK_SECRET_KEY, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY).' };
  }

  const sig = event.headers['x-paystack-signature'];
  if (!sig) {
    return { statusCode: 400, body: 'Missing x-paystack-signature header.' };
  }

  // Manually verify this really came from Paystack.
  const expectedSig = crypto.createHmac('sha512', paystackSecret).update(event.body).digest('hex');
  if (expectedSig !== sig) {
    return { statusCode: 400, body: 'Invalid signature.' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }

  try {
    if (payload.event === 'charge.success') {
      const data = payload.data;
      const userId = data.metadata && data.metadata.user_id;
      const customerCode = data.customer && data.customer.customer_code;

      if (userId) {
        const expiresAt = new Date(Date.now() + ACCESS_DAYS * 24 * 60 * 60 * 1000).toISOString();

        await fetch(supabaseUrl + '/rest/v1/subscriptions', {
          method: 'POST',
          headers: {
            'apikey': serviceKey,
            'Authorization': 'Bearer ' + serviceKey,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify({
            user_id: userId,
            status: 'active',
            stripe_customer_id: customerCode,
            expires_at: expiresAt,
            updated_at: new Date().toISOString()
          })
        });
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
