let currentAudio = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") {
    return false;
  }
  if (message?.type === "prime-audio") {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "play-sound") {
    playCue(message.cue).then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }
  return false;
});

async function playCue(cue) {
  const dataUrl = buildCueDataUrl(cue);
  if (!dataUrl) {
    return;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  const audio = new Audio(dataUrl);
  audio.volume = 0.9;
  currentAudio = audio;
  await audio.play();
}

function buildCueDataUrl(cue) {
  switch (cue) {
    case "study-complete":
      return buildWaveDataUrl([
        { frequency: 587.33, duration: 0.12, volume: 0.28, type: "sine" },
        { frequency: 783.99, duration: 0.2, volume: 0.22, type: "triangle" },
      ]);
    case "break-complete":
      return buildWaveDataUrl([
        { frequency: 440, duration: 0.1, volume: 0.24, type: "sine" },
        { frequency: 659.25, duration: 0.14, volume: 0.18, type: "triangle" },
      ]);
    case "session-complete":
      return buildWaveDataUrl([
        { frequency: 523.25, duration: 0.14, volume: 0.2, type: "sine" },
        { frequency: 659.25, duration: 0.16, volume: 0.18, type: "triangle" },
        { frequency: 783.99, duration: 0.34, volume: 0.24, type: "sine" },
      ]);
    default:
      return "";
  }
}

function buildWaveDataUrl(notes) {
  const sampleRate = 44100;
  const gapSeconds = 0.03;
  const totalDuration = notes.reduce((sum, note) => sum + note.duration, 0) + gapSeconds * Math.max(0, notes.length - 1);
  const frameCount = Math.ceil(totalDuration * sampleRate);
  const pcm = new Int16Array(frameCount);
  let offset = 0;

  notes.forEach((note, noteIndex) => {
    const noteFrames = Math.floor(note.duration * sampleRate);
    for (let frame = 0; frame < noteFrames && offset + frame < pcm.length; frame += 1) {
      const t = frame / sampleRate;
      const envelope = Math.min(1, frame / (sampleRate * 0.01), (noteFrames - frame) / (sampleRate * 0.04));
      const sample = waveform(note.type, 2 * Math.PI * note.frequency * t) * note.volume * envelope;
      pcm[offset + frame] = Math.max(-32767, Math.min(32767, Math.round(sample * 32767)));
    }
    offset += noteFrames;
    if (noteIndex < notes.length - 1) {
      offset += Math.floor(gapSeconds * sampleRate);
    }
  });

  return encodeWav(pcm, sampleRate);
}

function waveform(type, angle) {
  switch (type) {
    case "triangle":
      return (2 / Math.PI) * Math.asin(Math.sin(angle));
    case "square":
      return Math.sign(Math.sin(angle));
    default:
      return Math.sin(angle);
  }
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  samples.forEach((sample, index) => {
    view.setInt16(44 + index * 2, sample, true);
  });

  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
