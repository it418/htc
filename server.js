const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");

// Load local env from .env (safe on Vercel; ignored if dotenv not installed)
try { require("dotenv").config(); } catch {}

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { createClient } = require("@libsql/client");

// ================= DATABASE CONFIG (Turso/libSQL) =================
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || "";

// IMPORTANT: do NOT hardcode tokens. Configure via environment variables.
// This server should NOT crash at import-time if env is missing; instead we surface a clear health/debug response.
let turso = null;

function hasDbEnv() {
  return !!TURSO_DATABASE_URL && !!TURSO_AUTH_TOKEN;
}

function getTursoClient() {
  if (!hasDbEnv()) return null;
  if (!turso) {
    turso = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });
  }
  return turso;
}

// DB Helpers (lazy client)
async function dbGet(sql, args = []) {
  const c = getTursoClient();
  if (!c) throw new Error("DB not configured: missing TURSO_DATABASE_URL/TURSO_AUTH_TOKEN");
  const r = await c.execute({ sql, args });
  return r.rows && r.rows[0] ? r.rows[0] : null;
}
async function dbAll(sql, args = []) {
  const c = getTursoClient();
  if (!c) throw new Error("DB not configured: missing TURSO_DATABASE_URL/TURSO_AUTH_TOKEN");
  const r = await c.execute({ sql, args });
  return r.rows || [];
}
async function dbRun(sql, args = []) {
  const c = getTursoClient();
  if (!c) throw new Error("DB not configured: missing TURSO_DATABASE_URL/TURSO_AUTH_TOKEN");
  const r = await c.execute({ sql, args });
  return { lastInsertRowid: Number(r.lastInsertRowid || 0), changes: Number(r.rowsAffected || 0) };
}

// DB init guard (cold-start safe on Vercel)
let _dbReady = false;
let _dbReadyPromise = null;

async function ensureDbReady() {
  if (_dbReady) return;
  if (_dbReadyPromise) return _dbReadyPromise;

  _dbReadyPromise = (async () => {
    const c = getTursoClient();
    if (!c) throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
    await initDB(c);
    _dbReady = true;
  })().catch((e) => {
    _dbReadyPromise = null;
    throw e;
  });

  return _dbReadyPromise;
}

// ================= EMAIL & CHAT CONFIG =================
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;
const APP_URL = process.env.APP_URL || "";

const mailer = (SMTP_HOST && SMTP_USER && SMTP_PASS) ? nodemailer.createTransport({
  host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, auth: { user: SMTP_USER, pass: SMTP_PASS }
}) : null;

async function sendMail(to, subject, text) {
  if (!mailer || !to) return;
  try { await mailer.sendMail({ from: MAIL_FROM, to, subject, text }); } catch (e) { console.error("MAIL ERROR:", e); }
}

const CHAT_WEBHOOK_APPROVALS = process.env.CHAT_WEBHOOK_APPROVALS || "";
const CHAT_WEBHOOK_IT = process.env.CHAT_WEBHOOK_IT || "";

async function sendChat(webhookUrl, text) {
  if (!webhookUrl) return;
  try { await axios.post(webhookUrl, { text }, { headers: { "Content-Type": "application/json; charset=UTF-8" } }); } catch (e) { console.error("CHAT ERROR:", e); }
}

const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA ? `vercel-${String(process.env.VERCEL_GIT_COMMIT_SHA).slice(0, 7)}` : `local-${new Date().toISOString().slice(0, 19).replace('T', '_')}`;
const BUILD_TIME = new Date().toISOString();

// ================= VERCEL SETUP =================
const IS_VERCEL = !!process.env.VERCEL;

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);

function getLanIps(){
  const nets = os.networkInterfaces(); const ips = [];
  for (const name of Object.keys(nets)) for (const net of nets[name] || []) if (net.family === "IPv4" && !net.internal) ips.push(net.address);
  return [...new Set(ips)];
}

// ================= Upload Limits (Vercel safe) =================
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 4);
const MAX_UPLOAD_BYTES = Math.max(1, Math.min(MAX_UPLOAD_MB, 10)) * 1024 * 1024;

const itUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES }
});

const uniUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) return cb(new Error("Only image files are allowed"));
    cb(null, true);
  }
});

// ================= Static =================
app.use("/", express.static(path.join(__dirname, "public")));
app.use("/it", express.static(path.join(__dirname, "it", "public"), {
  etag: false,
  setHeaders: (res, fp) => { if (String(fp).endsWith(".html")) res.setHeader("Cache-Control", "no-store"); }
}));
app.use("/universe", express.static(path.join(__dirname, "universe", "public"), { etag: true }));

app.get(["/it", "/it/"], (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const p = path.join(__dirname, "it", "public", "app.html");
  if (!fs.existsSync(p)) return res.redirect("/");
  return res.sendFile(p);
});
app.get("/universe", (req, res) => {
  const p = path.join(__dirname, "universe", "public", "index.html");
  if (!fs.existsSync(p)) return res.redirect("/");
  return res.redirect("/universe/index.html");
});
app.get("/api/meta", (req, res) => {
  res.json({
    build_id: BUILD_ID,
    build_time: BUILD_TIME,
    vercel: IS_VERCEL,
    host: HOST,
    port: PORT,
    ips: getLanIps(),
    paths: { portal: "/", it: "/it/login.html", universe: "/universe/index.html" },
    server_time: new Date().toISOString(),
    db: { url_set: !!TURSO_DATABASE_URL, token_set: !!TURSO_AUTH_TOKEN, max_upload_mb: MAX_UPLOAD_MB }
  });
});
// Health/debug endpoint (no auth)
app.get("/api/health", async (req, res) => {
  try {
    await ensureDbReady();
    res.json({ ok: true, build_id: BUILD_ID, build_time: BUILD_TIME, db: "ready" });
  } catch (e) {
    res.status(500).json({
      ok: false,
      build_id: BUILD_ID,
      build_time: BUILD_TIME,
      error: String(e?.message || e),
      env: { turso_url_set: !!TURSO_DATABASE_URL, turso_token_set: !!TURSO_AUTH_TOKEN }
    });
  }
});


