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
const ExcelJS = require("exceljs");
const jwt = require("jsonwebtoken");
const { createClient } = require("@libsql/client");

// --- Express async safety: prevent unhandled promise rejections (Vercel crash) ---
const wrap = (fn) => (req, res, next) => {
  try {
    return Promise.resolve(fn(req, res, next)).catch(next);
  } catch (e) {
    return next(e);
  }
};
function wrapRouter(router) {
  const methods = ["get", "post", "put", "patch", "delete", "options"];
  for (const m of methods) {
    const orig = router[m].bind(router);
    router[m] = (path, ...handlers) => orig(path, ...handlers.map(h => (typeof h === "function" ? wrap(h) : h)));
  }
  return router;
}



// ================= DATABASE CONFIG (Turso/libSQL) =================
function _sanitizeEnv(v){
  return String(v||"").trim().replace(/^['"]+|['"]+$/g, "");
}

const TURSO_DATABASE_URL = _sanitizeEnv(process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || "");
const TURSO_AUTH_TOKEN = _sanitizeEnv(process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || "");

// IMPORTANT: do NOT hardcode tokens. Configure via environment variables.
// This server should NOT crash at import-time if env is missing; instead we surface a clear health/debug response.
let turso = null;

function isFileUrl(u) {
  return String(u || "").startsWith("file:");
}

// Fallback: use a local libSQL (SQLite) file so Login/Register works out-of-the-box.
// On Vercel without Turso env, this will fallback to an ephemeral /tmp DB (works, but data is not guaranteed to persist).
function resolveDbUrl() {
  if (TURSO_DATABASE_URL) return TURSO_DATABASE_URL;
  if (process.env.LIBSQL_FILE || process.env.LOCAL_DB_FILE) {
    const p = _sanitizeEnv(process.env.LIBSQL_FILE || process.env.LOCAL_DB_FILE);
    if (!p) return "";
    if (p.startsWith("file:")) return p;
    const abs = path.isAbsolute(p) ? p : path.join(__dirname, p);
    return `file:${abs}`;
  }
  // default local path (persistable in docker-compose via ./universe/data volume)
  const abs = path.join(__dirname, "universe", "data", "htc.db");
  return `file:${abs}`;
}

let DB_URL = resolveDbUrl();
let DB_TOKEN = (!DB_URL || isFileUrl(DB_URL)) ? "" : TURSO_AUTH_TOKEN;

function hasDbEnv() {
  if (!DB_URL) return false;
  if (isFileUrl(DB_URL)) return true;
  return !!DB_TOKEN;
}

function getTursoClient() {
  if (!hasDbEnv()) return null;
  if (!turso) {
    // Ensure local file directory exists
    if (isFileUrl(DB_URL)) {
      const fp = DB_URL.replace(/^file:/, "");
      try {
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        // Touch file to validate write permission early (helps clearer errors)
        try { fs.closeSync(fs.openSync(fp, "a")); } catch {}
        turso = createClient({ url: DB_URL });
      } catch (e) {
        // If folder is not writable (common in locked-down environments), fallback to OS temp.
        const tmp = path.join(os.tmpdir(), "htc-portal-bundle");
        try { fs.mkdirSync(tmp, { recursive: true }); } catch {}
        const alt = path.join(tmp, "htc.db");
        DB_URL = `file:${alt}`;
        DB_TOKEN = "";
        turso = createClient({ url: DB_URL });
      }
    } else {
      turso = createClient({ url: DB_URL, authToken: DB_TOKEN });
    }
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
    if (!c) throw new Error("DB not configured (set TURSO_DATABASE_URL/TURSO_AUTH_TOKEN or use local file DB)");
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

const CHAT_WEBHOOK_APPROVALS = process.env.CHAT_WEBHOOK_APPROVALS || "https://chat.googleapis.com/v1/spaces/AAQAAZWiQYM/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=67F1VXqQzC8KcfkErJYJia31LMNU753wjP3aJo65QX0";
const CHAT_WEBHOOK_IT = process.env.CHAT_WEBHOOK_IT || "https://chat.googleapis.com/v1/spaces/AAQAaiPXV-4/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=ED5IrcZblpX2Bsn-6Thu4QD1B6BGVzz60gTGgPznXNQ";
const CHAT_WEBHOOK_RETURNS = process.env.CHAT_WEBHOOK_RETURNS || "https://chat.googleapis.com/v1/spaces/AAQAAZWiQYM/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=67F1VXqQzC8KcfkErJYJia31LMNU753wjP3aJo65QX0";

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
  setHeaders: (res, fp) => {
    if (String(fp).endsWith(".html")) res.setHeader("Cache-Control", "no-store");
    if (String(fp).endsWith(".js"))   res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  }
}));
// Universe UI: disable caching for HTML so deployments update immediately (prevents stale login JS)
app.use("/universe", express.static(path.join(__dirname, "universe", "public"), {
  etag: false,
  setHeaders: (res, fp) => {
    if (String(fp).endsWith(".html") || String(fp).endsWith(".js")) res.setHeader("Cache-Control", "no-store");
    if (String(fp).endsWith(".js")) res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  }
}));

app.get(["/it", "/it/"], (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const p = path.join(__dirname, "it", "public", "app.html");
  try { if (fs.existsSync(p)) return res.sendFile(p); } catch {}
  return res.redirect("/");
});
app.get("/it/returns", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const p = path.join(__dirname, "it", "public", "returns.html");
  try { if (fs.existsSync(p)) return res.sendFile(p); } catch {}
  return res.redirect("/it/");
});
app.get("/it/login", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const p = path.join(__dirname, "it", "public", "login.html");
  try { if (fs.existsSync(p)) return res.sendFile(p); } catch {}
  return res.redirect("/it/");
});
// Serve Universe index without redirect (redirects can break when behind sub-path proxies)
app.get(["/universe", "/universe/"], (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const p = path.join(__dirname, "universe", "public", "index.html");
  try { if (fs.existsSync(p)) return res.sendFile(p); } catch {}
  return res.redirect("/");
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
    db: {
      mode: (!DB_URL ? "missing_env" : (isFileUrl(DB_URL) ? "local_file" : "turso")),
      url_set: !!DB_URL,
      token_set: !!DB_TOKEN,
      max_upload_mb: MAX_UPLOAD_MB
    }
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
      env: { db_url_set: !!DB_URL, db_token_set: !!DB_TOKEN }
    });
  }
});



// --- libSQL compatibility: executeMultiple may not exist in some versions ---
async function execMultipleCompat(client, sqlText) {
  if (client && typeof client.executeMultiple === "function") {
    return client.executeMultiple(sqlText);
  }
  const stmts = String(sqlText)
    .split(";")
    .map(s => s.trim())
    .filter(Boolean);
  const ops = stmts.map(sql => ({ sql, args: [] }));
  if (client && typeof client.batch === "function") {
    return client.batch(ops);
  }
  for (const op of ops) await client.execute(op);
}

