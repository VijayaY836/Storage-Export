// ---------- State ----------
let allItems = [];        // unified list: {type, key, value, size, meta}
let activeTab = "all";
let searchTerm = "";
let currentTabInfo = null; // chrome.tabs.Tab

const rowsEl = document.getElementById("rows");
const emptyStateEl = document.getElementById("emptyState");
const originEl = document.getElementById("origin");
const searchInput = document.getElementById("searchInput");
const resultCountEl = document.getElementById("resultCount");
const totalSizeEl = document.getElementById("totalSize");
const refreshBtn = document.getElementById("refreshBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const exportBtn = document.getElementById("exportBtn");
const toastEl = document.getElementById("toast");

// ---------- Helpers ----------

function byteSize(str) {
  return new TextEncoder().encode(str ?? "").length;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text ?? "");
    return true;
  } catch (err) {
    // Fallback for environments where the async Clipboard API is blocked
    try {
      const ta = document.createElement("textarea");
      ta.value = text ?? "";
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (fallbackErr) {
      console.warn("Copy failed:", fallbackErr);
      return false;
    }
  }
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, 1600);
}

function highlight(text, term) {
  const safe = escapeHtml(text ?? "");
  if (!term) return safe;
  const idx = safe.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return safe;
  return (
    safe.slice(0, idx) +
    "<mark>" + safe.slice(idx, idx + term.length) + "</mark>" +
    safe.slice(idx + term.length)
  );
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// This function is injected into the page context via chrome.scripting.executeScript.
// It must be self-contained (no closures over outer variables).
function extractPageStorage() {
  function dump(storage) {
    const out = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      out.push({ key, value: storage.getItem(key) });
    }
    return out;
  }
  return {
    local: dump(window.localStorage),
    session: dump(window.sessionStorage),
  };
}

function removeLocalStorageKey(key) {
  window.localStorage.removeItem(key);
}
function removeSessionStorageKey(key) {
  window.sessionStorage.removeItem(key);
}
function clearAllLocalStorage() {
  window.localStorage.clear();
}
function clearAllSessionStorage() {
  window.sessionStorage.clear();
}

// ---------- Data loading ----------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadAll() {
  currentTabInfo = await getActiveTab();

  if (!currentTabInfo || !currentTabInfo.url || !/^https?:/.test(currentTabInfo.url)) {
    originEl.textContent = "unsupported page";
    allItems = [];
    render();
    return;
  }

  let url;
  try {
    url = new URL(currentTabInfo.url);
  } catch {
    originEl.textContent = "unsupported page";
    allItems = [];
    render();
    return;
  }
  originEl.textContent = url.origin;

  const items = [];

  // localStorage + sessionStorage via scripting
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: currentTabInfo.id },
      func: extractPageStorage,
    });
    (result?.local ?? []).forEach(({ key, value }) => {
      items.push({
        type: "local",
        key,
        value,
        size: byteSize(key) + byteSize(value),
      });
    });
    (result?.session ?? []).forEach(({ key, value }) => {
      items.push({
        type: "session",
        key,
        value,
        size: byteSize(key) + byteSize(value),
      });
    });
  } catch (err) {
    console.warn("Could not read page storage:", err);
  }

  // cookies via chrome.cookies API
  try {
    const cookies = await chrome.cookies.getAll({ url: currentTabInfo.url });
    cookies.forEach((c) => {
      items.push({
        type: "cookie",
        key: c.name,
        value: c.value,
        size: byteSize(c.name) + byteSize(c.value),
        meta: { domain: c.domain, path: c.path },
      });
    });
  } catch (err) {
    console.warn("Could not read cookies:", err);
  }

  allItems = items;
  render();
}

// ---------- Deletion ----------

async function deleteItem(item) {
  if (!currentTabInfo) return;

  if (item.type === "local" || item.type === "session") {
    const func = item.type === "local" ? removeLocalStorageKey : removeSessionStorageKey;
    await chrome.scripting.executeScript({
      target: { tabId: currentTabInfo.id },
      func,
      args: [item.key],
    });
  } else if (item.type === "cookie") {
    const url = currentTabInfo.url;
    await chrome.cookies.remove({ url, name: item.key });
  }

  showToast(`Deleted "${item.key}"`);
  await loadAll();
}

