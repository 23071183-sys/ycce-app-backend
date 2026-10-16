const crypto = require('crypto');

// Razorpay Payment Links over plain HTTPS. Payment Links work the same in Expo
// Go, the APK and the browser, so no native SDK is needed anywhere.
// Test keys (rzp_test_...) and live keys use the same API; only the keys differ.

const API = 'https://api.razorpay.com/v1';

const configured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
const webhookConfigured = () => Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);

async function request(method, path, body) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.description || `Razorpay responded ${res.status}`);
    err.status = 502;
    throw err;
  }
  return data;
}

const createPaymentLink = (payload) => request('POST', '/payment_links', payload);
const fetchPaymentLink = (id) => request('GET', `/payment_links/${encodeURIComponent(id)}`);

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Webhooks are signed over the exact raw body with the webhook secret.
const verifyWebhook = (rawBody, signature) =>
  webhookConfigured() && safeEqual(hmac(process.env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);

// The browser redirect after paying is signed with the key secret over
// link_id|reference_id|status|payment_id.
const verifyCallback = (q) =>
  configured() &&
  safeEqual(
    hmac(
      process.env.RAZORPAY_KEY_SECRET,
      `${q.razorpay_payment_link_id}|${q.razorpay_payment_link_reference_id}|${q.razorpay_payment_link_status}|${q.razorpay_payment_id}`
    ),
    q.razorpay_signature
  );

module.exports = { configured, webhookConfigured, createPaymentLink, fetchPaymentLink, verifyWebhook, verifyCallback };
