#!/bin/bash
set -e
D=/var/app/staging; [ -d "$D/scripts/eb" ] || D=/var/app/current
bash "$D/scripts/eb/https-setup.sh" prebuild
