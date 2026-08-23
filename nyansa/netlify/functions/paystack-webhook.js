// Receives events from Paystack (payment succeeded, subscription cancelled,
// etc.) and updates the `subscriptions` table in Supabase accordingly.
//
// Needs three environment variables in Netlify:
//   PAYSTACK_SECRET_KEY        — same key used in create-checkout-session.js.
//                                 Paystack uses this same key to sign
//                                 webhooks, so no separate webhook secret
//                                 is needed (unlike Stripe).
//   SUPABASE_URL               — same one used elsewhere in this project
//   SUPABASE_SERVICE_ROLE_KEY  — the SECRET Supabase key (never the anon
//                                 one) — lets the server write to any
//                                 user's row, bypassing row-level security.

const crypto = require('crypto');

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
            // Reusing the same column that used to hold Stripe's customer
            // id — it's just a generic text field for "the processor's
            // reference to this customer".
            stripe_customer_id: customerCode,
            updated_at: new Date().toISOString()
          })
        });
      }
    } else if (payload.event === 'subscription.disable' || payload.event === 'subscription.not_renew') {
      const data = payload.data;
      const customerCode = data.customer && data.customer.customer_code;
      if (customerCode) {
        await fetch(supabaseUrl + '/rest/v1/subscriptions?stripe_customer_id=eq.' + customerCode, {
          method: 'PATCH',
          headers: {
            'apikey': serviceKey,
            'Authorization': 'Bearer ' + serviceKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ status: 'free', updated_at: new Date().toISOString() })
        });
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
