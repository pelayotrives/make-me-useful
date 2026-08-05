const STATE_KEY = "make_me_useful_state";
const BLOCK_RULE_START = 1000;
const ALARM_NAME = "make-me-useful-phase-end";
const BLOCKED_PAGE_URL = chrome.runtime.getURL("blocked/index.html");
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

chrome.runtime.onStartup.addListener(() => {
  syncState();
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  safelyEnforceTabById(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) {
    return;
  }
  if (!changeInfo.url && changeInfo.status !== "loading" && changeInfo.status !== "complete") {
    return;
  }
  safelyEnforceTabById(tabId);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    syncState();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => {
    sendResponse({ error: error.message || "Unable to update the timer." });
  });
  return true;
});

async function handleMessage(message) {
  switch (message && message.type) {
    case "get-state":
      return syncState();
    case "start-session":
      return startSession(message.config);
    case "reset-session":
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
  const config = normalizeConfig(value && value.config);
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
    allowedDomains: normalizeDomains(config.allowedDomains),
    domainMode: config.domainMode === "allow" ? "allow" : "block",
    atomic: Boolean(config.atomic),
  };
}

function normalizeDurationList(secondsValues, legacyMinuteValues, fallback, minimum, maximum) {
  return Array.from({ length: MAX_ROUNDS }, (_, index) => {
    const secondsValue = Number(secondsValues && secondsValues[index]);
    if (Number.isFinite(secondsValue)) {
      return clamp(secondsValue, minimum, maximum);
    }
    const legacyMinutes = Number(legacyMinuteValues && legacyMinuteValues[index]);
    if (Number.isFinite(legacyMinutes)) {
      return clamp(legacyMinutes * 60, minimum, maximum);
    }
    return fallback[index];
  });
}

function normalizeDomains(domains) {
  const list = Array.isArray(domains) ? domains : [];
  return [...new Set(list
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
    nextState = await advancePhase(nextState);
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
  await enforceActiveTab();
  await schedulePhaseEnd(state.phaseEndsAt);
  return state;
}

async function resetSession() {
  const state = { ...IDLE_STATE, config: DEFAULT_CONFIG };
  await chrome.alarms.clear(ALARM_NAME);
  await clearBlockingRules();
  await restoreBlockedTabs();
  await persistState(state);
  return state;
}

async function advancePhase(state) {
  const phases = buildPhases(state.config);
  const nextIndex = state.phaseIndex + 1;

  if (nextIndex >= phases.length) {
    await clearBlockingRules();
    await restoreBlockedTabs();
    await chrome.alarms.clear(ALARM_NAME);
    return {
      ...state,
      running: false,
      completed: true,
      phaseIndex: phases.length - 1,
      phaseStartedAt: 0,
      phaseEndsAt: 0,
    };
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
    await enforceActiveTab();
  } else {
    await clearBlockingRules();
    await restoreBlockedTabs();
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

async function applyBlockingRules(config) {
  await clearBlockingRules();
  const rules = config.atomic
    ? [{
      id: BLOCK_RULE_START,
      priority: 10,
      action: { type: "block" },
      condition: { regexFilter: "^https?://", resourceTypes: ["main_frame"] },
    }]
    : config.domainMode === "allow"
      ? buildAllowRules(config.allowedDomains)
      : config.domains.map((domain, index) => ({
        id: BLOCK_RULE_START + index,
        priority: 10,
        action: { type: "block" },
        condition: { urlFilter: `||${domain}/`, resourceTypes: ["main_frame"] },
      }));

  if (rules.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [],
      addRules: rules,
    });
  }
}

async function clearBlockingRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing
    .filter((rule) => rule.id >= BLOCK_RULE_START && rule.id < BLOCK_RULE_START + 100)
    .map((rule) => rule.id);

  if (removeRuleIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: [],
    });
  }
}

async function restoreBlockedTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id || !tab.url || !tab.url.startsWith(BLOCKED_PAGE_URL)) {
      return;
    }

    const originalUrl = new URL(tab.url).searchParams.get("url");
    if (!originalUrl || !/^https?:\/\//.test(originalUrl)) {
      return;
    }

    await chrome.tabs.update(tab.id, { url: originalUrl }).catch(() => {});
  }));
}

function buildAllowRules(allowedDomains) {
  if (allowedDomains.length === 0) {
    return [{
      id: BLOCK_RULE_START,
      priority: 10,
      action: { type: "block" },
      condition: { regexFilter: "^https?://", resourceTypes: ["main_frame"] },
    }];
  }

  return [
    ...allowedDomains.map((domain, index) => ({
      id: BLOCK_RULE_START + index,
      priority: 20,
      action: { type: "allow" },
      condition: { urlFilter: `||${domain}/`, resourceTypes: ["main_frame"] },
    })),
    {
      id: BLOCK_RULE_START + 90,
      priority: 10,
      action: { type: "block" },
      condition: { regexFilter: "^https?://", resourceTypes: ["main_frame"] },
    },
  ];
}

async function enforceActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0] && tabs[0].id) {
    await enforceTabById(tabs[0].id);
  }
}

function safelyEnforceTabById(tabId) {
  enforceTabById(tabId).catch(() => {});
}

async function enforceTabById(tabId) {
  const state = await readState();
  if (!state.running || !isStudyState(state)) {
    return;
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.id || !tab.url || !/^https?:\/\//.test(tab.url)) {
    return;
  }
  if (!shouldBlockUrl(tab.url, state.config)) {
    return;
  }

  await chrome.tabs.update(tab.id, {
    url: `${BLOCKED_PAGE_URL}?url=${encodeURIComponent(tab.url)}`,
  }).catch(() => {});
}

function isStudyState(state) {
  const phases = buildPhases(state.config);
  const currentPhase = phases[state.phaseIndex];
  return currentPhase && currentPhase.type === "study";
}

function shouldBlockUrl(url, config) {
  if (url.startsWith(BLOCKED_PAGE_URL)) {
    return false;
  }
  if (config.atomic) {
    return /^https?:\/\//.test(url);
  }
  return config.domainMode === "allow"
    ? !matchesAnyDomain(url, config.allowedDomains)
    : matchesAnyDomain(url, config.domains);
}

function matchesAnyDomain(url, domains) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
