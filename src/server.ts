import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tox-secret-key-change-in-prod';
const GIPHY_KEY = 'hwhnpVCf0AQTX898mvXm9NPkHH4mqtYX';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

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

// ── Auth middleware ──
function auth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { id: string; username: string };
    (req as any).user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Auth routes ──
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (users.has(username)) return res.status(409).json({ error: 'User exists' });
  const hash = await bcrypt.hash(password, 10);
  const user: User = { id: uid(), username, password: hash, reputation: 0, blocked: [], createdAt: Date.now() };
  users.set(username, user);
  const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

app.get('/api/users/me', auth, (req, res) => {
  const { username } = (req as any).user;
  const user = users.get(username);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ user: { username: user.username, reputation: user.reputation } });
});

app.delete('/api/users/me', auth, (req, res) => {
  const { username } = (req as any).user;
  users.delete(username);
  res.json({ ok: true });
});

app.get('/api/users/:username/profile', auth, (req, res) => {
  const user = users.get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const userPosts = posts.filter(p => p.userId === user.id);
  res.json({ user: { username: user.username, reputation: user.reputation, posts: userPosts } });
});

app.post('/api/reputation/gift/:username', auth, (req, res) => {
  const target = users.get(req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const giver = (req as any).user.username;
  const today = new Date().toISOString().slice(0, 10);
  const key = `${giver}:${target.username}`;
  if (reputationLog.get(key) === today) return res.status(429).json({ error: 'Already gifted today' });
  reputationLog.set(key, today);
  target.reputation += 1;
  res.json({ ok: true, reputation: target.reputation });
});

// ── Friends ──
app.get('/api/friends', auth, (req, res) => {
  const me = (req as any).user.username;
  const friends = friendRequests
    .filter(f => (f.from === me || f.to === me) && f.status === 'accepted')
    .map(f => (f.from === me ? f.to : f.from));
  res.json({ friends });
});

app.post('/api/friends/request', auth, (req, res) => {
  const me = (req as any).user.username;
  const { username: target } = req.body;
  if (!users.has(target)) return res.status(404).json({ error: 'User not found' });
  const existing = friendRequests.find(f => (f.from === me && f.to === target) || (f.from === target && f.to === me));
  if (existing) return res.status(409).json({ error: 'Request already exists' });
  friendRequests.push({ id: uid(), from: me, to: target, status: 'pending' });
  res.json({ ok: true });
});

app.delete('/api/friends/:id', auth, (req, res) => {
  const idx = friendRequests.findIndex(f => f.id === req.params.id);
  if (idx >= 0) friendRequests.splice(idx, 1);
  res.json({ ok: true });
});

app.post('/api/users/:username/block', auth, (req, res) => {
  const me = users.get((req as any).user.username);
  if (me) me.blocked.push(req.params.username);
  res.json({ ok: true });
});

// ── Posts / Feed ──
app.get('/api/posts', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;
  const slice = posts.slice(offset, offset + limit);
  res.json({ posts: slice, total: posts.length });
});

app.post('/api/posts', auth, (req, res) => {
  const { content, media, gif } = req.body;
  const user = users.get((req as any).user.username);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const post: Post = { id: uid(), userId: user.id, content, media, gif, createdAt: Date.now() };
  posts.unshift(post);
  res.json({ post });
});

// ── Sessions ──
app.get('/api/sessions', auth, (req, res) => {
  const me = (req as any).user.username;
  const userSessions = Array.from(sessions.values()).filter(s => {
    const owner = users.get(me);
    return owner && s.userId === owner.id;
  });
  res.json({ sessions: userSessions.map(s => ({ id: s.id, title: s.title, createdAt: s.createdAt })) });
});

app.delete('/api/sessions/:id', auth, (req, res) => {
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

app.get('/api/history/:sessionId', auth, (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json({ history: session.messages });
});

// ── Chat ──
app.post('/api/chat', auth, (req, res) => {
  const { message, sessionId } = req.body;
  const me = (req as any).user.username;
  const user = users.get(me);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  let session = sessionId ? sessions.get(sessionId) : null;
  if (!session) {
    session = { id: uid(), userId: user.id, title: message.slice(0, 30), messages: [], createdAt: Date.now() };
    sessions.set(session.id, session);
  }
  session.messages.push({ role: 'user', content: message, ts: Date.now() });
  const reply = `Η Ήρα λέει: ${message}`;
  session.messages.push({ role: 'assistant', content: reply, ts: Date.now() });
  res.json({ reply, sessionId: session.id });
});

// ── Threads ──
app.get('/api/threads', (req, res) => {
  const { category } = req.query;
  const filtered = category ? threads.filter(t => t.category === category) : threads;
  res.json({ threads: filtered });
});

app.post('/api/threads', auth, (req, res) => {
  const { category, title, content } = req.body;
  const user = users.get((req as any).user.username);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const thread: Thread = { id: uid(), userId: user.id, category, title, content, createdAt: Date.now() };
  threads.unshift(thread);
  res.json({ thread });
});

// ── GIPHY proxy ──
app.get('/api/gifs/search', async (req, res) => {
  const q = req.query.q || 'trending';
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q as string)}&limit=20`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    res.json(data);
  } catch {
    res.status(500).json({ error: 'GIPHY error' });
  }
});

app.listen(PORT, () => console.log(`tox.gr backend running on http://localhost:${PORT}`));