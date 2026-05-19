const topRow = document.getElementById("topRow");
const sideRow = document.getElementById("sideRow");
const mainGrid = document.getElementById("mainGrid");

const topTemplate = document.getElementById("topTemplate");
const sideTemplate = document.getElementById("sideTemplate");
const gridTemplate = document.getElementById("gridTemplate");
const transportPlayButton = document.getElementById("transportPlay");
const transportStopButton = document.getElementById("transportStop");
const midiConnectButton = document.getElementById("midiConnect");
const transportBpmInput = document.getElementById("transportBpm");
const transportBpmValue = document.getElementById("transportBpmValue");
const transportQuantizeSelect = document.getElementById("transportQuantize");
const transportStatus = document.getElementById("transportStatus");
const metronomeButton = document.querySelector(".logo-button");

const topLabels = ["1", "2", "3", "4", "5", "6", "7", "8"];
const sideLabels = ["A", "B", "C", "D", "E", "F", "G", "H"];
const sideDescriptions = [
  "Drums",
  "Snare / Clap",
  "Bass",
  "Chords",
  "Synth",
  "Tops",
  "Atmos / FX",
  "Perc / Alt Drums"
];
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const rowHues = [192, 3, 214, 287, 42, 165, 332, 32];
const midiSemanticColors = {
  waiting: 13,
  rowIdle: 21,
  rowPlaying: 5,
  reassign: 63
};
const midiHuePalettes = [
  { hue: 0, dim: 5, active: 7, pulse: 15, downbeat: 14 },
  { hue: 32, dim: 9, active: 60, pulse: 63, downbeat: 62 },
  { hue: 48, dim: 13, active: 63, pulse: 62, downbeat: 60 },
  { hue: 150, dim: 17, active: 21, pulse: 63, downbeat: 62 },
  { hue: 190, dim: 25, active: 27, pulse: 31, downbeat: 30 },
  { hue: 214, dim: 37, active: 53, pulse: 59, downbeat: 58 },
  { hue: 285, dim: 49, active: 51, pulse: 55, downbeat: 54 },
  { hue: 330, dim: 53, active: 55, pulse: 63, downbeat: 62 }
];
const SAMPLE_METADATA = window.SAMPLE_METADATA || {};
const TRACK_DB_STORAGE_KEY = "launchpadTrackDatabase";
const ROW_TRACK_INDEX_STORAGE_KEY = "launchpadRowTrackIndex";

function slugify(value, fallback = "track") {
  return String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function loadJsonStorage(key, fallbackValue) {
  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
      return fallbackValue;
    }

    return JSON.parse(rawValue);
  } catch {
    return fallbackValue;
  }
}

function saveJsonStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private mode; the app still works without persistence.
  }
}

const trackDatabase = loadJsonStorage(TRACK_DB_STORAGE_KEY, {
  version: 1,
  tracks: {},
  counters: {}
});

function saveTrackDatabase() {
  saveJsonStorage(TRACK_DB_STORAGE_KEY, trackDatabase);
}

function ensureTrackRecord(bank, index) {
  const trackKey = bank.trackKey || slugify(`${bank.category || bank.name}-${index + 1}`);
  const existingRecord = trackDatabase.tracks[trackKey];
  if (existingRecord) {
    return existingRecord;
  }

  const categorySlug = slugify(bank.category || bank.name || "track");
  const nextNumber = Number(trackDatabase.counters[categorySlug] || 0) + 1;
  trackDatabase.counters[categorySlug] = nextNumber;

  const record = {
    trackKey,
    category: categorySlug,
    trackId: `${categorySlug}-${String(nextNumber).padStart(3, "0")}`,
    name: bank.name || `Track ${index + 1}`
  };

  trackDatabase.tracks[trackKey] = record;
  saveTrackDatabase();
  return record;
}

const TRACK_BANKS = (window.SAMPLE_BANKS || []).map((bank, index) => ({
  ...bank,
  ...ensureTrackRecord(bank, index)
}));

const ROW_CATEGORY_FILTERS = [
  new Set(["drums", "perc", "perc-alt-drums"]),
  new Set(["clap", "snare", "snare-clap"]),
  new Set(["bass"]),
  new Set(["chords"]),
  new Set(["synth"]),
  new Set(["tops"]),
  new Set(["atmos-fx"]),
  new Set(["perc", "perc-alt-drums"])
];

let audioContext;
let masterGain;
let buttonCounter = 0;
let transportRunning = false;
let transportBpm = Number(transportBpmInput.value);
let transportQuantizeBeats = Number(transportQuantizeSelect.value);
let transportStartedAt = performance.now();
let samplesPreloaded = false;
let metronomeEnabled = false;
let metronomeBeat = 0;
let metronomeTimer = null;
let loopResyncTimer = null;
let midiLedPulseTimer = null;
let midiLedPulseBeat = 0;
let midiAccess = null;
let midiOutput = null;
let lastMidiMessage = "not connected";
const midiEventLog = [];
const midiNoteToCell = new Map();
const midiCellToNote = new Map();
const midiSideNoteToRow = new Map();
const midiCcToTopIndex = new Map();

