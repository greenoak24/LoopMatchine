# Launchpad Music auf Raspberry Pi

## Vorbereitung

### 1. Raspberry Pi Grundsetup
```bash
# SSH ins Pi
ssh pi@raspberrypi.local

# System aktualisieren
sudo apt update && sudo apt upgrade -y

# Notwendige Pakete installieren
sudo apt install -y \
  nodejs npm \
  chromium-browser \
  pulseaudio alsa-utils \
  xserver-xorg x11-xserver-utils xinit \
  openbox \
  git
```

### 2. Audio konfigurieren
```bash
# ALSA-Mixer starten und Lautstärke anpassen
sudo alsamixer

# PulseAudio für Browsersound
sudo systemctl --user enable pulseaudio
sudo systemctl --user start pulseaudio
```

### 3. Projekt klonen/kopieren
```bash
# Projektordner vorbereiten
mkdir -p /home/pi/launchpad-music
cd /home/pi/launchpad-music

# Entweder klonen:
# git clone <repo> .

# Oder per SCP kopieren vom Dev-Rechner:
# scp -r /path/to/Launchpad\ Music/* pi@raspberrypi.local:/home/pi/launchpad-music/
```

### 4. Node-Dependencies installieren
```bash
cd /home/pi/launchpad-music
npm init -y
npm install
```

### 5. Systemd-Service einrichten
```bash
# Service-Datei kopieren
sudo cp launchpad-music.service /etc/systemd/system/

# Pfade in der Service-Datei überprüfen und ggf. anpassen
sudo nano /etc/systemd/system/launchpad-music.service

# Service aktivieren und starten
sudo systemctl daemon-reload
sudo systemctl enable launchpad-music
sudo systemctl start launchpad-music

# Status prüfen
sudo systemctl status launchpad-music
```

### 6. Kiosk-Autostart einrichten
```bash
# Kiosk-Skript ausführbar machen
chmod +x /home/pi/launchpad-music/kiosk.sh

# Autostart-Datei erstellen
mkdir -p /home/pi/.config/openbox
cat > /home/pi/.config/openbox/autostart.sh << 'EOF'
#!/bin/bash
# Starte Server im Hintergrund
/home/pi/launchpad-music/server.js &

# Warte kurz
sleep 2

# Starte Kiosk
/home/pi/launchpad-music/kiosk.sh
EOF

chmod +x /home/pi/.config/openbox/autostart.sh

# lightdm-Autostart
sudo cat > /etc/lightdm/lightdm.conf << 'EOF'
[seat:*]
session=openbox
user=pi
autologin-user=pi
autologin-user-timeout=0
EOF

sudo systemctl restart lightdm
```

### 7. Beim Boot direkt starten
```bash
# .bashrc anpassen
cat >> /home/pi/.bashrc << 'EOF'
if [ -z "$DISPLAY" ] && [ "$XDG_VTNR" -eq 1 ]; then
  startx
fi
EOF
```

## Betrieb

### Server manuell starten
```bash
cd /home/pi/launchpad-music
node server.js
```

### Logs prüfen
```bash
# Systemd-Logs
sudo journalctl -u launchpad-music -f

# Browser-Logs
tail -f /tmp/chromium-errors.log
```

### Restart
```bash
sudo systemctl restart launchpad-music
```

### Remote-Zugriff
```bash
# Vom Dev-Rechner aus:
ssh pi@raspberrypi.local

# Im Browser (vom gleichen Netzwerk):
# http://raspberrypi.local:8080
```

## Troubleshooting

### Audio funktioniert nicht
```bash
# PulseAudio-Status prüfen
pactl list short sinks

# ALSA-Mixer anpassen
alsamixer -c 0
```

### Server startet nicht
```bash
# Node installiert?
node --version

# Port 8080 frei?
sudo netstat -tlnp | grep 8080

# Pfade in server.js überprüfen
```

### Chromium geht nicht in den Kiosk-Modus
```bash
# Kiosk-Skript debuggen
bash -x /home/pi/launchpad-music/kiosk.sh
```

### Samples laden nicht
```bash
# Dateipfade überprüfen
ls -la /home/pi/launchpad-music/Beats/

# Server-Logs prüfen
sudo journalctl -u launchpad-music -n 50
```

## Performance-Tipps

- Disable HDMI-CEC für reduzierten Stromverbrauch und Latenz
- GPU-Memory erhöhen (raspi-config) auf 128 MB
- Swap reduzieren: `sudo swapon --show`
- CPU-Governor auf "performance" setzen
- USB-Geräte minimieren (nur Maus/Keyboard)

## Optional: MIDI-Hardware

Für direkten MIDI-Input vom Launchpad:
```bash
# MIDI-Tools installieren
sudo apt install -y alsa-tools jack2

# MIDI-Devices auflisten
aconnect -l

# Direkt im Browser: Web MIDI API verwenden (browser-abhängig)
```
