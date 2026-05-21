;(function () {
  'use strict'

  const SUPABASE_URL = window.APP_CONFIG?.supabaseUrl || ''
  const SUPABASE_KEY = window.APP_CONFIG?.supabaseKey || ''
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

  let currentUser    = null
  let currentProfile = null
  let openPanel      = null

  // ── Toast ──────────────────────────────────────────────────────────────────
  let toastTimer = null
  function showToast(msg, type = 'success') {
    const t = document.getElementById('toast')
    t.textContent = msg
    t.className = 'toast show ' + type
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { t.className = 'toast' }, 3000)
  }

  function showUpload(text) {
    document.getElementById('upload-bar-text').textContent = text
    document.getElementById('upload-bar').classList.add('show')
  }
  function hideUpload() { document.getElementById('upload-bar').classList.remove('show') }

  // ── Panels ─────────────────────────────────────────────────────────────────
  function toggleEdit(name) {
    const panel = document.getElementById(name + '-panel')
    const isOpen = panel.classList.contains('open')
    if (openPanel && openPanel !== name) cancelEdit(openPanel)
    if (isOpen) { cancelEdit(name); return }
    panel.classList.add('open')
    openPanel = name
    const first = panel.querySelector('input, textarea')
    if (first) setTimeout(() => first.focus(), 40)
  }

  function cancelEdit(name) {
    const panel = document.getElementById(name + '-panel')
    if (!panel) return
    panel.classList.remove('open')
    if (openPanel === name) openPanel = null
    panel.querySelectorAll('input, textarea').forEach(el => el.value = '')
    ;[name + '-err', name + '-ok'].forEach(id => {
      const el = document.getElementById(id)
      if (el) el.classList.add('hidden')
    })
  }

  function setSaveLoading(prefix, loading, label) {
    const btn = document.getElementById(prefix + '-save')
    if (!btn) return
    btn.disabled = loading
    btn.innerHTML = loading ? '<span class="spinner"></span>' : label
  }

  // ── Bio ────────────────────────────────────────────────────────────────────
  async function saveBio() {
    const bio = document.getElementById('bio-input').value.trim()
    const err = document.getElementById('bio-err')
    err.classList.add('hidden')
    setSaveLoading('bio', true, 'Save')

    const { error } = await sb.from('profiles').update({ bio }).eq('id', currentUser.id)
    setSaveLoading('bio', false, 'Save')

    if (error) { err.textContent = 'Failed to save. Please try again.'; err.classList.remove('hidden'); return }
    currentProfile.bio = bio
    document.getElementById('bio-display').textContent = bio || 'No bio yet'
    document.getElementById('bio-display').className = 'row-value' + (bio ? '' : ' dim')
    cancelEdit('bio')
    showToast('Bio updated')
  }

  // ── Email ──────────────────────────────────────────────────────────────────
  async function saveEmail() {
    const email = document.getElementById('email-input').value.trim().toLowerCase()
    const err   = document.getElementById('email-err')
    const ok    = document.getElementById('email-ok')
    err.classList.add('hidden'); ok.classList.add('hidden')

    if (!email) { err.textContent = 'Please enter a new email.'; err.classList.remove('hidden'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Please enter a valid email.'; err.classList.remove('hidden'); return }

    setSaveLoading('email', true, 'Send Confirmation')
    const { error } = await sb.auth.updateUser({ email })
    setSaveLoading('email', false, 'Send Confirmation')

    if (error) { err.textContent = error.message || 'Failed to update email.'; err.classList.remove('hidden'); return }
    ok.classList.remove('hidden')
  }

  // ── Password ───────────────────────────────────────────────────────────────
  function validatePassword(pw) {
    if (!pw || pw.length < 10)     return 'Password must be at least 10 characters.'
    if (!/[A-Z]/.test(pw))         return 'Password must contain an uppercase letter.'
    if (!/[0-9]/.test(pw))         return 'Password must contain a number.'
    if (!/[^a-zA-Z0-9]/.test(pw))  return 'Password must contain a special character.'
    return null
  }

  async function savePassword() {
    const pw1 = document.getElementById('pw-new').value
    const pw2 = document.getElementById('pw-confirm').value
    const err = document.getElementById('password-err')
    const ok  = document.getElementById('password-ok')
    err.classList.add('hidden'); ok.classList.add('hidden')

    const valErr = validatePassword(pw1)
    if (valErr) { err.textContent = valErr; err.classList.remove('hidden'); return }
    if (pw1 !== pw2) { err.textContent = 'Passwords do not match.'; err.classList.remove('hidden'); return }

    setSaveLoading('password', true, 'Update Password')
    const { error } = await sb.auth.updateUser({ password: pw1 })
    setSaveLoading('password', false, 'Update Password')

    if (error) { err.textContent = error.message || 'Failed to update password.'; err.classList.remove('hidden'); return }
    ok.classList.remove('hidden')
    document.getElementById('pw-new').value = ''
    document.getElementById('pw-confirm').value = ''
    showToast('Password updated')
  }

  // ── Avatar upload ──────────────────────────────────────────────────────────
  async function handleAvatarUpload(input) {
    const file = input.files[0]; input.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('Select an image file.', 'error'); return }
    if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5 MB.', 'error'); return }

    showUpload('Uploading photo…')
    const ext  = file.name.split('.').pop().toLowerCase() || 'jpg'
    const path = `${currentUser.id}/avatar_${Date.now()}.${ext}`
    const { error: upErr } = await sb.storage.from('avatars').upload(path, file, { upsert: true })
    if (upErr) { hideUpload(); showToast('Upload failed. Try again.', 'error'); return }

    const { data } = sb.storage.from('avatars').getPublicUrl(path)
    const url = data.publicUrl + '?t=' + Date.now()
    const { error: dbErr } = await sb.from('profiles').update({ avatar_url: url }).eq('id', currentUser.id)
    hideUpload()
    if (dbErr) { showToast('Uploaded but could not save URL.', 'error'); return }

    currentProfile.avatar_url = url
    const img = document.getElementById('avatar-img')
    img.src = url; img.style.display = 'block'
    showToast('Profile photo updated')
  }

  // ── Banner upload ──────────────────────────────────────────────────────────
  async function handleBannerUpload(input) {
    const file = input.files[0]; input.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('Select an image file.', 'error'); return }
    if (file.size > 10 * 1024 * 1024) { showToast('Image must be under 10 MB.', 'error'); return }

    showUpload('Uploading banner…')
    const ext  = file.name.split('.').pop().toLowerCase() || 'jpg'
    const path = `${currentUser.id}/banner_${Date.now()}.${ext}`
    const { error: upErr } = await sb.storage.from('banners').upload(path, file, { upsert: true })
    if (upErr) { hideUpload(); showToast('Upload failed. Try again.', 'error'); return }

    const { data } = sb.storage.from('banners').getPublicUrl(path)
    const url = data.publicUrl + '?t=' + Date.now()
    const { error: dbErr } = await sb.from('profiles').update({ banner_image_url: url }).eq('id', currentUser.id)
    hideUpload()
    if (dbErr) { showToast('Uploaded but could not save URL.', 'error'); return }

    currentProfile.banner_image_url = url
    const img = document.getElementById('banner-img')
    img.src = url; img.style.display = 'block'
    showToast('Banner updated')
  }

  // ── Sign out ───────────────────────────────────────────────────────────────
  async function handleSignOut() {
    await sb.auth.signOut()
    window.location.href = '/login'
  }
  async function handleSignOutAll() {
    await sb.auth.signOut({ scope: 'global' })
    window.location.href = '/login'
  }

  // ── Subscription ───────────────────────────────────────────────────────────
  function renderSubscription(profile) {
    const isPremium = profile.is_subscribed === true
    const iconWrap  = document.getElementById('sub-icon-wrap')
    const name      = document.getElementById('sub-name')
    const desc      = document.getElementById('sub-desc')
    const acts      = document.getElementById('sub-actions')

    if (isPremium) {
      iconWrap.className = 'sub-icon premium'
      iconWrap.style.color = '#b45309'
      name.innerHTML = '<span class="badge-premium">PREMIUM</span>'
      desc.textContent = 'You have access to all premium features including live location tracking on meetups.'
      acts.innerHTML = '<a class="btn-sub-action" href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer">Manage subscription on Apple</a>'
    } else {
      iconWrap.className = 'sub-icon free'
      iconWrap.style.color = '#a020f0'
      name.innerHTML = '<span class="badge-free">FREE</span>'
      desc.textContent = 'Upgrade to Premium to unlock live meetup tracking, priority placement, and more.'
      acts.innerHTML = '<a class="btn-get-premium" href="https://apps.apple.com/app/id6744043695" target="_blank" rel="noopener noreferrer">Get Premium in the App</a>'
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function renderProfile(user, profile) {
    document.getElementById('nav-username').textContent = profile.username ? '@' + profile.username : ''
    const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || '—'
    document.getElementById('profile-fullname').textContent = fullName
    document.getElementById('profile-handle').textContent = profile.username ? '@' + profile.username : ''
    document.getElementById('bio-display').textContent = profile.bio || 'No bio yet'
    if (!profile.bio) document.getElementById('bio-display').classList.add('dim')
    if (profile.bio)  document.getElementById('bio-input').value = profile.bio
    document.getElementById('email-display').textContent = user.email || '—'

    if (profile.avatar_url) {
      const img = document.getElementById('avatar-img')
      img.src = profile.avatar_url; img.style.display = 'block'
    }
    if (profile.banner_image_url) {
      const img = document.getElementById('banner-img')
      img.src = profile.banner_image_url; img.style.display = 'block'
    }
    renderSubscription(profile)
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  document.getElementById('btn-signout').addEventListener('click', handleSignOut)
  document.getElementById('banner-wrap').addEventListener('click', () => document.getElementById('banner-input').click())
  document.getElementById('avatar-wrap').addEventListener('click', () => document.getElementById('avatar-input').click())
  document.getElementById('bio-edit-btn').addEventListener('click', () => toggleEdit('bio'))
  document.getElementById('bio-cancel-btn').addEventListener('click', () => cancelEdit('bio'))
  document.getElementById('bio-save').addEventListener('click', saveBio)
  document.getElementById('avatar-input').addEventListener('change', function () { handleAvatarUpload(this) })
  document.getElementById('banner-input').addEventListener('change', function () { handleBannerUpload(this) })
  document.getElementById('email-edit-btn').addEventListener('click', () => toggleEdit('email'))
  document.getElementById('email-cancel-btn').addEventListener('click', () => cancelEdit('email'))
  document.getElementById('email-save').addEventListener('click', saveEmail)
  document.getElementById('password-edit-btn').addEventListener('click', () => toggleEdit('password'))
  document.getElementById('password-cancel-btn').addEventListener('click', () => cancelEdit('password'))
  document.getElementById('password-save').addEventListener('click', savePassword)
  document.getElementById('btn-signout-all').addEventListener('click', handleSignOutAll)

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    const { data: { session } } = await sb.auth.getSession()
    if (!session) { window.location.href = '/login'; return }
    currentUser = session.user

    const { data: profile, error } = await sb
      .from('profiles')
      .select('first_name, last_name, username, bio, is_subscribed, avatar_url, banner_image_url')
      .eq('id', currentUser.id)
      .single()

    if (error || !profile) {
      document.getElementById('view-loading').innerHTML =
        '<span style="color:var(--danger)">Failed to load profile. Please refresh.</span>'
      return
    }

    currentProfile = profile
    document.getElementById('view-loading').classList.add('hidden')
    document.getElementById('view-main').classList.remove('hidden')
    renderProfile(currentUser, profile)

    sb.auth.onAuthStateChange((event, s) => {
      if (event === 'USER_UPDATED' && s?.user?.email) {
        document.getElementById('email-display').textContent = s.user.email
        currentUser = s.user
      }
      if (event === 'SIGNED_OUT') window.location.href = '/login'
    })
  }

  init()
})()
