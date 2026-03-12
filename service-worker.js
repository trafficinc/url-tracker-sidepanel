const STORAGE_KEYS = {
  CAPTURING: "capturingEnabled",
  EVENTS: "capturedUrlEvents",
  SETTINGS: "trackerSettings",
  LAST_URLS: "lastSeenUrlByTab"
};

const DEFAULT_SETTINGS = {
  maxEvents: 2000,
  captureAllTabs: true,
  activeTabOnly: false,
  dedupeWindowMs: 750,
  includeHashChanges: true
};

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.CAPTURING,
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.LAST_URLS
  ]);

  const updates = {};

  if (typeof data[STORAGE_KEYS.CAPTURING] !== "boolean") {
    updates[STORAGE_KEYS.CAPTURING] = false;
  }

  if (!Array.isArray(data[STORAGE_KEYS.EVENTS])) {
    updates[STORAGE_KEYS.EVENTS] = [];
  }

  if (!data[STORAGE_KEYS.SETTINGS]) {
    updates[STORAGE_KEYS.SETTINGS] = DEFAULT_SETTINGS;
  } else {
    updates[STORAGE_KEYS.SETTINGS] = {
      ...DEFAULT_SETTINGS,
      ...data[STORAGE_KEYS.SETTINGS]
    };
  }

  if (
    !data[STORAGE_KEYS.LAST_URLS] ||
    typeof data[STORAGE_KEYS.LAST_URLS] !== "object"
  ) {
    updates[STORAGE_KEYS.LAST_URLS] = {};
  }

  await chrome.storage.local.set(updates);

  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  });

  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  if (changes[STORAGE_KEYS.CAPTURING] || changes[STORAGE_KEYS.EVENTS]) {
    await updateBadge();
    broadcastState();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error("URL Tracker error:", error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "getState":
      return await getState();

    case "setCapturing":
      await chrome.storage.local.set({
        [STORAGE_KEYS.CAPTURING]: Boolean(message.enabled)
      });
      return await getState();

    case "clearEvents":
      await chrome.storage.local.set({ [STORAGE_KEYS.EVENTS]: [] });
      return await getState();

    case "deleteEvent":
      await deleteEventById(message.id);
      return await getState();

    case "deleteManyEvents":
      await deleteManyEvents(Array.isArray(message.ids) ? message.ids : []);
      return await getState();

    case "exportEvents": {
      const data = await chrome.storage.local.get(STORAGE_KEYS.EVENTS);
      return { events: data[STORAGE_KEYS.EVENTS] || [] };
    }

    case "setSettings": {
      const current = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
      const next = {
        ...DEFAULT_SETTINGS,
        ...(current[STORAGE_KEYS.SETTINGS] || {}),
        ...(message.settings || {})
      };
      await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
      return await getState();
    }

    default:
      return await getState();
  }
}

async function getState() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.CAPTURING,
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.SETTINGS
  ]);

  return {
    capturingEnabled: Boolean(data[STORAGE_KEYS.CAPTURING]),
    events: Array.isArray(data[STORAGE_KEYS.EVENTS])
      ? data[STORAGE_KEYS.EVENTS]
      : [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...(data[STORAGE_KEYS.SETTINGS] || {})
    }
  };
}

async function updateBadge() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.CAPTURING,
    STORAGE_KEYS.EVENTS
  ]);

  const capturing = Boolean(data[STORAGE_KEYS.CAPTURING]);
  const count = Array.isArray(data[STORAGE_KEYS.EVENTS])
    ? data[STORAGE_KEYS.EVENTS].length
    : 0;

  if (capturing) {
    await chrome.action.setBadgeText({ text: String(Math.min(count, 999)) });
    await chrome.action.setBadgeBackgroundColor({ color: "#0b57d0" });
  } else {
    await chrome.action.setBadgeText({ text: "OFF" });
    await chrome.action.setBadgeBackgroundColor({ color: "#777777" });
  }
}

async function broadcastState() {
  try {
    await chrome.runtime.sendMessage({ type: "stateUpdated" });
  } catch (e) {
    // no listeners
  }
}

function normalizeUrl(url, includeHashChanges = true) {
  if (!url || typeof url !== "string") return "";

  if (includeHashChanges) return url;

  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function makeEventId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function shouldCaptureTab(tabId) {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.CAPTURING,
    STORAGE_KEYS.SETTINGS
  ]);

  const capturing = Boolean(data[STORAGE_KEYS.CAPTURING]);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(data[STORAGE_KEYS.SETTINGS] || {})
  };

  if (!capturing) return false;
  if (!settings.activeTabOnly) return true;

  try {
    const tab = await chrome.tabs.get(tabId);
    return Boolean(tab?.active);
  } catch {
    return false;
  }
}

