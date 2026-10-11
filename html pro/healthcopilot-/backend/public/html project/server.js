require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const claude = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

fs.mkdirSync('uploads', { recursive: true });
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // frontend (index.html + style.css) yahan rakho

/* ---------- helpers ---------- */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Pehle login karo' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token galat ya expire ho gaya' });
  }
}

const sign = (u) => jwt.sign({ id: u.id, name: u.name }, JWT_SECRET, { expiresIn: '7d' });

/* ---------- AUTH ---------- */
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ error: 'Name, email aur 6+ character ka password chahiye' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'Ye email pehle se registered hai' });
  const hash = await bcrypt.hash(password, 10);
  const r = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(name, email, hash);
  const user = { id: r.lastInsertRowid, name };
  res.status(201).json({ token: sign(user), user });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email || '');
  if (!u || !(await bcrypt.compare(password || '', u.password_hash)))
    return res.status(401).json({ error: 'Email ya password galat hai' });
  res.json({ token: sign(u), user: { id: u.id, name: u.name } });
}));

app.get('/api/me', auth, (req, res) => {
  res.json(db.prepare('SELECT id,name,email FROM users WHERE id = ?').get(req.user.id));
});

/* ---------- HEALTH LOGS ---------- */
app.post('/api/health-logs', auth, (req, res) => {
  const { type, value } = req.body;
  if (!['heart_rate', 'steps', 'sleep', 'calories'].includes(type) || typeof value !== 'number' || value < 0)
    return res.status(400).json({ error: 'type (heart_rate/steps/sleep/calories) aur number value chahiye' });
  db.prepare('INSERT INTO health_logs (user_id,type,value) VALUES (?,?,?)').run(req.user.id, type, value);
  res.status(201).json({ ok: true });
});

app.get('/api/health-logs', auth, (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 90);
  const rows = db.prepare(`
    SELECT type, value, logged_at FROM health_logs
    WHERE user_id = ? AND (? IS NULL OR type = ?) AND logged_at >= datetime('now', ?)
    ORDER BY logged_at`)
    .all(req.user.id, req.query.type || null, req.query.type || null, `-${days} days`);
  res.json(rows);
});

/* ---------- DASHBOARD ---------- */
function todayStats(userId) {
  const out = {};
  const q = db.prepare(`SELECT value FROM health_logs WHERE user_id=? AND type=?
                        AND date(logged_at)=date('now') ORDER BY logged_at DESC LIMIT 1`);
  for (const t of ['heart_rate', 'steps', 'sleep', 'calories']) out[t] = q.get(userId, t)?.value ?? null;
  return out;
}

function healthScore(s) {
  const steps = Math.min((s.steps ?? 0) / 8000, 1) * 30;              // max 30
  const sleep = Math.min((s.sleep ?? 0) / 7.5, 1) * 40;               // max 40 (hours)
  const hr = s.heart_rate == null ? 15 : (s.heart_rate >= 60 && s.heart_rate <= 100 ? 30 : 15); // max 30
  return Math.round(steps + sleep + hr);
}

app.get('/api/dashboard', auth, (req, res) => {
  const stats = todayStats(req.user.id);
  const score = healthScore(stats);
  const insights = [];
  if (stats.sleep != null && stats.sleep < 7)
    insights.push({ title: 'Try to sleep 7–9 hours daily', text: 'Your sleep duration is slightly low for optimal recovery and focus.' });
  if ((stats.steps ?? 0) < 6000)
    insights.push({ title: 'Move a little more today', text: 'A short walk can help you reach your daily step goal.' });
  res.json({
    user: req.user.name,
    score,
    label: score >= 80 ? 'Good' : score >= 60 ? 'Okay' : 'Needs attention',
    stats,
    insights,
  });
});

/* ---------- AI CHAT ---------- */
const SYSTEM = `You are HealthCopilot, a friendly health assistant. Give general wellness guidance in simple language.
You are NOT a doctor: never diagnose or prescribe. For serious or lasting symptoms (chest pain, breathing trouble,
severe headache, symptoms over 2 days), clearly advise seeing a doctor. Reply in the user's language. Keep answers short.`;

app.get('/api/chat', auth, (req, res) => {
  res.json(db.prepare('SELECT role,content,created_at FROM chat_messages WHERE user_id=? ORDER BY id DESC LIMIT 50')
    .all(req.user.id).reverse());
});

app.post('/api/chat', auth, wrap(async (req, res) => {
  const message = (req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message khaali hai' });
  if (!claude) return res.status(500).json({ error: 'ANTHROPIC_API_KEY .env mein set karo' });

  const history = db.prepare('SELECT role,content FROM chat_messages WHERE user_id=? ORDER BY id DESC LIMIT 10')
    .all(req.user.id).reverse();
  const stats = todayStats(req.user.id);

  const r = await claude.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: `${SYSTEM}\nUser's health data today: ${JSON.stringify(stats)} (sleep in hours).`,
    messages: [...history, { role: 'user', content: message }],
  });
  const reply = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

  const ins = db.prepare('INSERT INTO chat_messages (user_id,role,content) VALUES (?,?,?)');
  ins.run(req.user.id, 'user', message);
  ins.run(req.user.id, 'assistant', reply);
  res.json({ reply });
}));

