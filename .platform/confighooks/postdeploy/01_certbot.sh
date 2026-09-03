#!/bin/bash
# Obtain / renew the Let's Encrypt cert for API_DOMAIN, then point nginx at it.
# Safe to run every deploy: --keep-until-expiring is a no-op if the cert is fresh.
set -euo pipefail
get_cfg() { /opt/elasticbeanstalk/bin/get-config environment -k "$1" 2>/dev/null || true; }
API_DOMAIN="$(get_cfg API_DOMAIN)"
[ -z "${API_DOMAIN}" ] && { echo "[certbot] API_DOMAIN not set - skip"; exit 0; }
LE_EMAIL="$(get_cfg LETSENCRYPT_EMAIL)"; LE_EMAIL="${LE_EMAIL:-info@primefinance.live}"

mkdir -p /var/www/letsencrypt/.well-known/acme-challenge

if certbot certonly --webroot -w /var/www/letsencrypt \
     -d "${API_DOMAIN}" --non-interactive --agree-tos -m "${LE_EMAIL}" \
     --keep-until-expiring --deploy-hook "ln -sf /etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem /etc/nginx/ssl/current.crt; ln -sf /etc/letsencrypt/live/${API_DOMAIN}/privkey.pem /etc/nginx/ssl/current.key; systemctl reload nginx" ; then
  # Ensure the symlinks point at the real cert even if the deploy-hook didn't fire.
  if [ -f "/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem" ]; then
    ln -sf "/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem" /etc/nginx/ssl/current.crt
    ln -sf "/etc/letsencrypt/live/${API_DOMAIN}/privkey.pem"   /etc/nginx/ssl/current.key
    nginx -t && systemctl reload nginx
    echo "[certbot] cert active for ${API_DOMAIN}"
  fi
else
  echo "[certbot] issuance failed (DNS not pointed yet? rate limit?) - staying on self-signed; will retry next deploy" >&2
fi

# certbot's systemd renew timer is installed with the package; make sure it's on.
systemctl enable --now certbot-renew.timer 2>/dev/null || true