// ================= INIT DATABASE =================
async function initDB(client) {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_locked INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      priority TEXT NOT NULL DEFAULT 'Medium',
      status TEXT NOT NULL DEFAULT 'Open',
      resolution TEXT,
      requester_id INTEGER NOT NULL,
      assignee_id INTEGER,
      due_date TEXT,
      asset_tag TEXT,
      requester_ip TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS ticket_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      actor_id INTEGER,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS ticket_tags (
      ticket_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (ticket_id, tag)
    );

    CREATE TABLE IF NOT EXISTS ticket_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      uploader_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      original_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- Store uploaded file bytes (optional; link-only attachments won't have a row here)
    CREATE TABLE IF NOT EXISTS ticket_attachment_data (
      attachment_id INTEGER PRIMARY KEY,
      content_type TEXT NOT NULL,
      data BLOB NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS ticket_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      priority TEXT NOT NULL DEFAULT 'Medium',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS routing_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL UNIQUE,
      assignee_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS csat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL UNIQUE,
      requester_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      action TEXT NOT NULL,
      target TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS it_settings (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE IF NOT EXISTS ticket_statuses (
      name TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_closed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ticket_checklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      is_done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- Universe Tables (kept for compatibility)
    CREATE TABLE IF NOT EXISTS uni_users (
      username TEXT PRIMARY KEY,
      password TEXT,
      name TEXT,
      email TEXT UNIQUE,
      role TEXT,
      department TEXT,
      is_approved INTEGER DEFAULT 0,
      is_locked INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      must_change_password INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS uni_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      req_type TEXT,
      item_name TEXT,
      quantity INTEGER,
      reason TEXT,
      image_url TEXT,
      requester TEXT,
      department TEXT,
      doc_no TEXT,
      vendor_id INTEGER,
      location_id INTEGER,
      total_cost REAL,
      status TEXT DEFAULT 'PENDING',
      reject_reason TEXT,
      approved_at DATETIME,
      updated_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_deleted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS uni_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      stock INTEGER,
      category TEXT,
      unit TEXT DEFAULT 'pcs',
      min_stock INTEGER DEFAULT 0,
      price REAL DEFAULT 0,
      is_asset INTEGER DEFAULT 0,
      asset_tag TEXT
    );

    CREATE TABLE IF NOT EXISTS uni_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT,
      action TEXT,
      details TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS uni_quotas (
      department TEXT PRIMARY KEY,
      withdraw_limit INTEGER DEFAULT 0,
      borrow_limit INTEGER DEFAULT 0,
      purchase_limit INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS uni_borrow_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER,
      item_name TEXT,
      quantity INTEGER,
      borrower TEXT,
      department TEXT,
      asset_tag TEXT,
      borrowed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      returned_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS uni_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS uni_doc_counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);

    CREATE TABLE IF NOT EXISTS uni_request_images (
      request_id INTEGER PRIMARY KEY,
      content_type TEXT NOT NULL,
      data BLOB NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // seed statuses
  const stCount = await dbGet("SELECT COUNT(*) as c FROM ticket_statuses");
  if (!stCount || Number(stCount.c || 0) === 0) {
    await dbRun("INSERT INTO ticket_statuses (name, sort_order, is_closed) VALUES ('Open', 10, 0), ('In Progress', 20, 0), ('Waiting', 30, 0), ('Closed', 90, 1)");
  }

  // seed IT admin
  const itAdmin = await dbGet("SELECT id FROM users WHERE email='admin@local'");
  if (!itAdmin) {
    await dbRun("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)",
      ["Admin", "admin@local", bcrypt.hashSync("admin1234", 10), "admin"]);
  }

  // seed Universe admin
  const uniAdmin = await dbGet("SELECT username FROM uni_users WHERE username='admin'");
  if (!uniAdmin) {
    await dbRun("INSERT INTO uni_users (username, password, name, role, department, is_approved) VALUES ('admin', ?, 'System Admin', 'IT', 'IT Dept', 1)", [bcrypt.hashSync("123", 10)]);
  }
}

async function ensureDb() {
  if (_dbReady) return;
  if (_dbReadyPromise) return _dbReadyPromise;
  _dbReadyPromise = (async () => {
    try {
      await initDB();
      _dbReady = true;
    } catch (e) {
      console.error("DB Init Error:", e);
      _dbReady = false;
    }
  })();
  return _dbReadyPromise;
}

app.use(async (req, res, next) => {
  // initialize DB once (cold start safe)
  await ensureDb();
  return next();
});

// ================= IT TICKET API =================
const itApi = express.Router();
app.use("/it/api", itApi);

const JWT_SECRET = process.env.JWT_SECRET || "change_me_secret";

async function itGetSettingJSON(key, defVal) {
  const row = await dbGet("SELECT value FROM it_settings WHERE key=?", [key]);
  if (!row) return defVal;
  try { return JSON.parse(row.value); } catch { return defVal; }
}

async function itAudit(actorId, action, target, details) {
  try { await dbRun("INSERT INTO audit_log (actor_id, action, target, details) VALUES (?,?,?,?)", [actorId || null, action, target || null, details || null]); } catch {}
}

async function itLogHistory(ticketId, actorId, action) {
  try { await dbRun("INSERT INTO ticket_history (ticket_id, actor_id, action) VALUES (?,?,?)", [ticketId, actorId || null, action]); } catch {}
}

function itAuth(req, res, next) {
  const token = (req.headers.authorization || "").startsWith("Bearer ") ? (req.headers.authorization || "").slice(7) : "";
  if (!token) return res.status(401).json({ error: "Missing token" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ error: "Invalid token" }); }
}

function itRequireRole(...roles) {
  const allow = roles.flat();
  return (req, res, next) => {
    if (!req.user || !allow.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

async function itComputeDueDate(priority) {
  const now = new Date();
  const p = (priority || "Medium").toLowerCase();
  const sla = await itGetSettingJSON("sla_policy", { urgent: 1, high: 2, medium: 5, low: 10 });
  now.setDate(now.getDate() + (Number(sla[p] ?? sla["medium"] ?? 5) || 5));
  return now.toISOString().slice(0, 10);
}
function itIsOwnerOrStaff(user, ticket) { return user.role !== "user" || ticket.requester_id === user.id; }

// Version + Debug
itApi.get("/version", (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json({ build_id: BUILD_ID, build_time: BUILD_TIME }); });
itApi.get("/_debug/db", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const envOk = hasDbEnv();
  let ping = { ok: false };
  if (envOk) {
    try {
      const c = getTursoClient();
      await c.execute({ sql: "SELECT 1 as ok", args: [] });
      ping = { ok: true };
    } catch (e) {
      ping = { ok: false, error: String(e?.message || e) };
    }
  }
  res.json({
    db_mode: envOk ? "turso" : "missing_env",
    turso_url_set: !!TURSO_DATABASE_URL,
    turso_token_set: !!TURSO_AUTH_TOKEN,
    ping,
    db_ready: _dbReady,
    max_upload_mb: MAX_UPLOAD_MB,
    build_id: BUILD_ID,
    build_time: BUILD_TIME
  });
});
// Require DB for the remaining IT API routes
itApi.use(async (req, res, next) => {
  try {
    await ensureDbReady();
    return next();
  } catch (e) {
    return res.status(500).json({
      error: "DB not ready",
      detail: String(e?.message || e),
      env: { turso_url_set: !!TURSO_DATABASE_URL, turso_token_set: !!TURSO_AUTH_TOKEN },
      build_id: BUILD_ID
    });
  }
});
itApi.post("/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Missing fields" });
  try {
    await dbRun("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'user')", [name, email, bcrypt.hashSync(password, 10)]);
    await itAudit(null, "REGISTER", email, "Self registration");
    res.json({ ok: true });
  } catch { res.status(400).json({ error: "Email exists" }); }
});

itApi.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const u = await dbGet("SELECT * FROM users WHERE email=?", [email]);
  if (!u || u.is_deleted || u.is_locked || !bcrypt.compareSync(String(password || ""), u.password_hash)) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: u.id, name: u.name, role: u.role }, JWT_SECRET, { expiresIn: "7d" });
  await itAudit(u.id, "LOGIN", u.email, "Login success");
  res.json({ token, user: { id: u.id, name: u.name, role: u.role, must_change_password: !!u.must_change_password } });
});

