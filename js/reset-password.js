;(function () {
  'use strict'

  var SUPABASE_URL      = window.APP_CONFIG?.supabaseUrl || ''
  var SUPABASE_ANON_KEY = window.APP_CONFIG?.supabaseKey || ''

  var supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  var appDeepLink = null

  function showSection(id) {
    document.querySelectorAll('section').forEach(function (s) { s.style.display = 'none' })
    document.getElementById(id).style.display = 'block'
  }

  var EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
  var EYE_OFF  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'

  function buildForm(el) {
    el.innerHTML =
      '<div class="error-box" id="field-error"></div>' +
      '<div class="field">' +
        '<label>New Password</label>' +
        '<div class="input-wrap">' +
          '<input type="password" id="pw" placeholder="At least 10 characters" maxlength="256" autocomplete="new-password">' +
          '<button type="button" class="eye-btn" id="pw-eye-btn">' + EYE_OPEN + '</button>' +
        '</div>' +
        '<p class="hint">At least 10 characters, including uppercase, number, and special character</p>' +
      '</div>' +
      '<div class="field">' +
        '<label>Confirm Password</label>' +
        '<div class="input-wrap">' +
          '<input type="password" id="pw2" placeholder="Repeat password" maxlength="256" autocomplete="new-password">' +
          '<button type="button" class="eye-btn" id="pw2-eye-btn">' + EYE_OPEN + '</button>' +
        '</div>' +
      '</div>' +
      '<button class="btn-primary" id="submit-btn">Update Password</button>'

    el.querySelector('#pw-eye-btn').addEventListener('click', function () { toggleEye('pw', this) })
    el.querySelector('#pw2-eye-btn').addEventListener('click', function () { toggleEye('pw2', this) })
    el.querySelector('#submit-btn').addEventListener('click', doReset)
  }

  function toggleEye(id, btn) {
    var inp = document.getElementById(id)
    if (inp.type === 'password') { inp.type = 'text'; btn.innerHTML = EYE_OFF }
    else { inp.type = 'password'; btn.innerHTML = EYE_OPEN }
  }

  function showError(msg) {
    var el = document.getElementById('field-error')
    if (!el) return
    el.textContent = msg
    el.style.display = 'block'
  }

  function validate(pw, pw2) {
    if (!pw || !pw2)               { showError('Please fill in both fields.'); return false }
    if (pw.length < 10)            { showError('Password must be at least 10 characters.'); return false }
    if (!/[A-Z]/.test(pw))         { showError('Password must contain an uppercase letter.'); return false }
    if (!/[0-9]/.test(pw))         { showError('Password must contain a number.'); return false }
    if (!/[^a-zA-Z0-9]/.test(pw))  { showError('Password must contain a special character.'); return false }
    if (pw !== pw2)                 { showError('Passwords do not match.'); return false }
    return true
  }

  async function doReset() {
    var errEl = document.getElementById('field-error')
    if (errEl) errEl.style.display = 'none'
    var pw  = document.getElementById('pw').value
    var pw2 = document.getElementById('pw2').value
    if (!validate(pw, pw2)) return
    var btn = document.getElementById('submit-btn')
    btn.disabled = true
    btn.textContent = 'Updating…'
    try {
      var result = await supabaseClient.auth.updateUser({ password: pw })
      if (result.error) {
        showError(result.error.message || 'Failed to update. Please request a new link.')
        btn.disabled = false
        btn.textContent = 'Update Password'
      } else {
        showSection('sec-success')
      }
    } catch (e) {
      showError('Network error. Please try again.')
      btn.disabled = false
      btn.textContent = 'Update Password'
    }
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  var hashP  = new URLSearchParams(window.location.hash.slice(1))
  var queryP = new URLSearchParams(window.location.search.slice(1))
  var at     = hashP.get('access_token')
  var rt     = hashP.get('refresh_token')
  var type   = hashP.get('type') || queryP.get('type')
  var code   = queryP.get('code')
  var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  if (at && rt && type === 'recovery') {
    supabaseClient.auth.setSession({ access_token: at, refresh_token: rt }).then(function (res) {
      if (res.error) { showSection('sec-error'); return }
      appDeepLink = 'firstbond://reset-password#' + window.location.hash.slice(1)
      if (isMobile) {
        showSection('sec-mobile')
        buildForm(document.getElementById('form-mobile'))
        window.location.href = appDeepLink
        document.getElementById('btn-open-app').addEventListener('click', function () { window.location.href = appDeepLink })
      } else {
        showSection('sec-desktop')
        buildForm(document.getElementById('form-desktop'))
      }
    })
  } else if (code && type === 'recovery') {
    supabaseClient.auth.exchangeCodeForSession(code).then(function (res) {
      if (res.error) { showSection('sec-error'); return }
      appDeepLink = 'firstbond://reset-password?' + window.location.search.slice(1)
      if (isMobile) {
        showSection('sec-mobile')
        buildForm(document.getElementById('form-mobile'))
        window.location.href = appDeepLink
        document.getElementById('btn-open-app').addEventListener('click', function () { window.location.href = appDeepLink })
      } else {
        showSection('sec-desktop')
        buildForm(document.getElementById('form-desktop'))
      }
    })
  } else {
    showSection('sec-error')
  }
})()
