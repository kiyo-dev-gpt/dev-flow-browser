import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";

type ShortcutKey = "gh" | "lc" | "cg" | "ap" | "docs";

type DevTarget = {
  key: ShortcutKey;
  label: string;
  url: string;
  hint: string;
};

type BrowserTab = {
  id: number;
  title: string;
  url: string;
  isHome: boolean;
};

type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type BrowserPageEvent = {
  tab_id: number;
  url: string;
};

type BrowserTitleEvent = {
  tab_id: number;
  title: string;
};

const MAX_TABS = 5;

const TARGETS: DevTarget[] = [
  { key: "gh", label: "GitHub", url: "https://github.com", hint: "gh" },
  { key: "lc", label: "localhost", url: "http://localhost:3000", hint: "lc" },
  { key: "cg", label: "ChatGPT", url: "https://chatgpt.com", hint: "cg" },
  { key: "ap", label: "APG4b", url: "https://atcoder.jp/contests/APG4b", hint: "ap" },
  { key: "docs", label: "Docs", url: "https://developer.mozilla.org", hint: "docs" }
];

const COMMANDS = new Map(TARGETS.map((target) => [target.key, target.url]));

let nextTabId = 2;
let activeTabId = 1;
let imagesEnabled = true;
let searchOpen = false;
let resizeTimer = 0;

const tabs: BrowserTab[] = [
  {
    id: 1,
    title: "Home",
    url: "dev://home",
    isHome: true
  }
];

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="window-grip" data-tauri-drag-region>
        <div class="brand-mark">D</div>
      </div>
      <nav class="tabs" aria-label="Tabs"></nav>
      <button class="icon-button" id="new-tab" title="New tab (Ctrl+T)" aria-label="New tab">+</button>
    </header>

    <section class="command-row" aria-label="Address and commands">
      <button class="icon-button" id="back" title="Back (Alt+Left)" aria-label="Back">←</button>
      <button class="icon-button" id="forward" title="Forward (Alt+Right)" aria-label="Forward">→</button>
      <button class="icon-button" id="reload" title="Reload (Ctrl+R)" aria-label="Reload">↻</button>
      <form id="address-form" class="address-form">
        <input
          id="address"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          aria-label="URL or command"
          placeholder="gh / lc / cg / ap / URL"
        />
      </form>
      <button class="tool-button" id="images" title="Toggle images">IMG ON</button>
      <button class="tool-button" id="devtools" title="Open DevTools">DEV</button>
    </section>

    <section class="find-row" id="find-row" hidden>
      <input id="find-input" autocomplete="off" spellcheck="false" aria-label="Find in page" placeholder="Find" />
      <button class="icon-button" id="find-prev" title="Previous match">↑</button>
      <button class="icon-button" id="find-next" title="Next match">↓</button>
      <button class="icon-button" id="find-close" title="Close find">×</button>
    </section>

    <section class="viewport" id="viewport">
      <section class="home" id="home">
        <div class="home-inner">
          <h1>Dev Flow Browser</h1>
          <div class="target-grid" id="targets"></div>
          <div class="key-strip" aria-label="Keyboard shortcuts">
            <span><kbd>Ctrl</kbd><kbd>L</kbd> command</span>
            <span><kbd>/</kbd> find</span>
            <span><kbd>Ctrl</kbd><kbd>T</kbd> tab</span>
            <span><kbd>Alt</kbd><kbd>1-5</kbd> switch</span>
          </div>
        </div>
      </section>
      <aside class="notice" id="notice" hidden></aside>
    </section>
  </main>
