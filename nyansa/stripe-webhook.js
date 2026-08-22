// Receives events from Stripe (payment succeeded, subscription cancelled, etc.)
// and updates the `subscriptions` table in Supabase accordingly.
//
// Needs three environment variables in Netlify:
//   STRIPE_WEBHOOK_SECRET      — from the Stripe webhook you'll create, starts with whsec_
//   SUPABASE_URL               — same one used on the frontend
//   SUPABASE_SERVICE_ROLE_KEY  — the SECRET Supabase key (never the anon one) —
//                                 this is what lets the server bypass row-level
//                                 security to write to another user's row.
//
// Verifies Stripe's signature manually using Node's built-in crypto module —
// no Stripe SDK required.

const crypto = require('crypto');

exports.handler = async (event) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!webhookSecret || !supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: 'Missing required environment variables (STRIPE_WEBHOOK_SECRET, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY).' };
  }

  const sig = event.headers['stripe-signature'];
  if (!sig) {
    return { statusCode: 400, body: 'Missing Stripe-Signature header.' };
  }

  // Manually verify this really came from Stripe.
  const sigParts = Object.fromEntries(sig.split(',').map(p => p.split('=')));
  const signedPayload = sigParts.t + '.' + event.body;
  const expectedSig = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
  if (expectedSig !== sigParts.v1) {
    return { statusCode: 400, body: 'Invalid signature.' };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }

  try {
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const userId = session.metadata && session.metadata.user_id;
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
            stripe_customer_id: session.customer,
            updated_at: new Date().toISOString()
          })
        });
      }
    } else if (stripeEvent.type === 'customer.subscription.updated' || stripeEvent.type === 'customer.subscription.deleted') {
      const sub = stripeEvent.data.object;
      const status = sub.status === 'active' ? 'active' : 'free';
      await fetch(supabaseUrl + '/rest/v1/subscriptions?stripe_customer_id=eq.' + sub.customer, {
        method: 'PATCH',
        headers: {
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status, updated_at: new Date().toISOString() })
      });
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