itApi.get("/me", itAuth, async (req, res) => {
  const row = await dbGet("SELECT id,name,role,must_change_password,is_locked,is_deleted FROM users WHERE id=?", [req.user.id]);
  if (!row || row.is_deleted || row.is_locked) return res.status(401).json({ error: "Invalid user" });
  res.json({ user: row });
});

itApi.get("/settings", itAuth, async (req, res) => {
  const company = await itGetSettingJSON("company", { name: "HTC Portal", logo: "" });
  const sla_policy = await itGetSettingJSON("sla_policy", { urgent: 1, high: 2, medium: 5, low: 10 });
  const statuses = await dbAll("SELECT name, sort_order, is_closed FROM ticket_statuses ORDER BY sort_order ASC, name ASC");
  res.json({ company, sla_policy, statuses });
});

itApi.get("/statuses", itAuth, async (req, res) => {
  const statuses = await dbAll("SELECT name, sort_order, is_closed FROM ticket_statuses ORDER BY sort_order ASC, name ASC");
  res.json(statuses);
});

itApi.post("/change_password", itAuth, async (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!new_password || String(new_password).trim().length < 4) return res.status(400).json({ error: "Password too short" });
  const u = await dbGet("SELECT * FROM users WHERE id=?", [req.user.id]);
  if (!u || !bcrypt.compareSync(String(old_password || ""), u.password_hash)) return res.status(400).json({ error: "Old password incorrect" });
  await dbRun("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?", [bcrypt.hashSync(String(new_password), 10), req.user.id]);
  res.json({ ok: true });
});

