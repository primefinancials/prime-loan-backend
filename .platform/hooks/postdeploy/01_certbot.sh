#!/bin/bash
# Postdeploy: (re)write the nginx HTTPS vhost then obtain/renew the Let's Encrypt
# cert. Runs here (not predeploy) because EB rebuilds /etc/nginx after predeploy,
# wiping anything a predeploy hook writes into conf.d.
set -euo pipefail
get_cfg() { /opt/elasticbeanstalk/bin/get-config environment -k "$1" 2>/dev/null || true; }
API_DOMAIN="$(get_cfg API_DOMAIN)"
[ -z "${API_DOMAIN}" ] && { echo "[certbot] API_DOMAIN not set - skip"; exit 0; }
LE_EMAIL="$(get_cfg LETSENCRYPT_EMAIL)"; LE_EMAIL="${LE_EMAIL:-info@primefinance.live}"

D=/var/app/current; [ -d "$D/scripts/eb" ] || D=/var/app/staging

# 1. Put the 80+443 server block in place and reload nginx (self-signed for now).
bash "$D/scripts/eb/https-setup.sh" vhost

# 2. ACME HTTP-01 challenge (port 80 now serves /.well-known/acme-challenge/).
mkdir -p /var/www/letsencrypt/.well-known/acme-challenge
chown -R nginx:nginx /var/www/letsencrypt 2>/dev/null || true

if certbot certonly --webroot -w /var/www/letsencrypt \
     -d "${API_DOMAIN}" --non-interactive --agree-tos -m "${LE_EMAIL}" \
     --keep-until-expiring \
     --deploy-hook "ln -sf /etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem /etc/nginx/ssl/current.crt; ln -sf /etc/letsencrypt/live/${API_DOMAIN}/privkey.pem /etc/nginx/ssl/current.key; systemctl reload nginx" ; then
  if [ -f "/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem" ]; then
    ln -sf "/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem" /etc/nginx/ssl/current.crt
    ln -sf "/etc/letsencrypt/live/${API_DOMAIN}/privkey.pem"   /etc/nginx/ssl/current.key
    nginx -t && systemctl reload nginx
    echo "[certbot] LE cert active for ${API_DOMAIN}"
  fi
else
  echo "[certbot] issuance failed (DNS not pointed / rate limit / port 80 blocked) - staying on self-signed; retries next deploy" >&2
fi

systemctl enable --now certbot-renew.timer 2>/dev/null || true
