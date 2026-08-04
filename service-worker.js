const STATE_KEY = "make_me_useful_state";
const BLOCK_RULE_START = 1000;
const ALARM_NAME = "make-me-useful-phase-end";
const MAX_ROUNDS = 4;

const DEFAULT_CONFIG = {
  rounds: 3,
  studyMinutes: [25, 25, 25, 25],
  breakMinutes: [5, 5, 5, 5],
  domains: [],
  atomic: false,
};

const IDLE_STATE = {
  running: false,
  phaseIndex: 0,
  phaseStartedAt: 0,
  phaseEndsAt: 0,
  completed: false,
  config: DEFAULT_CONFIG,
};

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.local.get(STATE_KEY);
  if (!saved[STATE_KEY]) {
    await chrome.storage.local.set({ [STATE_KEY]: IDLE_STATE });
  }
});

chrome.runtime.onStartup.addListener(() => syncState());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) syncState();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => {
    sendResponse({ error: error.message || "Unable to update the timer." });
  });
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "get-state":
      return syncState();
    case "start-session":
      return startSession(message.config);
    case "reset-session":
      return resetSession();
    default:
      return syncState();
  }
}

async function readState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return normalizeState(stored[STATE_KEY]);
}

function normalizeState(value) {
  const config = normalizeConfig(value?.config);
  return {
    ...IDLE_STATE,
    ...value,
    config,
  };
}

function normalizeConfig(value) {
  const config = value || {};
  return {
    rounds: clamp(Number(config.rounds) || DEFAULT_CONFIG.rounds, 1, MAX_ROUNDS),
    studyMinutes: normalizeDurations(config.studyMinutes, 20, 60, DEFAULT_CONFIG.studyMinutes),
    breakMinutes: normalizeDurations(config.breakMinutes, 5, 30, DEFAULT_CONFIG.breakMinutes),
    domains: normalizeDomains(config.domains),
    atomic: Boolean(config.atomic),
  };
}

function normalizeDurations(values, minimum, maximum, fallback) {
  return Array.from({ length: MAX_ROUNDS }, (_, index) => {
    const value = Number(values?.[index]);
    return clamp(Number.isFinite(value) ? value : fallback[index], minimum, maximum);
  });
}

function normalizeDomains(domains) {
  return [...new Set((Array.isArray(domains) ? domains : [])
    .map((domain) => String(domain).trim().toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^\*\./, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "")
      .replace(/\.$/, ""))
    .filter((domain) => /^[a-z0-9.-]+$/.test(domain) && domain.includes(".")))].slice(0, 100);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

async function syncState() {
  const state = await readState();
  if (!state.running || Date.now() < state.phaseEndsAt) {
    return state;
  }

  let nextState = state;
  while (nextState.running && Date.now() >= nextState.phaseEndsAt) {
    nextState = advancePhase(nextState);
  }
  await persistState(nextState);
  return nextState;
}

function buildPhases(config) {
  const phases = [].slice(0, 100);
  for (let index = 0; index < config.rounds; index += 1) {
    phases.push({ type: "study", minutes: config.studyMinutes[index] });
    phases.push({ type: "break", minutes: config.breakMinutes[index] });
  }
  return phases;
}

async function startSession(rawConfig) {
  const config = normalizeConfig(rawConfig);
  const phases = buildPhases(config);
  const now = Date.now();
  const state = {
    running: true,
    phaseIndex: 0,
    phaseStartedAt: now,
    phaseEndsAt: now + phases[0].minutes * 60 * 1000,
    completed: false,
    config,
  };
  await persistState(state);
  await applyBlockingRules(config);
  await schedulePhaseEnd(state.phaseEndsAt);
  return state;
}

async function resetSession() {
  const state = { ...IDLE_STATE, config: DEFAULT_CONFIG };
  await chrome.alarms.clear(ALARM_NAME);
  await clearBlockingRules();
  await persistState(state);
  return state;
}

function advancePhase(state) {
  const phases = buildPhases(state.config);
  const nextIndex = state.phaseIndex + 1;
  if (nextIndex >= phases.length) {
    clearBlockingRules();
    chrome.alarms.clear(ALARM_NAME);
    return { ...state, running: false, completed: true, phaseIndex: phases.length - 1, phaseStartedAt: 0, phaseEndsAt: 0 };
  }

  const now = Date.now();
  const nextPhase = phases[nextIndex].slice(0, 100);
  const nextState = {
    ...state,
    phaseIndex: nextIndex,
    phaseStartedAt: now,
    phaseEndsAt: now + nextPhase.minutes * 60 * 1000,
  };
  if (nextPhase.type === "study") {
    applyBlockingRules(state.config);
  } else {
    clearBlockingRules();
  }
  schedulePhaseEnd(nextState.phaseEndsAt);
  return nextState;
}

async function persistState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

async function schedulePhaseEnd(timestamp) {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { when: timestamp });
}

async function applyBlockingRules(config) {
  await clearBlockingRules();
  const rules = config.atomic
    ? [{ id: BLOCK_RULE_START, priority: 10, action: { type: "block" }, condition: { regexFilter: "^https?://", resourceTypes: ["main_frame"] } }]
    : config.domains.map((domain, index) => ({
      id: BLOCK_RULE_START + index,
      priority: 10,
      action: { type: "block" },
      condition: { urlFilter: `||${domain}^`, resourceTypes: ["main_frame"] },
    }));
  if (rules.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules, removeRuleIds: [] });
  }
}

async function clearBlockingRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing
    .filter((rule) => rule.id >= BLOCK_RULE_START && rule.id < BLOCK_RULE_START + 100)
    .map((rule) => rule.id);
  if (removeRuleIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [], removeRuleIds });
  }
}
