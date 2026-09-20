#!/usr/bin/env bash
# Richtet den AEVO Trainer als systemd-Dienst auf Port 3001 ein.
# Aufruf auf dem Server:   sudo bash deploy/install.sh
set -euo pipefail

DIENST=aevo-trainer
PROJEKT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENUTZER="${SUDO_USER:-$(id -un)}"
PORT="${PORT:-3001}"

echo "Projekt:  $PROJEKT"
echo "Benutzer: $BENUTZER"
echo "Port:     $PORT"

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "FEHLER: node nicht gefunden. Node.js 20 oder neuer installieren." >&2
  exit 1
fi
echo "Node:     $NODE ($("$NODE" --version))"

# Abhaengigkeiten installieren, falls noch nicht geschehen
if [ ! -d "$PROJEKT/node_modules" ]; then
  echo "Installiere Abhaengigkeiten ..."
  sudo -u "$BENUTZER" env -C "$PROJEKT" npm ci --omit=dev
fi

# Unit-Datei aus der Vorlage erzeugen, mit den tatsaechlichen Pfaden
UNIT="/etc/systemd/system/${DIENST}.service"
sed \
  -e "s|^User=.*|User=${BENUTZER}|" \
  -e "s|^Group=.*|Group=${BENUTZER}|" \
  -e "s|^WorkingDirectory=.*|WorkingDirectory=${PROJEKT}|" \
  -e "s|^Environment=PORT=.*|Environment=PORT=${PORT}|" \
  -e "s|^Environment=DATA_DIR=.*|Environment=DATA_DIR=${PROJEKT}/data|" \
  -e "s|^EnvironmentFile=.*|EnvironmentFile=-${PROJEKT}/.env|" \
  -e "s|^ExecStart=.*|ExecStart=${NODE} server.js|" \
  "$PROJEKT/deploy/aevo-trainer.service" > "$UNIT"

echo "Unit geschrieben: $UNIT"

systemctl daemon-reload
systemctl enable "$DIENST"
systemctl restart "$DIENST"
sleep 2

systemctl --no-pager --full status "$DIENST" || true
echo
echo "Fertig. Erreichbar unter http://localhost:${PORT}"
echo "Logs live:  journalctl -u ${DIENST} -f"
