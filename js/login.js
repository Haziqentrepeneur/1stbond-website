;(function () {
  'use strict'

  const SUPABASE_URL = window.APP_CONFIG?.supabaseUrl || ''
  const SUPABASE_KEY = window.APP_CONFIG?.supabaseKey || ''
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

  // ── Client-side rate limiting ─────────────────────────────────────────────
  // Primary enforcement is Supabase Auth server-side; this is a UX layer.
  const MAX_ATTEMPTS = 5
  const BASE_LOCKOUT = 30   // seconds; doubles each successive lockout
  const RL_KEY       = '1stbond_login_rl'

  function loadRL() {
    try { return JSON.parse(localStorage.getItem(RL_KEY)) || { attempts: 0, until: 0 } }
    catch { return { attempts: 0, until: 0 } }
  }
  function saveRL(state) { localStorage.setItem(RL_KEY, JSON.stringify(state)) }
  function clearRL()     { localStorage.removeItem(RL_KEY) }

  let rl = loadRL()
  let countdownTimer = null

  // ── View switching ────────────────────────────────────────────────────────
  function show(id) {
    ['view-login', 'view-forgot', 'view-forgot-sent']
      .forEach(v => document.getElementById(v).classList.toggle('hidden', v !== id))
  }

  // ── Eye toggle ────────────────────────────────────────────────────────────
  function toggleEye(inputId, btn) {
    const el = document.getElementById(inputId)
    const hidden = el.type === 'password'
    el.type = hidden ? 'text' : 'password'
    btn.innerHTML = hidden
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
  }

  // ── Button loading state ──────────────────────────────────────────────────
  function setLoading(btnId, loading, label) {
    const btn = document.getElementById(btnId)
    btn.disabled = loading
    btn.innerHTML = loading ? '<span class="spinner"></span>' : label
  }

  // ── Lockout countdown ─────────────────────────────────────────────────────
  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer)
    const btn = document.getElementById('login-btn')
    countdownTimer = setInterval(() => {
      const remaining = Math.ceil((rl.until - Date.now()) / 1000)
      if (remaining <= 0) {
        clearInterval(countdownTimer)
        btn.disabled = false
        btn.textContent = 'Sign In'
        document.getElementById('login-err').style.display = 'none'
      } else {
        btn.disabled = true
        btn.textContent = 'Try again in ' + remaining + 's'
      }
    }, 500)
  }

  // ── Auth event logging (fire-and-forget — never blocks login) ────────────
  function logAuthEvent(eventType, result, error_code) {
    try {
      fetch('/.netlify/functions/auth-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: eventType, result, error_code: error_code || null }),
      }).catch(() => {})
    } catch (_) {}
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async function handleLogin() {
    const err = document.getElementById('login-err')
    err.style.display = 'none'

    if (Date.now() < rl.until) {
      const remaining = Math.ceil((rl.until - Date.now()) / 1000)
      err.textContent = 'Too many attempts. Try again in ' + remaining + ' seconds.'
      err.style.display = 'block'
      return
    }

    const email = document.getElementById('email').value.trim().toLowerCase()
    const pw    = document.getElementById('password').value

    if (!email) { err.textContent = 'Please enter your email.'; err.style.display = 'block'; return }
    if (!pw)    { err.textContent = 'Please enter your password.'; err.style.display = 'block'; return }

    logAuthEvent('login_attempt', 'attempt')
    setLoading('login-btn', true, 'Sign In')
    const { error } = await sb.auth.signInWithPassword({ email, password: pw })
    setLoading('login-btn', false, 'Sign In')

    if (error) {
      rl.attempts += 1
      const errorCode = error.code || (error.message.includes('invalid_credentials') ? 'invalid_credentials' : 'unknown')
      if (rl.attempts >= MAX_ATTEMPTS) {
        const extra    = rl.attempts - MAX_ATTEMPTS
        const lockSecs = BASE_LOCKOUT * Math.pow(2, extra)
        rl.until = Date.now() + lockSecs * 1000
        saveRL(rl)
        logAuthEvent('lockout', 'locked', errorCode)
        err.textContent = 'Too many failed attempts. Locked for ' + lockSecs + ' seconds.'
        err.style.display = 'block'
        startCountdown()
      } else {
        saveRL(rl)
        logAuthEvent('login_failure', 'failure', errorCode)
        const left = MAX_ATTEMPTS - rl.attempts
        const isInvalidCreds = error.message.includes('Invalid login') || error.message.includes('invalid_credentials')
        err.textContent = isInvalidCreds
          ? 'Incorrect email or password. ' + left + ' attempt' + (left !== 1 ? 's' : '') + ' remaining.'
          : error.message
        err.style.display = 'block'
      }
      return
    }

    logAuthEvent('login_success', 'success')
    clearRL()
    rl = { attempts: 0, until: 0 }
    window.location.href = '/account'
  }

  // ── Forgot password ───────────────────────────────────────────────────────
  async function handleForgot() {
    const email = document.getElementById('forgot-email').value.trim().toLowerCase()
    const err   = document.getElementById('forgot-err')
    err.style.display = 'none'

    if (!email) { err.textContent = 'Please enter your email.'; err.style.display = 'block'; return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      err.textContent = 'Please enter a valid email address.'
      err.style.display = 'block'; return
    }

    setLoading('forgot-btn', true, 'Send Reset Link')
    await sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://1st-bond.com/reset-password' })
    setLoading('forgot-btn', false, 'Send Reset Link')
    show('view-forgot-sent')
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    const { data: { session } } = await sb.auth.getSession()
    if (session) { window.location.href = '/account'; return }

    if (Date.now() < rl.until) startCountdown()

    document.getElementById('password-eye-btn').addEventListener('click', function () { toggleEye('password', this) })
    document.getElementById('forgot-link-btn').addEventListener('click', () => show('view-forgot'))
    document.getElementById('login-btn').addEventListener('click', handleLogin)
    document.getElementById('forgot-btn').addEventListener('click', handleForgot)
    document.getElementById('back-to-login-btn').addEventListener('click', () => show('view-login'))
    document.getElementById('back-to-login-sent-btn').addEventListener('click', () => show('view-login'))

    document.getElementById('email').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('password').focus() })
    document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin() })
    document.getElementById('forgot-email').addEventListener('keydown', e => { if (e.key === 'Enter') handleForgot() })
  }

  init()
})()