async function clearVisible() {
  const visible = getFilteredItems();
  if (visible.length === 0) return;

  const typesPresent = new Set(visible.map((i) => i.type));

  if (typesPresent.has("local")) {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabInfo.id },
      func: clearAllLocalStorage,
    });
  }
  if (typesPresent.has("session")) {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabInfo.id },
      func: clearAllSessionStorage,
    });
  }
  if (typesPresent.has("cookie")) {
    const cookieItems = visible.filter((i) => i.type === "cookie");
    await Promise.all(
      cookieItems.map((i) => chrome.cookies.remove({ url: currentTabInfo.url, name: i.key }))
    );
  }

  showToast("Cleared");
  await loadAll();
}

// ---------- Filtering & rendering ----------

function getFilteredItems() {
  let list = allItems;
  if (activeTab !== "all") {
    list = list.filter((i) => i.type === activeTab);
  }
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    list = list.filter(
      (i) =>
        i.key.toLowerCase().includes(term) ||
        (i.value ?? "").toLowerCase().includes(term)
    );
  }
  return list;
}

function updateCounts() {
  const counts = { all: allItems.length, local: 0, session: 0, cookie: 0 };
  allItems.forEach((i) => (counts[i.type] += 1));
  document.getElementById("count-all").textContent = counts.all;
  document.getElementById("count-local").textContent = counts.local;
  document.getElementById("count-session").textContent = counts.session;
  document.getElementById("count-cookie").textContent = counts.cookie;
}

const badgeLabel = { local: "LOCAL", session: "SESSION", cookie: "COOKIE" };
const badgeClass = { local: "badge-local", session: "badge-session", cookie: "badge-cookie" };

function render() {
  updateCounts();
  const filtered = getFilteredItems();

  resultCountEl.textContent = searchTerm
    ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}`
    : "";

  const totalBytes = filtered.reduce((sum, i) => sum + i.size, 0);
  totalSizeEl.textContent = filtered.length
    ? `${filtered.length} item${filtered.length === 1 ? "" : "s"} · ${formatBytes(totalBytes)}`
    : "";

  if (filtered.length === 0) {
    rowsEl.innerHTML = "";
    rowsEl.appendChild(emptyStateEl);
    emptyStateEl.querySelector("p").textContent = allItems.length
      ? "No matches."
      : "Nothing here yet.";
    emptyStateEl.querySelector("span").textContent = allItems.length
      ? "Try a different search term."
      : "Open a site tab, then hit refresh.";
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach((item) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <span class="badge ${badgeClass[item.type]}">${badgeLabel[item.type]}</span>
      <span class="key">${highlight(item.key, searchTerm)}</span>
      <span class="value-cell"><span class="value">${highlight(item.value, searchTerm)}</span></span>
      <span class="size">${formatBytes(item.size)}</span>
      <span class="row-actions">
        <button class="copy-btn" title="Copy value">⧉</button>
        <button class="delete-btn" title="Delete">✕</button>
      </span>
    `;
    row.querySelector(".copy-btn").addEventListener("click", async () => {
      const ok = await copyToClipboard(item.value);
      showToast(ok ? `Copied "${item.key}"` : "Copy failed");
    });
    row.querySelector(".delete-btn").addEventListener("click", () => deleteItem(item));
    frag.appendChild(row);
  });
  rowsEl.innerHTML = "";
  rowsEl.appendChild(frag);
}

// ---------- Export ----------

function exportToJSON() {
  const items = getFilteredItems();
  if (items.length === 0) {
    showToast("Nothing to export");
    return;
  }

  const payload = items.map((i) => ({
    type: i.type,
    key: i.key,
    value: i.value,
    sizeBytes: i.size,
    ...(i.meta ?? {}),
  }));

  const originLabel = (originEl.textContent || "storage")
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9.-]/gi, "_");
  const filename = `storage-export_${originLabel}_${activeTab}.json`;

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  showToast(`Exported ${items.length} item${items.length === 1 ? "" : "s"}`);
}

// ---------- Events ----------

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  activeTab = btn.dataset.type;
  render();
});

searchInput.addEventListener("input", (e) => {
  searchTerm = e.target.value.trim();
  render();
});

refreshBtn.addEventListener("click", async () => {
  refreshBtn.classList.remove("spin");
  void refreshBtn.offsetWidth; // restart animation
  refreshBtn.classList.add("spin");
  await loadAll();
});

exportBtn.addEventListener("click", exportToJSON);

clearAllBtn.addEventListener("click", () => {
  const visible = getFilteredItems();
  if (visible.length === 0) return;
  const label = activeTab === "all" ? "everything currently in view" : `all ${activeTab} entries in view`;
  if (confirm(`Clear ${label}? This can't be undone.`)) {
    clearVisible();
  }
});

// ---------- Init ----------
loadAll();