#!/bin/bash

# Launchpad Music Kiosk Launcher für Raspberry Pi
# Startet Chromium im Kiosk-Modus auf http://localhost:8080

export DISPLAY=:0
export XAUTHORITY=/home/pi/.Xauthority

# Warte auf den Server
sleep 3

# Starte Chromium im Kiosk-Modus
/usr/bin/chromium-browser \
  --kiosk \
  --no-first-run \
  --no-default-browser-check \
  --disable-translate \
  --disable-extensions \
  --disable-sync \
  --disable-plugins \
  --disable-default-apps \
  --disable-component-extensions-with-background-pages \
  --disable-background-networking \
  --disable-breakpad \
  --disable-client-side-phishing-detection \
  --disable-default-apps \
  --disable-device-discovery-notifications \
  --disable-hang-monitor \
  --disable-java \
  --disable-preconnect \
  --disable-prompt-on-repost \
  --disable-push-messaging \
  --disable-web-resources \
  --enable-features=NetworkService,NetworkServiceInProcess \
  --touch-events=enabled \
  http://localhost:8080