// ================= INIT DATABASE =================
async function initDB(client) {
  await execMultipleCompat(client, `
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

    -- Equipment Returns (IT)
    CREATE TABLE IF NOT EXISTS it_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      asset_tag TEXT,
      item_name TEXT,
      serial_no TEXT,
      condition TEXT,
      reason TEXT,
      attachment_url TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      admin_notes TEXT,
      received_at TEXT,
      requester_ip TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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


  // seed default templates (helps Create Ticket link with template)
  const tmplCount = await dbGet("SELECT COUNT(*) as c FROM ticket_templates");
  if (!tmplCount || Number(tmplCount.c || 0) === 0) {
    await dbRun(`INSERT INTO ticket_templates (name,title,description,category,priority) VALUES
      ('Printer Problem','Printer ไม่พิมพ์/กระดาษติด','อาการ: \n- รุ่น/Asset Tag: \n- Error message: \n- ลองทำอะไรไปแล้ว: \n\nโปรดแนบรูป/ลิงก์ error ถ้ามี','IT','Medium'),
      ('VPN / Access','ขอสิทธิ์ VPN / System Access','ระบบ/สิทธิ์ที่ต้องการ: \nเหตุผล/งานที่เกี่ยวข้อง: \nวันที่ต้องการใช้งาน: \n','Access','High'),
      ('Computer Issue','คอมพ์ช้า/ค้าง/เปิดไม่ติด','อาการ: \n- Asset Tag: \n- เกิดเมื่อไหร่: \n- มีเสียง/ไฟกระพริบไหม: \n','IT','Medium')`);
  }


  // seed Universe admin + sample accounts/items
  const uniAdmin = await dbGet("SELECT username FROM uni_users WHERE username='admin'");
  if (!uniAdmin) {
    await dbRun("INSERT INTO uni_users (username, password, name, role, department, is_approved) VALUES ('admin', ?, 'System Admin', 'IT', 'IT Dept', 1)", [bcrypt.hashSync("123", 10)]);
  }
  const headMkt = await dbGet("SELECT username FROM uni_users WHERE username='head_mkt'");
  if (!headMkt) {
    await dbRun("INSERT INTO uni_users (username, password, name, role, department, is_approved) VALUES ('head_mkt', ?, 'Marketing Manager', 'HEAD', 'Marketing', 1)", [bcrypt.hashSync("123", 10)]);
  }
  const itemCnt = await dbGet("SELECT COUNT(*) as c FROM uni_items");
  if (!itemCnt || Number(itemCnt.c || 0) === 0) {
    await dbRun("INSERT INTO uni_items (name, stock, category, unit, min_stock, price, is_asset, asset_tag) VALUES ('hardware', 100, 'General', 'pcs', 0, 0, 0, '')");
  }

  // Ensure seed accounts are usable even if DB already existed (older runs may have locked/unapproved admin).
  try {
    await dbRun("UPDATE uni_users SET is_approved=1, is_locked=0, is_deleted=0 WHERE username='admin'");
    const ar = await dbGet("SELECT password FROM uni_users WHERE username='admin'");
    if (ar && (!ar.password || String(ar.password).trim() === "")) {
      await dbRun("UPDATE uni_users SET password=? WHERE username='admin'", [bcrypt.hashSync("123", 10)]);
    }
    await dbRun("UPDATE uni_users SET is_approved=1, is_locked=0, is_deleted=0 WHERE username='head_mkt'");
  } catch (e) {
    console.error("UNI seed normalize error", e);
  }
}


// ================= IT TICKET API =================
const itApi = wrapRouter(express.Router());
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
    db_mode: envOk ? (isFileUrl(DB_URL) ? "local_file" : "turso") : "missing_env",
    db_url_set: !!DB_URL,
    db_token_set: !!DB_TOKEN,
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
      env: { db_url_set: !!DB_URL, db_token_set: !!DB_TOKEN },
      build_id: BUILD_ID
    });
  }
});
itApi.post("/register", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!name || !email || !password) return res.status(400).json({ error: "Missing fields" });

  // Check email uniqueness first
  const emailExists = await dbGet("SELECT id FROM users WHERE lower(email)=lower(?)", [email]);
  if (emailExists) return res.status(400).json({ error: "Email exists" });

  try {
    const ph = bcrypt.hashSync(password, 10);
    const r = await dbRun("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'user')", [name, email, ph]);
    const u = await dbGet("SELECT id,name,email,role,must_change_password,is_locked,is_deleted FROM users WHERE id=?", [Number(r.lastInsertRowid)]);
    if (!u) return res.status(500).json({ error: "Registration failed, please try again" });
    const token = jwt.sign({ id: u.id, name: u.name, role: u.role }, JWT_SECRET, { expiresIn: "7d" });
    await itAudit(u.id, "REGISTER", u.email, "Self registration");
    res.json({ token, user: { id: u.id, name: u.name, role: u.role, must_change_password: !!u.must_change_password } });
  } catch (e) {
    console.error("REGISTER ERROR:", e);
    res.status(400).json({ error: "Registration failed: " + (String(e?.message || "").includes("UNIQUE") ? "Email exists" : "Please try again") });
  }
});

itApi.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const u = await dbGet("SELECT * FROM users WHERE lower(email)=lower(?)", [email]);
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

// Dashboard summary stats (used by app.html)
itApi.get("/stats", itAuth, async (req, res) => {
  const isUser = req.user.role === "user";
  const cond = isUser ? "WHERE requester_id = ?" : "";
  const params = isUser ? [req.user.id] : [];

  const byStatus = await dbAll(`SELECT status, COUNT(*) as count FROM tickets ${cond} GROUP BY status ORDER BY count DESC`, params);
  const byPriority = await dbAll(`SELECT priority, COUNT(*) as count FROM tickets ${cond} GROUP BY priority ORDER BY count DESC`, params);
  res.json({ byStatus, byPriority });
});

itApi.get("/reports", itAuth, async (req, res) => {
  const isUser = req.user.role === "user";
  const cond = isUser ? "requester_id = ?" : "1=1";
  const params = isUser ? [req.user.id] : [];

  const total = (await dbGet(`SELECT COUNT(*) as c FROM tickets WHERE ${cond}`, params))?.c || 0;
  const open = (await dbGet(`SELECT COUNT(*) as c FROM tickets WHERE ${cond} AND status!='Closed'`, params))?.c || 0;
  const overdue = (await dbGet(`SELECT COUNT(*) as c FROM tickets WHERE ${cond} AND status!='Closed' AND due_date IS NOT NULL AND date(due_date) < date('now','localtime')`, params))?.c || 0;
  const avgCloseHrs = (await dbGet(`SELECT AVG((julianday(closed_at)-julianday(created_at))*24.0) as v FROM tickets WHERE ${cond} AND closed_at IS NOT NULL`, params))?.v || 0;
  const csatAvg = (await dbGet(`SELECT AVG(rating) as v FROM csat ${isUser ? "WHERE requester_id=?" : ""}`, isUser ? [req.user.id] : []))?.v || 0;

  const byCategory = await dbAll(`SELECT category, COUNT(*) as count FROM tickets WHERE ${cond} GROUP BY category ORDER BY count DESC LIMIT 8`, params);
  const byPriority = await dbAll(`SELECT priority, COUNT(*) as count FROM tickets WHERE ${cond} GROUP BY priority ORDER BY count DESC`, params);
  const byStatus = await dbAll(`SELECT status, COUNT(*) as count FROM tickets WHERE ${cond} GROUP BY status ORDER BY count DESC`, params);

  res.json({ total, open, overdue, avgCloseHrs: Number(avgCloseHrs || 0), csatAvg: Number(csatAvg || 0), byCategory, byPriority, byStatus });
});

// Recent activity list for dashboard
itApi.get("/activity/recent", itAuth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 20) || 20, 1), 100);
  const onlyMine = (req.user.role === "user");
  const rows = await dbAll(
    `SELECT t.id, t.title, t.category, t.priority, t.status, t.created_at,
            ru.name as requester_name, ru.email as requester_email,
            au.name as assignee_name
     FROM tickets t
     JOIN users ru ON ru.id=t.requester_id
     LEFT JOIN users au ON au.id=t.assignee_id
     WHERE (${onlyMine ? "t.requester_id = ?" : "1=1"})
     ORDER BY t.created_at DESC
     LIMIT ?`,
    onlyMine ? [req.user.id, limit] : [limit]
  );
  res.json(rows);
});

itApi.get("/activity/stats", itAuth, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days || 14) || 14, 1), 60);
  const onlyMine = (req.user.role === "user");
  const rows = await dbAll(
    `SELECT date(t.created_at) as day, COUNT(*) as count
     FROM tickets t
     WHERE (${onlyMine ? "t.requester_id = ?" : "1=1"})
       AND t.created_at >= datetime('now','localtime', ?)
     GROUP BY date(t.created_at)
     ORDER BY day ASC`,
    onlyMine ? [req.user.id, `-${days} days`] : [`-${days} days`]
  );
  res.json({ days, rows });
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

  await sendChat(CHAT_WEBHOOK_IT, `🛠️ *IT Ticket ใหม่ #${ticketId}*\n━━━━━━━━━━━━━━\n📋 หัวข้อ: ${tTitle}\n📁 หมวดหมู่: ${tCat}\n🔴 ความเร่งด่วน: ${tPri}\n👤 ผู้แจ้ง: ${req.user.name}\n📅 Due: ${computedDue}${APP_URL ? `\n🔗 ${APP_URL}/it/?id=${ticketId}` : ""}`);

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
  // Qualify columns to avoid ambiguous `id` / `created_at` when joining with users
  const attachments = await dbAll(
    "SELECT a.id, a.url, a.original_name, a.created_at, u.name as uploader_name FROM ticket_attachments a JOIN users u ON u.id=a.uploader_id WHERE a.ticket_id=? ORDER BY a.created_at DESC",
    [id]
  );
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

// Checklist
itApi.post("/tickets/:id/checklist", itAuth, async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ ok: false, error: "Missing text" });
  const r = await dbRun("INSERT INTO ticket_checklist (ticket_id, text) VALUES (?,?)", [Number(req.params.id), text]);
  res.json({ ok: true, id: r.lastInsertRowid });
});
itApi.patch("/tickets/:id/checklist/:cid", itAuth, async (req, res) => {
  const fields = []; const params = [];
  if (req.body.text !== undefined) { fields.push("text=?"); params.push(String(req.body.text || "").trim()); }
  if (req.body.is_done !== undefined) { fields.push("is_done=?"); params.push(req.body.is_done ? 1 : 0); }
  if (!fields.length) return res.json({ ok: true });
  await dbRun(`UPDATE ticket_checklist SET ${fields.join(", ")} WHERE id=? AND ticket_id=?`, [...params, Number(req.params.cid), Number(req.params.id)]);
  res.json({ ok: true });
});
itApi.delete("/tickets/:id/checklist/:cid", itAuth, async (req, res) => {
  await dbRun("DELETE FROM ticket_checklist WHERE id=? AND ticket_id=?", [Number(req.params.cid), Number(req.params.id)]);
  res.json({ ok: true });
});