itApi.get("/tickets", itAuth, async (req, res) => {
  let where = ["1=1"], params = [];
  if (req.user.role === "user") { where.push("t.requester_id = ?"); params.push(req.user.id); }
  if (req.query.status) { where.push("t.status = ?"); params.push(req.query.status); }
  if (req.query.priority) { where.push("t.priority = ?"); params.push(req.query.priority); }
  if (req.query.assignee) { where.push("t.assignee_id = ?"); params.push(req.query.assignee); }
  if (req.query.category) { where.push("t.category = ?"); params.push(req.query.category); }
  if (req.query.tag) { where.push("EXISTS (SELECT 1 FROM ticket_tags tt WHERE tt.ticket_id=t.id AND tt.tag LIKE ?)"); params.push(`%${req.query.tag}%`); }
  if (req.query.overdue === '1') where.push("t.status != 'Closed' AND t.due_date IS NOT NULL AND t.due_date < date('now','localtime')");
  if (req.query.q) { where.push("(t.title LIKE ? OR t.description LIKE ?)"); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }

  const sql = `
    SELECT t.*,
      ru.name as requester_name,
      ru.email as requester_email,
      au.name as assignee_name,
      (SELECT GROUP_CONCAT(tag, ', ') FROM ticket_tags tt WHERE tt.ticket_id=t.id) as tags,
      (SELECT COUNT(*) FROM ticket_attachments a WHERE a.ticket_id=t.id) as attachment_count,
      (SELECT rating FROM csat c WHERE c.ticket_id=t.id) as csat_rating
    FROM tickets t
    JOIN users ru ON ru.id = t.requester_id
    LEFT JOIN users au ON au.id = t.assignee_id
    WHERE ${where.join(" AND ")}
    ORDER BY t.created_at DESC`;
  res.json(await dbAll(sql, params));
});

itApi.post("/tickets", itAuth, async (req, res) => {
  const { title, description, category, priority, due_date, template_id, tags, asset_tag } = req.body || {};
  let tTitle = title, tDesc = description, tCat = category || "General", tPri = priority || "Medium";

  if (template_id) {
    const tmpl = await dbGet("SELECT * FROM ticket_templates WHERE id=?", [template_id]);
    if (tmpl) { tTitle = tmpl.title; tDesc = tmpl.description; tCat = tmpl.category; tPri = tmpl.priority; }
  }
  if (!tTitle || !tDesc) return res.status(400).json({ error: "Missing title/description" });

  const rr = await dbGet("SELECT assignee_id FROM routing_rules WHERE category=?", [tCat]);
  const autoAssignee = rr ? rr.assignee_id : null;
  const computedDue = due_date || await itComputeDueDate(tPri);

  const r = await dbRun(
    "INSERT INTO tickets (title,description,category,priority,requester_id,assignee_id,due_date,asset_tag,requester_ip) VALUES (?,?,?,?,?,?,?,?,?)",
    [tTitle, tDesc, tCat, tPri, req.user.id, autoAssignee, computedDue, (asset_tag||null), (req.ip||null)]
  );
  const ticketId = r.lastInsertRowid;
  await itLogHistory(ticketId, req.user.id, `สร้าง Ticket ใหม่: ${tTitle}`);

  if (Array.isArray(tags)) {
    for (const tag of tags.map(x => String(x || "").trim()).filter(Boolean)) {
      await dbRun("INSERT OR IGNORE INTO ticket_tags (ticket_id, tag) VALUES (?,?)", [ticketId, tag]);
    }
  }

  await sendChat(CHAT_WEBHOOK_IT, `🛠️ มี IT Ticket ใหม่ #${ticketId}\nหัวข้อ: ${tTitle}\nหมวดหมู่: ${tCat}\nความเร่งด่วน: ${tPri}` + (APP_URL ? `\nเปิดดู: ${APP_URL}/it/?id=${ticketId}` : ""));

  res.json({ id: ticketId });
});

