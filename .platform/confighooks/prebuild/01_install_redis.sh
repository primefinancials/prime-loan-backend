#!/bin/bash
# Install and start a co-located Redis on the EB instance.
# Amazon Linux 2023 ships Redis as the `redis6` package (service: redis6).
# BullMQ + the app connect to redis://127.0.0.1:6379 (REDIS_URL env).
set -euo pipefail

echo "[hook] ensuring redis6 is installed and running"

if ! rpm -q redis6 >/dev/null 2>&1; then
  dnf install -y redis6
fi

CONF=/etc/redis6/redis6.conf
if [ -f "$CONF" ]; then
  # Bind to loopback only, disable protected-mode complaints, keep it lean.
  sed -i 's/^# *bind .*/bind 127.0.0.1 -::1/' "$CONF" || true
  sed -i 's/^bind .*/bind 127.0.0.1 -::1/' "$CONF" || true
  sed -i 's/^protected-mode .*/protected-mode yes/' "$CONF" || true
  # Cap memory so a runaway queue can't OOM the box; evict old keys if needed.
  grep -q '^maxmemory ' "$CONF" || echo 'maxmemory 256mb' >> "$CONF"
  grep -q '^maxmemory-policy ' "$CONF" || echo 'maxmemory-policy noeviction' >> "$CONF"
fi

systemctl enable redis6
systemctl restart redis6

# Wait for it to accept connections (max ~10s)
for i in $(seq 1 10); do
  if redis6-cli ping 2>/dev/null | grep -q PONG; then
    echo "[hook] redis6 is up"
    exit 0
  fi
  sleep 1
done

echo "[hook] WARNING: redis6 did not respond to PING in time" >&2
exit 0
