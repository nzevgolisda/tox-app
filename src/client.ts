const API_BASE = window.location.origin;

const el = (id: string) => document.getElementById(id);
const url = (path: string) => `${API_BASE}${path}`;
const token = () => localStorage.getItem('tox_token');
const username = () => localStorage.getItem('tox_user');
const loggedIn = () => !!token();
const jsonHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token()) h['Authorization'] = `Bearer ${token()}`;
  return h;
};
const authHeader = (): Record<string, string> =>
  token() ? { Authorization: `Bearer ${token()}` } : {};
const esc = (t: string) =>
  (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
const timeAgo = (ts: number) => {
  const d = Date.now() - ts, m = Math.floor(d / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  return dy > 0 ? `${dy}μ` : h > 0 ? `${h}ω` : m > 0 ? `${m}λ` : 'τώρα';
};

let currentTab = 'feed';
let currentSession: string | null = null;
let feedOffset = 0;
let authMode: 'login' | 'register' = 'login';

window.addEventListener('DOMContentLoaded', () => {
  updateTheme(localStorage.getItem('theme') || 'dark');
  if (loggedIn()) {
    applyLoggedIn(username()!);
    loadSessions();
  } else {
    applyGuest();
  }
  switchTab('feed');
  wireListeners();
});

function wireListeners() {
  el('open-auth-btn')?.addEventListener('click', openAuth);
  el('close-auth-btn')?.addEventListener('click', closeAuth);
  el('skip-auth-link')?.addEventListener('click', closeAuth);
  el('auth-overlay')?.addEventListener('click', (e) => {
    if (e.target === el('auth-overlay')) closeAuth();
  });
  el('auth-submit-btn')?.addEventListener('click', submitAuth);
  el('toggle-auth-link')?.addEventListener('click', toggleAuthMode);
  el('logout-btn')?.addEventListener('click', logout);
  el('theme-toggle-btn')?.addEventListener('click', toggleTheme);
  el('new-chat-btn')?.addEventListener('click', () => {
    if (!loggedIn()) return openAuth();
    currentSession = null;
    switchTab('chat');
  });
  el('fab-btn')?.addEventListener('click', () => {
    if (!loggedIn()) return openAuth();
    switchTab('chat');
    currentSession = null;
    el('chat-logs')?.classList.add('hidden');
    el('greeting')?.classList.remove('hidden');
  });

  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) =>
    b.addEventListener('click', () => switchTab((b as HTMLElement).dataset.tab!))
  );
  document.querySelectorAll('.btm-tab[data-tab]').forEach((b) =>
    b.addEventListener('click', () => switchTab((b as HTMLElement).dataset.tab!))
  );
  document.querySelectorAll('.chip[data-cat]').forEach((c) =>
    c.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
    })
  );

  el('send-action-btn')?.addEventListener('click', sendChat);
  el('user-input')?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  el('publish-post-btn')?.addEventListener('click', publishPost);
}

// ── Auth ──
function openAuth() { el('auth-overlay')?.classList.remove('hidden'); }
function closeAuth() { el('auth-overlay')?.classList.add('hidden'); }
function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  el('auth-title')!.textContent = authMode === 'login' ? 'Σύνδεση' : 'Εγγραφή';
  el('auth-submit-btn')!.textContent = authMode === 'login' ? 'Είσοδος' : 'Εγγραφή';
}
async function submitAuth() {
  const uname = (el('auth-username') as HTMLInputElement).value.trim();
  const pass = (el('auth-password') as HTMLInputElement).value;
  if (!uname || !pass) return showAuthError('Συμπληρώστε όλα τα πεδία');
  const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
  try {
    const res = await fetch(url(endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uname, password: pass }),
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error || 'Σφάλμα');
    localStorage.setItem('tox_token', data.token);
    localStorage.setItem('tox_user', data.username);
    closeAuth();
    applyLoggedIn(data.username);
    loadSessions();
  } catch { showAuthError('Σφάλμα δικτύου'); }
}
function showAuthError(msg: string) {
  const e = el('auth-error');
  if (e) { e.textContent = msg; e.classList.remove('hidden'); }
}
function applyLoggedIn(name: string) {
  el('sidebar-username')!.textContent = name;
  el('logout-btn')?.classList.remove('hidden');
  el('open-auth-btn')?.classList.add('hidden');
  const hint = document.querySelector('.login-hint');
  if (hint) (hint as HTMLElement).style.display = 'none';
}
function applyGuest() {
  el('sidebar-username')!.textContent = 'Επισκέπτης';
  el('logout-btn')?.classList.add('hidden');
  el('open-auth-btn')?.classList.remove('hidden');
  const hint = document.querySelector('.login-hint');
  if (hint) (hint as HTMLElement).style.display = '';
}
function logout() {
  localStorage.removeItem('tox_token');
  localStorage.removeItem('tox_user');
  applyGuest();
  switchTab('feed');
}

