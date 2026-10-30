# Deploying Akilii

One Ubuntu VPS, nginx in front, systemd running a single Next.js process on 127.0.0.1:3300 (the worker lives inside it, so never run two). SQLite database in `/var/lib/circle`, secrets in `/etc/circle/env`.

## 1. DNS at Namecheap

Domain List → akilii.xyz → Manage → **Advanced DNS**. Delete the parking records (`CNAME www → parkingpage.namecheap.com`, `URL Redirect @`), then add:

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `@` | your VPS IPv4 | Automatic |
| A Record | `www` | your VPS IPv4 | Automatic |

Leave any MX / TXT email records alone. Check it from your laptop: `dig +short akilii.xyz` should print the VPS IP.

## 2. First setup

Make the GitHub repo public (the competition needs it public anyway), then on the VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/Calebux/nimiq-circle/main/deploy/setup.sh -o setup.sh
sudo bash setup.sh you@example.com
```

It installs Node 22, nginx, certbot and a firewall, creates the `circle` user, clones to `/srv/akilii`, writes `/etc/circle/env` with fresh `SESSION_SECRET` and `CRON_SECRET`, builds, starts the `akilii` service and turns on HTTPS.

Then fill in the wallet keys and restart:

```bash
sudo nano /etc/circle/env      # POOL_ADDRESS, POOL_PRIVATE_KEY, Polygon + gas keys
sudo systemctl restart akilii
journalctl -u akilii -f        # refuses to start on weak secrets or dev flags, and says why
```

Then work through the operator checklist in `SECURITY.md` (offline key backup, cold wallet sweep, gas wallet).

## 3. Updates

The live server (`5.75.229.204`, ssh alias `hoursback-waba-gateway`) has no GitHub access, so updates go from the laptop. Commit, then:

```bash
bash deploy/ship.sh
```

(`deploy/update.sh` is for a server that can `git pull`.)

## Operator CLIs on the server

They read `.env.local`, so load the production env first:

```bash
cd /srv/akilii && sudo -u circle bash -c 'set -a; . /etc/circle/env; set +a; npm run pool -- status'
```
