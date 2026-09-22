const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_PAYLOAD = 2048;
const MAX_SESSIONS = 5000;
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'qr-relay', time: Date.now() }));

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  maxPayload: 16 * 1024,
  verifyClient: ({ origin }, done) => {
    // In production, restrict WebSocket connections to the deployed frontend origin(s).
    // Leave ALLOWED_ORIGINS empty only for local development.
    if (ALLOWED_ORIGINS.size === 0 || !origin || ALLOWED_ORIGINS.has(origin)) return done(true);
    return done(false, 403, 'Origin not allowed');
  }
});
const sessions = new Map();

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
function newSession() {
  if (sessions.size >= MAX_SESSIONS) throw new Error('server_busy');
  let code;
  do code = randomCode(); while (sessions.has(code));
  const session = { code, sender: null, receiver: null, payload: '', createdAt: Date.now(), lastActivity: Date.now() };
  sessions.set(code, session);
  return session;
}
function send(ws, type, data = {}) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...data }));
}
function touch(s) { s.lastActivity = Date.now(); }
function cleanup() {
  const now = Date.now();
  for (const [code, s] of sessions) {
    if (now - s.lastActivity > SESSION_TTL_MS || (!s.sender && !s.receiver && now - s.createdAt > 60_000)) sessions.delete(code);
  }
}
setInterval(cleanup, 30_000).unref();

wss.on('connection', (ws) => {
  ws.role = null; ws.session = null; ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, 'error', { code: 'BAD_MESSAGE', message: 'Invalid message.' }); }
    const type = String(msg.type || '');

    if (type === 'create') {
      if (ws.session) return send(ws, 'error', { code: 'ALREADY_JOINED', message: 'Already in a session.' });
      try {
        const s = newSession();
        s.receiver = ws; ws.role = 'receiver'; ws.session = s; touch(s);
        send(ws, 'created', { code: s.code, expiresInMs: SESSION_TTL_MS });
      } catch { send(ws, 'error', { code: 'SERVER_BUSY', message: 'Too many active sessions.' }); }
      return;
    }

    if (type === 'join') {
      if (ws.session) return send(ws, 'error', { code: 'ALREADY_JOINED', message: 'Already in a session.' });
      const code = String(msg.code || '').trim().toUpperCase();
      const s = sessions.get(code);
      if (!s) return send(ws, 'error', { code: 'NOT_FOUND', message: 'Pairing code not found or expired.' });
      if (s.sender) return send(ws, 'error', { code: 'SENDER_EXISTS', message: 'A sender is already connected.' });
      s.sender = ws; ws.role = 'sender'; ws.session = s; touch(s);
      send(ws, 'joined', { code: s.code, payload: s.payload || null });
      send(s.receiver, 'peer_connected', {});
      return;
    }

    const s = ws.session;
    if (!s) return send(ws, 'error', { code: 'NO_SESSION', message: 'Join or create a session first.' });
    touch(s);

    if (type === 'payload') {
      if (ws.role !== 'sender') return send(ws, 'error', { code: 'FORBIDDEN', message: 'Only sender may publish payloads.' });
      const payload = typeof msg.payload === 'string' ? msg.payload : '';
      if (!payload || payload.length > MAX_PAYLOAD) return send(ws, 'error', { code: 'INVALID_PAYLOAD', message: `Payload must be 1-${MAX_PAYLOAD} characters.` });
      if (payload === s.payload) return;
      s.payload = payload;
      send(s.receiver, 'payload', { payload, at: Date.now() });
      send(ws, 'sent', { at: Date.now() });
      return;
    }

    if (type === 'ping') return send(ws, 'pong', { at: Date.now() });
    if (type === 'leave') return ws.close(1000, 'left');
  });

  ws.on('close', () => {
    const s = ws.session;
    if (!s) return;
    if (s.sender === ws) s.sender = null;
    if (s.receiver === ws) s.receiver = null;
    touch(s);
    if (s.receiver) send(s.receiver, 'peer_disconnected', {});
    if (!s.sender && !s.receiver) sessions.delete(s.code);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  }
}, 20_000).unref();

server.listen(PORT, () => console.log(`QR Relay listening on http://localhost:${PORT}`));

function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
