const MAX_ROUNDS = 4;
const DEFAULT_CONFIG = {
  rounds: 3,
  studySeconds: [1500, 1500, 1500, 1500],
  breakSeconds: [300, 300, 300, 300],
  domains: [],
  allowedDomains: [],
  domainMode: "block",
  atomic: false,
};

const TEST_DURATION_SECONDS = 1;
const RESET_HOLD_MS = 45000;

const elements = {
  rounds: document.querySelector("#roundsSelect"),
  schedule: document.querySelector("#scheduleRows"),
  domains: document.querySelector("#domainsInput"),
  allowedDomains: document.querySelector("#allowedDomainsInput"),
  blockMode: document.querySelector("#blockMode"),
  allowMode: document.querySelector("#allowMode"),
  blockField: document.querySelector("#blockField"),
  allowField: document.querySelector("#allowField"),
  resetHint: document.querySelector("#resetHint"),
  resetHoldFill: document.querySelector("#resetHoldFill"),
  resetButtonLabel: document.querySelector("#resetButtonLabel"),
  atomic: document.querySelector("#atomicToggle"),
  atomicMessage: document.querySelector("#atomicMessage"),
  start: document.querySelector("#startButton"),
  reset: document.querySelector("#resetButton"),
  test: document.querySelector("#testButton"),
  phase: document.querySelector("#phaseLabel"),
  round: document.querySelector("#roundLabel"),
  time: document.querySelector("#timeDisplay"),
  progress: document.querySelector("#progressBar"),
  hint: document.querySelector("#timerHint"),
  version: document.querySelector("#versionLabel"),
};

let currentState = null;
let refreshTimer = null;
let holdStartAt = 0;
let holdTimer = null;

start();

async function start() {
  elements.version.textContent = `Version ${chrome.runtime.getManifest().version}`;
  elements.rounds.addEventListener("change", renderSchedule);
  elements.atomic.addEventListener("change", renderGuardrails);
  elements.blockMode.addEventListener("change", handleGuardModeChange);
  elements.allowMode.addEventListener("change", handleGuardModeChange);
  elements.start.addEventListener("click", startSession);
  elements.reset.addEventListener("pointerdown", beginResetHold);
  elements.reset.addEventListener("pointerup", cancelResetHold);
  elements.reset.addEventListener("pointerleave", cancelResetHold);
  elements.reset.addEventListener("pointercancel", cancelResetHold);
  elements.reset.addEventListener("click", interceptResetClick);
  elements.test.addEventListener("click", testResetSession);
  renderSchedule();
  await refreshState();
  refreshTimer = window.setInterval(refreshState, 1000);
}

function renderSchedule() {
  const rounds = Number(elements.rounds.value);
  elements.schedule.replaceChildren();
  for (let index = 0; index < rounds; index += 1) {
    const row = document.createElement("div");
    row.className = "schedule-row";
    row.innerHTML = `
      <span class="schedule-row__number">${String(index + 1).padStart(2, "0")}</span>
      <label>Study<span class="select-shell"><select data-kind="study" data-index="${index}">${durationOptions("study", getStoredDuration("studySeconds", index))}</select></span></label>
      <label>Break<span class="select-shell"><select data-kind="break" data-index="${index}">${durationOptions("break", getStoredDuration("breakSeconds", index))}</select></span></label>
    `;
    elements.schedule.appendChild(row);
  }
  elements.schedule.querySelectorAll("select").forEach((select) => {
    select.addEventListener("change", syncPreviewLabels);
  });
  syncPreviewLabels();
  syncConfigurationState();
}

function durationOptions(kind, selected) {
  const options = [];
  options.push(optionMarkup(TEST_DURATION_SECONDS, selected, "1 sec"));
  const range = kind === "study" ? buildMinuteRange(20, 60) : buildMinuteRange(5, 30);
  range.forEach((minutes) => {
    options.push(optionMarkup(minutes * 60, selected, `${minutes} min`));
  });
  return options.join("");
}

