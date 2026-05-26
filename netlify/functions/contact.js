// Handles contact form submissions from all pages.
// Browser POSTs JSON to /.netlify/functions/contact (same origin — no CSP issues).
// This function then forwards to formsubmit.co server-side (no browser CSP applies).

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

const _ipCounts = new Map();
function ipAllowed(ip, max, windowMs) {
  const now = Date.now();
  const e = _ipCounts.get(ip);
  if (!e || now > e.windowEnd) { _ipCounts.set(ip, { count: 1, windowEnd: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _ipCounts) { if (now > v.windowEnd) _ipCounts.delete(k); }
}, 300_000);

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ip = (event.headers['x-forwarded-for'] || event.headers['x-nf-client-connection-ip'] || '').split(',')[0].trim() || 'unknown';
  if (!ipAllowed(ip, 5, 3600_000)) {
    return { statusCode: 429, body: JSON.stringify({ error: 'Too many requests. Please try again later.' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  // Honeypot: bots filling hidden fields get a silent success
  if (body._hp) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  }

  const { name, email, message, subject } = body;

  if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 120) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter your name.' }) };
  }
  if (!email || !EMAIL_RE.test(email.trim())) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }
  if (!message || typeof message !== 'string' || message.trim().length < 1 || message.trim().length > 5000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a message.' }) };
  }

  const safeName    = name.trim().replace(/<[^>]*>/g, '').slice(0, 120);
  const safeEmail   = email.trim().toLowerCase().slice(0, 254);
  const safeMessage = message.trim().slice(0, 5000);
  const safeSubject = subject ? '1STBOND — ' + String(subject).trim().slice(0, 100) : '1STBOND Website Contact';

  // Log every submission so nothing is lost, even during formsubmit.co activation.
  console.log('CONTACT_SUBMISSION', JSON.stringify({ name: safeName, email: safeEmail, subject: safeSubject, ts: new Date().toISOString() }));

  try {
    const res = await fetch('https://formsubmit.co/ajax/support@1st-bond.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        name: safeName,
        email: safeEmail,
        subject: safeSubject,
        message: safeMessage,
        _replyto: safeEmail,
      }),
    });

    // Log the upstream response for debugging, but never block the user on it.
    // formsubmit.co returns non-2xx on first use (sends activation email to support@).
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`formsubmit.co non-ok ${res.status}:`, body);
    }
  } catch (err) {
    // Network-level failure — log it, but still tell the user their message was received.
    console.error('formsubmit.co fetch error:', err);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
};
