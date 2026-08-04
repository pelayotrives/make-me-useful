const MAX_ROUNDS = 4;
const DEFAULT_CONFIG = {
  rounds: 3,
  studyMinutes: [25, 25, 25, 25],
  breakMinutes: [5, 5, 5, 5],
  domains: [],
  atomic: false,
};

const elements = {
  rounds: document.querySelector("#roundsSelect"),
  schedule: document.querySelector("#scheduleRows"),
  domains: document.querySelector("#domainsInput"),
  atomic: document.querySelector("#atomicToggle"),
  atomicMessage: document.querySelector("#atomicMessage"),
  start: document.querySelector("#startButton"),
  reset: document.querySelector("#resetButton"),
  phase: document.querySelector("#phaseLabel"),
  round: document.querySelector("#roundLabel"),
  time: document.querySelector("#timeDisplay"),
  progress: document.querySelector("#progressBar"),
  hint: document.querySelector("#timerHint"),
  status: document.querySelector("#statusPill"),
  version: document.querySelector("#versionLabel"),
};

let currentState = null;
let refreshTimer = null;

start();

async function start() {
  elements.version.textContent = `Version ${chrome.runtime.getManifest().version}`;
  elements.rounds.addEventListener("change", renderSchedule);
  elements.atomic.addEventListener("change", renderGuardrails);
  elements.start.addEventListener("click", startSession);
  elements.reset.addEventListener("click", resetSession);
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
      <label>Study<select data-kind="study" data-index="${index}">${durationOptions(20, 60, getStoredDuration("studyMinutes", index))}</select></label>
      <span class="arrow" aria-hidden="true">→</span>
      <label>Break<select data-kind="break" data-index="${index}">${durationOptions(5, 30, getStoredDuration("breakMinutes", index))}</select></label>
    `;
    elements.schedule.appendChild(row);
  }
  syncConfigurationState();
}

function durationOptions(minimum, maximum, selected) {
  return Array.from({ length: ((maximum - minimum) / 5) + 1 }, (_, offset) => {
    const value = minimum + offset * 5;
    return `<option value="${value}"${value === selected ? " selected" : ""}>${value} min</option>`;
  }).join("");
}

function getStoredDuration(kind, index) {
  return currentState?.config?.[kind]?.[index] || DEFAULT_CONFIG[kind][index];
}

function syncConfigurationState() {
  const locked = Boolean(currentState?.running && isStudyPhase(currentState));
  elements.rounds.disabled = locked;
  elements.domains.disabled = locked || elements.atomic.checked;
  elements.atomic.disabled = locked;
  elements.schedule.querySelectorAll("select").forEach((select) => { select.disabled = locked; });
  elements.start.disabled = locked;
  elements.reset.disabled = locked;
  elements.start.textContent = currentState?.running ? "Session running" : "Start session";
}

function syncFormFromState(state) {
  const roundsChanged = Number(elements.rounds.value) !== state.config.rounds;
  elements.rounds.value = state.config.rounds;
  elements.atomic.checked = state.config.atomic;
  elements.domains.value = state.config.domains.join("\n");
  if (roundsChanged) renderSchedule();
  elements.schedule.querySelectorAll("select").forEach((select) => {
    const values = select.dataset.kind === "study" ? state.config.studyMinutes : state.config.breakMinutes;
    select.value = String(values[Number(select.dataset.index)]);
  });
}

function renderGuardrails() {
  elements.domains.disabled = elements.atomic.checked || Boolean(currentState?.running && isStudyPhase(currentState));
  elements.atomicMessage.hidden = !elements.atomic.checked;
}

function readConfig() {
  const studyMinutes = Array(MAX_ROUNDS).fill(25);
  const breakMinutes = Array(MAX_ROUNDS).fill(5);
  elements.schedule.querySelectorAll("select").forEach((select) => {
    const target = select.dataset.kind === "study" ? studyMinutes : breakMinutes;
    target[Number(select.dataset.index)] = Number(select.value);
  });
  return {
    rounds: Number(elements.rounds.value),
    studyMinutes,
    breakMinutes,
    domains: elements.domains.value.split("\n").map((domain) => domain.trim()).filter(Boolean),
    atomic: elements.atomic.checked,
  };
}

async function startSession() {
  const response = await chrome.runtime.sendMessage({ type: "start-session", config: readConfig() });
  applyState(response, true);
}

async function resetSession() {
  const response = await chrome.runtime.sendMessage({ type: "reset-session" });
  applyState(response, true);
}

async function refreshState() {
  const response = await chrome.runtime.sendMessage({ type: "get-state" });
  applyState(response);
}

function applyState(state, forceFormSync = false) {
  if (!state || state.error) return;
  const shouldSyncForm = forceFormSync || !currentState || state.running || state.completed;
  currentState = state;
  if (shouldSyncForm) syncFormFromState(state);
  const phase = getPhase(state);
  elements.status.textContent = state.completed ? "Complete" : state.running ? (phase.type === "study" ? "Focus locked" : "Break") : "Ready";
  elements.status.className = `status-pill status-pill--${state.completed ? "complete" : state.running ? phase.type : "ready"}`;
  elements.phase.textContent = state.completed ? "Chain complete" : state.running ? (phase.type === "study" ? "Study block" : "Recovery break") : "Configure a session";
  elements.round.textContent = state.running ? `${Math.floor(state.phaseIndex / 2) + 1} / ${state.config.rounds}` : `${state.config.rounds} blocks`;
  elements.hint.textContent = state.running && phase.type === "study" ? "The focus lock is active until this block ends." : state.running ? "Use the break to reset before the next block." : "Build a chain, then start when you are ready.";
  if (state.running) {
    const remaining = Math.max(0, state.phaseEndsAt - Date.now());
    elements.time.textContent = formatTime(remaining);
    const duration = phase.minutes * 60 * 1000;
    elements.progress.style.width = `${Math.max(0, Math.min(100, ((duration - remaining) / duration) * 100))}%`;
  } else {
    elements.time.textContent = state.completed ? "DONE" : "00:00";
    elements.progress.style.width = state.completed ? "100%" : "0%";
  }
  syncConfigurationState();
  renderGuardrails();
}

function getPhase(state) {
  const index = Math.min(state.phaseIndex, state.config.rounds * 2 - 1);
  return { type: index % 2 === 0 ? "study" : "break", minutes: index % 2 === 0 ? state.config.studyMinutes[Math.floor(index / 2)] : state.config.breakMinutes[Math.floor(index / 2)] };
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