// CSAT
itApi.post("/tickets/:id/csat", itAuth, async (req, res) => {
  const rating = Number(req.body?.rating);
  const comment = String(req.body?.comment || "");
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ ok: false, error: "Invalid rating" });
  await dbRun(
    "INSERT OR REPLACE INTO csat (ticket_id, requester_id, rating, comment) VALUES (?,?,?,?)",
    [Number(req.params.id), req.user.id, rating, comment]
  );
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

itApi.patch("/templates/:id", itAuth, itRequireRole("admin"), async (req, res) => {
  const { name, title, description, category, priority } = req.body || {};
  await dbRun(
    "UPDATE ticket_templates SET name=?, title=?, description=?, category=?, priority=? WHERE id=?",
    [name, title, description, category || "General", priority || "Medium", Number(req.params.id)]
  );
  res.json({ ok: true });
});
itApi.delete("/templates/:id", itAuth, itRequireRole("admin"), async (req, res) => {
  await dbRun("DELETE FROM ticket_templates WHERE id=?", [Number(req.params.id)]);
  res.json({ ok: true });
});

itApi.get("/users", itAuth, itRequireRole("agent", "admin"), async (req, res) => {
  res.json(await dbAll("SELECT id, name, email, role, is_locked, is_deleted, must_change_password, created_at FROM users ORDER BY name"));
});

// User management (admin)
itApi.post("/users", itAuth, itRequireRole("admin"), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "").trim();
    const role = String(req.body?.role || "user").trim();
    if (!name || !email || !password) return res.status(400).json({ ok: false, error: "Missing fields" });
    const r = await dbRun(
      "INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)",
      [name, email, bcrypt.hashSync(password, 10), role]
    );
    await itAudit(req.user.id, "CREATE_USER", email, role);
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ ok: false, error: "Email exists" });
  }
});
itApi.patch("/users/:id/role", itAuth, itRequireRole("admin"), async (req, res) => {
  await dbRun("UPDATE users SET role=? WHERE id=?", [String(req.body?.role || "user"), Number(req.params.id)]);
  res.json({ ok: true });
});
itApi.patch("/users/:id/lock", itAuth, itRequireRole("admin"), async (req, res) => {
  await dbRun("UPDATE users SET is_locked=1 WHERE id=?", [Number(req.params.id)]);
  res.json({ ok: true });
});
itApi.patch("/users/:id/unlock", itAuth, itRequireRole("admin"), async (req, res) => {
  await dbRun("UPDATE users SET is_locked=0 WHERE id=?", [Number(req.params.id)]);
  res.json({ ok: true });
});
itApi.delete("/users/:id", itAuth, itRequireRole("admin"), async (req, res) => {
  await dbRun("UPDATE users SET is_deleted=1 WHERE id=?", [Number(req.params.id)]);
  res.json({ ok: true });
});
itApi.post("/users/:id/restore", itAuth, itRequireRole("admin"), async (req, res) => {
  await dbRun("UPDATE users SET is_deleted=0 WHERE id=?", [Number(req.params.id)]);
  res.json({ ok: true });
});
itApi.post("/users/:id/reset_password", itAuth, itRequireRole("admin"), async (req, res) => {
  let newPassword = String(req.body?.new_password || "").trim();
  const generated = !newPassword;
  if (generated) newPassword = crypto.randomBytes(4).toString("hex");
  await dbRun("UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?", [bcrypt.hashSync(newPassword, 10), Number(req.params.id)]);
  res.json({ ok: true, ...(generated ? { temp_password: newPassword } : {}) });
});
itApi.post("/users/import_csv", itAuth, itRequireRole("admin"), async (req, res) => {
  const lines = String(req.body?.csv || "").trim().split(/\r?\n/).filter(Boolean);
  let created = 0, skipped = 0;
  for (const line of lines) {
    const [name, email, password, role] = line.split(",").map(s => s.trim());
    if (!name || !email || !password) { skipped++; continue; }
    const exists = await dbGet("SELECT id FROM users WHERE lower(email)=lower(?)", [email]);
    if (exists) { skipped++; continue; }
    await dbRun("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)", [name, email.toLowerCase(), bcrypt.hashSync(password, 10), role || "user"]);
    created++;
  }
  res.json({ ok: true, created, skipped });
});

// Routing rules (admin)
itApi.get("/routing", itAuth, itRequireRole("admin"), async (req, res) => {
  const rows = await dbAll("SELECT r.category, r.assignee_id, u.name as assignee_name FROM routing_rules r JOIN users u ON u.id=r.assignee_id ORDER BY r.category");
  res.json(rows);
});
itApi.post("/routing", itAuth, itRequireRole("admin"), async (req, res) => {
  const category = String(req.body?.category || "").trim();
  const assignee_id = Number(req.body?.assignee_id);
  if (!category || !assignee_id) return res.status(400).json({ ok: false, error: "Missing category/assignee" });
  await dbRun("INSERT OR REPLACE INTO routing_rules (category, assignee_id) VALUES (?,?)", [category, assignee_id]);
  await itAudit(req.user.id, "ROUTING_UPSERT", category, String(assignee_id));
  res.json({ ok: true });
});
itApi.delete("/routing/:category", itAuth, itRequireRole("admin"), async (req, res) => {
  await dbRun("DELETE FROM routing_rules WHERE category=?", [req.params.category]);
  res.json({ ok: true });
});
itApi.get("/categories", itAuth, itRequireRole("admin"), async (req, res) => {
  const rows = await dbAll("SELECT DISTINCT category FROM tickets WHERE category IS NOT NULL AND TRIM(category)<>'' ORDER BY category");
  res.json(rows.map(r => r.category));
});