// ── Theme ──
function updateTheme(t: string) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  const label = el('theme-label');
  if (label) label.textContent = t === 'light' ? 'Σκοτεινό Θέμα' : 'Φωτεινό Θέμα';
  const icon = document.querySelector('.theme-icon');
  if (icon) icon.textContent = t === 'light' ? '🌙' : '☀️';
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  updateTheme(cur === 'light' ? 'dark' : 'light');
}

// ── Tabs ──
function switchTab(tab: string) {
  currentTab = tab;
  document.body.dataset.tab = tab;
  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) =>
    b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab)
  );
  document.querySelectorAll('.btm-tab[data-tab]').forEach((b) =>
    b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab)
  );
  el('feed-view')?.classList.toggle('hidden', tab !== 'feed');
  el('chat-view')?.classList.toggle('hidden', tab !== 'chat');
  el('messages-view')?.classList.toggle('hidden', tab !== 'messages');
  el('threads-view')?.classList.toggle('hidden', tab !== 'threads');
  if (tab === 'feed') loadFeed();
  if (tab === 'chat') loadChat();
}

// ── Feed ──
async function loadFeed() {
  try {
    const res = await fetch(url(`/api/posts?limit=20&offset=${feedOffset}`), { headers: authHeader() });
    const data = await res.json();
    const container = el('posts-container');
    if (!container) return;
    if (!data.posts?.length) {
      container.innerHTML = '<p class="empty-note">Δεν υπάρχουν posts ακόμα.</p>';
      return;
    }
    container.innerHTML = data.posts.map((p: any) => `
      <div class="post-card">
        <div class="post-header">
          <div class="post-avatar">${(p.userId[0] || '?').toUpperCase()}</div>
          <span class="post-author">${esc(p.userId)}</span>
          <span class="post-time">${timeAgo(p.createdAt)}</span>
        </div>
        <div class="post-content">${esc(p.content)}</div>
        ${p.gif ? `<img src="${p.gif}" class="post-gif" />` : ''}
      </div>
    `).join('');
  } catch (e) { console.error('feed', e); }
}

async function publishPost() {
  const content = (el('post-content-input') as HTMLTextAreaElement)?.value.trim();
  if (!content) return;
  if (!loggedIn()) return openAuth();
  try {
    await fetch(url('/api/posts'), {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ content }),
    });
    (el('post-content-input') as HTMLTextAreaElement).value = '';
    loadFeed();
  } catch (e) { console.error(e); }
}

// ── Chat ──
async function loadChat() {
  if (!currentSession) {
    el('greeting')?.classList.remove('hidden');
    el('chat-logs')?.classList.add('hidden');
  }
}
async function sendChat() {
  const input = el('user-input') as HTMLTextAreaElement;
  const msg = input?.value.trim();
  if (!msg) return;
  if (!loggedIn()) return openAuth();
  input.value = '';
  appendMsg('user', msg);
  try {
    const res = await fetch(url('/api/chat'), {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ message: msg, sessionId: currentSession }),
    });
    const data = await res.json();
    if (data.sessionId) currentSession = data.sessionId;
    appendMsg('assistant', data.reply);
  } catch { appendMsg('assistant', 'Σφάλμα.'); }
}
function appendMsg(role: string, content: string) {
  const logs = el('chat-logs');
  if (!logs) return;
  logs.classList.remove('hidden');
  el('greeting')?.classList.add('hidden');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<div class="msg-bubble">${esc(content)}</div>`;
  logs.appendChild(div);
  logs.scrollTop = logs.scrollHeight;
}

// ── Sessions ──
async function loadSessions() {
  try {
    await fetch(url('/api/sessions'), { headers: jsonHeaders() });
  } catch (e) { console.error(e); }
}