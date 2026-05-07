// Netlify serverless function — handles password reset via Supabase.
// SUPABASE_URL and SUPABASE_ANON_KEY must be set in the Netlify dashboard. Never put them in code.

const SUPABASE_URL      = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

const PW_MIN     = 10
const PW_UPPER   = /[A-Z]/
const PW_NUMBER  = /[0-9]/
const PW_SPECIAL = /[^a-zA-Z0-9]/

function validatePassword(pw) {
  if (!pw || typeof pw !== 'string')  return 'Password is required.'
  if (pw.length < PW_MIN)             return `Password must be at least ${PW_MIN} characters.`
  if (!PW_UPPER.test(pw))             return 'Password must contain an uppercase letter.'
  if (!PW_NUMBER.test(pw))            return 'Password must contain a number.'
  if (!PW_SPECIAL.test(pw))           return 'Password must contain a special character (e.g. !@#$%).'
  return null
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars')
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) }
  }

  let body
  try { body = JSON.parse(event.body) } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) }
  }

  const { access_token, password } = body

  if (!access_token || typeof access_token !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing access token' }) }
  }

  // Validate password server-side — never trust the client
  const pwError = validatePassword(password)
  if (pwError) {
    return { statusCode: 400, body: JSON.stringify({ error: pwError }) }
  }

  // Call Supabase — keys never leave the server
  let res
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ password }),
    })
  } catch (err) {
    console.error('Supabase fetch error:', err)
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not reach auth service. Try again.' }) }
  }

  if (!res.ok) {
    // Don't forward Supabase internals to the browser
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Link expired or already used. Please request a new reset link from the app.' }),
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  }
}