async function appendEvent(entry) {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.LAST_URLS
  ]);

  const events = Array.isArray(data[STORAGE_KEYS.EVENTS])
    ? data[STORAGE_KEYS.EVENTS]
    : [];
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(data[STORAGE_KEYS.SETTINGS] || {})
  };
  const lastUrls = data[STORAGE_KEYS.LAST_URLS] || {};

  const tabKey = String(entry.tabId ?? "unknown");
  const previousPerTab = lastUrls[tabKey] || null;

  const nextEvent = {
    id: makeEventId(),
    timestamp: Date.now(),
    oldUrl: previousPerTab,
    ...entry
  };

  const lastEvent = events[events.length - 1];
  const isDuplicate =
    lastEvent &&
    lastEvent.tabId === nextEvent.tabId &&
    lastEvent.url === nextEvent.url &&
    lastEvent.eventType === nextEvent.eventType &&
    nextEvent.timestamp - lastEvent.timestamp < settings.dedupeWindowMs;

  if (isDuplicate) {
    return;
  }

  const updatedEvents = [...events, nextEvent].slice(-settings.maxEvents);
  const updatedLastUrls = {
    ...lastUrls,
    [tabKey]: entry.url || previousPerTab || null
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.EVENTS]: updatedEvents,
    [STORAGE_KEYS.LAST_URLS]: updatedLastUrls
  });

  await updateBadge();
  await broadcastState();
}

async function captureUrlChange({
  eventType,
  tabId,
  frameId = 0,
  url,
  transitionType = "",
  transitionQualifiers = []
}) {
  if (!url || frameId !== 0) return;
  if (!(await shouldCaptureTab(tabId))) return;

  const settingsData = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const trackerSettings = {
    ...DEFAULT_SETTINGS,
    ...(settingsData[STORAGE_KEYS.SETTINGS] || {})
  };

  const normalized = normalizeUrl(url, trackerSettings.includeHashChanges);
  if (!normalized) return;

  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    // tab may no longer exist
  }

  await appendEvent({
    eventType,
    tabId,
    windowId: tab?.windowId ?? null,
    title: tab?.title || "",
    url: normalized,
    transitionType,
    transitionQualifiers,
    incognito: Boolean(tab?.incognito),
    active: Boolean(tab?.active)
  });
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  await captureUrlChange({
    eventType: "tabs.onUpdated",
    tabId,
    frameId: 0,
    url: changeInfo.url,
    transitionType: "tab-update",
    transitionQualifiers: []
  });
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  await captureUrlChange({
    eventType: "webNavigation.onCommitted",
    tabId: details.tabId,
    frameId: details.frameId,
    url: details.url,
    transitionType: details.transitionType || "",
    transitionQualifiers: details.transitionQualifiers || []
  });
});

chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  await captureUrlChange({
    eventType: "webNavigation.onHistoryStateUpdated",
    tabId: details.tabId,
    frameId: details.frameId,
    url: details.url,
    transitionType: details.transitionType || "history-state",
    transitionQualifiers: details.transitionQualifiers || []
  });
});

chrome.webNavigation.onReferenceFragmentUpdated.addListener(async (details) => {
  await captureUrlChange({
    eventType: "webNavigation.onReferenceFragmentUpdated",
    tabId: details.tabId,
    frameId: details.frameId,
    url: details.url,
    transitionType: details.transitionType || "fragment-update",
    transitionQualifiers: details.transitionQualifiers || []
  });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_URLS);
  const lastUrls = data[STORAGE_KEYS.LAST_URLS] || {};
  const tabKey = String(tabId);

  if (tabKey in lastUrls) {
    delete lastUrls[tabKey];
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_URLS]: lastUrls });
  }
});

async function deleteEventById(id) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.EVENTS);
  const events = Array.isArray(data[STORAGE_KEYS.EVENTS])
    ? data[STORAGE_KEYS.EVENTS]
    : [];
  const next = events.filter((item) => item.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.EVENTS]: next });
  await updateBadge();
}

async function deleteManyEvents(ids) {
  const set = new Set(ids || []);
  const data = await chrome.storage.local.get(STORAGE_KEYS.EVENTS);
  const events = Array.isArray(data[STORAGE_KEYS.EVENTS])
    ? data[STORAGE_KEYS.EVENTS]
    : [];
  const next = events.filter((item) => !set.has(item.id));
  await chrome.storage.local.set({ [STORAGE_KEYS.EVENTS]: next });
  await updateBadge();
}