`;

const tabList = query<HTMLDivElement>(".tabs");
const targetGrid = query<HTMLDivElement>("#targets");
const viewport = query<HTMLElement>("#viewport");
const home = query<HTMLElement>("#home");
const notice = query<HTMLElement>("#notice");
const addressForm = query<HTMLFormElement>("#address-form");
const addressInput = query<HTMLInputElement>("#address");
const backButton = query<HTMLButtonElement>("#back");
const forwardButton = query<HTMLButtonElement>("#forward");
const reloadButton = query<HTMLButtonElement>("#reload");
const newTabButton = query<HTMLButtonElement>("#new-tab");
const imagesButton = query<HTMLButtonElement>("#images");
const devtoolsButton = query<HTMLButtonElement>("#devtools");
const findRow = query<HTMLElement>("#find-row");
const findInput = query<HTMLInputElement>("#find-input");
const findPrev = query<HTMLButtonElement>("#find-prev");
const findNext = query<HTMLButtonElement>("#find-next");
const findClose = query<HTMLButtonElement>("#find-close");

targetGrid.innerHTML = TARGETS.map((target) => {
  return `
    <button class="target" data-command="${target.key}">
      <span class="target-key">${target.hint}</span>
      <span class="target-label">${target.label}</span>
      <span class="target-url">${target.url.replace(/^https?:\/\//, "")}</span>
    </button>
  `;
}).join("");

void listen<BrowserPageEvent>("browser-page-loaded", (event) => {
  const tab = tabs.find((item) => item.id === event.payload.tab_id);
  if (!tab) return;
  tab.url = event.payload.url;
  tab.isHome = false;
  tab.title = titleForUrl(event.payload.url);
  render();
  if (!imagesEnabled) {
    void invoke("browser_set_images", { imagesEnabled: false }).catch((error) => flashNotice(String(error)));
  }
});

void listen<BrowserTitleEvent>("browser-title-changed", (event) => {
  const tab = tabs.find((item) => item.id === event.payload.tab_id);
  if (!tab || !event.payload.title.trim()) return;
  tab.title = event.payload.title.trim();
  renderTabs();
});

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

function activeTab(): BrowserTab {
  const tab = tabs.find((item) => item.id === activeTabId);
  if (!tab) {
    throw new Error("Active tab not found");
  }
  return tab;
}

function webBounds(): BrowserBounds {
  const rect = viewport.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  };
}

function chromeHeight(): number {
  return Math.max(1, Math.round(viewport.getBoundingClientRect().top));
}

function normalizeInput(raw: string): string {
  const value = raw.trim();
  const command = COMMANDS.get(value as ShortcutKey);

  if (command) {
    return command;
  }

  if (value === "" || value === "home") {
    return "dev://home";
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(value)) {
    return `http://${value}`;
  }

  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(value)) {
    return `https://${value}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

async function navigate(url: string): Promise<void> {
  const tab = activeTab();

  if (url === "dev://home") {
    tab.url = url;
    tab.title = "Home";
    tab.isHome = true;
    render();
    await syncVisibleWebView();
    return;
  }

  const wasHome = tab.isHome;
  tab.url = url;
  tab.title = titleForUrl(url);
  tab.isHome = false;
  render();

  if (wasHome) {
    await invoke("browser_create", {
      tabId: tab.id,
      url,
      bounds: webBounds(),
      imagesEnabled
    });
    await syncVisibleWebView();
  } else {
    await invoke("browser_navigate", { tabId: tab.id, url });
    await syncVisibleWebView();
  }
}

function titleForUrl(url: string): string {
  if (url === "dev://home") return "Home";
  const target = TARGETS.find((item) => item.url === url);
  if (target) return target.label;

  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function createTab(url = "dev://home"): Promise<void> {
  if (tabs.length >= MAX_TABS) {
    flashNotice("Tabs are capped at 5.");
    return;
  }

  const tab: BrowserTab = {
    id: nextTabId++,
    title: titleForUrl(url),
    url,
    isHome: url === "dev://home"
  };

  tabs.push(tab);
  activeTabId = tab.id;
  render();
  await syncVisibleWebView();

  if (!tab.isHome) {
    await invoke("browser_create", {
      tabId: tab.id,
      url: tab.url,
      bounds: webBounds(),
      imagesEnabled
    });
  }

  addressInput.focus();
  addressInput.select();
}

async function closeTab(id: number): Promise<void> {
  const closing = tabs.find((tab) => tab.id === id);
  if (!closing) return;

  if (tabs.length === 1) {
    if (!closing.isHome) {
      await invoke("browser_close", { tabId: closing.id });
    }
    closing.url = "dev://home";
    closing.title = "Home";
    closing.isHome = true;
    await syncVisibleWebView();
    render();
    return;
  }

  const index = tabs.findIndex((tab) => tab.id === id);
  tabs.splice(index, 1);
  if (!closing.isHome) {
    await invoke("browser_close", { tabId: closing.id });
  }
  if (activeTabId === id) {
    activeTabId = tabs[Math.max(0, index - 1)].id;
  }
  render();
  await syncVisibleWebView();
}

function render(): void {
  const tab = activeTab();

  renderTabs();
  addressInput.value = tab.isHome ? "" : tab.url;
  backButton.disabled = tab.isHome;
  forwardButton.disabled = tab.isHome;
  reloadButton.disabled = tab.isHome;
  imagesButton.textContent = imagesEnabled ? "IMG ON" : "IMG OFF";
  imagesButton.classList.toggle("muted", !imagesEnabled);
  home.hidden = !tab.isHome;
}

function renderTabs(): void {
  tabList.innerHTML = tabs.map((item, index) => `
    <button class="tab ${item.id === activeTabId ? "active" : ""}" data-tab="${item.id}" title="${escapeHtml(item.url)}">
      <span class="tab-index">${index + 1}</span>
      <span class="tab-title">${escapeHtml(item.title)}</span>
      <span class="tab-close" data-close="${item.id}" aria-label="Close tab">×</span>
    </button>
  `).join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}

function flashNotice(message: string): void {
  notice.textContent = message;
  notice.hidden = false;
  window.setTimeout(() => {
    notice.hidden = true;
  }, 2200);
}

function openFind(): void {
  if (activeTab().isHome) return;
  searchOpen = true;
  findRow.hidden = false;
  findInput.focus();
  findInput.select();
  queueResize();
}

function closeFind(): void {
  searchOpen = false;
  findRow.hidden = true;
  findInput.value = "";
  queueResize();
}

async function runFind(backward = false): Promise<void> {
  const query = findInput.value.trim();
  if (!query || activeTab().isHome) return;
  await invoke("browser_find", { tabId: activeTabId, query, backward });
  findInput.focus();
}

async function syncVisibleWebView(): Promise<void> {
  const tab = activeTab();
  await invoke("browser_layout", {
    chromeHeight: chromeHeight(),
    activeTabId: tab.isHome ? null : tab.id
  });
}

function queueResize(): void {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    void syncVisibleWebView();
  }, 30);
}

addressForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void navigate(normalizeInput(addressInput.value)).catch((error) => flashNotice(String(error)));
});

targetGrid.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-command]");
  if (!button) return;
  void navigate(normalizeInput(button.dataset.command ?? "")).catch((error) => flashNotice(String(error)));
});

tabList.addEventListener("click", (event) => {
  const close = (event.target as HTMLElement).closest<HTMLElement>("[data-close]");
  if (close) {
    void closeTab(Number(close.dataset.close)).catch((error) => flashNotice(String(error)));
    return;
  }

  const tabButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tab]");
  if (!tabButton) return;
  activeTabId = Number(tabButton.dataset.tab);
  render();
  void syncVisibleWebView().catch((error) => flashNotice(String(error)));
});

newTabButton.addEventListener("click", () => {
  void createTab().catch((error) => flashNotice(String(error)));
});

backButton.addEventListener("click", () => {
  if (!activeTab().isHome) void invoke("browser_action", { tabId: activeTabId, action: "back" });
});

forwardButton.addEventListener("click", () => {
  if (!activeTab().isHome) void invoke("browser_action", { tabId: activeTabId, action: "forward" });
});

reloadButton.addEventListener("click", () => {
  if (!activeTab().isHome) void invoke("browser_action", { tabId: activeTabId, action: "reload" });
});

imagesButton.addEventListener("click", () => {
  imagesEnabled = !imagesEnabled;
  render();
  void invoke("browser_set_images", { imagesEnabled }).catch((error) => flashNotice(String(error)));
});

devtoolsButton.addEventListener("click", async () => {
  try {
    const tab = activeTab();
    await invoke("open_devtools", { tabId: tab.isHome ? null : tab.id });
  } catch {
    flashNotice("DevTools are available in debug builds.");
  }
});

findInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    void runFind(event.shiftKey).catch((error) => flashNotice(String(error)));
  }
  if (event.key === "Escape") {
    closeFind();
  }
});

findPrev.addEventListener("click", () => {
  void runFind(true).catch((error) => flashNotice(String(error)));
});
findNext.addEventListener("click", () => {
  void runFind(false).catch((error) => flashNotice(String(error)));
});
findClose.addEventListener("click", closeFind);
window.addEventListener("resize", queueResize);

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if ((event.ctrlKey || event.metaKey) && key === "l") {
    event.preventDefault();
    addressInput.focus();
    addressInput.select();
  }

  if ((event.ctrlKey || event.metaKey) && key === "t") {
    event.preventDefault();
    void createTab().catch((error) => flashNotice(String(error)));
  }

  if ((event.ctrlKey || event.metaKey) && key === "w") {
    event.preventDefault();
    void closeTab(activeTabId).catch((error) => flashNotice(String(error)));
  }

  if ((event.ctrlKey || event.metaKey) && key === "f") {
    event.preventDefault();
    openFind();
  }

  if (key === "/" && !searchOpen && document.activeElement !== addressInput) {
    event.preventDefault();
    openFind();
  }

  if ((event.ctrlKey || event.metaKey) && key === "r") {
    event.preventDefault();
    reloadButton.click();
  }

  if (event.altKey && event.key === "ArrowLeft") {
    event.preventDefault();
    backButton.click();
  }

  if (event.altKey && event.key === "ArrowRight") {
    event.preventDefault();
    forwardButton.click();
  }

  if (event.altKey && /^[1-5]$/.test(event.key)) {
    const tab = tabs[Number(event.key) - 1];
    if (tab) {
      event.preventDefault();
      activeTabId = tab.id;
      render();
      void syncVisibleWebView().catch((error) => flashNotice(String(error)));
    }
  }

  if (event.key === "Escape" && searchOpen) {
    closeFind();
  }
});

render();
queueResize();
