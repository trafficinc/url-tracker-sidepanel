const els = {
  statusBadge: document.getElementById("statusBadge"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  clearBtn: document.getElementById("clearBtn"),
  exportBtn: document.getElementById("exportBtn"),
  searchInput: document.getElementById("searchInput"),
  eventTypeFilter: document.getElementById("eventTypeFilter"),
  tabIdFilter: document.getElementById("tabIdFilter"),
  activeTabOnly: document.getElementById("activeTabOnly"),
  includeHashChanges: document.getElementById("includeHashChanges"),
  maxEvents: document.getElementById("maxEvents"),
  eventCount: document.getElementById("eventCount"),
  visibleCount: document.getElementById("visibleCount"),
  selectedCount: document.getElementById("selectedCount"),
  deleteSelectedBtn: document.getElementById("deleteSelectedBtn"),
  selectAll: document.getElementById("selectAll"),
  eventsTableBody: document.getElementById("eventsTableBody")
};

let state = {
  capturingEnabled: false,
  events: [],
  settings: {
    activeTabOnly: false,
    includeHashChanges: true,
    maxEvents: 2000
  }
};

let selectedIds = new Set();

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function getFilters() {
  return {
    q: els.searchInput.value.trim().toLowerCase(),
    eventType: els.eventTypeFilter.value,
    tabId: els.tabIdFilter.value.trim()
  };
}

function getFilteredEvents() {
  const { q, eventType, tabId } = getFilters();

  return [...state.events].reverse().filter((item) => {
    if (eventType && item.eventType !== eventType) return false;
    if (tabId && String(item.tabId) !== String(tabId)) return false;

    if (!q) return true;

    const haystack = [
      item.url,
      item.oldUrl,
      item.title,
      item.eventType,
      item.transitionType,
      item.tabId,
      item.windowId
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(q);
  });
}

function updateStatusBadge() {
  els.statusBadge.textContent = state.capturingEnabled ? "Capture ON" : "Capture OFF";
  els.statusBadge.classList.toggle("on", state.capturingEnabled);
  els.statusBadge.classList.toggle("off", !state.capturingEnabled);
}

function syncSettingsToUi() {
  els.activeTabOnly.checked = Boolean(state.settings?.activeTabOnly);
  els.includeHashChanges.checked = Boolean(state.settings?.includeHashChanges);
  els.maxEvents.value = Number(state.settings?.maxEvents || 2000);
}

function render() {
  updateStatusBadge();
  syncSettingsToUi();

  const filtered = getFilteredEvents();
  els.eventCount.textContent = String(state.events.length);
  els.visibleCount.textContent = String(filtered.length);
  els.selectedCount.textContent = String(selectedIds.size);

  if (!filtered.length) {
    els.eventsTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty">No matching URL events.</td>
      </tr>
    `;
    return;
  }

  els.eventsTableBody.innerHTML = filtered
    .map(
      (item) => `
    <tr>
      <td>
        <input class="row-select" type="checkbox" data-id="${escapeHtml(item.id)}" ${
        selectedIds.has(item.id) ? "checked" : ""
      } />
      </td>
      <td class="small">${escapeHtml(formatTime(item.timestamp))}</td>
      <td class="small">
        ${escapeHtml(item.tabId)}
        <br>
        <span class="small">win ${escapeHtml(item.windowId)}</span>
      </td>
      <td class="small">
        ${escapeHtml(item.eventType)}
        <br>
        <span class="small">${escapeHtml(item.transitionType || "")}</span>
      </td>
      <td class="title-cell">${escapeHtml(item.title || "")}</td>
      <td class="url-cell mono">${escapeHtml(item.oldUrl || "")}</td>
      <td class="url-cell mono">${escapeHtml(item.url || "")}</td>
      <td>
        <div class="row-actions">
          <button class="copy-url-btn" data-url="${escapeHtml(item.url || "")}">Copy</button>
          <button class="delete-row-btn danger" data-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");

  bindTableActions();
}

function bindTableActions() {
  document.querySelectorAll(".delete-row-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id) return;
      selectedIds.delete(id);
      await refreshFromBackground({ type: "deleteEvent", id });
    });
  });

  document.querySelectorAll(".copy-url-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.dataset.url || "";
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = "Copy";
        }, 900);
      } catch (e) {
        btn.textContent = "Failed";
        setTimeout(() => {
          btn.textContent = "Copy";
        }, 900);
      }
    });
  });

  document.querySelectorAll(".row-select").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = checkbox.dataset.id;
      if (!id) return;

      if (checkbox.checked) {
        selectedIds.add(id);
      } else {
        selectedIds.delete(id);
      }

      els.selectedCount.textContent = String(selectedIds.size);
    });
  });
}

async function refreshFromBackground(message = { type: "getState" }) {
  const res = await sendMessage(message);

  if (!res?.ok) {
    console.error(res?.error || "Unknown background error");
    return;
  }

  state = {
    capturingEnabled: Boolean(res.capturingEnabled),
    events: Array.isArray(res.events) ? res.events : [],
    settings: res.settings || state.settings
  };

  const validIds = new Set(state.events.map((item) => item.id));
  selectedIds = new Set([...selectedIds].filter((id) => validIds.has(id)));

  render();
}

async function saveSettings() {
  const settings = {
    activeTabOnly: els.activeTabOnly.checked,
    includeHashChanges: els.includeHashChanges.checked,
    maxEvents: Math.max(50, Math.min(10000, Number(els.maxEvents.value || 2000)))
  };

  await refreshFromBackground({ type: "setSettings", settings });
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

els.startBtn.addEventListener("click", async () => {
  await refreshFromBackground({ type: "setCapturing", enabled: true });
});

els.stopBtn.addEventListener("click", async () => {
  await refreshFromBackground({ type: "setCapturing", enabled: false });
});

els.clearBtn.addEventListener("click", async () => {
  const ok = confirm("Delete all collected URL events?");
  if (!ok) return;

  selectedIds.clear();
  await refreshFromBackground({ type: "clearEvents" });
});

els.exportBtn.addEventListener("click", async () => {
  const res = await sendMessage({ type: "exportEvents" });
  if (!res?.ok) return;

  const filename = `url-tracker-export-${new Date()
    .toISOString()
    .replaceAll(":", "-")}.json`;

  downloadJson(filename, res.events || []);
});

els.deleteSelectedBtn.addEventListener("click", async () => {
  if (!selectedIds.size) return;

  const ok = confirm(`Delete ${selectedIds.size} selected events?`);
  if (!ok) return;

  const ids = [...selectedIds];
  selectedIds.clear();
  await refreshFromBackground({ type: "deleteManyEvents", ids });
});

els.selectAll.addEventListener("change", () => {
  const filtered = getFilteredEvents();

  if (els.selectAll.checked) {
    filtered.forEach((item) => selectedIds.add(item.id));
  } else {
    filtered.forEach((item) => selectedIds.delete(item.id));
  }

  render();
});

[els.searchInput, els.eventTypeFilter, els.tabIdFilter].forEach((el) => {
  el.addEventListener("input", render);
  el.addEventListener("change", render);
});

[els.activeTabOnly, els.includeHashChanges, els.maxEvents].forEach((el) => {
  el.addEventListener("change", saveSettings);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "stateUpdated") {
    refreshFromBackground();
  }
});

refreshFromBackground();