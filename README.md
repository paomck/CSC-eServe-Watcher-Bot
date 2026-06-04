# 🕵️ CSC eServe Slot Watcher

A headless Node.js + Playwright background monitor that checks the [CSC eServe portal](https://services.csc.gov.ph) for available Career Service examination appointment slots across **all 24 NCR field offices** and notifies you instantly via Telegram.

---

## 📁 Project Structure

```
CSC Watcher/
├── index.js        ← Entry point & worker loop
├── watcher.js      ← Playwright automation core
├── notifier.js     ← Telegram push notification
├── logger.js       ← Timestamped console logger
├── .env            ← Your secrets (never commit this!)
├── .env.example    ← Template — copy this to .env to get started
├── .gitignore
└── screenshots/    ← Auto-saved debug screenshots
```

---

## ⚙️ Setup Guide

### 1. Prerequisites
- **Node.js 18+** — run `node --version` to check
- A **Telegram account** (for notifications)

### 2. Clone the repo and install dependencies

```bash
git clone https://github.com/paomck/CSC-eServe-Watcher-Bot.git
cd CSC-eServe-Watcher-Bot
npm install
npx playwright install firefox
```

### 3. Create your `.env` file

```bash
cp .env.example .env
```

Then open `.env` in any text editor and fill in your values (see steps 4 and 5 below).

### 4. Get your eServe Session Cookie

> ⚠️ Your session cookie expires when you log out or after inactivity. Refresh it regularly.

1. Open **Chrome** and log in to [services.csc.gov.ph](https://services.csc.gov.ph).
2. Press **F12** → **Application** tab → **Cookies** → select `services.csc.gov.ph`.
3. Copy all `Name=Value` pairs into a single line separated by `; `.  
   Example: `PHPSESSID=abc123xyz; _ga=GA1.2.xxx; laravel_session=yyy`
4. Paste it as the value of `ESERVE_COOKIE` in your `.env`.

### 5. Set Up a Telegram Bot

1. Open Telegram and message **@BotFather** → `/newbot`.
2. Follow the prompts and copy the **bot token** it gives you.
3. Start a conversation with your new bot.
4. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` and find your **chat_id**.
5. Paste both values into your `.env`.

### 6. Run the Watcher

```bash
npm start
```

The watcher will:
- Run an immediate first check on startup.
- Poll **all 24 NCR field offices** every **10 minutes** (configurable).
- Save a screenshot to `./screenshots/` after every check for debugging.
- Send a **Telegram notification** the moment a green (available) slot is detected.

---

## 🛠️ Selector Tuning

The CSC eServe portal uses dynamically-rendered HTML. If the watcher fails to find the dropdowns or calendar, inspect the saved screenshot in `./screenshots/` and update the selectors in [`watcher.js`](./watcher.js).

**Key places to update:**

| What                 | Where in `watcher.js`                          |
|----------------------|------------------------------------------------|
| Region dropdown      | `selectByLabel(page, 'Region', ...)`           |
| Location dropdown    | `selectByLabel(page, 'Location', ...)`         |
| Service dropdown     | `selectByLabel(page, 'Service Application', ...)` |
| Calendar detection   | `scanCalendarForSlots()` — FC class selectors  |
| Available slot class | `hasAvailableClass()` inside `scanCalendarForSlots()` |

> 💡 **Tip:** Use `npx playwright codegen https://services.csc.gov.ph` to interactively record the exact selectors for your portal session.

---

## 📦 Commands

| Command           | Description                     |
|-------------------|---------------------------------|
| `npm start`       | Start the watcher (recommended) |
| `npm run watch`   | Alias for `npm start`           |

---

## 🔒 Security Notes

- `.env` is listed in `.gitignore` — **never commit it**.
- Use `.env.example` (no real values) as the template for others to clone and configure.
- The session cookie grants full access to your CSC account — treat it like a password.
- The watcher only **reads** the portal — it does not submit any booking on your behalf.

---

## 🐛 Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Redirected to login page | Cookie expired | Copy a fresh cookie from your browser |
| Dropdown option not found | Selector mismatch | Inspect `screenshots/page-loaded.png` |
| No calendar detected | Page didn't fully load | Increase `TIMEOUTS.calendar` in `watcher.js` |
| Telegram not sending | Bad token or chat ID | Verify credentials via `getUpdates` |
| `ESERVE_COOKIE is not set` | `.env` file missing | Run `cp .env.example .env` and fill in values |