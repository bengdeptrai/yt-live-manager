#!/usr/bin/env bash
set -e

echo "============================================================"
echo "  CAI DAT TU DONG MAY AO (VPS UBUNTU/DEBIAN) LIVESTREAM 24/7"
echo "============================================================"

# 1. Update packages & install FFmpeg + curl
sudo apt-get update -y
sudo apt-get install -y ffmpeg curl ca-certificates

# 2. Install Node.js 20 LTS if not installed
if ! command -v node >/dev/null 2>&1; then
  echo "Dang cai dat Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# 3. Install project dependencies
npm install --omit=dev

# 4. Install PM2 to keep the manager running 24/7 in background
sudo npm install -g pm2
pm2 delete yt-live-manager >/dev/null 2>&1 || true
pm2 start server.js --name "yt-live-manager"
pm2 save
pm2 startup | tail -n 1 | bash || true

# 5. Open firewall port 3000 if ufw is active
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 3000/tcp >/dev/null 2>&1 || true
fi

PUBLIC_IP=$(curl -s https://ifconfig.me || echo "IP-MAY-AO")
echo "============================================================"
echo "✅ CAI DAT HOAN TAT!"
echo "🌐 Truy cap Web Dashboard tai: http://${PUBLIC_IP}:3000"
echo "============================================================"
