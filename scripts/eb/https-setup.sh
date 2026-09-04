#!/bin/bash
# Shared TLS setup for the EB backend. Idempotent. No-ops unless API_DOMAIN is set.
#
# Env (EB environment properties):
#   API_DOMAIN         required to enable TLS, e.g. api-staging.primefinance.live
#                      (must have an A record -> this instance's Elastic IP)
#   LETSENCRYPT_EMAIL  optional, defaults to info@primefinance.live
#
# Phases:
#   prebuild : install certbot + a self-signed fallback cert + the ACME webroot.
#   vhost    : (re)write the nginx 80+443 server block for API_DOMAIN.
#              MUST run in postdeploy - EB rebuilds /etc/nginx from
#              /var/proxy/staging/nginx between predeploy and start, which wipes
#              anything a predeploy hook drops into /etc/nginx/conf.d.
set -euo pipefail

PHASE="${1:-vhost}"
get_cfg() { /opt/elasticbeanstalk/bin/get-config environment -k "$1" 2>/dev/null || true; }

API_DOMAIN="$(get_cfg API_DOMAIN)"

NGINX_VHOST=/etc/nginx/conf.d/https.conf

if [ -z "${API_DOMAIN}" ]; then
  echo "[https] API_DOMAIN not set - backend stays HTTP-only"
  [ -f "$NGINX_VHOST" ] && rm -f "$NGINX_VHOST" && systemctl reload nginx 2>/dev/null || true
  exit 0
fi

if [ "$PHASE" = "prebuild" ]; then
  echo "[https] prebuild for ${API_DOMAIN}"
  command -v certbot >/dev/null 2>&1 || dnf install -y certbot
  mkdir -p /var/www/letsencrypt/.well-known/acme-challenge /etc/nginx/ssl
  chown -R nginx:nginx /var/www/letsencrypt 2>/dev/null || true

  if [ ! -f /etc/nginx/ssl/selfsigned.crt ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout /etc/nginx/ssl/selfsigned.key -out /etc/nginx/ssl/selfsigned.crt \
      -subj "/CN=${API_DOMAIN}" >/dev/null 2>&1
  fi
  if [ -f "/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem" ]; then
    ln -sf "/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem" /etc/nginx/ssl/current.crt
    ln -sf "/etc/letsencrypt/live/${API_DOMAIN}/privkey.pem"   /etc/nginx/ssl/current.key
  else
    ln -sf /etc/nginx/ssl/selfsigned.crt /etc/nginx/ssl/current.crt
    ln -sf /etc/nginx/ssl/selfsigned.key /etc/nginx/ssl/current.key
  fi
  echo "[https] prebuild done"
  exit 0
fi

# ---- vhost (default) ----
echo "[https] writing nginx vhost for ${API_DOMAIN}"
mkdir -p /var/www/letsencrypt/.well-known/acme-challenge
chown -R nginx:nginx /var/www/letsencrypt 2>/dev/null || true

cat > "$NGINX_VHOST" <<NGINX
# Managed by scripts/eb/https-setup.sh - do not edit by hand.
map \$http_upgrade \$prime_connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name ${API_DOMAIN};

    # ACME HTTP-01 challenge (certbot --webroot). Must win over the EB default
    # server block, which proxies everything to the app.
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type "text/plain";
        try_files \$uri =404;
    }

    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl;
    http2 on;
    server_name ${API_DOMAIN};

    ssl_certificate     /etc/nginx/ssl/current.crt;
    ssl_certificate_key /etc/nginx/ssl/current.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size 30M;
    client_body_timeout 120s;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # WebSocket upgrade (socket.io)
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$prime_connection_upgrade;

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;

        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_buffering off;
    }
}
NGINX

if nginx -t 2>/dev/null; then
  systemctl reload nginx 2>/dev/null || systemctl restart nginx
  echo "[https] vhost active (port 443 up on $( [ -f /etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem ] && echo 'LE cert' || echo 'self-signed' ))"
else
  echo "[https] nginx config test FAILED - reverting vhost" >&2
  rm -f "$NGINX_VHOST"
  nginx -t && systemctl reload nginx || true
  exit 1
fi