/* ---------- REPORTS ---------- */
app.post('/api/reports', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File attach karo' });
  const { title, category, source } = req.body;
  const r = db.prepare('INSERT INTO reports (user_id,title,category,source,file_path,mime) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, title || req.file.originalname, category || 'Lab Reports', source || null, req.file.path, req.file.mimetype);
  res.status(201).json({ id: r.lastInsertRowid });
});

app.get('/api/reports', auth, (req, res) => {
  res.json(db.prepare(`SELECT id,title,category,source,created_at,ai_summary FROM reports
    WHERE user_id=? AND (? IS NULL OR category=?) ORDER BY created_at DESC`)
    .all(req.user.id, req.query.category || null, req.query.category || null));
});

app.get('/api/reports/:id/file', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'Report nahi mila' });
  res.type(r.mime).sendFile(path.resolve(r.file_path));
});

app.post('/api/reports/:id/summarize', auth, wrap(async (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'Report nahi mila' });
  if (!claude) return res.status(500).json({ error: 'ANTHROPIC_API_KEY .env mein set karo' });

  const data = fs.readFileSync(r.file_path).toString('base64');
  let block;
  if (r.mime === 'application/pdf')
    block = { type: 'document', source: { type: 'base64', media_type: r.mime, data } };
  else if (/^image\/(jpeg|png|gif|webp)$/.test(r.mime))
    block = { type: 'image', source: { type: 'base64', media_type: r.mime, data } };
  else return res.status(400).json({ error: 'Sirf PDF ya image report summarize ho sakti hai' });

  const out = await claude.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [block, { type: 'text', text: 'Summarize this medical report in simple words: key values, anything out of range, and what to ask a doctor.' }],
    }],
  });
  const summary = out.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  db.prepare('UPDATE reports SET ai_summary=? WHERE id=?').run(summary, r.id);
  res.json({ summary });
}));

/* ---------- MEDICINES ---------- */
app.get('/api/medicines', auth, (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json(db.prepare(`
    SELECT m.id, m.name, m.dose, m.timing, m.time, COALESCE(l.taken,0) AS taken
    FROM medicines m LEFT JOIN medicine_logs l ON l.medicine_id=m.id AND l.date=?
    WHERE m.user_id=? ORDER BY m.time`).all(date, req.user.id));
});

app.post('/api/medicines', auth, (req, res) => {
  const { name, dose, timing, time } = req.body;
  if (!name || !/^\d{2}:\d{2}$/.test(time || ''))
    return res.status(400).json({ error: 'name aur time (HH:MM) chahiye' });
  const r = db.prepare('INSERT INTO medicines (user_id,name,dose,timing,time) VALUES (?,?,?,?,?)')
    .run(req.user.id, name, dose || null, timing || null, time);
  res.status(201).json({ id: r.lastInsertRowid });
});

app.patch('/api/medicines/:id/taken', auth, (req, res) => {
  const m = db.prepare('SELECT id FROM medicines WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!m) return res.status(404).json({ error: 'Medicine nahi mili' });
  const date = req.body.date || new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO medicine_logs (medicine_id,date,taken) VALUES (?,?,?)
              ON CONFLICT(medicine_id,date) DO UPDATE SET taken=excluded.taken`)
    .run(m.id, date, req.body.taken === false ? 0 : 1);
  res.json({ ok: true });
});

app.delete('/api/medicines/:id', auth, (req, res) => {
  db.prepare('DELETE FROM medicines WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* ---------- DOCTORS & APPOINTMENTS ---------- */
app.get('/api/doctors', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM doctors WHERE (? IS NULL OR specialty=?) ORDER BY rating DESC')
    .all(req.query.specialty || null, req.query.specialty || null));
});

app.post('/api/appointments', auth, (req, res) => {
  const { doctor_id, slot } = req.body;
  if (!db.prepare('SELECT id FROM doctors WHERE id=?').get(doctor_id) || !slot)
    return res.status(400).json({ error: 'Valid doctor_id aur slot chahiye' });
  const r = db.prepare('INSERT INTO appointments (user_id,doctor_id,slot) VALUES (?,?,?)').run(req.user.id, doctor_id, slot);
  res.status(201).json({ id: r.lastInsertRowid, status: 'booked' });
});

app.get('/api/appointments', auth, (req, res) => {
  res.json(db.prepare(`SELECT a.id,a.slot,a.status,d.name doctor,d.specialty FROM appointments a
    JOIN doctors d ON d.id=a.doctor_id WHERE a.user_id=? ORDER BY a.slot`).all(req.user.id));
});

/* ---------- errors ---------- */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server mein kuch gadbad hui' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HealthCopilot chal raha hai: http://localhost:${PORT}`));