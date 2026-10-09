import express from 'express';
import http from 'http';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tox-secret-key-change-in-prod';
const GIPHY_KEY = 'hwhnpVCf0AQTX898mvXm9NPkHH4mqtYX';

// ── In-memory store ──
interface User {
  id: string;
  username: string;
  password: string;
  reputation: number;
  blocked: string[];
  createdAt: number;
}
interface Post {
  id: string;
  userId: string;
  username: string;      // ← NEW: display name stored alongside the id
  content: string;
  media?: string;
  gif?: string;
  createdAt: number;
}
interface FriendRequest {
  id: string;
  from: string;
  to: string;
  status: 'pending' | 'accepted' | 'rejected';
}
interface Session {
  id: string;
  userId: string;
  title: string;
  messages: { role: string; content: string; ts: number }[];
  createdAt: number;
}
interface Thread {
  id: string;
  userId: string;
  category: string;
  title: string;
  content: string;
  createdAt: number;
}

const users: Map<string, User> = new Map();
const posts: Post[] = [];
const friendRequests: FriendRequest[] = [];
const sessions: Map<string, Session> = new Map();
const threads: Thread[] = [];
const reputationLog: Map<string, string> = new Map();

const uid = () => Math.random().toString(36).slice(2, 10);

// ── HTTP layer (static assets only) ──
const app = express();
app.use(express.static(path.join(__dirname, '../public')));
const server = http.createServer(app);

// ── WebSocket layer ──
const wss = new WebSocketServer({ server, path: '/ws' });

interface ClientState {
  ws: WebSocket;
  username?: string;
  userId?: string;
  alive: boolean;
}
const clients = new Set<ClientState>();

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(event: string, data: unknown): void {
  const frame = JSON.stringify({ event, data });
  for (const c of clients) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(frame);
  }
}

class RpcError extends Error {}

function requireUser(client: ClientState): User {
  if (!client.username) throw new RpcError('Unauthorized');
  const user = users.get(client.username);
  if (!user) throw new RpcError('Unauthorized');
  return user;
}

