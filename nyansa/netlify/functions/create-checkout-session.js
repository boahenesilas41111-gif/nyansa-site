// Starts a Stripe subscription checkout for a logged-in user.
// STRIPE_SECRET_KEY must be set in Netlify's environment variables.
// No Stripe SDK needed — this calls Stripe's plain REST API directly,
// same pattern as the other functions in this project.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "STRIPE_SECRET_KEY is not set in this site's environment variables." }) };
  }

  try {
    const { userId, email } = JSON.parse(event.body);
    if (!userId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'userId is required' }) };
    }

    // process.env.URL is Netlify's own live site URL — no need to hardcode a domain.
    const siteUrl = process.env.URL || ('https://' + event.headers.host);

    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    // This price ID is specific to your Stripe product (Nyansa Unlimited).
    params.append('line_items[0][price]', 'price_1U71i9A4iHvcy77tRkIe8Did');
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', siteUrl + '/?checkout=success');
    params.append('cancel_url', siteUrl + '/?checkout=cancelled');
    // Tagging the session with the Supabase user id is how the webhook
    // later knows WHICH user just paid.
    params.append('metadata[user_id]', userId);
    if (email) params.append('customer_email', email);
    // Managed Payments (on by default for new Stripe accounts) requires a
    // tax code on the product, which is overkill for a small digital
    // subscription — turning it off for this session avoids that entirely.
    params.append('managed_payments[enabled]', 'false');

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + secretKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await response.json();
    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify(data) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: data.url })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
