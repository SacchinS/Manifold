import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INBOX_PATH = path.resolve(__dirname, '../inbox.json');
const PUBLIC_DIR = path.resolve(__dirname, '../webhook-server/public');

function getClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env');
  }
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

export async function sendUpdate(message, screenshotPath = null) {
  const { MY_PHONE_NUMBER, TWILIO_FROM_NUMBER, SCREENSHOT_BASE_URL } = process.env;
  if (!MY_PHONE_NUMBER || !TWILIO_FROM_NUMBER) {
    throw new Error('MY_PHONE_NUMBER and TWILIO_FROM_NUMBER must be set in .env');
  }

  const client = getClient();
  const params = {
    body: message,
    from: TWILIO_FROM_NUMBER,
    to: MY_PHONE_NUMBER,
  };

  if (screenshotPath && SCREENSHOT_BASE_URL && fs.existsSync(screenshotPath)) {
    const fileName = path.basename(screenshotPath);
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    fs.copyFileSync(screenshotPath, path.join(PUBLIC_DIR, fileName));
    params.mediaUrl = [`${SCREENSHOT_BASE_URL}/screenshots/${fileName}`];
  }

  await client.messages.create(params);
  console.log(`[twilio] SMS sent: ${message.slice(0, 80)}`);
}

export async function waitForReply(timeoutMs = 30 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const raw = fs.readFileSync(INBOX_PATH, 'utf-8');
        const inbox = JSON.parse(raw);
        const unread = inbox.replies.find(r => !r.read);

        if (unread) {
          unread.read = true;
          fs.writeFileSync(INBOX_PATH, JSON.stringify(inbox, null, 2));
          resolve(unread.message);
          return;
        }
      } catch {
        // inbox might not exist yet — ignore
      }

      if (Date.now() > deadline) {
        reject(new Error('Timed out waiting for SMS reply'));
        return;
      }

      setTimeout(poll, 2000);
    };

    poll();
  });
}
