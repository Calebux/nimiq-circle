#!/usr/bin/env bash
# Ship the latest main to the VPS:  sudo bash /srv/akilii/deploy/update.sh
set -euo pipefail
APP=/srv/akilii
sudo -u circle bash -c "cd $APP && git pull --ff-only && npm ci && npm run build"
systemctl restart akilii
sleep 3
systemctl --no-pager --lines=5 status akilii
