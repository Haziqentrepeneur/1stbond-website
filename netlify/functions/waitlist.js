// Netlify serverless function — proxies waitlist submissions to Airtable.
// The AIRTABLE_TOKEN env var must be set in the Netlify dashboard (never in code).

const AIRTABLE_BASE  = process.env.AIRTABLE_BASE  || 'appVCNSPnOSnUSDNi';
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE || 'Waitlist';
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN; // set in Netlify dashboard

// ── In-process IP rate limiter ────────────────────────────────────────────────
// Best-effort on warm instances (resets on cold starts). Stops burst abuse.
const _ipCounts = new Map()
function ipAllowed(ip, max, windowMs) {
  const now = Date.now()
  const e = _ipCounts.get(ip)
  if (!e || now > e.windowEnd) { _ipCounts.set(ip, { count: 1, windowEnd: now + windowMs }); return true }
  if (e.count >= max) return false
  e.count++
  return true
}

// Periodic cleanup so the map doesn't grow unbounded in long-lived instances
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of _ipCounts) { if (now > v.windowEnd) _ipCounts.delete(k) }
}, 300_000)

// Allowed notify-via values
const ALLOWED_NOTIFY = new Set(['Email', 'SMS', 'Email + SMS']);
// Allowed plan values
const ALLOWED_PLANS  = new Set(['Free', 'Premium', 'Business', 'General']);

// Basic email regex (RFC 5322 simplified)
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;
// E.164-ish phone — allow spaces/dashes/parens, 7–15 digits total
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

exports.handler = async function (event) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ip = (event.headers['x-forwarded-for'] || event.headers['x-nf-client-connection-ip'] || '').split(',')[0].trim() || 'unknown'

  // IP rate limit: 5 submissions per hour per IP
  if (!ipAllowed(ip, 5, 3600_000)) {
    return { statusCode: 429, body: JSON.stringify({ error: 'Too many requests. Please try again later.' }) };
  }

  // Require the token to be configured
  if (!AIRTABLE_TOKEN) {
    console.error('AIRTABLE_TOKEN env var is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  // Honeypot: bots filling hidden fields get a silent success (don't reveal detection)
  if (body._hp) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  }

  // Timing check: form submitted in < 2s is almost certainly a bot
  if (body._t && Date.now() - Number(body._t) < 2000) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  }

  const { name, email, phone, notifyVia, planInterest } = body;

  // --- Input validation ---
  if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 120) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Name must be 1–120 characters.' }) };
  }
  if (!email || !EMAIL_RE.test(email.trim())) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }
  if (phone && !PHONE_RE.test(phone.trim())) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a valid phone number.' }) };
  }
  const safeNotify = ALLOWED_NOTIFY.has(notifyVia) ? notifyVia : 'Email';
  const safePlan   = ALLOWED_PLANS.has(planInterest) ? planInterest : 'General';

  const fields = {
    'Name':          name.trim().slice(0, 120),
    'Email':         email.trim().toLowerCase().slice(0, 254),
    'Phone':         (phone || '').trim().slice(0, 30),
    'Notify via':    safeNotify,
    'Plan Interest': safePlan,
    'Signed Up':     new Date().toLocaleDateString('en-US'),
  };

  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Airtable error:', err);
      // Never forward Airtable internals to the browser
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not save your entry. Please try again.' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('Fetch error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error. Please try again.' }) };
  }
};
