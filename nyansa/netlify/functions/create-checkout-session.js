// Starts a ONE-TIME Paystack payment for 30 days of unlimited access.
// (Not a recurring subscription — Paystack subscriptions only support
// card payments, which locks out Mobile Money, Bank Transfer, and USSD.
// A one-time charge supports all of those instead.)
//
// PAYSTACK_SECRET_KEY must be set in Netlify's environment variables.

// Price of one 30-day unlimited pass, in pesewas (GHS's smallest unit —
// 100 pesewas = GHS 1). Change this single number to change the price.
const AMOUNT_PESEWAS = 1000; // GHS 10.00
const CURRENCY = 'GHS';

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

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + secretKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        amount: AMOUNT_PESEWAS,
        currency: CURRENCY,
        // No "plan" here — this is what makes it a one-time charge, which
        // is what unlocks these extra channels.
        channels: ['card', 'mobile_money', 'bank', 'ussd'],
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
