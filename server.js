const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directories exist
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const THUMBS_DIR = path.join(DATA_DIR, 'thumbnails');
['data', UPLOADS_DIR, THUMBS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Database setup
const db = new Database(path.join(DATA_DIR, 'viewtube.db'));
db.pragma('journal_mode = WAL');
db.exec(`
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
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
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
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(video_id) REFERENCES videos(id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    text TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY(sender_id) REFERENCES users(id),
    FOREIGN KEY(receiver_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    subscriber_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(subscriber_id, channel_id)
  );
`);

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

// Multer for video uploads
const videoStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const thumbStorage = multer.diskStorage({
  destination: THUMBS_DIR,
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const uploadVideo = multer({ storage: videoStorage, limits: { fileSize: 500 * 1024 * 1024 } });
const uploadThumb = multer({ storage: thumbStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
};

// ===== AUTH ROUTES =====
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    db.prepare('INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)').run(id, username, email, hash);
    req.session.userId = id;
    req.session.username = username;
    res.json({ success: true, user: { id, username } });
  } catch (e) {
    res.status(400).json({ error: 'Username or email already exists' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
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
  const user = db.prepare('SELECT id, username, email, avatar, bio FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user });
});

// ===== VIDEO ROUTES =====
app.post('/api/videos/upload', requireAuth, uploadVideo.single('video'), uploadThumb.single('thumbnail'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file' });
    const id = uuidv4();
    const { title, description } = req.body;
    db.prepare('INSERT INTO videos (id, user_id, title, description, filename) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.session.userId, title || 'Untitled', description || '', req.file.filename);
    res.json({ success: true, videoId: id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Handle both video and thumbnail in one upload
app.post('/api/videos/upload-with-thumb', requireAuth, (req, res) => {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, file.fieldname === 'video' ? UPLOADS_DIR : THUMBS_DIR);
      },
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

    db.prepare('INSERT INTO videos (id, user_id, title, description, filename, thumbnail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, req.session.userId, title || 'Untitled', description || '', videoFile, thumbFile);
    res.json({ success: true, videoId: id });
  });
});

app.get('/api/videos', (req, res) => {
  const { search, userId, limit = 20, offset = 0 } = req.query;
  let query = `SELECT v.*, u.username, u.avatar FROM videos v JOIN users u ON v.user_id = u.id`;
  const params = [];
  if (search) { query += ` WHERE v.title LIKE ? OR v.description LIKE ?`; params.push(`%${search}%`, `%${search}%`); }
  if (userId) { query += (params.length ? ' AND' : ' WHERE') + ` v.user_id = ?`; params.push(userId); }
  query += ` ORDER BY v.created_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));
  const videos = db.prepare(query).all(...params);
  res.json({ videos });
});

app.get('/api/videos/:id', (req, res) => {
  const video = db.prepare(`SELECT v.*, u.username, u.avatar, u.bio FROM videos v JOIN users u ON v.user_id = u.id WHERE v.id = ?`).get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  db.prepare('UPDATE videos SET views = views + 1 WHERE id = ?').run(req.params.id);
  const likes = db.prepare('SELECT type, COUNT(*) as count FROM likes WHERE video_id = ? GROUP BY type').all(req.params.id);
  const userLike = req.session.userId ? db.prepare('SELECT type FROM likes WHERE user_id = ? AND video_id = ?').get(req.session.userId, req.params.id) : null;
  const subCount = db.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE channel_id = ?').get(video.user_id);
  const isSubbed = req.session.userId ? db.prepare('SELECT id FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?').get(req.session.userId, video.user_id) : null;
  res.json({ video, likes, userLike, subCount: subCount.count, isSubbed: !!isSubbed });
});

// ===== LIKE/DISLIKE =====
app.post('/api/videos/:id/like', requireAuth, (req, res) => {
  const { type } = req.body; // 'like' or 'dislike'
  const existing = db.prepare('SELECT * FROM likes WHERE user_id = ? AND video_id = ?').get(req.session.userId, req.params.id);
  if (existing) {
    if (existing.type === type) {
      db.prepare('DELETE FROM likes WHERE user_id = ? AND video_id = ?').run(req.session.userId, req.params.id);
    } else {
      db.prepare('UPDATE likes SET type = ? WHERE user_id = ? AND video_id = ?').run(type, req.session.userId, req.params.id);
    }
  } else {
    db.prepare('INSERT INTO likes (id, user_id, video_id, type) VALUES (?, ?, ?, ?)').run(uuidv4(), req.session.userId, req.params.id, type);
  }
  const likes = db.prepare('SELECT type, COUNT(*) as count FROM likes WHERE video_id = ? GROUP BY type').all(req.params.id);
  const userLike = db.prepare('SELECT type FROM likes WHERE user_id = ? AND video_id = ?').get(req.session.userId, req.params.id);
  res.json({ likes, userLike });
});

// ===== COMMENTS =====
app.get('/api/videos/:id/comments', (req, res) => {
  const comments = db.prepare(`SELECT c.*, u.username, u.avatar FROM comments c JOIN users u ON c.user_id = u.id WHERE c.video_id = ? ORDER BY c.created_at DESC`).all(req.params.id);
  res.json({ comments });
});

app.post('/api/videos/:id/comments', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
  const id = uuidv4();
  db.prepare('INSERT INTO comments (id, user_id, video_id, text) VALUES (?, ?, ?, ?)').run(id, req.session.userId, req.params.id, text.trim());
  const comment = db.prepare(`SELECT c.*, u.username, u.avatar FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?`).get(id);
  res.json({ comment });
});

app.delete('/api/comments/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

// ===== MESSAGES =====
app.get('/api/messages/conversations', requireAuth, (req, res) => {
  const convos = db.prepare(`
    SELECT DISTINCT 
      CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END as other_id,
      u.username as other_username, u.avatar as other_avatar,
      (SELECT text FROM messages WHERE (sender_id = ? AND receiver_id = other_id) OR (sender_id = other_id AND receiver_id = ?) ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM messages WHERE (sender_id = ? AND receiver_id = other_id) OR (sender_id = other_id AND receiver_id = ?) ORDER BY created_at DESC LIMIT 1) as last_at,
      (SELECT COUNT(*) FROM messages WHERE sender_id = other_id AND receiver_id = ? AND read = 0) as unread
    FROM messages m
    JOIN users u ON u.id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
    WHERE m.sender_id = ? OR m.receiver_id = ?
    ORDER BY last_at DESC
  `).all(...Array(9).fill(req.session.userId));
  res.json({ conversations: convos });
});

app.get('/api/messages/:userId', requireAuth, (req, res) => {
  const msgs = db.prepare(`SELECT m.*, u.username as sender_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?) ORDER BY m.created_at ASC`).all(req.session.userId, req.params.userId, req.params.userId, req.session.userId);
  db.prepare('UPDATE messages SET read = 1 WHERE sender_id = ? AND receiver_id = ?').run(req.params.userId, req.session.userId);
  res.json({ messages: msgs });
});

app.post('/api/messages/:userId', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Message empty' });
  const receiver = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.userId);
  if (!receiver) return res.status(404).json({ error: 'User not found' });
  const id = uuidv4();
  db.prepare('INSERT INTO messages (id, sender_id, receiver_id, text) VALUES (?, ?, ?, ?)').run(id, req.session.userId, req.params.userId, text.trim());
  res.json({ success: true, messageId: id });
});

// ===== SUBSCRIPTIONS =====
app.post('/api/channels/:id/subscribe', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT id FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?').get(req.session.userId, req.params.id);
  if (existing) {
    db.prepare('DELETE FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?').run(req.session.userId, req.params.id);
    res.json({ subscribed: false });
  } else {
    db.prepare('INSERT INTO subscriptions (id, subscriber_id, channel_id) VALUES (?, ?, ?)').run(uuidv4(), req.session.userId, req.params.id);
    res.json({ subscribed: true });
  }
});

// ===== USER PROFILE =====
app.get('/api/users/:id', (req, res) => {
  const user = db.prepare('SELECT id, username, avatar, bio, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const videos = db.prepare('SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC').all(req.params.id);
  const subCount = db.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE channel_id = ?').get(req.params.id);
  res.json({ user, videos, subCount: subCount.count });
});

// Serve the SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`ViewTube running on port ${PORT}`));