// ── Request handlers ──
async function handle(type: string, p: any, client: ClientState): Promise<any> {
  switch (type) {
    case 'ping':
      return { pong: Date.now() };

    /* ── Auth ── */
    case 'auth': {
      if (!p.token) throw new RpcError('Missing token');
      let payload: { id: string; username: string };
      try {
        payload = jwt.verify(p.token, JWT_SECRET) as { id: string; username: string };
      } catch {
        throw new RpcError('Invalid token');
      }
      const user = users.get(payload.username);
      if (!user) throw new RpcError('Invalid token');
      client.username = user.username;
      client.userId = user.id;
      return { username: user.username, reputation: user.reputation };
    }

    case 'auth.register': {
      const { username, password } = p;
      if (!username || !password) throw new RpcError('Missing fields');
      if (users.has(username)) throw new RpcError('User exists');
      const hash = await bcrypt.hash(password, 10);
      const user: User = {
        id: uid(),
        username,
        password: hash,
        reputation: 0,
        blocked: [],
        createdAt: Date.now(),
      };
      users.set(username, user);
      client.username = user.username;
      client.userId = user.id;
      const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
      return { token, username };
    }

    case 'auth.login': {
      const { username, password } = p;
      const user = users.get(username);
      if (!user) throw new RpcError('Invalid credentials');
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) throw new RpcError('Invalid credentials');
      client.username = user.username;
      client.userId = user.id;
      const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
      return { token, username };
    }

    case 'auth.logout': {
      client.username = undefined;
      client.userId = undefined;
      return { ok: true };
    }

    /* ── Users ── */
    case 'users.me': {
      const user = requireUser(client);
      return { user: { username: user.username, reputation: user.reputation } };
    }

    case 'users.delete': {
      const user = requireUser(client);
      users.delete(user.username);
      client.username = undefined;
      client.userId = undefined;
      return { ok: true };
    }

    case 'users.profile': {
      requireUser(client);
      const target = users.get(p.username);
      if (!target) throw new RpcError('Not found');
      const userPosts = posts.filter((x) => x.userId === target.id);
      return {
        user: { username: target.username, reputation: target.reputation, posts: userPosts },
      };
    }

    case 'users.block': {
      const me = requireUser(client);
      me.blocked.push(p.username);
      return { ok: true };
    }

    case 'reputation.gift': {
      requireUser(client);
      const target = users.get(p.username);
      if (!target) throw new RpcError('User not found');
      const giver = client.username!;
      const today = new Date().toISOString().slice(0, 10);
      const key = `${giver}:${target.username}`;
      if (reputationLog.get(key) === today) throw new RpcError('Already gifted today');
      reputationLog.set(key, today);
      target.reputation += 1;
      return { ok: true, reputation: target.reputation };
    }

    /* ── Friends ── */
    case 'friends.list': {
      const me = requireUser(client).username;
      const friends = friendRequests
        .filter((f) => (f.from === me || f.to === me) && f.status === 'accepted')
        .map((f) => (f.from === me ? f.to : f.from));
      return { friends };
    }

    case 'friends.request': {
      const me = requireUser(client).username;
      const target = p.username;
      if (!users.has(target)) throw new RpcError('User not found');
      const existing = friendRequests.find(
        (f) => (f.from === me && f.to === target) || (f.from === target && f.to === me)
      );
      if (existing) throw new RpcError('Request already exists');
      friendRequests.push({ id: uid(), from: me, to: target, status: 'pending' });
      return { ok: true };
    }

    case 'friends.remove': {
      requireUser(client);
      const idx = friendRequests.findIndex((f) => f.id === p.id);
      if (idx >= 0) friendRequests.splice(idx, 1);
      return { ok: true };
    }

    /* ── Posts / Feed ── */
    case 'posts.list': {
      const limit = parseInt(p.limit) || 20;
      const offset = parseInt(p.offset) || 0;
      return { posts: posts.slice(offset, offset + limit), total: posts.length };
    }

    case 'posts.create': {
      const user = requireUser(client);
      const { content, media, gif } = p;
      const post: Post = {
        id: uid(),
        userId: user.id,
        username: user.username,           // ← NEW
        content,
        media,
        gif,
        createdAt: Date.now(),
      };
      posts.unshift(post);
      broadcast('post:new', post);
      return { post };
    }

    /* ── Sessions ── */
    case 'sessions.list': {
      const user = requireUser(client);
      const list = Array.from(sessions.values())
        .filter((s) => s.userId === user.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt }));
      return { sessions: list };
    }

    case 'sessions.delete': {
      const user = requireUser(client);
      const s = sessions.get(p.id);
      if (s && s.userId === user.id) sessions.delete(p.id);
      return { ok: true };
    }

    case 'history.get': {
      const user = requireUser(client);
      const session = sessions.get(p.sessionId);
      if (!session || session.userId !== user.id) throw new RpcError('Not found');
      return { history: session.messages };
    }

    /* ── Chat ── */
    case 'chat.send': {
      const user = requireUser(client);
      const { message, sessionId } = p;
      if (!message) throw new RpcError('Empty message');

      let session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session || session.userId !== user.id) {
        session = {
          id: uid(),
          userId: user.id,
          title: String(message).slice(0, 30),
          messages: [],
          createdAt: Date.now(),
        };
        sessions.set(session.id, session);
      }

      session.messages.push({ role: 'user', content: message, ts: Date.now() });
      const reply = `Η Ήρα λέει: ${message}`;
      session.messages.push({ role: 'assistant', content: reply, ts: Date.now() });

      return { reply, sessionId: session.id };
    }

    /* ── Threads ── */
    case 'threads.list': {
      const filtered = p.category ? threads.filter((t) => t.category === p.category) : threads;
      return { threads: filtered };
    }

    case 'threads.create': {
      const user = requireUser(client);
      const { category, title, content } = p;
      const thread: Thread = {
        id: uid(),
        userId: user.id,
        category,
        title,
        content,
        createdAt: Date.now(),
      };
      threads.unshift(thread);
      broadcast('thread:new', thread);
      return { thread };
    }

    /* ── GIPHY proxy ── */
    case 'gifs.search': {
      const q = p.q || 'trending';
      const gurl = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(
        q
      )}&limit=20`;
      const resp = await fetch(gurl);
      return await resp.json();
    }

    default:
      throw new RpcError(`Unknown message type: ${type}`);
  }
}

// ── Connection lifecycle ──
wss.on('connection', (ws: WebSocket) => {
  const client: ClientState = { ws, alive: true };
  clients.add(client);

  ws.on('pong', () => {
    client.alive = true;
  });

  ws.on('message', async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    const { id, type, ...payload } = msg;
    try {
      const data = await handle(type, payload, client);
      if (id !== undefined) send(ws, { id, ok: true, data });
    } catch (err: any) {
      if (id !== undefined) send(ws, { id, ok: false, error: err?.message || 'Error' });
    }
  });

  ws.on('close', () => clients.delete(client));
  ws.on('error', () => clients.delete(client));
});

// Heartbeat: drop sockets that stop responding to pings.
const heartbeat = setInterval(() => {
  for (const c of clients) {
    if (!c.alive) {
      c.ws.terminate();
      clients.delete(c);
      continue;
    }
    c.alive = false;
    try {
      c.ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () =>
  console.log(`tox.gr backend (websocket) running on http://localhost:${PORT}`)
);