window.lastMidiEvents = midiEventLog;

const buttonState = new WeakMap();
const rowIndicators = new Array(8);
const rowActiveVoiceCount = new Array(8).fill(0);
const sampleBufferCache = new Map();
const rowTrackIndex = loadJsonStorage(ROW_TRACK_INDEX_STORAGE_KEY, Array.from({ length: 8 }, (_, index) => index))
  .slice(0, 8)
  .map((value, index) => {
    const normalizedValue = Number(value);
    if (!Number.isFinite(normalizedValue) || TRACK_BANKS.length === 0) {
      return index;
    }

    return ((normalizedValue % TRACK_BANKS.length) + TRACK_BANKS.length) % TRACK_BANKS.length;
  });
const rowButtons = Array.from({ length: 8 }, () => []);

saveJsonStorage(ROW_TRACK_INDEX_STORAGE_KEY, rowTrackIndex);

function tracksForRow(row) {
  const allowedCategories = ROW_CATEGORY_FILTERS[row] || new Set();
  const filteredTracks = TRACK_BANKS.filter((track) => allowedCategories.has(track.category));
  return filteredTracks.length > 0 ? filteredTracks : TRACK_BANKS;
}

function pulse(button) {
  button.classList.add("is-active");
  window.setTimeout(() => {
    button.classList.remove("is-active");
  }, 120);
}

function updateTransportStatus() {
  transportBpmValue.value = String(transportBpm);
  const audioState = audioContext ? audioContext.state : "locked";
  const metronomeState = metronomeEnabled ? "on" : "off";
  const midiState = midiAccess ? `MIDI: ${lastMidiMessage}` : "MIDI: off";
  const activeRates = rowButtons
    .flat()
    .map((button) => buttonState.get(button))
    .filter((state) => state?.playing && state.samplePath)
    .map((state) => `${sideLabels[state.row]}${state.col + 1}:${playbackRateForSample(state.samplePath).toFixed(2)}x`);
  const rateText = activeRates.length > 0 ? ` · ${activeRates.slice(0, 3).join(" ")}` : "";
  transportStatus.textContent = transportRunning
    ? `Sync: running at ${transportBpm} BPM · Audio: ${audioState} · Metro: ${metronomeState} · ${midiState}${rateText}`
    : `Sync: stopped at ${transportBpm} BPM · Audio: ${audioState} · Metro: ${metronomeState} · ${midiState}${rateText}`;
}

function beatDurationMs() {
  return 60000 / transportBpm;
}

function quantumDurationMs() {
  return beatDurationMs() * transportQuantizeBeats;
}

function timeIntoTransportMs() {
  return performance.now() - transportStartedAt;
}

function transportElapsedSeconds() {
  return transportRunning ? timeIntoTransportMs() / 1000 : 0;
}

function transportElapsedBeats() {
  return transportElapsedSeconds() * (transportBpm / 60);
}

function timeUntilNextQuantumMs() {
  const quantum = quantumDurationMs();
  const remainder = timeIntoTransportMs() % quantum;
  return remainder === 0 ? quantum : quantum - remainder;
}

function timeUntilNextBeatMs() {
  const beat = beatDurationMs();
  const elapsed = timeIntoTransportMs();
  const remainder = elapsed % beat;
  return remainder === 0 ? beat : beat - remainder;
}

