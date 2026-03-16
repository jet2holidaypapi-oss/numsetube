const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directories exist
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const THUMBS_DIR = path.join(DATA_DIR, 'thumbnails');
const DB_PATH = path.join(DATA_DIR, 'viewtube.db');
[DATA_DIR, UPLOADS_DIR, THUMBS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ===== DATABASE SETUP =====
let db;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT NULL,
      bio TEXT DEFAULT '',
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      filename TEXT NOT NULL,
      thumbnail TEXT DEFAULT NULL,
      views INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS likes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, video_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      text TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      subscriber_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(subscriber_id, channel_id)
    );
  `);
  saveDb();
  console.log('Database initialized');
}

// sql.js helper functions
function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function dbAll(sql, params = []) {
  const results = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/thumbnails', express.static(THUMBS_DIR));
app.use(session({
  secret: process.env.SESSION_SECRET || 'viewtube-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Multer storage
const makeStorage = (dest) => multer.diskStorage({
  destination: dest,
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});

const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
};

// ===== AUTH =====
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  try {
    const existing = dbGet('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
    if (existing) return res.status(400).json({ error: 'Username or email already exists' });
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    dbRun('INSERT INTO users (id, username, email, password, created_at) VALUES (?, ?, ?, ?, ?)', [id, username, email, hash, now]);
    req.session.userId = id;
    req.session.username = username;
    res.json({ success: true, user: { id, username } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = dbGet('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, user: { id: user.id, username: user.username } });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = dbGet('SELECT id, username, email, avatar, bio FROM users WHERE id = ?', [req.session.userId]);
  res.json({ user });
});

// ===== VIDEOS =====
app.post('/api/videos/upload-with-thumb', requireAuth, (req, res) => {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, file.fieldname === 'video' ? UPLOADS_DIR : THUMBS_DIR),
      filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
    }),
    limits: { fileSize: 500 * 1024 * 1024 }
  }).fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);

  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files?.video) return res.status(400).json({ error: 'No video file' });
    const id = uuidv4();
    const { title, description } = req.body;
    const videoFile = req.files.video[0].filename;
    const thumbFile = req.files?.thumbnail ? req.files.thumbnail[0].filename : null;
    const now = Math.floor(Date.now() / 1000);
    dbRun('INSERT INTO videos (id, user_id, title, description, filename, thumbnail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.session.userId, title || 'Untitled', description || '', videoFile, thumbFile, now]);
    res.json({ success: true, videoId: id });
  });
});

app.get('/api/videos', (req, res) => {
  const { search, userId, limit = 20, offset = 0 } = req.query;
  let sql = 'SELECT v.*, u.username, u.avatar FROM videos v JOIN users u ON v.user_id = u.id';
  const params = [];
  if (search) { sql += ' WHERE (v.title LIKE ? OR v.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (userId) { sql += (params.length ? ' AND' : ' WHERE') + ' v.user_id = ?'; params.push(userId); }
  sql += ' ORDER BY v.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const videos = dbAll(sql, params);
  res.json({ videos });
});

app.get('/api/videos/:id', (req, res) => {
  const video = dbGet('SELECT v.*, u.username, u.avatar, u.bio FROM videos v JOIN users u ON v.user_id = u.id WHERE v.id = ?', [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  dbRun('UPDATE videos SET views = views + 1 WHERE id = ?', [req.params.id]);
  const likes = dbAll('SELECT type, COUNT(*) as count FROM likes WHERE video_id = ? GROUP BY type', [req.params.id]);
  const userLike = req.session.userId ? dbGet('SELECT type FROM likes WHERE user_id = ? AND video_id = ?', [req.session.userId, req.params.id]) : null;
  const subRow = dbGet('SELECT COUNT(*) as count FROM subscriptions WHERE channel_id = ?', [video.user_id]);
  const isSubbed = req.session.userId ? !!dbGet('SELECT id FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?', [req.session.userId, video.user_id]) : false;
  res.json({ video, likes, userLike, subCount: subRow ? subRow.count : 0, isSubbed });
});

// ===== LIKES =====
app.post('/api/videos/:id/like', requireAuth, (req, res) => {
  const { type } = req.body;
  const existing = dbGet('SELECT * FROM likes WHERE user_id = ? AND video_id = ?', [req.session.userId, req.params.id]);
  if (existing) {
    if (existing.type === type) {
      dbRun('DELETE FROM likes WHERE user_id = ? AND video_id = ?', [req.session.userId, req.params.id]);
    } else {
      dbRun('UPDATE likes SET type = ? WHERE user_id = ? AND video_id = ?', [type, req.session.userId, req.params.id]);
    }
  } else {
    dbRun('INSERT INTO likes (id, user_id, video_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), req.session.userId, req.params.id, type, Math.floor(Date.now() / 1000)]);
  }
  const likes = dbAll('SELECT type, COUNT(*) as count FROM likes WHERE video_id = ? GROUP BY type', [req.params.id]);
  const userLike = dbGet('SELECT type FROM likes WHERE user_id = ? AND video_id = ?', [req.session.userId, req.params.id]);
  res.json({ likes, userLike });
});

// ===== COMMENTS =====
app.get('/api/videos/:id/comments', (req, res) => {
  const comments = dbAll('SELECT c.*, u.username, u.avatar FROM comments c JOIN users u ON c.user_id = u.id WHERE c.video_id = ? ORDER BY c.created_at DESC', [req.params.id]);
  res.json({ comments });
});

app.post('/api/videos/:id/comments', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
  const id = uuidv4();
  const now = Math.floor(Date.now() / 1000);
  dbRun('INSERT INTO comments (id, user_id, video_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, req.session.userId, req.params.id, text.trim(), now]);
  const comment = dbGet('SELECT c.*, u.username, u.avatar FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?', [id]);
  res.json({ comment });
});

app.delete('/api/comments/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM comments WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
  res.json({ success: true });
});

// ===== MESSAGES =====
app.get('/api/messages/conversations', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const partners = dbAll(`
    SELECT DISTINCT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_id
    FROM messages WHERE sender_id = ? OR receiver_id = ?
  `, [uid, uid, uid]);

  const conversations = partners.map(p => {
    const user = dbGet('SELECT id, username, avatar FROM users WHERE id = ?', [p.other_id]);
    const last = dbGet(`SELECT text, created_at FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY created_at DESC LIMIT 1`,
      [uid, p.other_id, p.other_id, uid]);
    const unreadRow = dbGet('SELECT COUNT(*) as count FROM messages WHERE sender_id = ? AND receiver_id = ? AND read = 0', [p.other_id, uid]);
    return {
      other_id: p.other_id,
      other_username: user?.username || 'Unknown',
      other_avatar: user?.avatar,
      last_message: last?.text || '',
      last_at: last?.created_at || 0,
      unread: unreadRow?.count || 0
    };
  }).sort((a, b) => b.last_at - a.last_at);

  res.json({ conversations });
});

app.get('/api/messages/:userId', requireAuth, (req, res) => {
  const msgs = dbAll(`SELECT m.*, u.username as sender_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?) ORDER BY m.created_at ASC`,
    [req.session.userId, req.params.userId, req.params.userId, req.session.userId]);
  dbRun('UPDATE messages SET read = 1 WHERE sender_id = ? AND receiver_id = ?', [req.params.userId, req.session.userId]);
  res.json({ messages: msgs });
});

app.post('/api/messages/:userId', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Message empty' });
  const receiver = dbGet('SELECT id FROM users WHERE id = ?', [req.params.userId]);
  if (!receiver) return res.status(404).json({ error: 'User not found' });
  const id = uuidv4();
  const now = Math.floor(Date.now() / 1000);
  dbRun('INSERT INTO messages (id, sender_id, receiver_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, req.session.userId, req.params.userId, text.trim(), now]);
  res.json({ success: true, messageId: id });
});

// ===== SUBSCRIPTIONS =====
app.post('/api/channels/:id/subscribe', requireAuth, (req, res) => {
  const existing = dbGet('SELECT id FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?', [req.session.userId, req.params.id]);
  if (existing) {
    dbRun('DELETE FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?', [req.session.userId, req.params.id]);
    res.json({ subscribed: false });
  } else {
    dbRun('INSERT INTO subscriptions (id, subscriber_id, channel_id, created_at) VALUES (?, ?, ?, ?)',
      [uuidv4(), req.session.userId, req.params.id, Math.floor(Date.now() / 1000)]);
    res.json({ subscribed: true });
  }
});

// ===== USER PROFILE =====
app.get('/api/users/:id', (req, res) => {
  const user = dbGet('SELECT id, username, avatar, bio, created_at FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const videos = dbAll('SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC', [req.params.id]);
  const subRow = dbGet('SELECT COUNT(*) as count FROM subscriptions WHERE channel_id = ?', [req.params.id]);
  res.json({ user, videos, subCount: subRow?.count || 0 });
});

// Serve SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server after DB init
initDb().then(() => {
  app.listen(PORT, () => console.log(`ViewTube running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