function buildMinuteRange(minimum, maximum) {
  return Array.from({ length: ((maximum - minimum) / 5) + 1 }, (_, offset) => minimum + offset * 5);
}

function optionMarkup(value, selected, label) {
  return `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`;
}

function getStoredDuration(kind, index) {
  return currentState?.config?.[kind]?.[index] || DEFAULT_CONFIG[kind][index];
}

function syncConfigurationState() {
  const locked = Boolean(currentState?.running && isStudyPhase(currentState));
  const running = Boolean(currentState?.running);
  elements.rounds.disabled = locked;
  elements.domains.disabled = locked || elements.atomic.checked || elements.allowMode.checked;
  elements.allowedDomains.disabled = locked || elements.atomic.checked || elements.blockMode.checked;
  elements.atomic.disabled = locked;
  elements.blockMode.disabled = locked || elements.atomic.checked;
  elements.allowMode.disabled = locked || elements.atomic.checked;
  elements.schedule.querySelectorAll("select").forEach((select) => { select.disabled = locked; });
  elements.start.disabled = running;
  elements.reset.disabled = false;
  elements.test.disabled = false;
  elements.start.textContent = running ? "Session running" : "Start session";
  elements.resetHint.hidden = !running;
  if (!running) {
    cancelResetHold();
  }
}

function syncFormFromState(state) {
  const roundsChanged = Number(elements.rounds.value) !== state.config.rounds;
  elements.rounds.value = state.config.rounds;
  elements.atomic.checked = state.config.atomic;
  elements.blockMode.checked = state.config.domainMode !== "allow";
  elements.allowMode.checked = state.config.domainMode === "allow";
  elements.domains.value = state.config.domains.join(", ");
  elements.allowedDomains.value = state.config.allowedDomains.join(", ");
  if (roundsChanged) renderSchedule();
  elements.schedule.querySelectorAll("select").forEach((select) => {
    const values = select.dataset.kind === "study" ? state.config.studySeconds : state.config.breakSeconds;
    select.value = String(values[Number(select.dataset.index)]);
  });
  syncPreviewLabels();
}

function renderGuardrails() {
  const locked = Boolean(currentState?.running && isStudyPhase(currentState));
  const isAllowMode = elements.allowMode.checked;
  elements.blockField.hidden = isAllowMode;
  elements.allowField.hidden = !isAllowMode;
  elements.domains.disabled = elements.atomic.checked || locked || isAllowMode;
  elements.allowedDomains.disabled = elements.atomic.checked || locked || !isAllowMode;
  elements.blockMode.disabled = elements.atomic.checked || locked;
  elements.allowMode.disabled = elements.atomic.checked || locked;
  elements.atomicMessage.hidden = !elements.atomic.checked;
}

function handleGuardModeChange(event) {
  if (!event.target.checked) {
    return;
  }
  if (event.target === elements.allowMode) {
    elements.domains.value = "";
  } else {
    elements.allowedDomains.value = "";
  }
  renderGuardrails();
}

function readConfig() {
  const studySeconds = Array(MAX_ROUNDS).fill(DEFAULT_CONFIG.studySeconds[0]);
  const breakSeconds = Array(MAX_ROUNDS).fill(DEFAULT_CONFIG.breakSeconds[0]);
  elements.schedule.querySelectorAll("select").forEach((select) => {
    const target = select.dataset.kind === "study" ? studySeconds : breakSeconds;
    target[Number(select.dataset.index)] = Number(select.value);
  });
  return {
    rounds: Number(elements.rounds.value),
    studySeconds,
    breakSeconds,
    domains: parseDomainsInput(elements.domains.value),
    allowedDomains: parseDomainsInput(elements.allowedDomains.value),
    domainMode: elements.allowMode.checked ? "allow" : "block",
    atomic: elements.atomic.checked,
  };
}

async function startSession() {
  await sendAction({ type: "start-session", config: readConfig() });
}

async function testResetSession() {
  cancelResetHold();
  await sendAction({ type: "test-reset-session" });
}

