const MAX_ROUNDS = 4;
const ENABLE_TEST_CONTROLS = false;
const DEFAULT_CONFIG = {
  rounds: 3,
  studySeconds: [1500, 1500, 1500, 1500],
  breakSeconds: [300, 300, 300, 300],
  domains: [],
  allowedDomains: [],
  domainMode: "block",
  atomic: false,
};
const RESET_HOLD_MS = 45000;
const DOMAIN_DRAFT_KEY = "make_me_useful_domain_draft";

const elements = {
  rounds: document.querySelector("#roundsSelect"),
  schedule: document.querySelector("#scheduleRows"),
  domains: document.querySelector("#domainsInput"),
  allowedDomains: document.querySelector("#allowedDomainsInput"),
  blockMode: document.querySelector("#blockMode"),
  allowMode: document.querySelector("#allowMode"),
  blockField: document.querySelector("#blockField"),
  allowField: document.querySelector("#allowField"),
  domainListName: document.querySelector("#domainListNameInput"),
  saveDomainList: document.querySelector("#saveDomainListButton"),
  domainListStatus: document.querySelector("#domainListStatus"),
  domainLists: document.querySelector("#domainLists"),
  resetHint: document.querySelector("#resetHint"),
  resetHoldFill: document.querySelector("#resetHoldFill"),
  resetButtonLabel: document.querySelector("#resetButtonLabel"),
  testActions: document.querySelector("#testActions"),
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
let domainLists = [];
let domainListStatusTimer = null;
let editingDomainListId = null;

start();

async function start() {
  elements.version.textContent = `Version ${chrome.runtime.getManifest().version}`;
  elements.rounds.addEventListener("change", renderSchedule);
  elements.atomic.addEventListener("change", renderGuardrails);
  elements.blockMode.addEventListener("change", handleGuardModeChange);
  elements.allowMode.addEventListener("change", handleGuardModeChange);
  elements.domains.addEventListener("input", persistDomainDraft);
  elements.allowedDomains.addEventListener("input", persistDomainDraft);
  elements.saveDomainList.addEventListener("click", saveDomainList);
  elements.domainLists.addEventListener("click", handleDomainListAction);
  document.addEventListener("pointerdown", dismissDomainListStatus, true);
  elements.start.addEventListener("click", startSession);
  elements.reset.addEventListener("pointerdown", beginResetHold);
  elements.reset.addEventListener("pointerup", cancelResetHold);
  elements.reset.addEventListener("pointerleave", cancelResetHold);
  elements.reset.addEventListener("pointercancel", cancelResetHold);
  elements.reset.addEventListener("click", interceptResetClick);
  elements.testActions.hidden = !ENABLE_TEST_CONTROLS;
  if (ENABLE_TEST_CONTROLS) {
    elements.test.addEventListener("click", testResetSession);
  }
  elements.rounds.value = String(DEFAULT_CONFIG.rounds);
  renderSchedule();
  await refreshDomainLists();
  await refreshState();
  await restoreDomainDraft();
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
  const range = kind === "study" ? buildMinuteRange(20, 60) : buildMinuteRange(5, 30);
  return range.map((minutes) => optionMarkup(minutes * 60, selected, `${minutes} min`)).join("");
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
  elements.saveDomainList.disabled = locked;
  elements.domainListName.disabled = locked;
  elements.domainLists.querySelectorAll("button").forEach((button) => { button.disabled = locked; });
  elements.reset.disabled = false;
  if (ENABLE_TEST_CONTROLS) {
    elements.test.disabled = false;
  }
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
  persistDomainDraft();
}

function persistDomainDraft() {
  chrome.storage.local.set({
    [DOMAIN_DRAFT_KEY]: {
      domains: elements.domains.value,
      allowedDomains: elements.allowedDomains.value,
      domainMode: elements.allowMode.checked ? "allow" : "block",
    },
  }).catch(() => {});
}

async function restoreDomainDraft() {
  if (currentState?.running) return;
  try {
    const stored = await chrome.storage.local.get(DOMAIN_DRAFT_KEY);
    const draft = stored[DOMAIN_DRAFT_KEY];
    if (!draft) return;
    const isAllowed = draft.domainMode === "allow";
    elements.allowMode.checked = isAllowed;
    elements.blockMode.checked = !isAllowed;
    elements.domains.value = typeof draft.domains === "string" ? draft.domains : elements.domains.value;
    elements.allowedDomains.value = typeof draft.allowedDomains === "string" ? draft.allowedDomains : elements.allowedDomains.value;
    renderGuardrails();
  } catch {
    // A missing draft should not prevent the popup from opening.
  }
}

async function refreshDomainLists() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-domain-lists" });
    domainLists = Array.isArray(response) ? response : [];
    renderDomainLists();
  } catch (error) {
    setDomainListStatus(error.message || "Unable to load saved lists.");
  }
}

