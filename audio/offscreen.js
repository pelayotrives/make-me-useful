const audioByCue = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") {
    return false;
  }

  if (message.type === "prime-audio") {
    primeAudio().then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message.type === "play-sound") {
    playCue(message.cue).then(() => sendResponse({ ok: true })).catch((error) => {
      console.error("Make me useful audio playback failed", error);
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  return false;
});

async function primeAudio() {
  await Promise.all([
    loadAudio("study-complete"),
    loadAudio("break-complete"),
    loadAudio("session-complete"),
  ]);
}

async function playCue(cue) {
  const audio = await loadAudio(cue);
  audio.pause();
  audio.currentTime = 0;
  audio.volume = 1;
  await audio.play();
}

function loadAudio(cue) {
  if (audioByCue.has(cue)) {
    return Promise.resolve(audioByCue.get(cue));
  }

  const filename = {
    "study-complete": "success.mp3",
    "break-complete": "stop.mp3",
    "session-complete": "complete.mp3",
  }[cue];

  if (!filename) {
    return Promise.reject(new Error(`Unknown audio cue: ${cue}`));
  }

  const audio = document.createElement("audio");
  audio.src = chrome.runtime.getURL(`audio/sounds/${filename}`);
  audio.preload = "auto";
  audio.setAttribute("aria-hidden", "true");
  document.body.appendChild(audio);
  audioByCue.set(cue, audio);
  return Promise.resolve(audio);
}
