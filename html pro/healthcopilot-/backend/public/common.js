/* HealthCopilot - shared code for all pages */
(() => {
  const page = location.pathname.split('/').pop() || 'index.html';
  const isLogin = page === 'login.html';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ymd = (d) => d.toLocaleDateString('en-CA');

  let token = localStorage.getItem('hc_token');
  let user = JSON.parse(localStorage.getItem('hc_user') || 'null');

  // login guard
  if (!token && !isLogin) location.replace('login.html');
  if (token && isLogin) location.replace('index.html');

  const NAV = [
    ['index.html', '🏠', 'Dashboard', 'Home'],
    ['assistant.html', '🤖', 'AI Health Assistant', 'Chat'],
    ['monitor.html', '🫀', 'Health Monitor', 'Monitor'],
    ['medicine.html', '💊', 'Medicine Reminder', 'Meds'],
    ['reports.html', '📄', 'Health Reports', 'Reports'],
    ['doctors.html', '🩺', 'Doctor Connect', 'Doctors'],
    ['settings.html', '⚙️', 'Settings', 'Settings'],
  ];

  function logout() {
    localStorage.removeItem('hc_token'); localStorage.removeItem('hc_user');
    location.replace('login.html');
  }
  function saveAuth(r) {
    localStorage.setItem('hc_token', r.token);
    localStorage.setItem('hc_user', JSON.stringify(r.user));
  }

  /* ---------- API ---------- */
  async function api(path, { method = 'GET', body, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    let payload;
    if (form) payload = form;
    else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let res;
    try { res = await fetch('/api' + path, { method, headers, body: payload }); }
    catch { throw new Error('Server se connect nahi hua. Terminal mein "npm start" chalu hai?'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith('/auth')) { logout(); throw new Error('Dobara login karo'); }
    if (!res.ok) throw new Error(data.error || 'Kuch gadbad hui');
    return data;
  }

  /* ---------- UI: toast + modal ---------- */
  document.body.insertAdjacentHTML('beforeend', '<div id="modal" class="overlay hidden"></div><div id="toast" class="toast hidden"></div>');
  let tt;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(tt); tt = setTimeout(() => t.classList.add('hidden'), 3200);
  }
  function closeModal() { const m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; }

  function fieldHtml(f) {
    const id = 'f_' + f.name;
    const input = f.type === 'select'
      ? `<select name="${f.name}" id="${id}">${f.options.map((o) => `<option value="${esc(o.value ?? o)}">${esc(o.label ?? o)}</option>`).join('')}</select>`
      : `<input name="${f.name}" id="${id}" type="${f.type || 'text'}" ${f.step ? `step="${f.step}"` : ''} ${f.accept ? `accept="${f.accept}"` : ''} placeholder="${esc(f.placeholder || '')}" ${f.required === false ? '' : 'required'}>`;
    return `<label class="fld"><span>${esc(f.label)}</span>${input}</label>`;
  }

  function openForm({ title, fields, submit, onSubmit, footer = '', closable = true }) {
    const m = $('#modal');
    m.innerHTML = `<form class="modal-card" novalidate>
      ${closable ? '<button type="button" class="x" aria-label="Close">×</button>' : ''}
      <h3>${esc(title)}</h3>${fields.map(fieldHtml).join('')}
      <p class="form-err"></p><button class="btn btn-primary wide">${esc(submit)}</button>${footer}</form>`;
    m.classList.remove('hidden');
    const form = m.querySelector('form'); const err = form.querySelector('.form-err');
    if (closable) { form.querySelector('.x').onclick = closeModal; m.onclick = (e) => { if (e.target === m) closeModal(); }; }
    else m.onclick = null;
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) { err.textContent = 'Saari fields bharo'; return; }
      const btn = form.querySelector('button.btn'); btn.disabled = true; err.textContent = '';
      try { await onSubmit(Object.fromEntries(new FormData(form)), form); }
      catch (x) { err.textContent = x.message; }
      finally { btn.disabled = false; }
    };
    const first = form.querySelector('input,select'); if (first) first.focus();
    return form;
  }

  function openInfo(title, text, buttons = []) {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card"><button type="button" class="x" aria-label="Close">×</button>
      <h3>${esc(title)}</h3><div class="info-text">${esc(text)}</div>
      <div class="row-btns">${buttons.map((b, i) => `<button class="btn ${b.ghost ? 'ghost' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    m.classList.remove('hidden');
    m.onclick = (e) => { if (e.target === m) closeModal(); };
    m.querySelector('.x').onclick = closeModal;
    m.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => buttons[b.dataset.i].onClick(b)));
  }

  /* ---------- shell: sidebar, bottom nav, user box ---------- */
  function mountShell() {
    const sb = $('#sidebar');
    if (sb) sb.innerHTML = `
      <div class="logo"><span class="logo-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg></span><span class="logo-text">HealthCopilot</span></div>
      <nav class="nav">${NAV.map(([h, i, l]) => `<a href="${h}" class="nav-item ${h === page ? 'active' : ''}"><span class="ico">${i}</span>${l}</a>`).join('')}</nav>
      <div class="side-card"><h4>Better Health<br>Brighter Future</h4><p>Your AI copilot for a healthier you.</p><span class="heart">♥</span></div>`;

    if (sb) document.body.insertAdjacentHTML('beforeend',
      `<nav class="bottom-nav">${NAV.slice(0, 6).map(([h, i, , s]) => `<a href="${h}" class="${h === page ? 'on' : ''}">${i}<span>${s}</span></a>`).join('')}</nav>`);

    const ub = $('#userBox');
    if (ub) {
      ub.innerHTML = `<button class="bell" id="bell" aria-label="Notifications">🔔</button>
        <a href="settings.html" class="ulink"><div class="avatar"></div><span class="uname">${esc(user?.name || 'Guest')}</span></a>`;
      $('#bell').onclick = () => toast('Koi nayi notification nahi');
    }
  }

  if (location.protocol === 'file:') {
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="banner">⚠️ Page file se khola hai. Server chalao (npm start) aur browser mein http://localhost:3000 kholo.</div>');
  }
  mountShell();

  /* ---------- formatters ---------- */
  const fmt = {
    sleep: (v) => { const h = Math.floor(v); return `${h}h ${String(Math.round((v - h) * 60)).padStart(2, '0')}m`; },
    num: (v) => Number(v).toLocaleString('en-IN'),
    time12: (t) => { const [h, m] = t.split(':').map(Number); return `${String(((h + 11) % 12) + 1).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; },
    date: (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    clock: (d) => new Date(d || Date.now()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
  };

  window.HC = {
    $, esc, ymd, api, toast, openForm, openInfo, closeModal, fmt, logout, saveAuth,
    get user() { return user; },
    get token() { return token; },
    run(fn) { if (token && !isLogin) Promise.resolve().then(fn).catch((e) => toast(e.message)); },
  };
})();