function extractSampleBpm(samplePath) {
  const analyzedBpm = SAMPLE_METADATA[samplePath]?.bpm;
  if (Number.isFinite(analyzedBpm)) {
    return analyzedBpm;
  }

  const fileName = samplePath.split("/").pop() || "";
  const explicitMatch =
    fileName.match(/(\d{2,3})[-_\s]*bpm/i) ||
    fileName.match(/bpm[-_\s]*(\d{2,3})/i);

  if (explicitMatch) {
    return Number(explicitMatch[1]);
  }

  const tokens = [...fileName.matchAll(/(?:^|[-_\s])(\d{3})(?=[-_\s.]|$)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 80 && value <= 180);

  if (tokens.length === 0) {
    return null;
  }

  return tokens[tokens.length - 1];
}

function roundedLoopBeats(duration, sampleBpm) {
  const rawBeats = duration * (sampleBpm / 60);
  const roundedBeats = Math.max(1, Math.round(rawBeats));
  const roundedBars = Math.max(1, Math.round(rawBeats / 4)) * 4;

  return Math.abs(rawBeats - roundedBars) < 0.35 ? roundedBars : roundedBeats;
}

function loopOffsetForBuffer(sampleBuffer, samplePath) {
  if (!sampleBuffer || sampleBuffer.duration <= 0) {
    return 0;
  }

  const sampleBpm = extractSampleBpm(samplePath);
  if (!sampleBpm) {
    return transportElapsedSeconds() % sampleBuffer.duration;
  }

  const analyzedLoopBeats = SAMPLE_METADATA[samplePath]?.loopBeats;
  const loopBeats = Number.isFinite(analyzedLoopBeats)
    ? analyzedLoopBeats
    : roundedLoopBeats(sampleBuffer.duration, sampleBpm);
  const offsetBeats = transportElapsedBeats() % loopBeats;
  return (offsetBeats * 60) / sampleBpm;
}

function playbackRateForSample(samplePath) {
  const sampleBpm = extractSampleBpm(samplePath);
  return sampleBpm ? transportBpm / sampleBpm : 1;
}

function startSampleSource(button, state, sampleBuffer, countPlayback = true) {
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();

  source.buffer = sampleBuffer;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = sampleBuffer.duration;
  const playbackRate = playbackRateForSample(state.samplePath);
  source.playbackRate.value = playbackRate;
  source.playbackRate.setValueAtTime(playbackRate, audioContext.currentTime);
  gain.gain.value = 0.95;
  source.connect(gain);
  gain.connect(masterGain);
  source.start(audioContext.currentTime, loopOffsetForBuffer(sampleBuffer, state.samplePath));

  state.source = source;
  state.gainNode = gain;
  state.playing = true;

  if (countPlayback) {
    adjustRowPlayback(state.row, 1);
  }

  button.classList.add("is-lit");
  if (countPlayback && typeof state.row === "number" && typeof state.col === "number") {
    updateMidiPadLed(state.row, state.col);
    startMidiLedPulseClock();
  }
}

function stopSampleSource(state) {
  if (!state.source) {
    return;
  }

  try {
    state.source.stop();
  } catch {
    // A source may already be stopped by the audio engine during a rapid restart.
  }

  state.source.disconnect();
  state.gainNode.disconnect();
  state.source = null;
  state.gainNode = null;
}

function refreshGridDebugText() {
  for (let row = 0; row < 8; row += 1) {
    applyTrackToRow(row);
  }
}

function restartActiveSampleSources() {
  if (!audioContext) {
    return;
  }

  rowButtons.flat().forEach((button) => {
    const state = buttonState.get(button);
    if (state?.source && state.samplePath) {
      loadSampleBuffer(state.samplePath).then((sampleBuffer) => {
        if (!state.playing) {
          return;
        }

        stopSampleSource(state);
        startSampleSource(button, state, sampleBuffer, false);
      });
    }
  });
}

function hasActiveSampleSources() {
  return rowButtons.flat().some((button) => {
    const state = buttonState.get(button);
    return Boolean(state?.source && state.playing && state.samplePath);
  });
}

function startLoopResyncClock() {
  if (loopResyncTimer) {
    window.clearTimeout(loopResyncTimer);
    loopResyncTimer = null;
  }

  if (!transportRunning) {
    return;
  }

  const tick = () => {
    if (!transportRunning) {
      loopResyncTimer = null;
      return;
    }

    if (hasActiveSampleSources()) {
      restartActiveSampleSources();
    }

    loopResyncTimer = window.setTimeout(tick, Math.max(1, timeUntilNextBeatMs()));
  };

  loopResyncTimer = window.setTimeout(tick, Math.max(1, timeUntilNextBeatMs()));
}

function stopLoopResyncClock() {
  if (loopResyncTimer) {
    window.clearTimeout(loopResyncTimer);
    loopResyncTimer = null;
  }
}

function urlForSamplePath(samplePath) {
  return samplePath.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function loadSampleBuffer(samplePath) {
  if (sampleBufferCache.has(samplePath)) {
    return sampleBufferCache.get(samplePath);
  }

  const bufferPromise = fetch(urlForSamplePath(samplePath))
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load sample: ${samplePath}`);
      }

      return response.arrayBuffer();
    })
    .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer));

  sampleBufferCache.set(samplePath, bufferPromise);
  return bufferPromise;
}

function preloadAssignedSamples() {
  if (samplesPreloaded || !audioContext) {
    return;
  }

  samplesPreloaded = true;
  const samplePaths = new Set();

  rowButtons.flat().forEach((button) => {
    const state = buttonState.get(button);
    if (state && state.samplePath) {
      samplePaths.add(state.samplePath);
    }
  });

  samplePaths.forEach((samplePath) => {
    loadSampleBuffer(samplePath).catch(() => {});
  });
}

function midiName(port) {
  return [port.manufacturer, port.name].filter(Boolean).join(" ") || "MIDI device";
}

function cellKey(row, col) {
  return `${row}:${col}`;
}

function buildMidiMaps() {
  midiNoteToCell.clear();
  midiCellToNote.clear();
  midiSideNoteToRow.clear();
  midiCcToTopIndex.clear();

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const note = row * 16 + col;
      midiNoteToCell.set(note, { row, col });
      midiCellToNote.set(cellKey(row, col), note);
    }
  }

  for (let index = 0; index < 8; index += 1) {
    midiCcToTopIndex.set(104 + index, index);
  }

  for (let row = 0; row < 8; row += 1) {
    midiSideNoteToRow.set(row * 16 + 8, row);
  }
}

function noteForLaunchpadCell(row, col) {
  return midiCellToNote.get(cellKey(row, col));
}

function launchpadCellFromNote(note) {
  return midiNoteToCell.get(note) || null;
}

function launchpadSideRowFromNote(note) {
  return midiSideNoteToRow.has(note) ? midiSideNoteToRow.get(note) : null;
}

function launchpadTopIndexFromCc(cc) {
  return midiCcToTopIndex.has(cc) ? midiCcToTopIndex.get(cc) : null;
}

function sendMidiNote(note, velocity) {
  if (!midiOutput || typeof note !== "number") {
    return;
  }

  midiOutput.send([0x90, note, velocity]);
}

function hueDistance(a, b) {
  const diff = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return diff;
}

function midiPaletteForCell(row, col) {
  const baseHue = (rowHues[row] + col * 3) % 360;
  return midiHuePalettes.reduce((closest, palette) => (
    hueDistance(baseHue, palette.hue) < hueDistance(baseHue, closest.hue) ? palette : closest
  ), midiHuePalettes[0]);
}

function midiPadVelocity(row, col, options = {}) {
  const button = rowButtons[row]?.[col];
  const state = button ? buttonState.get(button) : null;
  const palette = midiPaletteForCell(row, col);
  const isWaiting = Boolean(state?.transportQueued || button?.classList.contains("is-waiting"));
  const isPlaying = Boolean(state?.playing);
  const isLatched = Boolean(state?.latched || button?.classList.contains("is-latched"));

  if (options.reassign) {
    return midiSemanticColors.reassign;
  }

  if (options.pulse) {
    return options.downbeat ? palette.downbeat : palette.pulse;
  }

  if (isWaiting) {
    return midiSemanticColors.waiting;
  }

  if (isPlaying) {
    return palette.active;
  }

  if (isLatched) {
    return midiSemanticColors.waiting;
  }

  return palette.dim;
}

function midiSideVelocity(row, options = {}) {
  const indicator = rowIndicators[row];
  const isReassigning = Boolean(options.reassign || indicator?.classList.contains("row-reassigning"));
  const isPlaying = Boolean(rowActiveVoiceCount[row] > 0 || indicator?.classList.contains("row-playing"));

  if (isReassigning) {
    return midiSemanticColors.reassign;
  }

  return isPlaying ? midiSemanticColors.rowPlaying : midiSemanticColors.rowIdle;
}

function renderMidiPad(row, col, options = {}) {
  sendMidiNote(noteForLaunchpadCell(row, col), midiPadVelocity(row, col, options));
}

function renderMidiSide(row, options = {}) {
  sendMidiNote(row * 16 + 8, midiSideVelocity(row, options));
}

function updateMidiPadLed(row, col) {
  renderMidiPad(row, col);
}

function updateMidiSideLed(row) {
  renderMidiSide(row);
}

function pulseMidiPlayingLeds(isDownbeat = false) {
  rowButtons.forEach((buttons, row) => {
    buttons.forEach((button, col) => {
      const state = buttonState.get(button);
      if (!state?.playing) {
        return;
      }

      renderMidiPad(row, col, { pulse: true, downbeat: isDownbeat });
      window.setTimeout(() => renderMidiPad(row, col), 95);
    });
  });
}

function startMidiLedPulseClock() {
  if (midiLedPulseTimer) {
    return;
  }

  const tick = () => {
    if (!hasActiveSampleSources()) {
      midiLedPulseTimer = null;
      midiLedPulseBeat = 0;
      refreshMidiGridLeds();
      return;
    }

    const beatIndex = transportRunning ? Math.floor(transportElapsedBeats()) : midiLedPulseBeat;
    pulseMidiPlayingLeds(beatIndex % 4 === 0);
    midiLedPulseBeat = (midiLedPulseBeat + 1) % 4;
    midiLedPulseTimer = window.setTimeout(tick, transportRunning ? Math.max(1, timeUntilNextBeatMs()) : beatDurationMs());
  };

  if (transportRunning) {
    midiLedPulseTimer = window.setTimeout(tick, Math.max(1, timeUntilNextBeatMs()));
    return;
  }

  tick();
}

function stopMidiLedPulseClockIfIdle() {
  if (hasActiveSampleSources()) {
    return;
  }

  if (midiLedPulseTimer) {
    window.clearTimeout(midiLedPulseTimer);
    midiLedPulseTimer = null;
  }

  midiLedPulseBeat = 0;
  refreshMidiGridLeds();
}

function refreshMidiGridLeds() {
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      updateMidiPadLed(row, col);
    }
    updateMidiSideLed(row);
  }
}

function triggerGridButtonFromMidi(row, col) {
  const button = rowButtons[row]?.[col];
  if (!button) {
    return;
  }

  pulse(button);
  toggleLatch(button);
  updateMidiPadLed(row, col);
}

function handleMidiMessage(event) {
  const [status, data1, data2] = event.data;
  const command = status & 0xf0;
  const channel = status & 0x0f;
  const isNoteOn = command === 0x90 && data2 > 0;
  const isControlChange = command === 0xb0;
  const type = command === 0x90 ? "note" : command === 0xb0 ? "cc" : `0x${command.toString(16)}`;

  const mappedCell = launchpadCellFromNote(data1);
  const mappedSideRow = launchpadSideRowFromNote(data1);
  const mappedTopIndex = isControlChange ? launchpadTopIndexFromCc(data1) : null;
  const mappedLabel = mappedCell
    ? `${sideLabels[mappedCell.row]}${mappedCell.col + 1}`
    : typeof mappedSideRow === "number"
      ? `${sideLabels[mappedSideRow]} side`
      : typeof mappedTopIndex === "number"
        ? `top ${mappedTopIndex + 1}`
        : "unmapped";

  midiEventLog.unshift({
    type,
    channel: channel + 1,
    data1,
    data2,
    mapped: mappedLabel,
    device: midiName(event.target)
  });
  midiEventLog.splice(16);

  lastMidiMessage = `${type} ch${channel + 1} ${data1}:${data2} -> ${mappedLabel}`;
  updateTransportStatus();

  if (!isNoteOn && !isControlChange) {
    return;
  }

  const cell = launchpadCellFromNote(data1);
  if (cell) {
    triggerGridButtonFromMidi(cell.row, cell.col);
    return;
  }

  const sideRow = launchpadSideRowFromNote(data1);
  if (typeof sideRow === "number") {
    reassignRow(sideRow);
    return;
  }

  const topIndex = isControlChange ? launchpadTopIndexFromCc(data1) : null;
  if (isControlChange && typeof topIndex === "number") {
    const topButton = topRow.querySelectorAll(".button")[topIndex];
    topButton?.click();
  }
}

function selectMidiOutput(access) {
  const outputs = [...access.outputs.values()];
  return outputs.find((output) => /launchpad/i.test(midiName(output))) || outputs[0] || null;
}

function bindMidiInputs(access) {
  [...access.inputs.values()].forEach((input) => {
    input.onmidimessage = handleMidiMessage;
  });
}

function handleMidiStateChange() {
  if (!midiAccess) {
    return;
  }

  bindMidiInputs(midiAccess);
  midiOutput = selectMidiOutput(midiAccess);
  lastMidiMessage = `connected ${[...midiAccess.inputs.values()].length} in / ${[...midiAccess.outputs.values()].length} out`;
  midiConnectButton.classList.toggle("is-connected", [...midiAccess.inputs.values()].length > 0);
  updateTransportStatus();
  refreshMidiGridLeds();
}

async function connectMidi() {
  if (!navigator.requestMIDIAccess) {
    lastMidiMessage = "Web MIDI unavailable";
    updateTransportStatus();
    return;
  }

  midiAccess = await navigator.requestMIDIAccess({ sysex: false });
  midiAccess.onstatechange = handleMidiStateChange;
  handleMidiStateChange();
}

function playMetronomeClick(isDownbeat = false) {
  if (!ensureAudio()) {
    return;
  }

  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.type = "square";
  osc.frequency.setValueAtTime(isDownbeat ? 1380 : 920, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(isDownbeat ? 0.22 : 0.14, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.065);

  metronomeButton.classList.add("is-ticking");
  window.setTimeout(() => metronomeButton.classList.remove("is-ticking"), 70);
}

function startMetronomeClock(reset = true) {
  if (metronomeTimer) {
    window.clearTimeout(metronomeTimer);
    metronomeTimer = null;
  }

  if (!metronomeEnabled || !transportRunning) {
    return;
  }

  if (reset) {
    metronomeBeat = 0;
  }

  const tick = () => {
    if (!metronomeEnabled || !transportRunning) {
      metronomeTimer = null;
      return;
    }

    const currentBeat = Math.floor(transportElapsedBeats());
    playMetronomeClick(currentBeat % 4 === 0);
    metronomeBeat = (currentBeat + 1) % 4;
    metronomeTimer = window.setTimeout(tick, Math.max(1, timeUntilNextBeatMs()));
  };

  if (reset && timeIntoTransportMs() < 25) {
    tick();
    return;
  }

  metronomeTimer = window.setTimeout(tick, Math.max(1, timeUntilNextBeatMs()));
}

function stopMetronomeClock() {
  if (metronomeTimer) {
    window.clearTimeout(metronomeTimer);
    metronomeTimer = null;
  }
}

function updateMetronomeButton() {
  metronomeButton.classList.toggle("is-metronome-on", metronomeEnabled);
  metronomeButton.setAttribute("aria-pressed", String(metronomeEnabled));
  metronomeButton.setAttribute("aria-label", metronomeEnabled ? "Metronome on" : "Metronome off");
}

function toggleMetronome() {
  metronomeEnabled = !metronomeEnabled;
  updateMetronomeButton();
  updateTransportStatus();

  if (metronomeEnabled) {
    if (!transportRunning) {
      startTransport();
      return;
    }

    startMetronomeClock(true);
    return;
  }

  stopMetronomeClock();
}

function clearQueuedStart(button) {
  const state = buttonState.get(button);
  if (!state) {
    return;
  }

  if (state.pendingStartTimeout) {
    window.clearTimeout(state.pendingStartTimeout);
    state.pendingStartTimeout = null;
  }

  state.transportQueued = false;
  button.classList.remove("is-waiting");
  if (typeof state.row === "number" && typeof state.col === "number") {
    updateMidiPadLed(state.row, state.col);
  }
}

function queueStart(button) {
  const state = buttonState.get(button);
  if (!state || state.playing) {
    return;
  }

  state.transportQueued = true;

  if (!transportRunning) {
    button.classList.add("is-waiting");
    if (typeof state.row === "number" && typeof state.col === "number") {
      updateMidiPadLed(state.row, state.col);
    }
    return;
  }

  if (state.pendingStartTimeout) {
    return;
  }

  const delay = timeUntilNextQuantumMs();
  button.classList.add("is-waiting");
  if (typeof state.row === "number" && typeof state.col === "number") {
    updateMidiPadLed(state.row, state.col);
  }
  state.pendingStartTimeout = window.setTimeout(() => {
    state.pendingStartTimeout = null;
    button.classList.remove("is-waiting");
    if (typeof state.row === "number" && typeof state.col === "number") {
      updateMidiPadLed(state.row, state.col);
    }
    if (transportRunning && state.transportQueued && !state.playing) {
      startTone(button);
    }
  }, delay);
}

function scheduleQueuedStarts(immediate = false) {
  const buttons = [...rowButtons.flat(), ...Array.from(topRow.querySelectorAll(".button"))];
  buttons.forEach((button) => {
    const state = buttonState.get(button);
    if (state && state.transportQueued && !state.playing) {
      if (immediate) {
        startTone(button);
        return;
      }

      queueStart(button);
    }
  });
}

function stopAllPlaying() {
  const buttons = [...rowButtons.flat(), ...Array.from(topRow.querySelectorAll(".button"))];
  buttons.forEach((button) => {
    const state = buttonState.get(button);
    if (!state) {
      return;
    }

    clearQueuedStart(button);
    if (state.playing) {
      stopTone(button);
      button.classList.remove("is-lit");
    }
  });
}

function startTransport() {
  const audioReady = ensureAudio();
  transportRunning = true;
  transportStartedAt = performance.now();
  updateTransportStatus();
  scheduleQueuedStarts(true);
  startMetronomeClock(true);
  startLoopResyncClock();
  startMidiLedPulseClock();

  if (!audioReady) {
    return;
  }

  audioContext.resume().then(() => {
    updateTransportStatus();
  });
}

function stopTransport() {
  transportRunning = false;
  updateTransportStatus();
  stopAllPlaying();
  stopMetronomeClock();
  stopLoopResyncClock();
  stopMidiLedPulseClockIfIdle();
}

function ensureAudio() {
  if (!AudioContextClass) {
    transportStatus.textContent = "Audio is not supported in this browser";
    return false;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.42;
    masterGain.connect(audioContext.destination);
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().then(() => {
      updateTransportStatus();
      preloadAssignedSamples();
    });
  }

  updateTransportStatus();
  if (audioContext.state === "running") {
    preloadAssignedSamples();
  }
  return true;
}

function frequencyFromIndex(index) {
  const semitone = index % 24;
  return 110 * 2 ** (semitone / 12);
}

function frequencyFromMidi(midiNote) {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

function trackForRow(row) {
  const availableTracks = tracksForRow(row);
  if (!availableTracks.length) {
    return null;
  }

  return availableTracks[rowTrackIndex[row] % availableTracks.length];
}

function colorForCell(row, col) {
  const baseHue = rowHues[row] + col * 3;
  const hi = `hsl(${baseHue} 96% ${72 - row * 1.2}%)`;
  const mid = `hsl(${baseHue + 6} 86% ${57 - row * 0.8}%)`;
  const low = `hsl(${baseHue + 10} 80% ${43 - row * 0.5}%)`;
  const text = row === 1 || row === 6 ? "#2a0f14" : "#102026";
  return { hi, mid, low, text };
}

function applyColor(button, row, col) {
  const palette = colorForCell(row, col);
  button.style.setProperty("--btn-hi", palette.hi);
  button.style.setProperty("--btn-mid", palette.mid);
  button.style.setProperty("--btn-low", palette.low);
  button.style.setProperty("--btn-text", palette.text);
}

function setGridButtonText(button, label, debugId) {
  button.innerHTML = `
    <span class="grid-label">${label}</span>
    <span class="grid-debug">${debugId}</span>
  `;
}

function debugTextForSample(track, samplePath, col) {
  const sampleBpm = extractSampleBpm(samplePath);
  const loopBeats = SAMPLE_METADATA[samplePath]?.loopBeats;
  const rate = sampleBpm ? playbackRateForSample(samplePath).toFixed(2) : "1.00";
  const parts = [`ID ${track.trackId.toUpperCase()}-${col + 1}`];

  if (sampleBpm) {
    parts.push(`${sampleBpm}B`);
  }

  if (loopBeats) {
    parts.push(`${loopBeats}bt`);
  }

  parts.push(`${rate}x`);
  return parts.join(" ");
}

function updateRowIndicator(row) {
  const indicator = rowIndicators[row];
  if (!indicator) {
    return;
  }

  const isPlaying = rowActiveVoiceCount[row] > 0;
  indicator.classList.toggle("row-playing", isPlaying);
  indicator.classList.toggle("row-idle", !isPlaying);
}

function adjustRowPlayback(row, delta) {
  if (typeof row !== "number") {
    return;
  }

  rowActiveVoiceCount[row] = Math.max(0, rowActiveVoiceCount[row] + delta);
  updateRowIndicator(row);
  updateMidiSideLed(row);
}

function startTone(button) {
  const state = buttonState.get(button);
  if (!state || state.playing) {
    return;
  }

  state.transportQueued = false;
  if (state.pendingStartTimeout) {
    window.clearTimeout(state.pendingStartTimeout);
    state.pendingStartTimeout = null;
  }
  button.classList.remove("is-waiting");

  if (state.samplePath) {
    if (!ensureAudio()) {
      return;
    }

    button.classList.add("is-waiting");
    updateMidiPadLed(state.row, state.col);

    loadSampleBuffer(state.samplePath)
      .then((sampleBuffer) => {
        if (state.playing || (!state.latched && !state.pointerDown)) {
          return;
        }

        startSampleSource(button, state, sampleBuffer);
      })
      .catch(() => {
        button.classList.remove("is-lit");
        transportStatus.textContent = `Could not load ${button.textContent.trim()}`;
      })
      .finally(() => {
        button.classList.remove("is-waiting");
        updateMidiPadLed(state.row, state.col);
      });

    if (audioContext.state === "suspended") {
      audioContext.resume().then(updateTransportStatus);
    }
    return;
  }

  if (!ensureAudio()) {
    return;
  }

  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  osc.type = state.waveform || "sawtooth";
  osc.frequency.setValueAtTime(state.frequency, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.24, now + 0.02);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);

  state.oscillator = osc;
  state.source = null;
  state.gainNode = gain;
  state.playing = true;
  adjustRowPlayback(state.row, 1);

  button.classList.add("is-lit");
}

function stopTone(button) {
  const state = buttonState.get(button);
  if (!state || !state.playing) {
    return;
  }

  if (state.source) {
    stopSampleSource(state);
    state.playing = false;
    adjustRowPlayback(state.row, -1);
    updateMidiPadLed(state.row, state.col);
    stopMidiLedPulseClockIfIdle();
    return;
  }

  const now = audioContext.currentTime;
  state.gainNode.gain.cancelScheduledValues(now);
  state.gainNode.gain.setValueAtTime(Math.max(state.gainNode.gain.value, 0.001), now);
  state.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
  state.oscillator.stop(now + 0.06);

  state.oscillator = null;
  state.gainNode = null;
  state.playing = false;
  adjustRowPlayback(state.row, -1);
  updateMidiPadLed(state.row, state.col);
  stopMidiLedPulseClockIfIdle();
}

function releaseIfNeeded(button) {
  const state = buttonState.get(button);
  if (!state || state.latched) {
    return;
  }

  if (!state.playing) {
    clearQueuedStart(button);
  }

  stopTone(button);
  button.classList.remove("is-lit");
}

function toggleLatch(button) {
  const state = buttonState.get(button);
  if (!state) {
    return;
  }

  state.latched = !state.latched;
  button.classList.toggle("is-latched", state.latched);

  if (state.latched) {
    queueStart(button);
    button.classList.add("is-lit");
    updateMidiPadLed(state.row, state.col);
    if (!transportRunning) {
      startTransport();
    }
    return;
  }

  clearQueuedStart(button);

  if (!state.pointerDown) {
    stopTone(button);
    button.classList.remove("is-lit");
    updateMidiPadLed(state.row, state.col);
  }
}

function bindPerformanceBehavior(button, frequency, options = {}) {
  const row = typeof options.row === "number" ? options.row : null;
  const col = typeof options.col === "number" ? options.col : null;

  buttonState.set(button, {
    frequency,
    waveform: options.waveform || "sawtooth",
    samplePath: options.samplePath || null,
    row,
    col,
    playing: false,
    latched: false,
    pointerDown: false,
    oscillator: null,
    source: null,
    gainNode: null,
    pendingStartTimeout: null,
    transportQueued: false
  });

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    const state = buttonState.get(button);
    state.pointerDown = true;
    pulse(button);
    queueStart(button);
  });

  button.addEventListener("pointerup", (event) => {
    event.preventDefault();
    const state = buttonState.get(button);
    state.pointerDown = false;
    releaseIfNeeded(button);
  });

  button.addEventListener("pointercancel", () => {
    const state = buttonState.get(button);
    state.pointerDown = false;
    releaseIfNeeded(button);
  });

  button.addEventListener("pointerleave", () => {
    const state = buttonState.get(button);
    if (!state.pointerDown) {
      return;
    }
    state.pointerDown = false;
    releaseIfNeeded(button);
  });

  button.addEventListener("click", (event) => {
    event.preventDefault();
    toggleLatch(button);
  });
}

function playRowReassignWave(row) {
  const waveStepMs = 115;
  const ledHoldMs = 240;
  const uiHoldMs = 620;

  const indicator = rowIndicators[row];
  if (indicator) {
    indicator.classList.add("row-reassigning");
    renderMidiSide(row, { reassign: true });
    window.setTimeout(() => {
      indicator.classList.remove("row-reassigning");
      renderMidiSide(row);
    }, 1800);
  }

  rowButtons[row].forEach((button, col) => {
    button.classList.remove("is-reassign-wave");

    window.setTimeout(() => {
      void button.offsetWidth;
      button.classList.add("is-reassign-wave");
      renderMidiPad(row, col, { reassign: true });

      window.setTimeout(() => button.classList.remove("is-reassign-wave"), uiHoldMs);
      window.setTimeout(() => {
        renderMidiPad(row, col);
      }, ledHoldMs);
    }, col * waveStepMs);
  });

  window.setTimeout(() => renderMidiSide(row), 8 * waveStepMs + ledHoldMs);
}

function applyTrackToRow(row) {
  const track = trackForRow(row);
  if (!track || !Array.isArray(track.samples) || track.samples.length === 0) {
    return;
  }

  rowButtons[row].forEach((button, col) => {
    const state = buttonState.get(button);
    if (!state) {
      return;
    }

    const samplePath = track.samples[col % track.samples.length];
    const debugId = debugTextForSample(track, samplePath, col);

    state.samplePath = samplePath;
    state.frequency = frequencyFromMidi(48 + col * 2 + row);
    state.waveform = track.waveform || "sawtooth";
    button.title = `${track.name} - ${sideLabels[row]}${col + 1} - ${debugId}`;
    setGridButtonText(button, `${sideLabels[row]}${col + 1}`, debugId);
  });
}

function reassignRow(row) {
  if (rowActiveVoiceCount[row] > 0) {
    pulse(rowIndicators[row]);
    return;
  }

  const availableTracks = tracksForRow(row);
  if (!availableTracks.length) {
    return;
  }

  rowTrackIndex[row] = (rowTrackIndex[row] + 1) % availableTracks.length;
  saveJsonStorage(ROW_TRACK_INDEX_STORAGE_KEY, rowTrackIndex);
  applyTrackToRow(row);
  playRowReassignWave(row);
}

function bindIndicatorBehavior(button, row) {
  button.addEventListener("click", () => {
    reassignRow(row);
  });
}

function buildTopRow() {
  topLabels.forEach((label, index) => {
    const button = topTemplate.content.firstElementChild.cloneNode(true);
    button.textContent = label;
    if (index === 4) {
      button.classList.add("is-warning");
    }
    bindPerformanceBehavior(button, frequencyFromIndex(buttonCounter));
    buttonCounter += 1;
    topRow.appendChild(button);
  });
}

function buildSideRow() {
  sideLabels.forEach((label, row) => {
    const button = sideTemplate.content.firstElementChild.cloneNode(true);
    button.innerHTML = `
      <span class="side-letter">${label}</span>
      <span class="side-description">${sideDescriptions[row]}</span>
    `;
    button.classList.add("row-idle");
    bindIndicatorBehavior(button, row);
    rowIndicators[row] = button;
    sideRow.appendChild(button);
  });
}

function buildMainGrid() {
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const button = gridTemplate.content.firstElementChild.cloneNode(true);
      const label = `${sideLabels[row]}${col + 1}`;

      setGridButtonText(button, label, "ID --");
      button.setAttribute("aria-label", `Pad ${label}`);
      applyColor(button, row, col);

      bindPerformanceBehavior(button, frequencyFromIndex(buttonCounter), { row, col });
      buttonCounter += 1;
      rowButtons[row].push(button);
      mainGrid.appendChild(button);
    }
  }

  for (let row = 0; row < 8; row += 1) {
    applyTrackToRow(row);
  }
}

buildTopRow();
buildSideRow();
buildMainGrid();
buildMidiMaps();
updateMetronomeButton();
updateTransportStatus();

transportPlayButton.addEventListener("click", startTransport);
transportStopButton.addEventListener("click", stopTransport);
midiConnectButton.addEventListener("click", () => {
  connectMidi().catch(() => {
    lastMidiMessage = "connection failed";
    updateTransportStatus();
  });
});
metronomeButton.addEventListener("click", toggleMetronome);

transportBpmInput.addEventListener("input", () => {
  handleBpmChange();
});

transportBpmInput.addEventListener("change", () => {
  handleBpmChange();
});

function handleBpmChange() {
  const previousBpm = transportBpm;
  const elapsedBeats = transportRunning ? transportElapsedSeconds() * (previousBpm / 60) : 0;
  transportBpm = Number(transportBpmInput.value);

  if (transportRunning) {
    transportStartedAt = performance.now() - (elapsedBeats * 60 * 1000) / transportBpm;
  }

  refreshGridDebugText();
  updateTransportStatus();
  restartActiveSampleSources();
  startLoopResyncClock();
  stopMidiLedPulseClockIfIdle();
  startMidiLedPulseClock();
  if (metronomeEnabled && transportRunning) {
    startMetronomeClock(false);
  }
}

transportQuantizeSelect.addEventListener("change", () => {
  transportQuantizeBeats = Number(transportQuantizeSelect.value);
  updateTransportStatus();
});