itApi.get("/tickets/:id", itAuth, async (req, res) => {
  const id = Number(req.params.id);
  const t = await dbGet(`
    SELECT t.*, ru.name as requester_name, ru.email as requester_email, au.name as assignee_name
    FROM tickets t
    JOIN users ru ON ru.id = t.requester_id
    LEFT JOIN users au ON au.id = t.assignee_id
    WHERE t.id = ?`, [id]);
  if (!t) return res.status(404).json({ error: "Not found" });
  if (!itIsOwnerOrStaff(req.user, t)) return res.status(403).json({ error: "Forbidden" });

  const comments = await dbAll("SELECT c.*, u.name as user_name FROM comments c JOIN users u ON u.id = c.user_id WHERE ticket_id = ? ORDER BY c.created_at ASC", [id]);
  const history = await dbAll("SELECT h.*, u.name as actor_name FROM ticket_history h LEFT JOIN users u ON u.id = h.actor_id WHERE ticket_id = ? ORDER BY h.created_at DESC", [id]);
  const tags = (await dbAll("SELECT tag FROM ticket_tags WHERE ticket_id=? ORDER BY tag", [id])).map(r => r.tag);
  const attachments = await dbAll("SELECT id,url,original_name,created_at, u.name as uploader_name FROM ticket_attachments a JOIN users u ON u.id=a.uploader_id WHERE ticket_id=? ORDER BY created_at DESC", [id]);
  const csat = await dbGet("SELECT rating, comment, created_at FROM csat WHERE ticket_id=?", [id]) || null;
  const checklist = await dbAll("SELECT id,text,is_done,created_at FROM ticket_checklist WHERE ticket_id=? ORDER BY id ASC", [id]);
  res.json({ ticket: t, comments, history, tags, attachments, checklist, csat });
});

itApi.patch("/tickets/:id", itAuth, itRequireRole("agent", "admin"), async (req, res) => {
  const id = Number(req.params.id);
  const old = await dbGet("SELECT * FROM tickets WHERE id=?", [id]);
  if (!old) return res.status(404).json({ error: "Not found" });

  const body = req.body || {};
  const fields = []; const params = [];
  function setField(col, value) { fields.push(`${col}=?`); params.push(value); }

  if (body.title !== undefined) setField("title", body.title);
  if (body.description !== undefined) setField("description", body.description);
  if (body.category !== undefined) setField("category", body.category);
  if (body.priority !== undefined) setField("priority", body.priority);
  if (body.due_date !== undefined) setField("due_date", body.due_date);
  if (body.assignee_id !== undefined) setField("assignee_id", body.assignee_id === "" ? null : Number(body.assignee_id));
  if (body.resolution !== undefined) setField("resolution", body.resolution);
  if (body.status !== undefined) {
    setField("status", body.status);
    if (String(body.status) === "Closed" && !old.closed_at) fields.push("closed_at=datetime('now','localtime')");
  }
  fields.push("updated_at=datetime('now','localtime')");

  await dbRun(`UPDATE tickets SET ${fields.join(", ")} WHERE id=?`, [...params, id]);

  if (Array.isArray(body.tags)) {
    await dbRun("DELETE FROM ticket_tags WHERE ticket_id=?", [id]);
    for (const tag of body.tags.map(x=>String(x||"").trim()).filter(Boolean)) {
      await dbRun("INSERT OR IGNORE INTO ticket_tags (ticket_id, tag) VALUES (?,?)", [id, tag]);
    }
  }
  await itLogHistory(id, req.user.id, `อัปเดต Ticket: ${Object.keys(body).join(", ")}`);
  res.json({ ok: true });
});

itApi.delete("/tickets/:id", itAuth, itRequireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  await dbRun("DELETE FROM comments WHERE ticket_id=?", [id]);
  await dbRun("DELETE FROM ticket_history WHERE ticket_id=?", [id]);
  await dbRun("DELETE FROM ticket_tags WHERE ticket_id=?", [id]);
  // delete attachment bytes + meta
  const att = await dbAll("SELECT id FROM ticket_attachments WHERE ticket_id=?", [id]);
  for (const a of att) await dbRun("DELETE FROM ticket_attachment_data WHERE attachment_id=?", [Number(a.id)]);
  await dbRun("DELETE FROM ticket_attachments WHERE ticket_id=?", [id]);
  await dbRun("DELETE FROM csat WHERE ticket_id=?", [id]);
  await dbRun("DELETE FROM tickets WHERE id=?", [id]);
  await itAudit(req.user.id, "DELETE_TICKET", String(id), "");
  res.json({ ok: true });
});

