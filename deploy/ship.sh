#!/usr/bin/env bash
# Ship the committed HEAD from this laptop to the VPS (the server has no GitHub access):
#   bash deploy/ship.sh            # host defaults to the ssh alias below
set -euo pipefail
HOST="${1:-hoursback-waba-gateway}"
cd "$(dirname "$0")/.."
[[ -z "$(git status --porcelain)" ]] || { echo "Commit first: only committed code is shipped."; exit 1; }
REV=$(git rev-parse --short HEAD)
git archive --format=tar HEAD | ssh "$HOST" "sudo -u circle tar -x -C /srv/akilii && echo $REV | sudo -u circle tee /srv/akilii/REVISION >/dev/null"
# pipefail inside the build shell: piping through tail must not hide a failed build, or the
# restart below would run on a broken .next.
ssh "$HOST" 'cd /srv/akilii && sudo -u circle -H bash -c "set -o pipefail; npm ci --no-audit --no-fund --loglevel=error && npm run build 2>&1 | tail -3" \
  && cp deploy/akilii.service /etc/systemd/system/akilii.service && systemctl daemon-reload && systemctl restart akilii \
  && sleep 4 && systemctl is-active akilii && curl -s -o /dev/null -w "local %{http_code}\n" http://127.0.0.1:3300/'
echo "Shipped $REV"
