# Owner Guard Bot

A small Discord bot with one job: if anyone pings your "Owner" role, they get timed out for 5 minutes. There's an owner-only command to undo that if it was a mistake.

The bot token and owner ID both live in environment variables — never in the code. So if this repo is ever public, forked, or cloned, nobody can run it as *your* bot or use the owner-only command in *your* server. They'd need their own token and their own ID for it to do anything.

## Commands

| Command | Who can use it | What it does |
|---|---|---|
| `!ping` | anyone | replies with the bot's latency |
| `!help` | anyone | lists these commands |
| `!untimeout @user` | owner only | removes a timeout from someone |

Prefix defaults to `!`. Change it with the `PREFIX` env var if you want.

## 1. Create the bot in Discord

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Name it, then open the **Bot** tab.
3. Click **Reset Token** and copy it — that's your `BOT_TOKEN`. Treat it like a password.
4. Still on the Bot tab, scroll to **Privileged Gateway Intents** and turn ON:
   - **Server Members Intent**
   - **Message Content Intent**
5. Go to **OAuth2 → URL Generator**. Check the `bot` scope, then check these bot permissions:
   - View Channels
   - Send Messages
   - Read Message History
   - Moderate Members *(this is the one that actually lets it apply timeouts)*
6. Copy the generated URL and open it to invite the bot to your server.

   Or just drop your Application/Client ID into this link:
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=1099511696384&scope=bot
   ```

**Important:** in Server Settings → Roles, drag the bot's role **above** the Owner role (and above anyone else you want it able to time out). Discord won't let a bot act on a role higher than its own — no exceptions.

## 2. Get your two IDs

Turn on Developer Mode first: Discord app → Settings → Advanced → Developer Mode.

- **OWNER_ID** — right-click your own name/avatar → **Copy User ID**.
- **OWNER_ROLE_ID** — Server Settings → Roles → right-click the Owner role → **Copy Role ID**.

## 3. Configure your environment variables

Copy `.env.example` to a new file named `.env` and fill it in:

```
BOT_TOKEN=your-bot-token
OWNER_ID=your-user-id
OWNER_ROLE_ID=the-role-id
PREFIX=!
```

`.env` is already listed in `.gitignore`, so it won't get pushed to GitHub.

## 4. Run it locally (optional)

```
npm install
npm start
```

## 5. Deploy to Railway

1. Push this folder to a GitHub repo.
2. On [railway.com/new](https://railway.com/new), choose **Deploy from GitHub repo** and select it.
3. Open the service's **Variables** tab and add `BOT_TOKEN`, `OWNER_ID`, `OWNER_ROLE_ID` (and `PREFIX` if you want something other than `!`).
4. That's it. Railway detects the Node app automatically and runs `npm start` — no extra config needed. The included `railway.json` just sets it to auto-restart if it ever crashes.

The bot stays online as long as the Railway service is running.

## How the security actually works

- **`BOT_TOKEN`** never touches the code — it's read from the environment at runtime. Without it, nobody can log in as your bot, full stop.
- **`OWNER_ID`** gates the `untimeout` command. Even if someone else has the bot in their server or reads this code, they can't remove a timeout unless their Discord account matches that ID.
- Real owners and admins are automatically exempt from getting timed out themselves if they ping the role.
