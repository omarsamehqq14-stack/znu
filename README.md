# QR Relay — Deployment Guide

A real-time QR text relay web app. Phone A scans a changing QR locally, sends only the decoded text over WebSocket, and Phone B immediately renders an equivalent QR.

## Architecture

- Frontend: static files (`public/`) hosted on GitHub Pages.
- Backend: Node.js + Express + `ws`, hosted either on a free platform (Render, recommended) or on your own VPS.
- Public transport: HTTPS/WSS.

GitHub Pages is static hosting, so the Node.js WebSocket server must run somewhere that can keep a long-lived process. The browser must connect to the backend using `wss://` when the frontend is HTTPS.

## Option A: Free hosting on Render.com (recommended, easiest)

No server to manage, no Nginx, no Certbot, no DNS setup for the backend — Render gives you a `wss://your-app.onrender.com` URL automatically.

1. Push the `QRRelayWeb` folder to a GitHub repository (can be the same repo as the Pages frontend, or a separate one).
2. Go to [render.com](https://render.com), sign up (no credit card required for the free tier), and click **New → Blueprint**.
3. Point it at your repo. Render will detect `render.yaml` in this folder and configure the service automatically.
4. Before deploying, edit the `ALLOWED_ORIGINS` value in `render.yaml` (or set it in the Render dashboard under Environment) to your actual GitHub Pages URL, e.g. `https://malik.github.io`.
5. Deploy. Render builds with `npm install` and starts with `npm start`.
6. Once live, your backend health check is at:
   ```
   https://qr-relay.onrender.com/health
   ```
7. Set `public/config.js` to:
   ```js
   window.QR_RELAY_CONFIG = {
     websocketUrl: 'wss://qr-relay.onrender.com'
   };
   ```
   (use your actual `.onrender.com` subdomain, shown in the Render dashboard)

**Note on the free tier:** the service spins down after 15 minutes of no traffic and takes a few seconds to wake up on the next request. Fine for occasional use; if you need it always-on and instant, upgrade to a paid Render plan or use the VPS route below.

## Option B: Your own VPS (full control, no cold starts)

- Process manager: PM2 (Linux) or NSSM (Windows).
- Reverse proxy: Nginx (Linux) or Caddy (Windows/Linux, simpler automatic TLS).
- TLS: Let's Encrypt / Certbot (Linux) or Caddy's built-in automatic HTTPS.

## 1. Upload backend to VPS

Copy these backend files to the VPS:

- `server.js`
- `package.json`
- `package-lock.json` (after running npm install locally, or generate it on the VPS)
- `ecosystem.config.cjs`
- `.env.example`

On Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
# Install Node.js 20+ using your preferred official Node.js method.
node -v
npm -v
```

Then:

```bash
cd /opt
sudo mkdir -p qr-relay
sudo chown -R $USER:$USER qr-relay
cd qr-relay
# copy backend files here
npm install --omit=dev
```

Create the environment file:

```bash
cp .env.example .env
nano .env
```

Set:

```env
PORT=3000
ALLOWED_ORIGINS=https://YOUR-USERNAME.github.io
```

If your GitHub Pages URL is a project site, use the origin only (no path), e.g.:

```env
ALLOWED_ORIGINS=https://malik.github.io
```

## 2. DNS

Create a DNS `A` record for your backend subdomain pointing to the VPS IPv4 address.

Example:

```text
api.example.com  ->  VPS_IP
```

Wait until DNS resolves.

## 3. Nginx

Copy `nginx-qr-relay.conf.example` to:

```text
/etc/nginx/sites-available/qr-relay
```

Replace `api.example.com` with your real backend hostname.

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/qr-relay /etc/nginx/sites-enabled/qr-relay
sudo nginx -t
sudo systemctl reload nginx
```

## 4. TLS / WSS

Run:

```bash
sudo certbot --nginx -d api.example.com
```

Choose the redirect-to-HTTPS option when prompted.

After that your backend should be reachable at:

```text
https://api.example.com/health
```

and WebSocket at:

```text
wss://api.example.com
```

The Nginx configuration forwards the WebSocket Upgrade/Connection headers and uses a longer read timeout so idle WebSocket sessions are not immediately closed.

## 5. Start Node.js with PM2

Install PM2:

```bash
sudo npm install -g pm2
```

Start:

```bash
cd /opt/qr-relay
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`, then:

```bash
pm2 save
pm2 status
pm2 logs qr-relay
```

## 6. Configure the GitHub Pages frontend

The static frontend is in `public/`.

Upload its contents to your GitHub Pages repository so that `index.html` is published.

Edit:

```text
public/config.js
```

Set:

```js
window.QR_RELAY_CONFIG = {
  websocketUrl: 'wss://api.example.com'
};
```

Then publish the frontend.

## 7. GitHub Pages

Enable GitHub Pages from repository Settings → Pages.

Use your `main` branch and the root folder if the frontend files are at repository root.

Make sure HTTPS is enabled.

## 8. Test

Backend health:

```bash
curl https://api.example.com/health
```

Expected JSON includes:

```json
{"ok":true,"service":"qr-relay"}
```

Then open the GitHub Pages URL on two phones.

Phone B:

1. Receive QR
2. Wait for pairing code

Phone A:

1. Send QR
2. Enter pairing code
3. Allow camera permission
4. Point camera at the source QR

The receiver should update immediately when the decoded text changes.

## Security notes

- Do not put VPS secrets in the GitHub Pages repository.
- `ALLOWED_ORIGINS` restricts browser WebSocket origins.
- The backend does not store QR images.
- Payloads are kept in memory for active sessions.
- Sessions expire after inactivity.
- Do not expose port 3000 publicly; Nginx should be the public HTTPS/WSS endpoint.
- Keep SSH protected and patched.

## GitHub Pages + VPS split

GitHub Pages only serves the frontend. The VPS runs Node.js. This separation is intentional.
