const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

const el = (id: string) => document.getElementById(id);
const token = () => localStorage.getItem('tox_token');
const username = () => localStorage.getItem('tox_user');
const loggedIn = () => !!token();
const esc = (t: string) =>
  (t || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
const timeAgo = (ts: number) => {
  const d = Date.now() - ts,
    m = Math.floor(d / 60000),
    h = Math.floor(m / 60),
    dy = Math.floor(h / 24);
  return dy > 0 ? `${dy}μ` : h > 0 ? `${h}ω` : m > 0 ? `${m}λ` : 'τώρα';
};

let currentTab = 'feed';
let currentSession: string | null = null;
let feedOffset = 0;
let authMode: 'login' | 'register' = 'login';

/* ═══════════ WebSocket transport ═══════════ */

let socket: WebSocket | null = null;
let reqId = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let readyWaiters: Array<() => void> = [];

function whenReady(): Promise<void> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((res) => readyWaiters.push(res));
}

function connect(): void {
  socket = new WebSocket(WS_URL);

  socket.addEventListener('open', () => {
    const saved = token();
    const auth = saved
      ? rpc<{ username: string }>('auth', { token: saved })
      : Promise.resolve(null);

    auth
      .then((me) => {
        if (me) {
          applyLoggedIn(me.username);
          loadSessions();
        } else {
          applyGuest();
        }
      })
      .catch(() => {
        clearAuth();
        applyGuest();
      })
      .finally(() => {
        if (currentTab === 'feed') loadFeed();
      });

    const waiters = readyWaiters;
    readyWaiters = [];
    waiters.forEach((w) => w());
  });

  socket.addEventListener('message', (ev: MessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }

    if (msg.event) {
      handleEvent(msg.event, msg.data);
      return;
    }

    if (typeof msg.id !== 'number') return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(msg.error || 'Σφάλμα'));
  });

  socket.addEventListener('close', () => {
    socket = null;
    pending.forEach((p) => p.reject(new Error('Η σύνδεση χάθηκε')));
    pending.clear();
    setTimeout(connect, 2000);
  });
}

function rpc<T = any>(type: string, payload: Record<string, any> = {}): Promise<T> {
  return whenReady().then(
    () =>
      new Promise<T>((resolve, reject) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          reject(new Error('Δεν υπάρχει σύνδεση'));
          return;
        }
        const id = ++reqId;
        pending.set(id, { resolve: resolve as (v: any) => void, reject });
        socket.send(JSON.stringify({ id, type, ...payload }));
      })
  );
}

function handleEvent(event: string, _data: any): void {
  if (event === 'post:new' && currentTab === 'feed') loadFeed();
}

/* ═══════════ Bootstrap ═══════════ */

window.addEventListener('DOMContentLoaded', () => {
  updateTheme(localStorage.getItem('theme') || 'dark');
  if (loggedIn()) applyLoggedIn(username() || '');
  else applyGuest();
  wireListeners();
  switchTab('feed');
  connect();
});

function wireListeners(): void {
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
    el('chat-logs')?.classList.add('hidden');
    el('chat-logs')!.innerHTML = '';
    el('greeting')?.classList.remove('hidden');
    document.querySelectorAll('.session-item').forEach((s) => s.classList.remove('active'));
  });
  el('fab-btn')?.addEventListener('click', () => {
    if (!loggedIn()) return openAuth();
    currentSession = null;
    switchTab('chat');
    el('chat-logs')?.classList.add('hidden');
    el('chat-logs')!.innerHTML = '';
    el('greeting')?.classList.remove('hidden');
    document.querySelectorAll('.session-item').forEach((s) => s.classList.remove('active'));
  });

  /* Settings modal */
  el('settings-btn')?.addEventListener('click', () => {
    el('settings-overlay')?.classList.remove('hidden');
  });
  el('close-settings-btn')?.addEventListener('click', closeSettings);
  el('settings-overlay')?.addEventListener('click', (e) => {
    if (e.target === el('settings-overlay')) closeSettings();
  });
  el('settings-theme-btn')?.addEventListener('click', toggleTheme);
  el('settings-logout-btn')?.addEventListener('click', () => {
    closeSettings();
    logout();
  });
  el('settings-delete-btn')?.addEventListener('click', async () => {
    if (!loggedIn()) return;
    if (!confirm('Να διαγραφεί ο λογαριασμός σας; Αυτό δεν αναιρείται.')) return;
    try {
      await rpc('users.delete');
    } catch {
      /* ignore */
    }
    closeSettings();
    clearAuth();
    applyGuest();
    renderSessions([]);
    switchTab('feed');
  });

  document
    .querySelectorAll('.tab-btn[data-tab]')
    .forEach((b) =>
      b.addEventListener('click', () => switchTab((b as HTMLElement).dataset.tab!))
    );
  document
    .querySelectorAll('.btm-tab[data-tab]')
    .forEach((b) =>
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });
  el('publish-post-btn')?.addEventListener('click', publishPost);
}