// Exports (admin/agent)
itApi.get("/export/tickets.csv", itAuth, itRequireRole("admin","agent"), async (req, res) => {
  const rows = await dbAll(`SELECT t.id, t.title, t.category, t.priority, t.status, t.due_date,
    ru.email as requester_email, ru.name as requester_name,
    au.email as assignee_email, au.name as assignee_name,
    t.created_at, t.updated_at
    FROM tickets t
    JOIN users ru ON ru.id=t.requester_id
    LEFT JOIN users au ON au.id=t.assignee_id
    ORDER BY t.created_at DESC`);
  const header = ["id","title","category","priority","status","due_date","requester_email","requester_name","assignee_email","assignee_name","created_at","updated_at"];
  const csv = [header.join(","), ...rows.map(r=>header.map(k=>'"'+String(r[k]??"").replace(/"/g,'""')+'"').join(","))].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition","attachment; filename=\"it_tickets.csv\"");
  res.send("\ufeff"+csv);
});
itApi.get("/export/users.csv", itAuth, itRequireRole("admin"), async (req, res) => {
  const rows = await dbAll(`SELECT id,name,email,role,is_locked,is_deleted,must_change_password,created_at FROM users ORDER BY id DESC`);
  const header = ["id","name","email","role","is_locked","is_deleted","must_change_password","created_at"];
  const csv = [header.join(","), ...rows.map(r=>header.map(k=>'"'+String(r[k]??"").replace(/"/g,'""')+'"').join(","))].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition","attachment; filename=\"it_users.csv\"");
  res.send("\ufeff"+csv);
});
itApi.get("/export/audit.csv", itAuth, itRequireRole("admin"), async (req, res) => {
  const rows = await dbAll(`SELECT a.id, a.created_at, u.email as actor_email, u.name as actor_name, a.action, a.target, a.details
    FROM audit_log a
    LEFT JOIN users u ON u.id=a.actor_id
    ORDER BY a.id DESC LIMIT 2000`);
  const header = ["id","created_at","actor_email","actor_name","action","target","details"];
  const csv = [header.join(","), ...rows.map(r=>header.map(k=>'"'+String(r[k]??"").replace(/"/g,'""')+'"').join(","))].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition","attachment; filename=\"it_audit.csv\"");
  res.send("\ufeff"+csv);
});


// ================= Equipment Returns (IT) =================

// IMPORTANT: /returns/stats must be before /returns/:id to avoid route conflict
itApi.get("/returns/stats", itAuth, itRequireRole("admin","agent"), async (req, res) => {
  const byStatus = await dbAll("SELECT status, COUNT(*) as count FROM it_returns WHERE is_deleted=0 GROUP BY status ORDER BY count DESC");
  const byCondition = await dbAll("SELECT condition, COUNT(*) as count FROM it_returns WHERE is_deleted=0 AND condition IS NOT NULL AND condition!='' GROUP BY condition ORDER BY count DESC");
  const monthly = await dbAll("SELECT substr(created_at,1,7) as month, COUNT(*) as count FROM it_returns WHERE is_deleted=0 GROUP BY month ORDER BY month DESC LIMIT 6");
  const total = await dbGet("SELECT COUNT(*) as c FROM it_returns WHERE is_deleted=0");
  const pending = await dbGet("SELECT COUNT(*) as c FROM it_returns WHERE is_deleted=0 AND status='PENDING'");
  res.json({ total: total?.c||0, pending: pending?.c||0, byStatus, byCondition, monthly });
});

itApi.get("/returns", itAuth, async (req, res) => {
  const isUser = req.user.role === "user";
  const where = ["r.is_deleted=0"];
  const args = [];
  if (isUser) { where.push("r.requester_id=?"); args.push(req.user.id); }
  if (req.query.status) { where.push("upper(r.status)=upper(?)"); args.push(String(req.query.status)); }

  const rows = await dbAll(
    `SELECT r.*, u.name as requester_name, u.email as requester_email
     FROM it_returns r
     JOIN users u ON u.id=r.requester_id
     WHERE ${where.join(" AND ")}
     ORDER BY r.created_at DESC`,
    args
  );
  res.json(rows);
});

itApi.post("/returns", itAuth, async (req, res) => {
  const asset_tag = String(req.body?.asset_tag || "").trim();
  const item_name = String(req.body?.item_name || "").trim();
  const serial_no = String(req.body?.serial_no || "").trim();
  const condition = String(req.body?.condition || "").trim();
  const reason = String(req.body?.reason || "").trim();
  const attachment_url = String(req.body?.attachment_url || "").trim();

  if (!asset_tag && !item_name && !serial_no) {
    return res.status(400).json({ ok: false, error: "กรุณากรอก Asset Tag หรือ Item หรือ Serial อย่างน้อย 1 อย่าง" });
  }
  if (attachment_url && !/^https?:\/\//i.test(attachment_url)) {
    return res.status(400).json({ ok: false, error: "ลิงก์ต้องขึ้นต้นด้วย http/https" });
  }

  const r = await dbRun(
    `INSERT INTO it_returns (requester_id, asset_tag, item_name, serial_no, condition, reason, attachment_url, status, requester_ip)
     VALUES (?,?,?,?,?,?,?,'PENDING',?)`,
    [req.user.id, asset_tag || null, item_name || null, serial_no || null, condition || null, reason || null, attachment_url || null, (req.ip || null)]
  );
  await itAudit(req.user.id, "RETURN_CREATE", String(r.lastInsertRowid), JSON.stringify({ asset_tag, item_name, serial_no }));

  // Send Google Chat notification for return
  const returnId = r.lastInsertRowid;
  const itemLine = [asset_tag && `Asset Tag: ${asset_tag}`, item_name && `Item: ${item_name}`, serial_no && `S/N: ${serial_no}`].filter(Boolean).join(", ");
  await sendChat(CHAT_WEBHOOK_RETURNS, `📦 *คืนอุปกรณ์ใหม่ #${returnId}*\n━━━━━━━━━━━━━━\n👤 ผู้คืน: ${req.user.name}\n🏷️ ${itemLine || "-"}\n🔍 สภาพ: ${condition || "-"}\n📝 ${reason || "-"}\n⏳ PENDING${APP_URL ? `\n🔗 ${APP_URL}/it/returns` : ""}`);

  res.json({ ok: true, id: returnId });
});

itApi.get("/returns/:id", itAuth, async (req, res) => {
  const id = Number(req.params.id);
  const row = await dbGet(
    `SELECT r.*, u.name as requester_name, u.email as requester_email
     FROM it_returns r
     JOIN users u ON u.id=r.requester_id
     WHERE r.id=? AND r.is_deleted=0`,
    [id]
  );
  if (!row) return res.status(404).json({ ok: false, error: "Not found" });

  const isStaff = req.user.role !== "user";
  if (!isStaff && Number(row.requester_id) !== Number(req.user.id)) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }
  res.json({ ok: true, row });
});

itApi.patch("/returns/:id", itAuth, itRequireRole("admin","agent"), async (req, res) => {
  const id = Number(req.params.id);
  const old = await dbGet("SELECT * FROM it_returns WHERE id=? AND is_deleted=0", [id]);
  if (!old) return res.status(404).json({ ok: false, error: "Not found" });

  const fields = [];
  const args = [];
  const set = (k, v) => { fields.push(`${k}=?`); args.push(v); };

  if (req.body.status !== undefined) set("status", String(req.body.status || "PENDING").trim().toUpperCase());
  if (req.body.admin_notes !== undefined) set("admin_notes", String(req.body.admin_notes || "").trim() || null);
  if (req.body.received_at !== undefined) set("received_at", String(req.body.received_at || "").trim() || null);

  if (req.body.asset_tag !== undefined) set("asset_tag", String(req.body.asset_tag || "").trim() || null);
  if (req.body.item_name !== undefined) set("item_name", String(req.body.item_name || "").trim() || null);
  if (req.body.serial_no !== undefined) set("serial_no", String(req.body.serial_no || "").trim() || null);
  if (req.body.condition !== undefined) set("condition", String(req.body.condition || "").trim() || null);
  if (req.body.reason !== undefined) set("reason", String(req.body.reason || "").trim() || null);

  if (req.body.attachment_url !== undefined) {
    const url = String(req.body.attachment_url || "").trim();
    if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: "ลิงก์ต้องขึ้นต้นด้วย http/https" });
    set("attachment_url", url || null);
  }

  if (!fields.length) return res.json({ ok: true });

  const sql = `UPDATE it_returns SET ${fields.join(", ")}, updated_at=datetime('now','localtime') WHERE id=?`;
  await dbRun(sql, [...args, id]);
  await itAudit(req.user.id, "RETURN_UPDATE", String(id), JSON.stringify(Object.keys(req.body||{})));

  // Notify if status changed
  if (req.body.status !== undefined) {
    const newStatus = String(req.body.status || "PENDING").trim().toUpperCase();
    const statusEmoji = { RECEIVED: "📥", COMPLETED: "✅", CANCELLED: "❌", PENDING: "⏳" }[newStatus] || "🔄";
    const itemLine = [old.asset_tag && `Asset: ${old.asset_tag}`, old.item_name && `Item: ${old.item_name}`, old.serial_no && `S/N: ${old.serial_no}`].filter(Boolean).join(", ");
    await sendChat(CHAT_WEBHOOK_RETURNS, `${statusEmoji} *อัปเดตการคืน #${id}*\n━━━━━━━━━━━━━━\n📊 สถานะ: ${newStatus}\n🏷️ ${itemLine || "-"}\n✍️ โดย: ${req.user.name}${req.body.admin_notes ? `\n📝 ${req.body.admin_notes}` : ""}`);
  }

  res.json({ ok: true });
});

itApi.delete("/returns/:id", itAuth, itRequireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  await dbRun("UPDATE it_returns SET is_deleted=1, updated_at=datetime('now','localtime') WHERE id=?", [id]);
  await itAudit(req.user.id, "RETURN_DELETE", String(id), "");
  res.json({ ok: true });
});

itApi.get("/export/returns.csv", itAuth, itRequireRole("admin","agent"), async (req, res) => {
  const rows = await dbAll(
    `SELECT r.*, u.name as requester_name, u.email as requester_email
     FROM it_returns r
     JOIN users u ON u.id=r.requester_id
     WHERE r.is_deleted=0
     ORDER BY r.created_at DESC`
  );
  const header = ["id","status","requester_name","requester_email","asset_tag","item_name","serial_no","condition","reason","admin_notes","received_at","created_at"];
  const csv = [header.join(","), ...rows.map(r=>header.map(k=>'\"'+String(r[k]??"").replace(/"/g,'""')+'\"').join(","))].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition","attachment; filename=\"it_returns.csv\"");
  res.send("\ufeff"+csv);
});


itApi.get("/export/returns.xlsx", itAuth, itRequireRole("admin","agent"), async (req, res) => {
  const rows = await dbAll(
    `SELECT r.*, u.name as requester_name, u.email as requester_email
     FROM it_returns r
     JOIN users u ON u.id=r.requester_id
     WHERE r.is_deleted=0
     ORDER BY r.created_at DESC`
  );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Returns");
  ws.columns = [
    { header: "ID", key: "id", width: 8 },
    { header: "Status", key: "status", width: 14 },
    { header: "Requester", key: "requester_name", width: 18 },
    { header: "Requester Email", key: "requester_email", width: 22 },
    { header: "Asset Tag", key: "asset_tag", width: 16 },
    { header: "Item", key: "item_name", width: 22 },
    { header: "Serial No", key: "serial_no", width: 18 },
    { header: "Condition", key: "condition", width: 16 },
    { header: "Reason", key: "reason", width: 40 },
    { header: "Attachment URL", key: "attachment_url", width: 40 },
    { header: "Admin Notes", key: "admin_notes", width: 40 },
    { header: "Received At", key: "received_at", width: 20 },
    { header: "Requester IP", key: "requester_ip", width: 18 },
    { header: "Created At", key: "created_at", width: 20 },
    { header: "Updated At", key: "updated_at", width: 20 }
  ];
  for (const r of rows) ws.addRow(r);
  ws.getRow(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="it_returns.xlsx"`);
  res.send(Buffer.from(buf));
});




// Backup endpoint (not available on Turso)
itApi.get("/admin/backup", itAuth, itRequireRole("admin"), (req, res) => {
  res.status(404).send("SQLite backup not available on Cloud Database.");
});


// ================= Universe API (full) =================
const uniApi = wrapRouter(express.Router());
app.use("/universe/api", uniApi);

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
      env: { db_url_set: !!DB_URL, db_token_set: !!DB_TOKEN },
      build_id: BUILD_ID
    });
  }
});

async function isBcryptHash(s) { return typeof s === "string" && s.startsWith("$2"); }
async function verifyPassword(stored, plain) {
  if (!stored) return false;
  if (await isBcryptHash(stored)) return bcrypt.compare(String(plain || ""), stored);
  return String(stored) === String(plain || "");
}
async function hashPassword(plain) { return bcrypt.hash(String(plain || ""), 10); }

async function logAction(user, action, details) {
  try { await dbRun("INSERT INTO uni_logs (user, action, details) VALUES (?, ?, ?)", [user || "unknown", action, details || ""]); } catch (e) { console.error("UNI log error", e); }
}

async function uniGetSettingJSON(key, defVal) {
  const row = await dbGet("SELECT value FROM uni_settings WHERE key=?", [key]);
  if (!row) return defVal;
  try { return JSON.parse(row.value); } catch { return defVal; }
}

async function uniGetActor(actor) {
  if (!actor) return null;
  return await dbGet("SELECT username, name, role, department, is_approved, is_locked, is_deleted, must_change_password FROM uni_users WHERE username=?", [actor]);
}
async function uniGetUserEmail(username) {
  const row = await dbGet("SELECT email FROM uni_users WHERE username=?", [username]);
  return (row?.email || "").toString();
}
async function uniGetDeptHeadEmails(department) {
  const rows = await dbAll("SELECT email FROM uni_users WHERE role='HEAD' AND department=? AND is_approved=1 AND is_locked=0 AND is_deleted=0 AND email IS NOT NULL AND trim(email)<>''", [department]);
  return rows.map(r => r.email).filter(Boolean);
}
async function uniGetRoleEmails(role, department = null) {
  let sql = "SELECT email FROM uni_users WHERE role=? AND is_approved=1 AND is_locked=0 AND is_deleted=0 AND email IS NOT NULL AND trim(email)<>''";
  const params = [role];
  if (department) { sql += " AND department=?"; params.push(department); }
  const rows = await dbAll(sql, params);
  return rows.map(r => r.email).filter(Boolean);
}

function statusLabel(st) {
  const map = { PENDING: "รอหัวหน้าอนุมัติ", HEAD_APPROVED: "หัวหน้าอนุมัติแล้ว (รอ IT/Finance)", FINANCE_APPROVED: "Finance อนุมัติแล้ว (รอ CEO)", APPROVED: "อนุมัติเรียบร้อย", REJECTED: "ถูกปฏิเสธ", CANCELLED: "ยกเลิก" };
  return map[st] || st;
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

// Quota helpers
async function uniCheckQuota(dept, reqType, qty) {
  const q = await dbGet("SELECT * FROM uni_quotas WHERE department=?", [dept]);
  const limit = Number(q ? (reqType === "WITHDRAW" ? q.withdraw_limit : (reqType === "BORROW" ? q.borrow_limit : q.purchase_limit)) : 0);
  if (!limit || limit <= 0) return { ok: true, limit, used: 0, nextUsed: 0 };
  const ym = new Date().toISOString().slice(0, 7);
  const row = await dbGet("SELECT SUM(quantity) as s FROM uni_requests WHERE department=? AND req_type=? AND status='APPROVED' AND substr(created_at,1,7)=?", [dept, reqType, ym]);
  const used = Number(row?.s || 0);
  return { ok: (used + qty) <= limit, limit, used, nextUsed: used + qty };
}

// Debug
uniApi.get("/_debug/db", async (req, res) => {
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
    ok: true,
    db_mode: envOk ? (isFileUrl(DB_URL) ? "local_file" : "turso") : "missing_env",
    db_url_set: !!DB_URL,
    db_token_set: !!DB_TOKEN,
    ping,
    build_id: BUILD_ID,
    build_time: BUILD_TIME
  });
});

// Debug: seed/users snapshot (no passwords)
uniApi.get("/_debug/seed", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await ensureDbReady();
    const admin = await dbGet("SELECT username, name, role, department, email, is_approved, is_locked, is_deleted FROM uni_users WHERE username='admin'");
    const head = await dbGet("SELECT username, name, role, department, email, is_approved, is_locked, is_deleted FROM uni_users WHERE username='head_mkt'");
    const cnt = await dbGet("SELECT COUNT(*) as c FROM uni_users");
    res.json({
      ok: true,
      users_count: Number(cnt?.c || 0),
      admin,
      head_mkt: head,
      db_mode: hasDbEnv() ? (isFileUrl(DB_URL) ? "local_file" : "turso") : "missing_env",
      build_id: BUILD_ID,
      build_time: BUILD_TIME
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: String(e?.message || e), build_id: BUILD_ID });
  }
});


// Require DB for the remaining Universe API routes
uniApi.use(async (req, res, next) => {
  try {
    await ensureDbReady();
    return next();
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "DB not ready",
      detail: String(e?.message || e),
      env: { db_url_set: !!DB_URL, db_token_set: !!DB_TOKEN },
      build_id: BUILD_ID
    });
  }
});

// Auth
uniApi.post("/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();
  const user = await dbGet("SELECT * FROM uni_users WHERE username=?", [username]);
  if (!user || user.is_deleted) return res.json({ success: false, message: "ผู้ใช้ไม่ถูกต้อง" });
  if (user.is_locked) return res.json({ success: false, message: "บัญชีถูกล็อค (ติดต่อ IT)" });
  if (Number(user.is_approved) === 0) return res.json({ success: false, message: "รอการอนุมัติสิทธิ์จาก IT" });

  if (!(await verifyPassword(user.password, password))) return res.json({ success: false, message: "รหัสผ่านไม่ถูกต้อง" });
  if (!(await isBcryptHash(user.password))) {
    await dbRun("UPDATE uni_users SET password=? WHERE username=?", [await hashPassword(password), user.username]);
  }
  await logAction(username, "LOGIN", "Logged in");
  res.json({ success: true, user: { username: user.username, name: user.name, role: user.role, department: user.department, must_change_password: !!user.must_change_password } });
});

uniApi.post("/register", async (req, res) => {
  const { username, password, name, department, email } = req.body || {};
  const u = String(username || "").trim();
  const em = String(email || "").trim().toLowerCase();
  if (!u || !password || !name || !department || !em) return res.json({ success: false, message: "กรุณากรอกข้อมูลให้ครบ" });

  // Check username uniqueness
  const userExists = await dbGet("SELECT username FROM uni_users WHERE username=?", [u]);
  if (userExists) return res.json({ success: false, message: "Username นี้ถูกใช้แล้ว" });

  // Check email uniqueness
  const emailExists = await dbGet("SELECT username FROM uni_users WHERE lower(email)=lower(?)", [em]);
  if (emailExists) return res.json({ success: false, message: "Email นี้ถูกใช้แล้ว" });

  try {
    // Auto-approve self registration so users can login immediately
    await dbRun("INSERT INTO uni_users (username, password, name, email, department, role, is_approved) VALUES (?,?,?,?,?, 'USER', 1)",
      [u, await hashPassword(password), String(name).trim(), em, String(department).trim()]);
    await logAction(u, "REGISTER", `dept=${department} email=${em}`);
    res.json({ success: true });
  } catch (e) {
    console.error("UNI REGISTER ERROR:", e);
    const msg = String(e?.message || "");
    if (msg.includes("UNIQUE") && msg.includes("email")) {
      res.json({ success: false, message: "Email นี้ถูกใช้แล้ว" });
    } else if (msg.includes("UNIQUE") || msg.includes("PRIMARY")) {
      res.json({ success: false, message: "Username นี้ถูกใช้แล้ว" });
    } else {
      res.json({ success: false, message: "สมัครไม่สำเร็จ กรุณาลองใหม่" });
    }
  }
});

uniApi.post("/change_password", async (req, res) => {
  const { actor, old_password, new_password } = req.body || {};
  if (!new_password || String(new_password).trim().length < 4) return res.json({ success: false, message: "Password too short" });
  const u = await dbGet("SELECT * FROM uni_users WHERE username=?", [actor]);
  if (!u || u.is_deleted || !(await verifyPassword(u.password, old_password))) return res.json({ success: false, message: "Invalid user/password" });

  await dbRun("UPDATE uni_users SET password=?, must_change_password=0 WHERE username=?", [await hashPassword(new_password), actor]);
  await logAction(actor, "CHANGE_PASSWORD", "");
  res.json({ success: true });
});

// Items
uniApi.get("/items", async (req, res) => { res.json(await dbAll("SELECT * FROM uni_items ORDER BY id DESC")); });
uniApi.get("/items/low_stock", async (req, res) => { res.json(await dbAll("SELECT * FROM uni_items WHERE min_stock > 0 AND stock <= min_stock ORDER BY stock ASC")); });

uniApi.post("/items/add", uniRequireRole(["IT"]), async (req, res) => {
  await dbRun("INSERT INTO uni_items (name, stock, category, unit, min_stock, price, is_asset, asset_tag) VALUES (?,?,?,?,?,?,?,?)",
    [req.body.name, Number(req.body.stock || 0), req.body.category || "", req.body.unit || "pcs", Number(req.body.min_stock || 0), Number(req.body.price || 0), Number(req.body.is_asset ? 1 : 0), req.body.asset_tag || ""]);
  await logAction(req.actor.username, "ADD_ITEM", req.body.name);
  res.json({ success: true });
});
uniApi.post("/items/update", uniRequireRole(["IT"]), async (req, res) => {
  await dbRun("UPDATE uni_items SET name=?, stock=?, category=?, unit=?, min_stock=?, price=?, is_asset=?, asset_tag=? WHERE id=?",
    [req.body.name, Number(req.body.stock || 0), req.body.category || "", req.body.unit || "pcs", Number(req.body.min_stock || 0), Number(req.body.price || 0), Number(req.body.is_asset ? 1 : 0), req.body.asset_tag || "", Number(req.body.id)]);
  await logAction(req.actor.username, "UPDATE_ITEM", `#${req.body.id} ${req.body.name}`);
  res.json({ success: true });
});
uniApi.post("/items/delete", uniRequireRole(["IT"]), async (req, res) => { await dbRun("DELETE FROM uni_items WHERE id=?", [Number(req.body.id)]); res.json({ success: true }); });

// Requests list
uniApi.get("/requests", async (req, res) => {
  const actor = (req.query.actor || "").toString();
  const scope = (req.query.scope || "all").toString();
  const u = await dbGet("SELECT * FROM uni_users WHERE username=?", [actor]);
  if (!u) return res.status(401).json({ success: false, message: "Invalid actor" });

  let sql = "SELECT * FROM uni_requests WHERE is_deleted=0";
  const params = [];
  if (scope === "mine") { sql += " AND requester=?"; params.push(actor); }
  else if (scope === "inbox") {
    if (u.role === "HEAD") { sql += " AND status='PENDING' AND department=?"; params.push(u.department); }
    else if (u.role === "IT") { sql += " AND status='HEAD_APPROVED' AND req_type IN ('WITHDRAW','BORROW')"; }
    else if (u.role === "FINANCE") { sql += " AND status='HEAD_APPROVED' AND req_type='PURCHASE'"; }
    else if (u.role === "CEO") { sql += " AND status='FINANCE_APPROVED' AND req_type='PURCHASE'"; }
    else { sql += " AND 1=0"; }
  }
  sql += " ORDER BY id DESC";
  res.json({ success: true, rows: await dbAll(sql, params) });
});

// Create request (image upload OR link)
uniApi.post("/request", uniUpload.single("image"), async (req, res) => {
  const { req_type, item_name, quantity, reason, requester, department, image_url } = req.body || {};
  const qty = Number(quantity || 0);
  if (!req_type || !requester || !department || !qty || qty <= 0) return res.json({ success: false, message: "ข้อมูลไม่ครบ" });

  // quota check
  const q = await uniCheckQuota(department, req_type, qty);
  if (!q.ok) return res.json({ success: false, message: `เกินโควต้า (ใช้แล้ว ${q.used}/${q.limit})` });

  if (req_type === "WITHDRAW" || req_type === "BORROW") {
    const item = await dbGet("SELECT stock FROM uni_items WHERE name=?", [item_name]);
    if (!item) return res.json({ success: false, message: "ไม่พบสินค้าในคลัง" });
    if (Number(item.stock) < qty) return res.json({ success: false, message: "สต็อกไม่พอ" });
  }

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
  const _rtLabel = { WITHDRAW: "📤 เบิกอุปกรณ์", BORROW: "🔄 ยืมอุปกรณ์", PURCHASE: "🛒 ขอซื้อ" };
  await sendChat(CHAT_WEBHOOK_APPROVALS, `${_rtLabel[req_type] || "📢"} *คำขอใหม่ #${reqId}*\n━━━━━━━━━━━━━━\n📋 ประเภท: ${req_type}\n📦 รายการ: ${item_name}\n🔢 จำนวน: ${qty}\n👤 ผู้ขอ: ${requester}\n🏢 แผนก: ${department}\n📝 เหตุผล: ${reason || "-"}\n⏳ สถานะ: รอหัวหน้าอนุมัติ${APP_URL ? `\n🔗 ${APP_URL}/universe/` : ""}`);

  try {
    const details = `เลขที่คำขอ: #${reqId}\nประเภท: ${req_type}\nรายการ: ${item_name}\nจำนวน: ${qty}\nผู้ขอ: ${requester} (${department})\nสถานะ: ${statusLabel("PENDING")}\n`;
    const headEmails = await uniGetDeptHeadEmails(department);
    if (headEmails.length) await sendMail(headEmails.join(","), `📩 มีคำขอใหม่ #${reqId} รออนุมัติ`, details);
    const reqEmail = await uniGetUserEmail(requester);
    if (reqEmail) await sendMail(reqEmail, `✅ รับคำขอแล้ว #${reqId}`, details);
  } catch {}

  res.json({ success: true, id: reqId });
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

// Approvals
uniApi.post("/requests/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  const actor = (req.body?.actor || "").toString();
  const u = await dbGet("SELECT * FROM uni_users WHERE username=?", [actor]);
  if (!u) return res.status(401).json({ success: false, message: "Invalid actor" });
  const r = await dbGet("SELECT * FROM uni_requests WHERE id=? AND is_deleted=0", [id]);
  if (!r) return res.json({ success: false, message: "Request not found" });

  let next = null;
  if (u.role === "HEAD" && r.status === "PENDING") {
    if (u.department !== r.department) return res.json({ success: false, message: "ไม่มีสิทธิ์อนุมัติข้ามแผนก" });
    next = "HEAD_APPROVED";
  } else if (u.role === "IT" && r.status === "HEAD_APPROVED" && (r.req_type === "WITHDRAW" || r.req_type === "BORROW")) {
    const item = await dbGet("SELECT stock, is_asset, asset_tag FROM uni_items WHERE name=?", [r.item_name]);
    if (!item) return res.json({ success: false, message: "ไม่พบสินค้าในคลัง" });
    if (Number(item.stock) < Number(r.quantity)) return res.json({ success: false, message: "สต็อกไม่พอ" });
    next = "APPROVED";
    await dbRun("UPDATE uni_items SET stock = stock - ? WHERE name = ?", [Number(r.quantity), r.item_name]);
    if (r.req_type === "BORROW") {
      await dbRun("INSERT INTO uni_borrow_records (request_id,item_name,quantity,borrower,department,asset_tag) VALUES (?,?,?,?,?,?)",
        [r.id, r.item_name, r.quantity, r.requester, r.department, item.is_asset ? (item.asset_tag || "") : ""]);
    }
  } else if (u.role === "FINANCE" && r.status === "HEAD_APPROVED" && r.req_type === "PURCHASE") {
    next = "FINANCE_APPROVED";
  } else if (u.role === "CEO" && r.status === "FINANCE_APPROVED" && r.req_type === "PURCHASE") {
    next = "APPROVED";
  } else return res.status(403).json({ success: false, message: "Forbidden" });

  const appAt = (next === "APPROVED") ? "datetime('now','localtime')" : "approved_at";
  await dbRun(`UPDATE uni_requests SET status=?, reject_reason=null, approved_at=${appAt}, updated_at=datetime('now','localtime') WHERE id=?`, [next, id]);
  await logAction(actor, "APPROVE", `Request #${id} -> ${next}`);

  await sendChat(CHAT_WEBHOOK_APPROVALS, `✅ *อนุมัติคำขอ #${id}*\n━━━━━━━━━━━━━━\n📦 รายการ: ${r.item_name}\n🔢 จำนวน: ${r.quantity}\n👤 ผู้ขอ: ${r.requester} (${r.department})\n📊 สถานะใหม่: ${statusLabel(next)}\n✍️ โดย: ${actor}`);

  try {
    const requesterEmail = await uniGetUserEmail(r.requester);
    const baseMsg = `เลขที่คำขอ: #${id}\nประเภท: ${r.req_type}\nรายการ: ${r.item_name}\nจำนวน: ${r.quantity}\nผู้ขอ: ${r.requester} (${r.department})\nสถานะใหม่: ${statusLabel(next)}\nโดย: ${actor}\n`;
    if (requesterEmail) await sendMail(requesterEmail, `🔔 อัปเดตคำขอ #${id}: ${statusLabel(next)}`, baseMsg);

    let nextEmails = [];
    if (next === "HEAD_APPROVED") nextEmails = (r.req_type === "PURCHASE") ? await uniGetRoleEmails("FINANCE") : await uniGetRoleEmails("IT");
    else if (next === "FINANCE_APPROVED") nextEmails = await uniGetRoleEmails("CEO");
    if (nextEmails.length) await sendMail(nextEmails.join(","), `📩 มีคำขอ #${id} รออนุมัติขั้นถัดไป`, baseMsg);
  } catch {}

  res.json({ success: true, next });
});

uniApi.post("/requests/:id/reject", async (req, res) => {
  const { actor, reason } = req.body || {};
  const id = Number(req.params.id);
  const u = await dbGet("SELECT * FROM uni_users WHERE username=?", [actor]);
  if (!u) return res.status(401).json({ success: false });
  const r = await dbGet("SELECT * FROM uni_requests WHERE id=? AND is_deleted=0", [id]);

  await dbRun("UPDATE uni_requests SET status='REJECTED', reject_reason=?, updated_at=datetime('now','localtime') WHERE id=?", [reason, id]);
  await logAction(actor, "REJECT", `Request #${id}`);

  await sendChat(CHAT_WEBHOOK_APPROVALS, `❌ *ปฏิเสธคำขอ #${id}*\n━━━━━━━━━━━━━━\n📦 รายการ: ${r ? r.item_name : "-"}\n👤 ผู้ขอ: ${r ? r.requester : "-"}\n📝 เหตุผล: ${reason || "-"}\n✍️ โดย: ${actor}`);

  try {
    if (r) {
      const requesterEmail = await uniGetUserEmail(r.requester);
      if (requesterEmail) await sendMail(requesterEmail, `❌ คำขอ #${id} ถูกปฏิเสธ`, `เลขที่คำขอ: #${id}\nสถานะใหม่: ${statusLabel("REJECTED")}\nเหตุผล: ${reason}\nโดย: ${actor}`);
    }
  } catch {}

  res.json({ success: true });
});

uniApi.post("/requests/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  const actor = (req.body?.actor || "").toString();
  const r = await dbGet("SELECT * FROM uni_requests WHERE id=? AND is_deleted=0", [id]);
  await dbRun("UPDATE uni_requests SET status='CANCELLED', updated_at=datetime('now','localtime') WHERE id=? AND requester=?", [id, actor]);
  await logAction(actor, "CANCEL", `Request #${id}`);

  try {
    if (r) {
      const requesterEmail = await uniGetUserEmail(r.requester);
      if (requesterEmail) await sendMail(requesterEmail, `🟡 คำขอ #${id} ถูกยกเลิกแล้ว`, `สถานะ: ยกเลิกคำขอ`);
    }
  } catch {}

  res.json({ success: true });
});

// Borrow records
uniApi.get("/borrow_records", async (req, res) => {
  const actor = (req.query.actor || "").toString();
  const active = (req.query.active || "1").toString();
  const u = await dbGet("SELECT * FROM uni_users WHERE username=?", [actor]);
  if (!u) return res.status(401).json({ success: false });

  let sql = "SELECT * FROM uni_borrow_records";
  const params = [];
  const clauses = [];
  if (active === "1") clauses.push("returned_at IS NULL");
  if (u.role !== "IT") { clauses.push("borrower=?"); params.push(actor); }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  res.json({ success: true, rows: await dbAll(sql + " ORDER BY id DESC", params) });
});

uniApi.post("/borrow_records/:id/return", async (req, res) => {
  const id = Number(req.params.id);
  const br = await dbGet("SELECT * FROM uni_borrow_records WHERE id=?", [id]);
  if (!br) return res.json({ success: false, message: "Not found" });
  await dbRun("UPDATE uni_borrow_records SET returned_at=datetime('now','localtime') WHERE id=?", [br.id]);
  await dbRun("UPDATE uni_items SET stock = stock + ? WHERE name = ?", [Number(br.quantity), br.item_name]);
  await logAction(req.body.actor, "RETURN", `Borrow #${br.id}`);
  res.json({ success: true });
});

// Users (IT)
uniApi.get("/users", uniRequireRole(["IT"]), async (req, res) => {
  res.json({
    success: true,
    rows: await dbAll("SELECT username, name, email, role, department, is_approved, is_locked, is_deleted, must_change_password FROM uni_users ORDER BY username")
  });
});
uniApi.post("/users/add", uniRequireRole(["IT"]), async (req, res) => {
  const { username, password, name, role, department, approved, email } = req.body || {};
  const u = String(username || "").trim();
  const pw = String(password || "");
  const nm = String(name || u).trim();
  const dep = String(department || "").trim();
  const rl = String(role || "USER").trim().toUpperCase();
  const em = String(email || "").trim().toLowerCase();

  if (!u || !pw) return res.json({ success: false, message: "Missing username/password" });

  const exists = await dbGet("SELECT username FROM uni_users WHERE username=?", [u]);
  if (exists) return res.json({ success: false, message: "Username already exists" });

  if (em) {
    const emExists = await dbGet("SELECT username FROM uni_users WHERE lower(email)=lower(?)", [em]);
    if (emExists) return res.json({ success: false, message: "Email นี้ถูกใช้แล้ว" });
  }

  await dbRun(
    "INSERT INTO uni_users (username,password,name,email,role,department,is_approved) VALUES (?,?,?,?,?,?,?)",
    [u, await hashPassword(pw), nm, em, rl, dep, approved ? 1 : 0]
  );
  res.json({ success: true });
});
uniApi.post("/users/import_csv", uniRequireRole(["IT"]), async (req, res) => {
  const csv = String(req.body?.csv || "");
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let created = 0, skipped = 0;

  for (const line of lines) {
    const cols = line.split(",").map(x => x.trim());
    if (!cols.length) continue;
    if ((cols[0] || "").toLowerCase() === "username") continue; // header

    const [username, password, name, department, role, email] = cols;
    if (!username || !password) { skipped++; continue; }

    const u = String(username).trim();
    const pw = String(password || "");
    const nm = String(name || u).trim();
    const dep = String(department || "").trim();
    const rl = String(role || "USER").trim().toUpperCase();
    const em = String(email || "").trim().toLowerCase();

    const exists = await dbGet("SELECT username FROM uni_users WHERE username=?", [u]);
    if (exists) { skipped++; continue; }

    if (em) {
      const emExists = await dbGet("SELECT username FROM uni_users WHERE lower(email)=lower(?)", [em]);
      if (emExists) { skipped++; continue; }
    }

    await dbRun(
      "INSERT INTO uni_users (username,password,name,email,role,department,is_approved) VALUES (?,?,?,?,?,?,1)",
      [u, await hashPassword(pw), nm, em, rl, dep]
    );
    created++;
  }

  res.json({ success: true, created, skipped });
});

uniApi.post("/users/update", uniRequireRole(["IT"]), async (req, res) => {
  await dbRun("UPDATE uni_users SET role=?, is_approved=?, department=?, is_locked=? WHERE username=?",
    [req.body.role, Number(req.body.approved ? 1 : 0), req.body.department || "", Number(req.body.locked ? 1 : 0), req.body.target]);
  res.json({ success: true });
});
uniApi.post("/users/soft_delete", uniRequireRole(["IT"]), async (req, res) => { await dbRun("UPDATE uni_users SET is_deleted=1 WHERE username=?", [req.body.target]); res.json({ success: true }); });
uniApi.post("/users/restore", uniRequireRole(["IT"]), async (req, res) => { await dbRun("UPDATE uni_users SET is_deleted=0 WHERE username=?", [req.body.target]); res.json({ success: true }); });
uniApi.post("/users/reset_password", uniRequireRole(["IT"]), async (req, res) => {
  let pw = req.body.new_password || crypto.randomBytes(4).toString("hex");
  await dbRun("UPDATE uni_users SET password=?, must_change_password=1 WHERE username=?", [await hashPassword(pw), req.body.target]);
  res.json({ success: true, temp_password: req.body.new_password ? undefined : pw });
});

// Quotas
uniApi.get("/quotas", uniRequireRole(["IT"]), async (req, res) => res.json({ success: true, rows: await dbAll("SELECT * FROM uni_quotas ORDER BY department") }));
uniApi.post("/quotas/set", uniRequireRole(["IT"]), async (req, res) => {
  await dbRun("INSERT OR REPLACE INTO uni_quotas (department, withdraw_limit, borrow_limit, purchase_limit) VALUES (?,?,?,?)",
    [req.body.department, Number(req.body.withdraw_limit||0), Number(req.body.borrow_limit||0), Number(req.body.purchase_limit||0)]);
  res.json({ success: true });
});

// Reports
uniApi.get("/reports", uniRequireRole(["IT", "FINANCE", "CEO"]), async (req, res) => {
  const ym = new Date().toISOString().slice(0, 7);

  const total = (await dbGet("SELECT COUNT(*) as c FROM uni_requests WHERE is_deleted=0"))?.c || 0;
  const pending = (await dbGet("SELECT COUNT(*) as c FROM uni_requests WHERE status='PENDING' AND is_deleted=0"))?.c || 0;
  const approved = (await dbGet("SELECT COUNT(*) as c FROM uni_requests WHERE status='APPROVED' AND is_deleted=0"))?.c || 0;
  const rejected = (await dbGet("SELECT COUNT(*) as c FROM uni_requests WHERE status='REJECTED' AND is_deleted=0"))?.c || 0;
  const activeBorrows = (await dbGet("SELECT COUNT(*) as c FROM uni_borrow_records WHERE returned_at IS NULL"))?.c || 0;

  const total_items = (await dbGet("SELECT COUNT(*) as c FROM uni_items"))?.c || 0;
  const total_users = (await dbGet("SELECT COUNT(*) as c FROM uni_users WHERE is_deleted=0"))?.c || 0;

  const byStatus = await dbAll("SELECT status, COUNT(*) as count FROM uni_requests WHERE is_deleted=0 GROUP BY status ORDER BY count DESC");
  const byDept = await dbAll("SELECT department, COUNT(*) as count FROM uni_requests WHERE is_deleted=0 GROUP BY department ORDER BY count DESC");
  const byType = await dbAll("SELECT req_type, COUNT(*) as count FROM uni_requests WHERE is_deleted=0 GROUP BY req_type ORDER BY count DESC");
  const quotaUsage = await dbAll(
    "SELECT department, req_type, SUM(quantity) as used FROM uni_requests WHERE status='APPROVED' AND is_deleted=0 AND substr(created_at,1,7)=? GROUP BY department, req_type ORDER BY department",
    [ym]
  );

  // Provide both new + legacy keys (front-compat)
  res.json({
    success: true,
    month: ym,

    // new keys
    total, pending, approved, rejected, activeBorrows,
    total_items, total_users,
    byStatus, byDept, byType, quotaUsage,

    // legacy keys used by older frontend
    total_requests: total,
    total_items_legacy: total_items,
    total_users_legacy: total_users,
    by_status: byStatus,
    by_department: byDept,
    by_type: byType
  });
});

// CSV export
uniApi.get("/export/requests.csv", uniRequireRole(["IT"]), async (req,res)=>{
  const rows = await dbAll("SELECT * FROM uni_requests WHERE is_deleted=0 ORDER BY id DESC");
  const header = ["id","req_type","item_name","quantity","reason","requester","department","status","created_at"];
  const csv = [header.join(","), ...rows.map(r=>header.map(k=>'"'+String(r[k]??"").replace(/"/g,'""')+'"').join(","))].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8"); res.setHeader("Content-Disposition","attachment; filename=\"requests.csv\""); res.send("\ufeff"+csv);
});
uniApi.get("/export/inventory.csv", uniRequireRole(["IT"]), async (req,res)=>{
  const rows = await dbAll("SELECT * FROM uni_items ORDER BY id DESC");
  const header = ["id","name","stock","category","min_stock"];
  const csv = [header.join(","), ...rows.map(r=>header.map(k=>'"'+String(r[k]??"").replace(/"/g,'""')+'"').join(","))].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8"); res.setHeader("Content-Disposition","attachment; filename=\"inventory.csv\""); res.send("\ufeff"+csv);
});

// Logs + Backup (backup disabled on cloud DB)
uniApi.get("/logs", uniRequireRole(["IT"]), async (req, res) => res.json({ success: true, rows: await dbAll("SELECT * FROM uni_logs ORDER BY id DESC LIMIT 200") }));
uniApi.get("/backup", uniRequireRole(["IT"]), (req,res)=> res.status(404).send("SQLite backup not available on Cloud Database."));


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
