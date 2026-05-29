import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INBOX_PATH = path.resolve(__dirname, '../inbox.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.WEBHOOK_PORT || 3001;

// Ensure inbox.json and public/ exist on startup
if (!fs.existsSync(INBOX_PATH)) {
  fs.writeFileSync(INBOX_PATH, JSON.stringify({ replies: [] }, null, 2));
}
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/screenshots', express.static(PUBLIC_DIR));

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/webhook', (req, res) => {
  const { Body: message, From: from } = req.body;

  if (message && from) {
    let inbox = { replies: [] };
    try {
      inbox = JSON.parse(fs.readFileSync(INBOX_PATH, 'utf-8'));
    } catch { /* start fresh */ }

    inbox.replies.push({
      timestamp: new Date().toISOString(),
      from,
      message,
      read: false,
    });

    fs.writeFileSync(INBOX_PATH, JSON.stringify(inbox, null, 2));
    console.log(`[webhook] SMS from ${from}: ${message}`);
  }

  res.type('text/xml').send('<Response></Response>');
});

app.listen(PORT, () => {
  console.log(`[webhook] Server running on port ${PORT}`);
  console.log(`[webhook] To receive SMS replies, expose this port with ngrok:`);
  console.log(`[webhook]   ngrok http ${PORT}`);
  console.log(`[webhook] Then set your Twilio webhook URL to: https://<ngrok-url>/webhook`);
});