/* ═══════════ Auth ═══════════ */

function openAuth(): void {
  el('auth-overlay')?.classList.remove('hidden');
}
function closeAuth(): void {
  el('auth-overlay')?.classList.add('hidden');
}
function closeSettings(): void {
  el('settings-overlay')?.classList.add('hidden');
}
function toggleAuthMode(): void {
  authMode = authMode === 'login' ? 'register' : 'login';
  el('auth-title')!.textContent = authMode === 'login' ? 'Σύνδεση' : 'Εγγραφή';
  el('auth-submit-btn')!.textContent = authMode === 'login' ? 'Είσοδος' : 'Εγγραφή';
}

async function submitAuth(): Promise<void> {
  const uname = (el('auth-username') as HTMLInputElement).value.trim();
  const pass = (el('auth-password') as HTMLInputElement).value;
  if (!uname || !pass) return showAuthError('Συμπληρώστε όλα τα πεδία');

  try {
    const data = await rpc<{ token: string; username: string }>(
      authMode === 'login' ? 'auth.login' : 'auth.register',
      { username: uname, password: pass }
    );
    localStorage.setItem('tox_token', data.token);
    localStorage.setItem('tox_user', data.username);
    closeAuth();
    applyLoggedIn(data.username);
    loadFeed();
    loadSessions();
  } catch (e: any) {
    showAuthError(e?.message || 'Σφάλμα');
  }
}

function showAuthError(msg: string): void {
  const e = el('auth-error');
  if (e) {
    e.textContent = msg;
    e.classList.remove('hidden');
  }
}

function clearAuth(): void {
  localStorage.removeItem('tox_token');
  localStorage.removeItem('tox_user');
}

function applyLoggedIn(name: string): void {
  el('sidebar-username')!.textContent = name;
  el('logout-btn')?.classList.remove('hidden');
  el('open-auth-btn')?.classList.add('hidden');
  const hint = document.querySelector('.login-hint');
  if (hint) (hint as HTMLElement).style.display = 'none';
}

function applyGuest(): void {
  el('sidebar-username')!.textContent = 'Επισκέπτης';
  el('logout-btn')?.classList.add('hidden');
  el('open-auth-btn')?.classList.remove('hidden');
  const hint = document.querySelector('.login-hint');
  if (hint) (hint as HTMLElement).style.display = '';
}

async function logout(): Promise<void> {
  try {
    await rpc('auth.logout');
  } catch {
    /* ignore */
  }
  clearAuth();
  applyGuest();
  renderSessions([]);
  switchTab('feed');
}

/* ═══════════ Theme ═══════════ */

function updateTheme(t: string): void {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  const label = el('theme-label');
  if (label) label.textContent = t === 'light' ? 'Σκοτεινό Θέμα' : 'Φωτεινό Θέμα';
  const icon = document.querySelector('.theme-icon');
  if (icon) icon.textContent = t === 'light' ? '🌙' : '☀️';
}
function toggleTheme(): void {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  updateTheme(cur === 'light' ? 'dark' : 'light');
}

/* ═══════════ Tabs ═══════════ */

function switchTab(tab: string): void {
  currentTab = tab;
  document.body.dataset.tab = tab;
  document
    .querySelectorAll('.tab-btn[data-tab]')
    .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab));
  document
    .querySelectorAll('.btm-tab[data-tab]')
    .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab));

  el('feed-view')?.classList.toggle('hidden', tab !== 'feed');
  el('chat-view')?.classList.toggle('hidden', tab !== 'chat');
  el('messages-view')?.classList.toggle('hidden', tab !== 'messages');
  el('threads-view')?.classList.toggle('hidden', tab !== 'threads');

  if (tab === 'feed') loadFeed();
  if (tab === 'chat') loadChat();
}

