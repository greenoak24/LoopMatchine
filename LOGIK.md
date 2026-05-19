# Logik-Dokumentation

Diese Datei beschreibt die aktuelle Laufzeitlogik des Prototyps.

## 1. Komponenten und Verantwortung

- `index.html`
  - Definiert die sichtbaren Bereiche (Top-Row, 8x8 Grid, Side-Row).
  - Enthält Templates fuer Top-, Grid- und Side-Buttons.
- `style.css`
  - Definiert Farben, States und Animationen.
  - Wichtige Klassen: `is-lit`, `is-latched`, `row-idle`, `row-playing`, `row-reassigning`, `is-reassign-wave`.
- `script.js`
  - Baut die Buttons aus Templates auf.
  - Verwaltet Audio (Web Audio API fuer Top-Buttons plus HTMLAudioElement fuer Samples).
  - Verwaltet State fuer Hold/Latch/Row-Status.
  - Implementiert Re-Assign mit Track-Banks und Reihen-Welle.
  - Implementiert globalen Transport mit BPM und Quantisierung.
- `sample-banks.js`
  - Enthält die Sample-Bank-Definitionen fuer die lokalen Beats.
  - Jede Bank liefert 8 Sample-Pfade fuer eine Reihe.

## 2. Datenmodelle in script.js

- `buttonState: WeakMap<HTMLButtonElement, State>`
  - Speichert pro Button:
    - `frequency`, `waveform`, `samplePath`
    - `row`, `col`
    - `playing`, `latched`, `pointerDown`
    - `oscillator`, `gainNode`, `audioElement`
- `rowIndicators: HTMLButtonElement[8]`
  - Referenzen auf Side-Buttons `A..H`.
- `rowActiveVoiceCount: number[8]`
  - Zaehlt, wie viele aktive Stimmen in einer Reihe laufen.
  - Steuert visuell `row-idle` (gruen) vs `row-playing` (rot).
- `rowTrackIndex: number[8]`
  - Aktiver Track-Bank-Index pro Reihe.
  - Initiale Reihenbelegung startet bei `0..7`, also jede Reihe mit einer eigenen Bank.
- `rowButtons: HTMLButtonElement[8][]`
  - Direkte Referenzen auf die 8 Grid-Buttons einer Reihe.

## 3. Globaler Transport und Quantisierung

- Transport-Controls:
  - `Play`
  - `Stop`
  - `BPM`
  - `Quantize`
- `transportRunning`
  - bestimmt, ob neue Starts auf das Raster gelegt werden
- `transportBpm`
  - bestimmt die Dauer eines Beats
- `transportQuantizeBeats`
  - bestimmt das Quantisierungsraster in Beats
- `transportStartedAt`
  - Referenzzeitpunkt fuer die aktuelle Transportphase

### Quantisierte Starts

- Alle Pad-Starts laufen ueber `queueStart(button)`.
- Der Start wird auf den naechsten Quantisierungs-Punkt verschoben.
- Solange ein Start nur geplant, aber noch nicht aktiv ist, bekommt der Button `is-waiting`.
- Wenn der Transport gestoppt ist, bleiben Starts als Queue-Wunsch erhalten und werden beim Wiedereinschalten wieder auf das Raster gelegt.

## 4. Audio-Engine (minimal)

- Audio wird lazy initialisiert in `ensureAudio()`.
- Signalweg pro Stimme:
  - `OscillatorNode` -> `GainNode` -> `masterGain` -> `destination`
- Start in `startTone(button)`:
  - startet Oscillator mit Waveform aus dem Button-State
  - schnelle Attack-Huellkurve
  - setzt `playing = true`
  - erhoeht Row-Playback-Counter
- Stop in `stopTone(button)`:
  - kurze Release-Huellkurve
  - stoppt Oscillator
  - setzt `playing = false`
  - verringert Row-Playback-Counter

### Sample-Playback fuer Grid-Pads

