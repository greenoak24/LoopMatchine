const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const SAMPLE_BANKS_PATH = path.join(ROOT_DIR, "sample-banks.js");
const OUTPUT_PATH = path.join(ROOT_DIR, "sample-metadata.js");

function loadSampleBanks() {
  const source = fs.readFileSync(SAMPLE_BANKS_PATH, "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: SAMPLE_BANKS_PATH });
  return context.window.SAMPLE_BANKS || [];
}

function extractSampleBpm(samplePath) {
  const fileName = path.basename(samplePath);
  const explicitMatch =
    fileName.match(/(\d{2,3})[-_\s]*bpm/i) ||
    fileName.match(/bpm[-_\s]*(\d{2,3})/i);

  if (explicitMatch) {
    return { bpm: Number(explicitMatch[1]), source: "filename" };
  }

  const tokens = [...fileName.matchAll(/(?:^|[-_\s])(\d{3})(?=[-_\s.]|$)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 80 && value <= 180);

  if (tokens.length > 0) {
    return { bpm: tokens[tokens.length - 1], source: "filename-token" };
  }

  return { bpm: null, source: null };
}

function extractBpmRange(samplePath) {
  const match = samplePath.match(/(\d{2,3})\s*-\s*(\d{2,3})\s*bpm/i);
  if (!match) {
    return null;
  }

  const low = Number(match[1]);
  const high = Number(match[2]);
  return low < high ? { low, high } : null;
}

function probeDuration(samplePath) {
  const absolutePath = path.join(ROOT_DIR, samplePath);
  const output = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      absolutePath
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  return Number(output.trim());
}

function roundedLoopBeats(duration, bpm) {
  const rawBeats = duration * (bpm / 60);
  const roundedBeats = Math.max(1, Math.round(rawBeats));
  const roundedBars = Math.max(1, Math.round(rawBeats / 4)) * 4;
  const loopBeats = Math.abs(rawBeats - roundedBars) < 0.35 ? roundedBars : roundedBeats;

  return {
    rawBeats: Number(rawBeats.toFixed(3)),
    loopBeats,
    confidence: Math.abs(rawBeats - loopBeats) <= 0.35 ? "high" : "medium"
  };
}

function shouldAnalyzeAsLoop(samplePath) {
  return /loops?/i.test(samplePath) || /bpm/i.test(samplePath);
}

function estimateBpmFromDuration(samplePath, duration) {
  if (!shouldAnalyzeAsLoop(samplePath) || !Number.isFinite(duration)) {
    return { bpm: null, source: null };
  }

  const range = extractBpmRange(samplePath);
  const possibleLoopBeats = [4, 8, 16, 32, 64];
  const candidates = possibleLoopBeats
    .map((beats) => ({
      beats,
      bpm: (beats * 60) / duration
    }))
    .filter(({ bpm }) => bpm >= 80 && bpm <= 180);

  if (candidates.length === 0) {
    return { bpm: null, source: null };
  }

  const rangedCandidates = range
    ? candidates.filter(({ bpm }) => bpm >= range.low && bpm <= range.high)
    : candidates;
  const usableCandidates = rangedCandidates.length > 0 ? rangedCandidates : candidates;
  const target = range ? (range.low + range.high) / 2 : 140;
  const best = usableCandidates.reduce((currentBest, candidate) => {
    const currentDistance = Math.abs(currentBest.bpm - target);
    const candidateDistance = Math.abs(candidate.bpm - target);
    return candidateDistance < currentDistance ? candidate : currentBest;
  });

  return {
    bpm: Math.round(best.bpm),
    source: range ? "duration-range" : "duration-estimate"
  };
}

function buildMetadata() {
  const sampleBanks = loadSampleBanks();
  const samples = new Set();

  sampleBanks.forEach((bank) => {
    (bank.samples || []).forEach((samplePath) => samples.add(samplePath));
  });

  const metadata = {};

  [...samples].sort().forEach((samplePath) => {
    let duration = null;
    try {
      duration = probeDuration(samplePath);
    } catch (error) {
      console.warn(`Skipping duration probe for ${samplePath}`);
    }

    const detectedBpm = extractSampleBpm(samplePath);
    const estimatedBpm = detectedBpm.bpm ? detectedBpm : estimateBpmFromDuration(samplePath, duration);
    const { bpm, source } = estimatedBpm;
    const record = {
      duration: Number.isFinite(duration) ? Number(duration.toFixed(6)) : null,
      bpm,
      bpmSource: source,
      loopBeats: null,
      rawBeats: null,
      confidence: bpm ? "medium" : "unknown"
    };

    if (Number.isFinite(duration) && bpm && shouldAnalyzeAsLoop(samplePath)) {
      Object.assign(record, roundedLoopBeats(duration, bpm));
    }

    metadata[samplePath] = record;
  });

  return metadata;
}

const metadata = buildMetadata();
const output = `window.SAMPLE_METADATA = ${JSON.stringify(metadata, null, 2)};\n`;
fs.writeFileSync(OUTPUT_PATH, output);

const entries = Object.values(metadata);
const bpmCount = entries.filter((entry) => entry.bpm).length;
const loopCount = entries.filter((entry) => entry.loopBeats).length;
console.log(`Analyzed ${entries.length} samples`);
console.log(`Detected BPM for ${bpmCount} samples`);
console.log(`Detected loop lengths for ${loopCount} samples`);