async function refreshState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-state" });
    applyState(response);
  } catch (error) {
    elements.hint.textContent = error.message || "The extension background worker is not responding.";
  }
}

async function sendAction(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (response && response.error) {
      elements.hint.textContent = response.error;
      return;
    }
    applyState(response, true);
  } catch (error) {
    elements.hint.textContent = error.message || "The extension background worker is not responding.";
  }
}

function applyState(state, forceFormSync = false) {
  if (!state || state.error) return;
  const shouldSyncForm = forceFormSync || !currentState || state.running || state.completed;
  currentState = state;
  if (shouldSyncForm) syncFormFromState(state);
  const phase = getPhase(state);
  elements.phase.textContent = state.completed ? "Chain complete" : state.running ? (phase.type === "study" ? "Study block" : "Recovery break") : "Configure a session";
  syncPreviewLabels();
  elements.hint.textContent = state.running && phase.type === "study"
    ? "The focus lock is active until this block ends."
    : state.running
      ? "Use the break to reset before the next block."
      : "Build a chain, then start when you are ready.";
  if (state.running) {
    const remaining = Math.max(0, state.phaseEndsAt - Date.now());
    elements.time.textContent = formatTime(remaining);
    const duration = phase.seconds * 1000;
    elements.progress.style.width = `${Math.max(0, Math.min(100, ((duration - remaining) / duration) * 100))}%`;
  } else {
    elements.time.textContent = state.completed ? "Done" : "00:00";
    elements.progress.style.width = state.completed ? "100%" : "0%";
  }
  syncConfigurationState();
  renderGuardrails();
}

function syncPreviewLabels() {
  const rounds = Number(elements.rounds.value);
  if (currentState?.running) {
    elements.round.textContent = `${Math.floor(currentState.phaseIndex / 2) + 1} / ${currentState.config.rounds}`;
    return;
  }
  elements.round.textContent = `${rounds} ${rounds === 1 ? "Block" : "Blocks"}`;
}

function getPhase(state) {
  const index = Math.min(state.phaseIndex, state.config.rounds * 2 - 1);
  const roundIndex = Math.floor(index / 2);
  return {
    type: index % 2 === 0 ? "study" : "break",
    seconds: index % 2 === 0 ? state.config.studySeconds[roundIndex] : state.config.breakSeconds[roundIndex],
  };
}

function isStudyPhase(state) {
  return getPhase(state).type === "study";
}

function formatTime(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseDomainsInput(value) {
  return value
    .split(/[\n,]+/)
    .map((domain) => domain.trim())
    .filter(Boolean);
}

function interceptResetClick(event) {
  if (currentState?.running) {
    event.preventDefault();
    return;
  }
  sendAction({ type: "reset-session" });
}

function beginResetHold(event) {
  event.preventDefault();
  if (!currentState?.running || holdTimer) {
    return;
  }
  holdStartAt = Date.now();
  elements.reset.classList.add("is-holding");
  elements.resetButtonLabel.textContent = "Keep holding...";
  holdTimer = window.setInterval(checkResetHoldProgress, 80);
}

function cancelResetHold() {
  if (holdTimer) {
    window.clearInterval(holdTimer);
    holdTimer = null;
  }
  holdStartAt = 0;
  updateHoldResetProgress(0);
  elements.reset.classList.remove("is-holding");
  elements.resetButtonLabel.textContent = "Reset";
}

function checkResetHoldProgress() {
  const elapsed = Date.now() - holdStartAt;
  const progress = Math.max(0, Math.min(1, elapsed / RESET_HOLD_MS));
  updateHoldResetProgress(progress);
  if (progress >= 1) {
    finishResetHold();
  }
}

async function finishResetHold() {
  cancelResetHold();
  await sendAction({ type: "reset-session" });
}

function updateHoldResetProgress(progress) {
  elements.resetHoldFill.style.width = `${progress * 100}%`;
  elements.reset.style.setProperty("--hold-progress", `${progress * 100}%`);
}
