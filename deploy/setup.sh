#!/usr/bin/env bash
# One-time setup of Akilii on a fresh Ubuntu 22.04 / 24.04 VPS. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/Calebux/nimiq-circle/main/deploy/setup.sh -o setup.sh   (or scp it over)
#   sudo bash setup.sh you@example.com
#
# The email is for Let's Encrypt expiry notices. Point akilii.xyz and www at this server's IP
# (Namecheap A records) before running, or the HTTPS step fails; rerun the script once DNS is live.
set -euo pipefail

EMAIL="${1:?usage: setup.sh <email for Lets Encrypt notices>}"
DOMAIN=akilii.xyz
# The repo must be public for this URL (the competition requires it anyway); otherwise set
# REPO=git@github.com:Calebux/nimiq-circle.git and add a deploy key for the circle user.
REPO="${REPO:-https://github.com/Calebux/nimiq-circle.git}"
APP=/srv/akilii

echo "==> Packages"
apt-get update -y
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx ufw
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Firewall: SSH and web only"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> User and folders"
id circle >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin circle
install -d -o circle -g circle -m 750 /var/lib/circle "$APP"
install -d -o root -g circle -m 750 /etc/circle

echo "==> Code"
if [[ ! -d "$APP/.git" ]]; then sudo -u circle git clone "$REPO" "$APP"; else sudo -u circle git -C "$APP" pull --ff-only; fi

echo "==> Secrets"
if [[ ! -f /etc/circle/env ]]; then
  # Fresh secrets, generated here so they never pass through chat, the repo or shell history.
  cat > /etc/circle/env <<EOF
NODE_ENV=production
NIM_NETWORK=mainnet
NIM_RPC_URL=https://rpc.nimiqwatch.com
NIM_MIN_CONFIRMATIONS=2
POOL_ADDRESS=
POOL_PRIVATE_KEY=
STAKE_VALIDATOR=NQ08 RS08 LTKL 62QL B954 S9YP 0G3R XVKM RU2Y
POLYGON_RPC_URL=
EVM_POOL_ADDRESS=
EVM_POOL_PRIVATE_KEY=
GAS_ADDRESS=
GAS_PRIVATE_KEY=
EVM_COLD_ADDRESS=
OFFRAMP_PROVIDER=mock
SESSION_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 24)
DATABASE_URL=file:/var/lib/circle/circle.db
DEV_WALLET=
INSTANT_PAYOUTS=
DEMO_CADENCE=
AUTO_STAKE=off
POOL_FLOAT_NIM=0
EOF
  chown root:circle /etc/circle/env
  chmod 640 /etc/circle/env
  echo "    Wrote /etc/circle/env with fresh SESSION_SECRET and CRON_SECRET."
  echo "    Fill in the pool and Polygon keys:  sudo nano /etc/circle/env"
fi

echo "==> Build"
sudo -u circle bash -c "cd $APP && npm ci && npm run build"

echo "==> Service"
cp "$APP/deploy/akilii.service" /etc/systemd/system/akilii.service
systemctl daemon-reload
systemctl enable akilii
systemctl restart akilii

echo "==> nginx"
cp "$APP/deploy/nginx-akilii.conf" /etc/nginx/sites-available/akilii
ln -sf /etc/nginx/sites-available/akilii /etc/nginx/sites-enabled/akilii
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> HTTPS"
if certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN" -d "www.$DOMAIN"; then
  echo "    HTTPS is on."
else
  echo "    certbot failed: is DNS pointing here yet? Check with: dig +short $DOMAIN"
  echo "    Then rerun: sudo certbot --nginx --redirect -d $DOMAIN -d www.$DOMAIN"
fi

echo
echo "Done. Status: systemctl status akilii   Logs: journalctl -u akilii -f"
echo "If the service keeps restarting, the logs say which env value is missing or unsafe."
