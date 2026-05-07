// Netlify serverless function — handles password reset via Supabase.
// SUPABASE_URL and SUPABASE_ANON_KEY must be set in the Netlify dashboard. Never put them in code.

const SUPABASE_URL      = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

const PW_MIN     = 10
const PW_UPPER   = /[A-Z]/
const PW_NUMBER  = /[0-9]/
const PW_SPECIAL = /[^a-zA-Z0-9]/
const MAX_BODY   = 4096  // bytes — reject oversized payloads

// JWT format: three Base64url segments separated by dots
const JWT_PATTERN = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

const SECURITY_HEADERS = {
  'Content-Type':           'application/json',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control':          'no-store',
}

function validatePassword(pw) {
  if (!pw || typeof pw !== 'string')  return 'Password is required.'
  if (pw.length < PW_MIN)             return `Password must be at least ${PW_MIN} characters.`
  if (pw.length > 256)                return 'Password is too long.'
  if (!PW_UPPER.test(pw))             return 'Password must contain an uppercase letter.'
  if (!PW_NUMBER.test(pw))            return 'Password must contain a number.'
  if (!PW_SPECIAL.test(pw))           return 'Password must contain a special character (e.g. !@#$%).'
  return null
}

function json(statusCode, body) {
  return { statusCode, headers: SECURITY_HEADERS, body: JSON.stringify(body) }
}

exports.handler = async (event) => {
  // Method guard
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  // Origin check — only accept requests from our own domain (defense-in-depth)
  const origin = (event.headers['origin'] || event.headers['Origin'] || '').toLowerCase()
  if (origin && origin !== 'https://1st-bond.com') {
    return json(403, { error: 'Forbidden' })
  }

  // Env var guard
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars')
    return json(500, { error: 'Server misconfiguration' })
  }

  // Payload size guard
  const bodyLen = Buffer.byteLength(event.body || '', 'utf8')
  if (bodyLen > MAX_BODY) {
    return json(413, { error: 'Request too large' })
  }

  // Parse body
  let body
  try { body = JSON.parse(event.body) } catch {
    return json(400, { error: 'Invalid request body' })
  }

  const { access_token, password } = body

  // Token format validation — must be a JWT-shaped string
  if (!access_token || typeof access_token !== 'string' || !JWT_PATTERN.test(access_token)) {
    return json(400, { error: 'Missing or invalid access token' })
  }

  // Server-side password validation — never trust the client
  const pwError = validatePassword(password)
  if (pwError) {
    return json(400, { error: pwError })
  }

  // Call Supabase — keys never leave the server
  let res
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${access_token}`,
        'apikey':        SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ password }),
    })
  } catch (err) {
    console.error('Supabase fetch error:', err)
    return json(502, { error: 'Could not reach auth service. Try again.' })
  }

  if (!res.ok) {
    // Never forward Supabase error internals to the browser
    return json(400, { error: 'Link expired or already used. Please request a new reset link from the app.' })
  }

  return json(200, { ok: true })
}