- Wenn ein Pad eine `samplePath` besitzt, wird statt des Oszillators ein `HTMLAudioElement` benutzt.
- Beim Start:
  - Audio-Element wird erzeugt oder wiederverwendet
  - `loop = true`
  - Quelle wird auf den Sample-Pfad gesetzt
  - `play()` startet die Datei sofort
- Beim Stop:
  - `pause()`
  - `currentTime = 0`

Damit verhalten sich die Pads wie Loop-Launcher fuer lokale WAV-Dateien.

## 5. Input-Logik pro Grid-Pad

Jeder Grid-Button bekommt via `bindPerformanceBehavior(...)` Pointer- und Click-Handler.

### Hold-Verhalten

- `pointerdown`:
  - `pointerDown = true`
  - visueller Pulse
  - `startTone(...)`
- `pointerup` / `pointercancel` / `pointerleave`:
  - `pointerDown = false`
  - `releaseIfNeeded(...)` stoppt den Ton nur, wenn nicht gelatcht

### Click/Latch-Verhalten

- `click` toggelt `latched`.
- Beim Aktivieren:
  - Ton startet (falls nicht schon aktiv)
  - Button bekommt `is-latched` + `is-lit`
- Beim Deaktivieren:
  - wenn kein Hold aktiv ist, Ton stoppt

## 6. Reihenstatus A-H

- Funktion `adjustRowPlayback(row, delta)` pflegt `rowActiveVoiceCount`.
- `updateRowIndicator(row)` setzt CSS-State:
  - `row-idle`, wenn Counter = 0
  - `row-playing`, wenn Counter > 0
- Ergebnis:
  - A-H sind gruen bei Stille
  - A-H sind rot, sobald in der Reihe etwas spielt

## 7. Re-Assign (Neu-Belegen)

### Trigger

- Klick auf Side-Button `A..H` ruft `reassignRow(row)`.

### Guard

- Wenn in der Reihe gerade etwas spielt (`rowActiveVoiceCount[row] > 0`):
  - kein Re-Assign, nur kurzer Pulse als Feedback

### Erfolgreiches Re-Assign

1. `rowTrackIndex[row]` wird zyklisch erhoeht
2. `applyTrackToRow(row)` schreibt neue Sample-Pfade in die 8 Pads der Reihe
  - Pads behalten ihre Position `A1..H8`
  - der neue Track-Sound kommt aus einer anderen Sample-Bank
3. `playRowReassignWave(row)`
   - Side-Button bekommt kurz `row-reassigning`
   - Grid-Pads der Reihe animieren zeitversetzt von links nach rechts

## 8. Track-Banks

- Definiert in `sample-banks.js`:
  - `name`
  - `waveform`
  - `samples[8]`
- Jede Bank greift auf einen anderen Beat-/Bass-/Chord-/FX-Ordner aus dem lokalen `Beats`-Verzeichnis zu.
- `applyTrackToRow(row)` schreibt fuer alle 8 Pads einer Reihe die Sample-Pfade aus der aktiven Bank.
- Beim Re-Assign wird nur die Bank gewechselt, nicht die Button-Position.
- Reihenfolge der Bänke beim Start:
  - Drums
  - Snare / Clap
  - Bass
  - Chords
  - Synth
  - Tops
  - Atmos / FX
  - Perc / Alt Drums

## 9. Initialisierung

Beim Start:

1. `buildTopRow()`
2. `buildSideRow()`
3. `buildMainGrid()`
4. In `buildMainGrid()` wird fuer jede Reihe einmal `applyTrackToRow(row)` ausgefuehrt

Danach ist das System sofort spielbar.

## 10. Erweiterungspunkte

- Persistente Scenes/Projects (Track-Bank pro Reihe speichern/laden)
- Sample-Playback statt Oszillatoren
- Quantisierung/Global Transport
- MIDI-In/MIDI-Out zur Hardware-Synchronisation
- Performance-Schutz:
  - maximale gleichzeitige Stimmen
  - Master-Limiter / Soft-Clip