/* ═══════════ Feed ═══════════ */

async function loadFeed(): Promise<void> {
  try {
    const data = await rpc<{ posts: any[]; total: number }>('posts.list', {
      limit: 20,
      offset: feedOffset,
    });
    const container = el('posts-container');
    if (!container) return;

    if (!data.posts?.length) {
      container.innerHTML = '<p class="empty-note">Δεν υπάρχουν posts ακόμα.</p>';
      return;
    }

    container.innerHTML = data.posts
      .map((p: any) => {
        const name = p.username || p.userId || '?';
        return `
      <div class="post-card">
        <div class="post-header">
          <div class="post-avatar">${(name[0] || '?').toUpperCase()}</div>
          <span class="post-author">${esc(name)}</span>
          <span class="post-time">${timeAgo(p.createdAt)}</span>
        </div>
        <div class="post-content">${esc(p.content)}</div>
        ${p.gif ? `<img src="${p.gif}" class="post-gif" />` : ''}
      </div>
    `;
      })
      .join('');
  } catch (e) {
    console.error('feed', e);
  }
}

async function publishPost(): Promise<void> {
  const input = el('post-content-input') as HTMLTextAreaElement | null;
  const content = input?.value.trim();
  if (!content) return;
  if (!loggedIn()) return openAuth();

  try {
    await rpc('posts.create', { content });
    if (input) input.value = '';
  } catch (e) {
    console.error(e);
  }
}

/* ═══════════ Sessions (sidebar history) ═══════════ */

async function loadSessions(): Promise<void> {
  if (!loggedIn()) {
    renderSessions([]);
    return;
  }
  try {
    const data = await rpc<{ sessions: any[] }>('sessions.list');
    renderSessions(data.sessions || []);
  } catch (e) {
    console.error('sessions', e);
  }
}

function renderSessions(sessions: any[]): void {
  const container = el('sessions-list');
  if (!container) return;

  if (!sessions.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = sessions
    .map(
      (s) => `
      <button class="session-item${s.id === currentSession ? ' active' : ''}" data-id="${s.id}">
        <span class="session-title">${esc(s.title || 'Συνομιλία')}</span>
        <span class="session-time">${timeAgo(s.createdAt)}</span>
      </button>
    `
    )
    .join('');

  container.querySelectorAll('.session-item').forEach((btn) =>
    btn.addEventListener('click', () => openSession((btn as HTMLElement).dataset.id!))
  );
}

async function openSession(id: string): Promise<void> {
  currentSession = id;
  switchTab('chat');
  document
    .querySelectorAll('.session-item')
    .forEach((s) => s.classList.toggle('active', (s as HTMLElement).dataset.id === id));

  const logs = el('chat-logs');
  if (!logs) return;
  logs.innerHTML = '';
  logs.classList.remove('hidden');
  el('greeting')?.classList.add('hidden');

  try {
    const data = await rpc<{ history: any[] }>('history.get', { sessionId: id });
    data.history.forEach((m) => appendMsg(m.role, m.content));
  } catch (e) {
    console.error('history', e);
    appendMsg('assistant', 'Σφάλμα φόρτωσης ιστορικού.');
  }
}

/* ═══════════ Chat ═══════════ */

async function loadChat(): Promise<void> {
  if (!currentSession) {
    el('greeting')?.classList.remove('hidden');
    el('chat-logs')?.classList.add('hidden');
  }
}

async function sendChat(): Promise<void> {
  const input = el('user-input') as HTMLTextAreaElement | null;
  const msg = input?.value.trim();
  if (!msg) return;
  if (!loggedIn()) return openAuth();

  input!.value = '';
  appendMsg('user', msg);

  try {
    const data = await rpc<{ reply: string; sessionId: string }>('chat.send', {
      message: msg,
      sessionId: currentSession,
    });
    if (data.sessionId) currentSession = data.sessionId;
    appendMsg('assistant', data.reply);
    // Refresh sidebar so a brand-new session shows up.
    loadSessions();
    document
      .querySelectorAll('.session-item')
      .forEach((s) =>
        s.classList.toggle('active', (s as HTMLElement).dataset.id === currentSession)
      );
  } catch {
    appendMsg('assistant', 'Σφάλμα.');
  }
}

function appendMsg(role: string, content: string): void {
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