itApi.post("/tickets/:id/comments", itAuth, async (req, res) => {
  await dbRun("INSERT INTO comments (ticket_id,user_id,body) VALUES (?,?,?)", [Number(req.params.id), req.user.id, String(req.body.body || "")]);
  res.json({ ok: true });
});

// Attachments: upload file (bytes in DB)
itApi.post("/tickets/:id/attachments", itAuth, itUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No file" });
  const ticketId = Number(req.params.id);
  const f = req.file;

  const ins = await dbRun(
    "INSERT INTO ticket_attachments (ticket_id,uploader_id,url,original_name) VALUES (?,?,?,?)",
    [ticketId, req.user.id, "", f.originalname]
  );
  const aid = ins.lastInsertRowid;

  await dbRun(
    "INSERT OR REPLACE INTO ticket_attachment_data (attachment_id, content_type, data, size) VALUES (?,?,?,?)",
    [aid, f.mimetype || "application/octet-stream", f.buffer, f.size || f.buffer.length]
  );

  const url = `/it/api/attachments/${aid}`;
  await dbRun("UPDATE ticket_attachments SET url=? WHERE id=?", [url, aid]);

  res.json({ ok: true, url, original_name: f.originalname });
});

// Attachments: add link (no bytes)
itApi.post("/tickets/:id/attachments/link", itAuth, async (req, res) => {
  const ticketId = Number(req.params.id);
  const link = String(req.body?.url || "").trim();
  const name = String(req.body?.name || "").trim() || link;
  if (!link || !/^https?:\/\//i.test(link)) return res.status(400).json({ ok: false, error: "Invalid URL" });

  const ins = await dbRun(
    "INSERT INTO ticket_attachments (ticket_id,uploader_id,url,original_name) VALUES (?,?,?,?)",
    [ticketId, req.user.id, link, name]
  );
  res.json({ ok: true, id: ins.lastInsertRowid, url: link, original_name: name });
});

// Serve attachment bytes
itApi.get("/attachments/:aid", async (req, res) => {
  const aid = Number(req.params.aid);
  const meta = await dbGet("SELECT original_name FROM ticket_attachments WHERE id=?", [aid]);
  const row = await dbGet("SELECT content_type, data FROM ticket_attachment_data WHERE attachment_id=?", [aid]);
  if (!row) return res.status(404).send("Not found");

  const bytes = row.data;
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  res.setHeader("Content-Type", row.content_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(meta?.original_name || "file")}"`);
  res.send(buf);
});

// Templates
itApi.get("/templates", itAuth, async (req, res) => res.json(await dbAll("SELECT * FROM ticket_templates ORDER BY id DESC")));
itApi.post("/templates", itAuth, itRequireRole("admin"), async (req, res) => {
  const { name, title, description, category, priority } = req.body || {};
  const r = await dbRun("INSERT INTO ticket_templates (name,title,description,category,priority) VALUES (?,?,?,?,?)", [name, title, description, category || "General", priority || "Medium"]);
  res.json({ ok: true, id: r.lastInsertRowid });
});

itApi.get("/users", itAuth, itRequireRole("agent", "admin"), async (req, res) => {
  res.json(await dbAll("SELECT id, name, email, role, is_locked, is_deleted, must_change_password, created_at FROM users ORDER BY name"));
});

// ================= Universe API (kept minimal) =================
const uniApi = express.Router();
app.use("/universe/api", uniApi);

async function logAction(user, action, details) {
  try { await dbRun("INSERT INTO uni_logs (user, action, details) VALUES (?, ?, ?)", [user || "unknown", action, details || ""]); } catch (e) { console.error("UNI log error", e); }
}

async function uniGetActor(actor) {
  if (!actor) return null;
  return await dbGet("SELECT username, name, role, department, is_approved, is_locked, is_deleted, must_change_password FROM uni_users WHERE username=?", [actor]);
}

function uniRequireRole(roles) {
  return async (req, res, next) => {
    const actor = (req.body?.actor || req.query?.actor || "").toString();
    if (!actor) return res.status(401).json({ success: false, message: "Missing actor" });
    try {
      const u = await uniGetActor(actor);
      if (!u || u.is_deleted) return res.status(401).json({ success: false, message: "Invalid actor" });
      if (u.is_locked) return res.status(403).json({ success: false, message: "Locked" });
      if (!roles.includes(u.role)) return res.status(403).json({ success: false, message: "Forbidden" });
      req.actor = u; next();
    } catch (e) { return res.status(500).json({ success: false, message: "DB error" }); }
  };
}


// Require DB for Universe API routes
uniApi.use(async (req, res, next) => {
  try {
    await ensureDbReady();
    return next();
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "DB not ready",
      detail: String(e?.message || e),
      env: { turso_url_set: !!TURSO_DATABASE_URL, turso_token_set: !!TURSO_AUTH_TOKEN },
      build_id: BUILD_ID
    });
  }
});
uniApi.get("/items", async (req, res) => { try { res.json(await dbAll("SELECT * FROM uni_items ORDER BY id DESC")); } catch { res.json([]); } });

