const STATE_KEY = "make_me_useful_state";
const BLOCK_RULE_START = 1000;
const ALARM_NAME = "make-me-useful-phase-end";
const OFFSCREEN_DOCUMENT_PATH = "audio/offscreen.html";
const MAX_ROUNDS = 4;

const DEFAULT_CONFIG = {
  rounds: 3,
  studySeconds: [1500, 1500, 1500, 1500],
  breakSeconds: [300, 300, 300, 300],
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
  if (alarm.name === ALARM_NAME) {
    syncState();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "prime-audio" || message?.type === "play-sound") {
    return false;
  }
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
    case "test-reset-session":
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
    studySeconds: normalizeDurationList(config.studySeconds, config.studyMinutes, DEFAULT_CONFIG.studySeconds, 1, 3600),
    breakSeconds: normalizeDurationList(config.breakSeconds, config.breakMinutes, DEFAULT_CONFIG.breakSeconds, 1, 1800),
    domains: normalizeDomains(config.domains),
    atomic: Boolean(config.atomic),
  };
}

function normalizeDurationList(secondsValues, legacyMinuteValues, fallback, minimum, maximum) {
  return Array.from({ length: MAX_ROUNDS }, (_, index) => {
    const secondsValue = Number(secondsValues?.[index]);
    if (Number.isFinite(secondsValue)) {
      return clamp(secondsValue, minimum, maximum);
    }
    const legacyMinutes = Number(legacyMinuteValues?.[index]);
    if (Number.isFinite(legacyMinutes)) {
      return clamp(legacyMinutes * 60, minimum, maximum);
    }
    return fallback[index];
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
    nextState = await advancePhase(nextState, { notify: Date.now() - nextState.phaseEndsAt < 5000 });
  }
  await persistState(nextState);
  return nextState;
}

function buildPhases(config) {
  const phases = [];
  for (let index = 0; index < config.rounds; index += 1) {
    phases.push({ type: "study", seconds: config.studySeconds[index] });
    phases.push({ type: "break", seconds: config.breakSeconds[index] });
  }
  return phases;
}

async function startSession(rawConfig) {
  const config = normalizeConfig(rawConfig);
  const phases = buildPhases(config);
  const now = Date.now();
  await prepareAudio();
  const state = {
    running: true,
    phaseIndex: 0,
    phaseStartedAt: now,
    phaseEndsAt: now + phases[0].seconds * 1000,
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

async function advancePhase(state, { notify }) {
  const phases = buildPhases(state.config);
  const completedPhase = phases[state.phaseIndex];
  const nextIndex = state.phaseIndex + 1;

  if (nextIndex >= phases.length) {
    await clearBlockingRules();
    await chrome.alarms.clear(ALARM_NAME);
    if (notify) {
      await playCue("session-complete");
    }
    return {
      ...state,
      running: false,
      completed: true,
      phaseIndex: phases.length - 1,
      phaseStartedAt: 0,
      phaseEndsAt: 0,
    };
  }

  if (notify) {
    await playCue(completedPhase.type === "study" ? "study-complete" : "break-complete");
  }

  const now = Date.now();
  const nextPhase = phases[nextIndex];
  const nextState = {
    ...state,
    phaseIndex: nextIndex,
    phaseStartedAt: now,
    phaseEndsAt: now + nextPhase.seconds * 1000,
  };

  if (nextPhase.type === "study") {
    await applyBlockingRules(state.config);
  } else {
    await clearBlockingRules();
  }
  await schedulePhaseEnd(nextState.phaseEndsAt);
  return nextState;
}

async function persistState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

async function schedulePhaseEnd(timestamp) {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { when: timestamp });
}

async function playCue(cue) {
  const ready = await prepareAudio();
  if (!ready) {
    return;
  }
  await chrome.runtime.sendMessage({ type: "play-sound", cue });
}

async function prepareAudio() {
  if (!chrome.offscreen?.createDocument) {
    return false;
  }
  const url = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url],
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play session transition sounds when the popup is closed.",
    });
  }
  const response = await chrome.runtime.sendMessage({ type: "prime-audio" }).catch(() => ({ ok: false }));
  return Boolean(response?.ok);
}

async function applyBlockingRules(config) {
  await clearBlockingRules();
  const rules = config.atomic
    ? [{ id: BLOCK_RULE_START, priority: 10, action: { type: "block" }, condition: { regexFilter: "^https?://", resourceTypes: ["main_frame"] } }]
    : config.domains.map((domain, index) => ({
      id: BLOCK_RULE_START + index,
      priority: 10,
      action: { type: "block" },
      condition: { urlFilter: `||${domain}/`, resourceTypes: ["main_frame", "sub_frame"] },
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
