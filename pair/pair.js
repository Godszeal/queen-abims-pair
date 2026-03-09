import express from 'express';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();
const sessionStore = new Map();
const TMP_ROOT = path.resolve('./tmp_pairing');
const SESSION_ROOT = path.resolve('./sessions');

function removeFile(p) { try { if (!fs.existsSync(p)) return; fs.rmSync(p, { recursive: true, force: true }); } catch {} }
function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }

function generateSessionId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let suf = '';
  for (let i = 0; i < 16; i++) suf += chars[Math.floor(Math.random() * chars.length)];
  return 'Queen-Abims-' + suf;
}

function buildSessionData(sessionPath) {
  try {
    const payload = {};
    const files = fs.readdirSync(sessionPath).filter((f) => f.endsWith('.json'));
    for (const file of files) payload[file] = fs.readFileSync(path.join(sessionPath, file), 'utf8');
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  } catch {
    return '';
  }
}

function persistSessionById(sessionPath, sessionId) {
  const target = path.join(SESSION_ROOT, sessionId);
  ensureDir(target);
  const files = fs.readdirSync(sessionPath);
  for (const file of files) fs.copyFileSync(path.join(sessionPath, file), path.join(target, file));
}

router.get('/', async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).send({ code: 'Phone number required.' });

  num = String(num).replace(/[^0-9]/g, '');
  const phone = pn('+' + num);
  if (!phone.isValid()) return res.status(400).send({ code: 'Invalid phone number.' });
  num = phone.getNumber('e164').replace('+', '');

  ensureDir(TMP_ROOT);
  const dirs = path.join(TMP_ROOT, num);
  removeFile(dirs);

  async function go() {
    const { state, saveCreds } = await useMultiFileAuthState(dirs);
    try {
      const { version } = await fetchLatestBaileysVersion();
      const sock = makeWASocket({ version, auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })) }, printQRInTerminal: false, logger: pino({ level: 'fatal' }).child({ level: 'fatal' }), browser: Browsers.windows('Chrome'), markOnlineOnConnect: false, defaultQueryTimeoutMs: 60000, connectTimeoutMs: 60000, keepAliveIntervalMs: 30000, retryRequestDelayMs: 250, maxRetries: 5 });

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
          try {
            const sf = fs.readFileSync(path.join(dirs, 'creds.json'));
            const jid = jidNormalizedUser(num + '@s.whatsapp.net');
            const sid = generateSessionId();
            const sessionData = buildSessionData(dirs);

            persistSessionById(dirs, sid);
            sessionStore.set(num, { sid, sessionData });

            await sock.sendMessage(jid, { document: sf, mimetype: 'application/json', fileName: 'creds.json' });
            await sock.sendMessage(jid, { text: '👑 *QUEEN ABIMS* Pairing Complete!

🔑 SESSION_ID=' + sid + '

If bot is on another host, set SESSION_DATA from pairing response too.

⚠️ Do not share your auth details.', contextInfo: { forwardingScore: 1, isForwarded: true, forwardedNewsletterMessageInfo: { newsletterJid: '120363269950668068@newsletter', newsletterName: '❦ ════ •⊰❂ QUEEN ABIMS ❂⊱• ════ ❦', serverMessageId: -1 } } });

            try {
              await sock.query({ tag: 'iq', attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'w:mex' }, content: [{ tag: 'query', attrs: { query_id: '9926858900719341' }, content: new TextEncoder().encode(JSON.stringify({ variables: { newsletter_id: '120363269950668068@newsletter' } })) }] });
            } catch {}

            await delay(1000);
            removeFile(dirs);
          } catch {
            removeFile(dirs);
          }
        }

        if (connection === 'close') {
          if (lastDisconnect?.error?.output?.statusCode === 401) return;
          go();
        }
      });

      if (!sock.authState.creds.registered) {
        await delay(3000);
        try {
          let code = await sock.requestPairingCode(num);
          code = code?.match(/.{1,4}/g)?.join('-') || code;
          if (!res.headersSent) res.send({ code });
        } catch {
          if (!res.headersSent) res.status(503).send({ code: 'Failed. Try again.' });
        }
      }

      sock.ev.on('creds.update', saveCreds);
    } catch {
      if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' });
      removeFile(dirs);
    }
  }

  await go();
});

router.get('/session', (req, res) => {
  const num = String(req.query.number || '').replace(/[^0-9]/g, '');
  const data = sessionStore.get(num);
  if (data) {
    res.send({ sessionId: data.sid, sessionData: data.sessionData, status: 'connected' });
    sessionStore.delete(num);
  } else {
    res.send({ sessionId: null, sessionData: null, status: 'pending' });
  }
});

process.on('uncaughtException', (err) => { let e = String(err); if (/conflict|not-authorized|timeout|rate-overlimit|Connection Closed|Timed Out|Value not found|Stream Errored|515|503/.test(e)) return; console.log('Exception:', err); });
export default router;
