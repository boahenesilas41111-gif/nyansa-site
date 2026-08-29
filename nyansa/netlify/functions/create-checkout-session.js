// Starts a Paystack subscription checkout for a logged-in user.
// PAYSTACK_SECRET_KEY must be set in Netlify's environment variables.
// Calls Paystack's plain REST API directly — no SDK needed.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "PAYSTACK_SECRET_KEY is not set in this site's environment variables." }) };
  }

  try {
    const { userId, email } = JSON.parse(event.body);
    if (!userId || !email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'userId and email are required' }) };
    }

    // process.env.URL is Netlify's own live site URL — no need to hardcode a domain.
    const siteUrl = process.env.URL || ('https://' + event.headers.host);

    // Paystack still wants an explicit amount even when a plan is given —
    // look the plan's real amount up each time so it can't drift out of
    // sync if the price is ever changed in the Paystack dashboard.
    const planRes = await fetch('https://api.paystack.co/plan/PLN_464kn6pylq08wrz', {
      headers: { 'Authorization': 'Bearer ' + secretKey }
    });
    const planData = await planRes.json();
    if (!planRes.ok || !planData.status) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not look up the subscription plan.' }) };
    }
    const amount = planData.data.amount;
    const currency = planData.data.currency;

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + secretKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        amount: amount,
        currency: currency,
        // This plan code is specific to your Paystack plan (Nyansa Unlimited).
        plan: 'PLN_464kn6pylq08wrz',
        callback_url: siteUrl + '/?checkout=success',
        // Tagging the transaction with the Supabase user id is how the
        // webhook later knows WHICH user just paid.
        metadata: { user_id: userId }
      })
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      return {
        statusCode: response.status || 500,
        body: JSON.stringify({ error: data.message || 'Paystack could not start the transaction.' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: data.data.authorization_url })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
