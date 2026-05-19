# Launchpad Mini Layout

Browser-Prototyp fuer eine Launchpad-aehnliche Groovebox-Oberflaeche.

## Aktueller Funktionsumfang
- Quadratische Hardware-Ansicht mit:
	- Top-Buttons `1..8`
	- rechter Seite `A..H`
	- 8x8 Grid `A1..H8`
- Globaler Transport:
	- Play / Stop
	- BPM-Regler
	- Quantisierung auf `1/2`, `1 Beat` oder `1 Bar`
- Performance-Logik pro Grid-Pad:
	- gedrueckt halten: Ton spielt nur waehrend Hold
	- klicken: Latch an/aus (Dauerton)
	- Starts laufen quantisiert auf den naechsten Rasterpunkt
	- gelatchte Pads blinken
- Reihen-Status auf `A..H`:
	- idle: gruen
	- sobald in der Reihe etwas spielt: statisch rot
- Re-Assign pro Reihe:
	- Klick auf `A..H` im Idle-Zustand laedt naechste Track-Bank
	- beim Neu-Belegen laeuft eine Wellen-Animation durch die Reihe
- Sample-Playback:
	- die Pads ziehen ihre Sounds aus deinen lokalen Beats-Ordnern
	- pro Reihe gibt es mehrere Track-Banks mit WAV-Loops und One-Shots
	- beim Re-Assign wird eine neue Sample-Bank fuer die gesamte Reihe geladen
	- die Reihen starten musikalisch sortiert: Drums, Snare/Clap, Bass, Chords, Synth, Tops, Atmos/FX, Perc/Alt-Drums
	- jede Bank hat eine persistente, kategoriebasierte Track-ID
	- neue Tracks fuegst du in `sample-banks.js` als weitere Bank mit `category` und `trackKey` hinzu

## Architektur
- UI/Interaction/Audio-Logik: `script.js`
- Sample-Bank-Mapping: `sample-banks.js`
- Visuelles System und Animationen: `style.css`
- Markup-Struktur und Templates: `index.html`

Technische Detail-Doku: `LOGIK.md`

## Starten
Direkt im Browser oeffnen:
- `index.html`

Optional per lokalem Server:

```bash
python3 -m http.server 8080
```

Dann im Browser aufrufen:
- `http://localhost:8080`