async function saveDomainList() {
  const name = elements.domainListName.value.trim();
  const source = elements.allowMode.checked ? elements.allowedDomains.value : elements.domains.value;
  const domains = parseDomainsInput(source);
  if (!name) {
    setDomainListStatus("Add a name for this list first.");
    elements.domainListName.focus();
    return;
  }
  if (domains.length === 0) {
    setDomainListStatus("Add at least one domain before saving.");
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: "save-domain-list",
      name,
      domains,
      domainMode: elements.allowMode.checked ? "allow" : "block",
      ...(editingDomainListId ? { id: editingDomainListId } : {}),
    });
    if (response?.error) {
      setDomainListStatus(response.error);
      return;
    }
    domainLists = response;
    editingDomainListId = null;
    elements.domainListName.value = "";
    elements.saveDomainList.textContent = "Save list";
    setDomainListStatus("List saved.");
    renderDomainLists();
  } catch (error) {
    setDomainListStatus(error.message || "Unable to save this list.");
  }
}

async function handleDomainListAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const list = domainLists.find((item) => item.id === button.dataset.id);
  if (!list) return;
  if (button.dataset.action === "edit") {
    editingDomainListId = list.id;
    const isAllowed = list.domainMode === "allow";
    elements.allowMode.checked = isAllowed;
    elements.blockMode.checked = !isAllowed;
    elements.domains.value = isAllowed ? elements.domains.value : list.domains.join(", ");
    elements.allowedDomains.value = isAllowed ? list.domains.join(", ") : elements.allowedDomains.value;
    elements.domainListName.value = list.name;
    elements.saveDomainList.textContent = "Update list";
    renderGuardrails();
    persistDomainDraft();
    elements.domainListName.focus();
    setDomainListStatus(`Editing ${list.name}.`);
    return;
  }
  if (button.dataset.action === "load") {
    const isAllowed = list.domainMode === "allow";
    elements.allowMode.checked = isAllowed;
    elements.blockMode.checked = !isAllowed;
    renderGuardrails();
    const target = isAllowed ? elements.allowedDomains : elements.domains;
    target.value = list.domains.join(", ");
    persistDomainDraft();
    setDomainListStatus(`Loaded ${list.name}.`);
    return;
  }
  if (button.dataset.action === "delete") {
    const response = await chrome.runtime.sendMessage({ type: "delete-domain-list", id: list.id });
    domainLists = Array.isArray(response) ? response : domainLists;
    if (editingDomainListId === list.id) {
      editingDomainListId = null;
      elements.domainListName.value = "";
      elements.saveDomainList.textContent = "Save list";
    }
    setDomainListStatus("List deleted.");
    renderDomainLists();
  }
}

function renderDomainLists() {
  elements.domainLists.replaceChildren();
  domainLists.forEach((list) => {
    const item = document.createElement("div");
    item.className = "domain-list-item";
    item.innerHTML = `
      <div class="domain-list-item__copy">
        <strong>${escapeHtml(list.name)}</strong>
        <span>${list.domainMode === "allow" ? "Allowed" : "Blocked"} · ${list.domains.length} ${list.domains.length === 1 ? "domain" : "domains"}</span>
      </div>
      <div class="domain-list-item__actions">
        <button class="button button--small button--primary" type="button" data-action="load" data-id="${escapeHtml(list.id)}">Load</button>
        <button class="button button--small button--secondary" type="button" data-action="edit" data-id="${escapeHtml(list.id)}">Edit</button>
        <button class="button button--small button--secondary button--danger" type="button" data-action="delete" data-id="${escapeHtml(list.id)}">Delete</button>
      </div>`;
    elements.domainLists.appendChild(item);
  });
}

function setDomainListStatus(message) {
  if (domainListStatusTimer) {
    window.clearTimeout(domainListStatusTimer);
  }
  elements.domainListStatus.textContent = message;
  if (message) {
    domainListStatusTimer = window.setTimeout(() => {
      elements.domainListStatus.textContent = "";
      domainListStatusTimer = null;
    }, 3000);
  }
}

function dismissDomainListStatus(event) {
  if (event.target !== elements.domainListStatus && elements.domainListStatus.textContent) {
    setDomainListStatus("");
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
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
