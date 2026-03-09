import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion, delay } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const router = express.Router();
function removeFile(p) { try { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); } catch {} }

router.get('/', async (req, res) => {
  const sid = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  const dirs = './qr_sessions/session_' + sid;
  if (!fs.existsSync('./qr_sessions')) fs.mkdirSync('./qr_sessions', { recursive: true });
  if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dirs);
  try {
    const { version } = await fetchLatestBaileysVersion();
    let sent = false, qrDone = false;

    let sock = makeWASocket({ version, logger: pino({ level: 'silent' }), browser: Browsers.windows('Chrome'), auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })) }, markOnlineOnConnect: false, defaultQueryTimeoutMs: 60000, connectTimeoutMs: 60000, keepAliveIntervalMs: 30000 });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr && !qrDone) {
        qrDone = true;
        try {
          const url = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M', type: 'image/png', quality: 0.92, margin: 1 });
          if (!sent) { sent = true; res.send({ qr: url, message: 'Scan QR with WhatsApp', instructions: ['1. Open WhatsApp', '2. Linked Devices', '3. Link a Device', '4. Scan QR'] }); }
        } catch { if (!sent) { sent = true; res.status(500).send({ code: 'QR failed' }); } }
      }
      if (connection === 'open') {
        try {
          const sf = fs.readFileSync(dirs + '/creds.json');
          const jid = sock.authState.creds.me ? jidNormalizedUser(sock.authState.creds.me.id) : null;
          if (jid) { await sock.sendMessage(jid, { document: sf, mimetype: 'application/json', fileName: 'creds.json' }); await sock.sendMessage(jid, { text: '👑 QUEEN ABIMS QR Pairing Complete!' }); }
        } catch {}
        setTimeout(() => removeFile(dirs), 15000);
      }
      if (connection === 'close') { removeFile(dirs); }
    });
    sock.ev.on('creds.update', saveCreds);
    setTimeout(() => { if (!sent) { sent = true; res.status(408).send({ code: 'QR timeout' }); removeFile(dirs); } }, 30000);
  } catch { if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' }); removeFile(dirs); }
});

process.on('uncaughtException', (err) => { let e = String(err); if (/conflict|not-authorized|timeout|rate-overlimit|Connection Closed|Timed Out|Value not found|Stream Errored|515|503/.test(e)) return; console.log('Exception:', err); });
export default router;
