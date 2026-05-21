// Receives auth event beacons from the login page and writes structured JSON
// to stdout, where Netlify log drains can capture them for SIEM/alerting.
// Returns 204 immediately — never blocks the login flow.

// ── In-process IP rate limiter ────────────────────────────────────────────────
const _ipCounts = new Map()
function ipAllowed(ip, max, windowMs) {
  const now = Date.now()
  const e = _ipCounts.get(ip)
  if (!e || now > e.windowEnd) { _ipCounts.set(ip, { count: 1, windowEnd: now + windowMs }); return true }
  if (e.count >= max) return false
  e.count++
  return true
}
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of _ipCounts) { if (now > v.windowEnd) _ipCounts.delete(k) }
}, 300_000)

const ALLOWED_EVENTS = new Set([
  'login_attempt',
  'login_success',
  'login_failure',
  'lockout',
  'password_reset_request',
])

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: SECURITY_HEADERS, body: '' }
  }

  const ip = (event.headers['x-forwarded-for'] || event.headers['x-nf-client-connection-ip'] || '').split(',')[0].trim() || 'unknown'
  const ua = (event.headers['user-agent'] || '').slice(0, 200)

  // IP rate limit: 60 events per minute per IP (prevents log flooding)
  if (!ipAllowed(ip, 60, 60_000)) {
    return { statusCode: 429, headers: SECURITY_HEADERS, body: '' }
  }

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch {
    return { statusCode: 400, headers: SECURITY_HEADERS, body: '' }
  }

  const { event: eventType, result, error_code } = payload

  if (!ALLOWED_EVENTS.has(eventType)) {
    return { statusCode: 400, headers: SECURITY_HEADERS, body: '' }
  }

  console.log(JSON.stringify({
    ts:         new Date().toISOString(),
    fn:         'auth-log',
    event:      eventType,
    result:     result   || null,
    error_code: error_code || null,
    ip,
    ua,
  }))

  return { statusCode: 204, headers: SECURITY_HEADERS, body: '' }
}
