// Netlify build script: generates js/env.js from environment variables.
// Run automatically by Netlify before each deploy (see netlify.toml [build] command).
// js/env.js is gitignored — credentials never touch the repository.

const { writeFileSync, mkdirSync } = require('fs')

const url = process.env.SUPABASE_URL || ''
const key = process.env.SUPABASE_ANON_KEY || ''

if (!url || !key) {
  console.error('[build] ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set in Netlify dashboard environment variables.')
  process.exit(1)
}

// Sanitise: only allow known-safe characters (URL chars + base64url)
if (!/^https:\/\/[a-zA-Z0-9._\-/]+$/.test(url)) {
  console.error('[build] ERROR: SUPABASE_URL contains unexpected characters.')
  process.exit(1)
}
if (!/^[A-Za-z0-9._\-]+$/.test(key)) {
  console.error('[build] ERROR: SUPABASE_ANON_KEY contains unexpected characters.')
  process.exit(1)
}

mkdirSync('js', { recursive: true })

writeFileSync(
  'js/env.js',
  `window.APP_CONFIG={"supabaseUrl":"${url}","supabaseKey":"${key}"};\n`
)

console.log('[build] js/env.js generated successfully.')
