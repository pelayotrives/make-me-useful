const STATE_KEY = "make_me_useful_state";
const phaseChip = document.getElementById("phaseChip");
const phaseLabel = document.getElementById("phaseLabel");
const timeLeft = document.getElementById("timeLeft");

let tickId = null;
let syncId = null;
let currentState = null;

function buildPhases(config) {
  const phases = [];
  for (let index = 0; index < config.rounds; index += 1) {
    phases.push({ type: "study", seconds: config.studySeconds[index] });
    phases.push({ type: "break", seconds: config.breakSeconds[index] });
  }
  return phases;
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function renderPhaseMeta() {
  if (!currentState?.running || !currentState.config) {
    phaseChip.hidden = true;
    return;
  }

  const phases = buildPhases(currentState.config);
  const phase = phases[Number(currentState.phaseIndex)];
  if (!phase) {
    phaseChip.hidden = true;
    return;
  }

  const blockNumber = Math.floor(Number(currentState.phaseIndex || 0) / 2) + 1;
  const phaseName = phase.type === "study" ? "Study" : "Break";
  phaseLabel.textContent = `${phaseName} block ${blockNumber}`;
  timeLeft.textContent = formatClock(Number(currentState.phaseEndsAt) - Date.now());
  phaseChip.hidden = false;
}

async function syncState() {
  try {
    // Ask the service worker to advance overdue phases before rendering.
    const state = await chrome.runtime.sendMessage({ type: "get-state" });
    currentState = state || null;
    renderPhaseMeta();
  } catch {
    const stored = await chrome.storage.local.get(STATE_KEY);
    currentState = stored[STATE_KEY] || null;
    renderPhaseMeta();
  }
}

syncState();
tickId = window.setInterval(renderPhaseMeta, 250);
syncId = window.setInterval(syncState, 1000);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STATE_KEY]) {
    return;
  }
  currentState = changes[STATE_KEY].newValue || null;
  renderPhaseMeta();
});

window.addEventListener("beforeunload", () => {
  window.clearInterval(tickId);
  window.clearInterval(syncId);
});