uniApi.post("/request", uniUpload.single("image"), async (req, res) => {
  const { req_type, item_name, quantity, reason, requester, department, image_url } = req.body || {};
  const qty = Number(quantity || 0);
  if (!req_type || !requester || !department || !qty || qty <= 0) return res.json({ success: false, message: "ข้อมูลไม่ครบ" });

  try {
    const ins = await dbRun(
      "INSERT INTO uni_requests (req_type,item_name,quantity,reason,image_url,requester,department,status,updated_at) VALUES (?,?,?,?,?,?,?,'PENDING',datetime('now','localtime'))",
      [req_type, item_name || "", qty, reason || "", null, requester, department]
    );
    const reqId = ins.lastInsertRowid;

    const urlCandidate = String(image_url || "").trim();
    if (urlCandidate && /^https?:\/\//i.test(urlCandidate)) {
      await dbRun("UPDATE uni_requests SET image_url=? WHERE id=?", [urlCandidate, reqId]);
    } else if (req.file) {
      await dbRun(
        "INSERT OR REPLACE INTO uni_request_images (request_id, content_type, data, size) VALUES (?,?,?,?)",
        [reqId, req.file.mimetype || "application/octet-stream", req.file.buffer, req.file.size || req.file.buffer.length]
      );
      await dbRun("UPDATE uni_requests SET image_url=? WHERE id=?", [`/universe/api/requests/${reqId}/image`, reqId]);
    }

    await logAction(requester, "CREATE_REQUEST", `${req_type} ${item_name} x${qty}`);
    await sendChat(CHAT_WEBHOOK_APPROVALS, `📢 มีคำขอใหม่ (รออนุมัติ)\nประเภท: ${req_type}\nรายการ: ${item_name}\nจำนวน: ${qty}\nผู้ขอ: ${requester}\nแผนก: ${department}`);

    res.json({ success: true, id: reqId });
  } catch (e) {
    console.error(e);
    res.json({ success: false, message: "DB error" });
  }
});

uniApi.get("/requests/:id/image", async (req, res) => {
  const id = Number(req.params.id);
  const row = await dbGet("SELECT content_type, data FROM uni_request_images WHERE request_id=?", [id]);
  if (!row) return res.status(404).send("Not found");
  const bytes = row.data;
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  res.setHeader("Content-Type", row.content_type || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(buf);
});


// Global error handler (prevents Vercel from showing a blank crash page)
app.use((err, req, res, next) => {
  console.error("UNHANDLED ERROR:", err);
  const isApi = String(req.originalUrl || "").startsWith("/it/api") || String(req.originalUrl || "").startsWith("/universe/api") || String(req.originalUrl || "").startsWith("/api/");
  if (isApi) {
    return res.status(500).json({ error: "Server error", detail: String(err?.message || err), build_id: BUILD_ID });
  }
  res.status(500).send("Server error");
});
module.exports = app;

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log("---------------------------------------------------");
    console.log(`🚀 PORTAL is RUNNING! Local: http://localhost:${PORT}`);
    console.log("---------------------------------------------------");
  });
}
