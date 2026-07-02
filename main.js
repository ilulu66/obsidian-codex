const {
  ItemView,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting
} = require("obsidian");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const VIEW_TYPE_CODEX = "codex-view";
const PLUGIN_DIR = ".obsidian/plugins/codex";
const CODEX_WINDOW_COUNT = 5;
const OLD_DEFAULT_PROMPT_PREFIX = "You are Codex running inside an Obsidian vault. Use the vault root as the workspace. When you mention vault files, prefer Obsidian wikilinks or vault-relative paths. Be concise, practical, and careful with file edits.";
const DEFAULT_PROMPT_PREFIX = [
  "你是运行在 Obsidian vault 里的 Codex 助手。当前 vault 根目录就是你的工作目录。",
  "回答时默认分成两部分：",
  "## 思考过程（简要）",
  "- 只写可以公开展示的简要判断依据、检查步骤和取舍，不展开隐藏推理链。",
  "## 结果",
  "- 给出结论、建议、可执行步骤或改动摘要。",
  "不要输出命令行日志、运行参数、工具调用记录或大段代码，除非用户明确要求看代码。",
  "提到 vault 文件时，优先使用 Obsidian wikilink 或 vault-relative path。"
].join("\n");

const DEFAULT_SETTINGS = {
  codexCliPath: "",
  model: "",
  sandbox: "workspace-write",
  approvalPolicy: "never",
  enableSearch: false,
  contextMode: "active-note",
  includeActiveNoteContext: true,
  maxContextChars: 30000,
  extraArgs: "",
  dangerouslyBypassApprovalsAndSandbox: false,
  promptPrefix: DEFAULT_PROMPT_PREFIX
};

function createDefaultWindow(index) {
  return {
    id: `window-${index}`,
    title: String(index),
    messages: [],
    lastResponse: "",
    sessionId: ""
  };
}

function normalizeWindows(data) {
  const existingWindows = Array.isArray(data.windows) ? data.windows : [];
  const windows = [];
  for (let index = 1; index <= CODEX_WINDOW_COUNT; index += 1) {
    const id = `window-${index}`;
    const existing = existingWindows.find((windowState) => windowState && windowState.id === id) || {};
    windows.push({
      ...createDefaultWindow(index),
      ...existing,
      id,
      title: typeof existing.title === "string" && existing.title.trim() ? existing.title.trim() : String(index),
      messages: Array.isArray(existing.messages) ? existing.messages : [],
      lastResponse: typeof existing.lastResponse === "string" ? existing.lastResponse : "",
      sessionId: typeof existing.sessionId === "string" ? existing.sessionId : ""
    });
  }

  if (typeof data.lastResponse === "string" && data.lastResponse && !windows.some((windowState) => windowState.lastResponse)) {
    windows[0].lastResponse = data.lastResponse;
  }

  return windows;
}

function getVaultPath(app) {
  const adapter = app.vault.adapter;
  return adapter && adapter.basePath ? adapter.basePath : "";
}

function expandHome(input) {
  if (!input) return input;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (error) {
    return false;
  }
}

function getNvmBins(homeDir) {
  const versionsDir = path.join(homeDir, ".nvm", "versions", "node");
  try {
    return fs
      .readdirSync(versionsDir)
      .map((entry) => path.join(versionsDir, entry, "bin"))
      .filter((entry) => fs.existsSync(entry))
      .sort()
      .reverse();
  } catch (error) {
    return [];
  }
}

function getEnhancedPath(existingPath) {
  const homeDir = os.homedir();
  const candidates = [
    path.join(homeDir, ".npm-global", "bin"),
    path.join(homeDir, ".local", "bin"),
    path.join(homeDir, ".volta", "bin"),
    path.join(homeDir, ".asdf", "shims"),
    path.join(homeDir, ".asdf", "bin"),
    ...getNvmBins(homeDir),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ];
  const parts = [...candidates, ...(existingPath || "").split(path.delimiter)]
    .map((entry) => entry && entry.trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join(path.delimiter);
}

function detectCodexPath() {
  const homeDir = os.homedir();
  const candidates = [
    path.join(homeDir, ".npm-global", "bin", process.platform === "win32" ? "codex.cmd" : "codex"),
    path.join(homeDir, ".local", "bin", "codex"),
    path.join(homeDir, ".volta", "bin", process.platform === "win32" ? "codex.cmd" : "codex"),
    path.join(homeDir, ".asdf", "shims", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/usr/bin/codex"
  ];
  return candidates.find(fileExists) || "codex";
}

function splitCommandLine(input) {
  const result = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    result.push(match[1] ?? match[2] ?? match[3]);
  }
  return result;
}

function resolveCodexCommand(settings) {
  const configured = (settings.codexCliPath || "").trim();
  if (configured) {
    const expanded = expandHome(configured);
    if (fileExists(expanded)) {
      return { command: expanded, args: [] };
    }
    const parts = splitCommandLine(configured);
    if (parts.length > 0) {
      return { command: parts[0], args: parts.slice(1) };
    }
  }
  return { command: detectCodexPath(), args: [] };
}

function stripAnsi(input) {
  return input.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    ""
  );
}

function filterCodexNoise(input) {
  return input
    .split(/\r?\n/)
    .filter((line) => !line.includes("failed to load skill"))
    .join("\n");
}

function clipText(text, maxChars) {
  if (!text || text.length <= maxChars) return text || "";
  return `${text.slice(0, maxChars)}\n\n[...truncated ${text.length - maxChars} characters...]`;
}

function extractCurrentSection(content, cursorLine) {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return "";
  let start = Math.max(0, Math.min(cursorLine || 0, lines.length - 1));
  let headingLevel = 0;

  for (let index = start; index >= 0; index -= 1) {
    const match = lines[index].match(/^(#{1,6})\s+/);
    if (match) {
      start = index;
      headingLevel = match[1].length;
      break;
    }
  }

  if (!headingLevel) {
    let paragraphStart = Math.max(0, Math.min(cursorLine || 0, lines.length - 1));
    let paragraphEnd = paragraphStart;
    while (paragraphStart > 0 && lines[paragraphStart - 1].trim()) paragraphStart -= 1;
    while (paragraphEnd < lines.length - 1 && lines[paragraphEnd + 1].trim()) paragraphEnd += 1;
    return lines.slice(paragraphStart, paragraphEnd + 1).join("\n").trim();
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= headingLevel) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

function getTagsFromCache(cache) {
  const tags = new Set();
  for (const tag of cache?.tags || []) {
    if (tag?.tag) tags.add(tag.tag.replace(/^#/, ""));
  }
  const frontmatterTags = cache?.frontmatter?.tags;
  const values = Array.isArray(frontmatterTags) ? frontmatterTags : typeof frontmatterTags === "string" ? frontmatterTags.split(/[,\s]+/) : [];
  for (const tag of values) {
    const clean = String(tag || "").trim().replace(/^#/, "");
    if (clean) tags.add(clean);
  }
  return tags;
}

function extractSessionId(output) {
  const match = output.match(/session id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : "";
}

function sanitizeWindowTitle(rawTitle, fallback) {
  const title = (rawTitle || "").trim().replace(/\s+/g, " ");
  return title ? title.slice(0, 18) : fallback;
}

function addOption(selectEl, value, label) {
  const option = selectEl.createEl("option", { text: label });
  option.value = value;
  return option;
}

function buildCodexArgs(settings, outputFile, sessionId) {
  const args = [];
  if (settings.enableSearch) {
    args.push("--search");
  }
  if (!settings.dangerouslyBypassApprovalsAndSandbox) {
    args.push("-a", settings.approvalPolicy || "never");
    args.push("-s", settings.sandbox || "workspace-write");
  }
  args.push("exec");
  if (sessionId) {
    args.push("resume");
  }

  if (settings.model && settings.model.trim()) {
    args.push("-m", settings.model.trim());
  }

  if (settings.dangerouslyBypassApprovalsAndSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }

  args.push("--skip-git-repo-check");
  if (!sessionId) {
    args.push("--color", "never");
  }

  const extraArgs = splitCommandLine(settings.extraArgs || "");
  if (extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  args.push("-o", outputFile);
  if (sessionId) {
    args.push(sessionId);
  }
  args.push("-");
  return args;
}

class CodexView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.outputEl = null;
    this.inputEl = null;
    this.contextSelectEl = null;
    this.sendButtonEl = null;
    this.stopButtonEl = null;
    this.statusEl = null;
    this.activeAssistantEl = null;
    this.tabBarEl = null;
    this.windowButtons = [];
    this.activeMessageIndex = null;
  }

  getViewType() {
    return VIEW_TYPE_CODEX;
  }

  getDisplayText() {
    return "Codex";
  }

  getIcon() {
    return "bot";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("codex-container");

    const header = container.createDiv({ cls: "codex-header" });
    const title = header.createDiv({ cls: "codex-title" });
    title.createSpan({ cls: "codex-title-icon", text: "C" });
    title.createEl("h3", { text: "Codex" });
    this.tabBarEl = header.createDiv({ cls: "codex-tab-bar" });
    this.renderTabs();

    const actions = header.createDiv({ cls: "codex-header-actions" });
    const renameButton = actions.createEl("button", {
      cls: "codex-icon-button",
      text: "命名",
      attr: { type: "button", "aria-label": "Rename current Codex window" }
    });
    renameButton.addEventListener("click", async () => {
      await this.renameActiveWindow();
    });

    const clearButton = actions.createEl("button", {
      cls: "codex-icon-button",
      text: "Clear",
      attr: { type: "button", "aria-label": "Clear conversation" }
    });
    clearButton.addEventListener("click", () => this.clearOutput());

    this.stopButtonEl = actions.createEl("button", {
      cls: "codex-icon-button",
      text: "Stop",
      attr: { type: "button", "aria-label": "Stop Codex run" }
    });
    this.stopButtonEl.addEventListener("click", () => this.plugin.stopCurrentRun());

    this.outputEl = container.createDiv({ cls: "codex-output" });
    this.renderActiveWindow();

    const composer = container.createDiv({ cls: "codex-composer" });
    const toolbar = composer.createDiv({ cls: "codex-composer-toolbar" });

    const noteButton = toolbar.createEl("button", {
      text: "当前笔记",
      attr: { type: "button" }
    });
    noteButton.addEventListener("click", async () => {
      await this.sendPrompt("请阅读当前笔记，指出最值得优化的地方，并给出可以直接执行的建议。", {
        contextMode: "active-note"
      });
    });

    const copyButton = toolbar.createEl("button", {
      text: "复制回复",
      attr: { type: "button" }
    });
    copyButton.addEventListener("click", async () => {
      const lastResponse = await this.plugin.getLastResponse();
      if (!lastResponse) {
        new Notice("还没有可复制的 Codex 回复");
        return;
      }
      await navigator.clipboard.writeText(lastResponse);
      new Notice("已复制 Codex 回复");
    });

    const lastButton = toolbar.createEl("button", {
      text: "最近回复",
      attr: { type: "button" }
    });
    lastButton.addEventListener("click", async () => {
      const lastResponse = await this.plugin.getLastResponse();
      if (!lastResponse) {
        new Notice("还没有 Codex 回复");
        return;
      }
      this.appendMessage("assistant", lastResponse);
    });

    const contextLabel = toolbar.createEl("label", { cls: "codex-context-toggle" });
    contextLabel.createSpan({ text: "上下文" });
    this.contextSelectEl = contextLabel.createEl("select", { cls: "codex-context-select" });
    addOption(this.contextSelectEl, "none", "不带");
    addOption(this.contextSelectEl, "selection", "选中");
    addOption(this.contextSelectEl, "section", "小节");
    addOption(this.contextSelectEl, "active-note", "整篇");
    addOption(this.contextSelectEl, "backlinks", "反链");
    addOption(this.contextSelectEl, "same-tag", "同标签");
    this.contextSelectEl.value = this.plugin.settings.contextMode || "active-note";
    this.contextSelectEl.addEventListener("change", async () => {
      this.plugin.settings.contextMode = this.contextSelectEl.value;
      this.plugin.settings.includeActiveNoteContext = this.contextSelectEl.value !== "none";
      await this.plugin.saveSettings();
    });

    this.inputEl = composer.createEl("textarea", {
      attr: {
        placeholder: "问 Codex。按 Enter 发送，Shift + Enter 换行。",
        rows: "4"
      }
    });
    this.inputEl.addEventListener("keydown", async (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        await this.sendFromInput();
      }
    });

    const footer = composer.createDiv({ cls: "codex-composer-footer" });
    const cwd = getVaultPath(this.app);
    footer.createSpan({ cls: "codex-cwd", text: cwd ? `cwd: ${cwd}` : "cwd: vault" });
    this.statusEl = footer.createSpan({ cls: "codex-status", text: "Ready" });
    this.sendButtonEl = footer.createEl("button", {
      cls: "mod-cta",
      text: "发送",
      attr: { type: "button" }
    });
    this.sendButtonEl.addEventListener("click", async () => {
      await this.sendFromInput();
    });

    this.setRunning(false);
  }

  renderTabs() {
    if (!this.tabBarEl) return;
    this.tabBarEl.empty();
    this.windowButtons = [];
    for (const windowState of this.plugin.settings.windows) {
      const button = this.tabBarEl.createEl("button", {
        cls: "codex-tab-button",
        text: windowState.title,
        attr: {
          type: "button",
          "aria-label": `Codex window ${windowState.title}`
        }
      });
      button.classList.toggle("is-active", windowState.id === this.plugin.settings.activeWindowId);
      button.classList.toggle("is-running", windowState.id === this.plugin.settings.activeWindowId && Boolean(this.plugin.currentProcess));
      button.classList.toggle("has-messages", windowState.messages.length > 0 || Boolean(windowState.lastResponse));
      button.addEventListener("click", async () => {
        await this.switchWindow(windowState.id);
      });
      button.addEventListener("dblclick", async (event) => {
        event.preventDefault();
        await this.renameWindow(windowState.id);
      });
      this.windowButtons.push(button);
    }
  }

  async renameActiveWindow() {
    await this.renameWindow(this.plugin.getActiveWindow().id);
  }

  async renameWindow(windowId) {
    if (this.plugin.currentProcess) {
      new Notice("Codex 还在运行，结束后再命名窗口");
      return;
    }
    const windowState = this.plugin.settings.windows.find((candidate) => candidate.id === windowId);
    if (!windowState) return;
    const nextTitle = window.prompt("给这个 Codex 窗口起个名字", windowState.title);
    if (nextTitle === null) return;
    await this.plugin.renameWindow(windowId, nextTitle);
    this.renderTabs();
    this.renderActiveWindow();
  }

  async switchWindow(windowId) {
    if (this.plugin.currentProcess) {
      new Notice("Codex 还在运行，结束后再切换窗口");
      return;
    }
    await this.plugin.setActiveWindow(windowId);
    this.activeAssistantEl = null;
    this.activeMessageIndex = null;
    this.renderTabs();
    this.renderActiveWindow();
  }

  async sendFromInput() {
    const text = this.inputEl.value.trim();
    if (!text) {
      new Notice("先写一句要问 Codex 的话");
      return;
    }
    this.inputEl.value = "";
    await this.sendPrompt(text, {
      contextMode: this.plugin.settings.contextMode
    });
  }

  async sendPrompt(text, options = {}) {
    if (this.plugin.currentProcess) {
      new Notice("Codex 还在运行，先等它结束或点击 Stop");
      return;
    }

    this.appendMessage("user", text);
    const assistantEl = this.appendMessage("assistant", "正在准备上下文...");
    this.activeMessageIndex = Number(assistantEl.dataset.messageIndex);
    this.activeAssistantEl = assistantEl;
    this.setRunning(true);
    this.setStatus("Preparing context");
    let statusText = "正在准备上下文";
    const startedAt = Date.now();
    const statusTimer = window.setInterval(() => {
      if (!this.activeAssistantEl) return;
      const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      this.updateAssistantText(`${statusText}... ${seconds}s`);
      this.scrollToBottom();
    }, 1000);

    try {
      this.updateAssistantText("正在准备上下文...");
      const prompt = await this.plugin.buildPrompt(text, options);
      statusText = "正在启动 Codex";
      this.setStatus("Starting Codex");
      await this.plugin.runCodex(prompt, {
        onStart: (info) => {
          statusText = info.isResume ? "正在续接这个窗口的 Codex 会话" : "正在创建这个窗口的 Codex 会话";
          this.setStatus(info.isResume ? "Resuming session" : "New session");
          this.updateAssistantText([
            statusText + "。",
            "我会隐藏命令行日志，结束后只显示「思考过程（简要）」和「结果」。"
          ].join("\n"));
        },
        onClose: (result) => {
          statusText = "正在整理结果";
          this.setStatus(result.code === 0 ? "Done" : "Error");
          if (result.finalMessage) {
            this.updateAssistantText(result.finalMessage);
          } else if (result.code !== 0 && result.output) {
            this.updateAssistantText(result.output);
          } else {
            this.updateAssistantText("Codex 已结束，但没有返回文本。");
          }
        }
      });
    } catch (error) {
      assistantEl.addClass("codex-message-error");
      this.updateAssistantText(`Codex failed: ${error.message || error}`);
      this.setStatus("Error");
      new Notice("Codex 运行失败，打开面板查看详情");
    } finally {
      window.clearInterval(statusTimer);
      this.activeAssistantEl = null;
      this.activeMessageIndex = null;
      this.setRunning(false);
      this.renderTabs();
      this.scrollToBottom();
    }
  }

  appendAssistantChunk(chunk) {
    if (!this.activeAssistantEl) return;
    const clean = stripAnsi(chunk);
    if (
      this.activeAssistantEl.textContent.startsWith("Codex 已启动") ||
      this.activeAssistantEl.textContent.startsWith("Codex 正在运行")
    ) {
      this.updateAssistantText("");
    }
    this.updateAssistantText(this.activeAssistantEl.textContent + clean);
    this.scrollToBottom();
  }

  appendMessage(role, text, options = {}) {
    const persist = options.persist !== false;
    let messageIndex = options.messageIndex;
    if (persist) {
      messageIndex = this.plugin.addMessageToActiveWindow(role, text);
      this.renderTabs();
    }
    if (this.outputEl.querySelector(".codex-welcome")) {
      this.outputEl.empty();
    }
    const row = this.outputEl.createDiv({ cls: `codex-message codex-message-${role}` });
    row.createDiv({ cls: "codex-message-role", text: role === "user" ? "You" : "Codex" });
    const body = row.createDiv({ cls: "codex-message-body" });
    body.textContent = text;
    if (messageIndex !== undefined && messageIndex !== null) {
      body.dataset.messageIndex = String(messageIndex);
    }
    this.scrollToBottom();
    return body;
  }

  updateAssistantText(text) {
    if (this.activeAssistantEl) {
      this.activeAssistantEl.textContent = text;
    }
    if (this.activeMessageIndex !== null && Number.isFinite(this.activeMessageIndex)) {
      this.plugin.updateMessageInActiveWindow(this.activeMessageIndex, text);
    }
  }

  renderActiveWindow() {
    const windowState = this.plugin.getActiveWindow();
    this.outputEl.empty();
    if (!windowState || windowState.messages.length === 0) {
      this.renderWelcome();
      return;
    }
    windowState.messages.forEach((message, index) => {
      this.appendMessage(message.role, message.text, { persist: false, messageIndex: index });
    });
  }

  renderWelcome() {
    this.outputEl.empty();
    const welcome = this.outputEl.createDiv({ cls: "codex-welcome" });
    welcome.createEl("h4", { text: `Codex 窗口 ${this.plugin.getActiveWindow().title}` });
    welcome.createEl("p", {
      text: "当前 vault 会作为 Codex 的工作目录。这个窗口的对话会单独保存。"
    });
  }

  async clearOutput() {
    await this.plugin.clearActiveWindow();
    this.renderTabs();
    this.renderWelcome();
  }

  setRunning(isRunning) {
    if (this.sendButtonEl) this.sendButtonEl.disabled = isRunning;
    if (this.stopButtonEl) this.stopButtonEl.disabled = !isRunning;
    if (this.inputEl) this.inputEl.classList.toggle("codex-running", isRunning);
    if (!isRunning && this.statusEl && this.statusEl.textContent === "Running") {
      this.setStatus("Ready");
    }
  }

  setStatus(status) {
    if (!this.statusEl) return;
    this.statusEl.textContent = status;
    this.statusEl.dataset.status = status.toLowerCase().replace(/\s+/g, "-");
  }

  scrollToBottom() {
    if (!this.outputEl) return;
    window.setTimeout(() => {
      this.outputEl.scrollTop = this.outputEl.scrollHeight;
    }, 0);
  }

  async onClose() {
    if (this.plugin.currentProcess) {
      this.plugin.stopCurrentRun();
    }
  }
}

class CodexPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.currentProcess = null;
    this.lastResponse = this.getActiveWindow().lastResponse || this.settings.lastResponse || "";

    this.registerView(VIEW_TYPE_CODEX, (leaf) => new CodexView(leaf, this));

    this.addRibbonIcon("bot", "Open Codex", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-view",
      name: "Open Codex view",
      callback: () => this.activateView()
    });

    for (let index = 1; index <= CODEX_WINDOW_COUNT; index += 1) {
      this.addCommand({
        id: `open-window-${index}`,
        name: `Open Codex window ${index}`,
        callback: async () => {
          const view = await this.activateView();
          const switched = await this.setActiveWindow(`window-${index}`);
          if (!switched) return;
          if (view && typeof view.renderTabs === "function") {
            view.renderTabs();
            view.renderActiveWindow();
          }
        }
      });
    }

    this.addCommand({
      id: "ask-selection",
      name: "Ask Codex about selection",
      editorCallback: async (editor, view) => {
        const selectedText = editor.getSelection();
        if (!selectedText.trim()) {
          new Notice("请先选中一段文字");
          return;
        }
        const filePath = view.file ? view.file.path : "current note";
        await this.sendToView(`请基于这段选中文本给我建议。来源：${filePath}\n\n${selectedText}`, {
          includeActiveNoteContext: false
        });
      }
    });

    this.addCommand({
      id: "ask-current-note",
      name: "Ask Codex about current note",
      editorCallback: async (editor, view) => {
        const filePath = view.file ? view.file.path : "current note";
        await this.sendToView("请阅读当前笔记，指出结构、表达和可执行性上最值得优化的地方。", {
          includeActiveNoteContext: false,
          explicitContext: {
            path: filePath,
            content: editor.getValue()
          }
        });
      }
    });

    this.addCommand({
      id: "insert-last-response",
      name: "Insert last Codex response at cursor",
      editorCallback: async (editor) => {
        const lastResponse = await this.getLastResponse();
        if (!lastResponse) {
          new Notice("还没有 Codex 回复可以插入");
          return;
        }
        editor.replaceSelection(lastResponse);
      }
    });

    this.addCommand({
      id: "show-last-response",
      name: "Show last Codex response",
      callback: async () => {
        const view = await this.activateView();
        const lastResponse = await this.getLastResponse();
        if (!lastResponse) {
          new Notice("还没有 Codex 回复");
          return;
        }
        view.appendMessage("assistant", lastResponse);
      }
    });

    this.addCommand({
      id: "stop-current-run",
      name: "Stop current Codex run",
      callback: () => this.stopCurrentRun()
    });

    this.addSettingTab(new CodexSettingTab(this.app, this));
  }

  onunload() {
    this.stopCurrentRun();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CODEX);
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    if (!data.promptPrefix || data.promptPrefix === OLD_DEFAULT_PROMPT_PREFIX) {
      this.settings.promptPrefix = DEFAULT_PROMPT_PREFIX;
    }
    if (!data.contextMode) {
      this.settings.contextMode = data.includeActiveNoteContext === false ? "none" : "active-note";
    }
    this.settings.windows = normalizeWindows(data);
    if (!this.settings.windows.some((windowState) => windowState.id === this.settings.activeWindowId)) {
      this.settings.activeWindowId = "window-1";
    }
  }

  async saveSettings() {
    const activeWindow = this.getActiveWindow();
    await this.saveData(Object.assign({}, this.settings, { lastResponse: activeWindow.lastResponse || this.lastResponse || "" }));
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CODEX)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_CODEX, active: true });
    }
    workspace.revealLeaf(leaf);
    return leaf.view;
  }

  async sendToView(prompt, options = {}) {
    const view = await this.activateView();
    if (view && typeof view.sendPrompt === "function") {
      await view.sendPrompt(prompt, options);
    }
  }

  getActiveWindow() {
    const activeWindow = this.settings.windows.find((windowState) => windowState.id === this.settings.activeWindowId);
    return activeWindow || this.settings.windows[0];
  }

  async setActiveWindow(windowId) {
    if (this.currentProcess) {
      new Notice("Codex 还在运行，结束后再切换窗口");
      return false;
    }
    if (!this.settings.windows.some((windowState) => windowState.id === windowId)) return false;
    this.settings.activeWindowId = windowId;
    await this.saveSettings();
    return true;
  }

  async renameWindow(windowId, rawTitle) {
    const windowState = this.settings.windows.find((candidate) => candidate.id === windowId);
    if (!windowState) return;
    const fallback = windowId.replace("window-", "");
    windowState.title = sanitizeWindowTitle(rawTitle, fallback);
    await this.saveSettings();
  }

  addMessageToActiveWindow(role, text) {
    const windowState = this.getActiveWindow();
    windowState.messages.push({
      role,
      text,
      createdAt: Date.now()
    });
    void this.saveSettings();
    return windowState.messages.length - 1;
  }

  updateMessageInActiveWindow(index, text) {
    const windowState = this.getActiveWindow();
    if (!windowState.messages[index]) return;
    windowState.messages[index].text = text;
    void this.saveSettings();
  }

  async clearActiveWindow() {
    const windowState = this.getActiveWindow();
    windowState.messages = [];
    windowState.lastResponse = "";
    windowState.sessionId = "";
    if (this.settings.activeWindowId === "window-1") {
      this.lastResponse = "";
    }
    await this.saveSettings();
  }

  getWindowOutputFile(windowId) {
    const vaultPath = getVaultPath(this.app);
    if (!vaultPath) return "";
    return path.join(vaultPath, PLUGIN_DIR, `${windowId}-last-response.md`);
  }

  async setLastResponseForWindow(windowId, text) {
    const windowState = this.settings.windows.find((candidate) => candidate.id === windowId) || this.getActiveWindow();
    windowState.lastResponse = text;
    this.lastResponse = text;
    await this.saveSettings();
  }

  async setSessionIdForWindow(windowId, sessionId) {
    if (!sessionId) return;
    const windowState = this.settings.windows.find((candidate) => candidate.id === windowId) || this.getActiveWindow();
    windowState.sessionId = sessionId;
    await this.saveSettings();
  }

  async getLastResponse() {
    const windowState = this.getActiveWindow();
    if (windowState.lastResponse) return windowState.lastResponse;
    const vaultPath = getVaultPath(this.app);
    if (!vaultPath) return "";
    const outputFile = this.getWindowOutputFile(windowState.id) || path.join(vaultPath, PLUGIN_DIR, "last-response.md");
    try {
      windowState.lastResponse = fs.readFileSync(outputFile, "utf8").trim();
      await this.saveSettings();
      return windowState.lastResponse;
    } catch (error) {
      if (windowState.id !== "window-1") return "";
      try {
        windowState.lastResponse = fs.readFileSync(path.join(vaultPath, PLUGIN_DIR, "last-response.md"), "utf8").trim();
        await this.saveSettings();
        return windowState.lastResponse;
      } catch (readError) {
        return "";
      }
      return "";
    }
  }

  async getActiveMarkdownInfo() {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMarkdownView && activeMarkdownView.file) {
      return {
        file: activeMarkdownView.file,
        path: activeMarkdownView.file.path,
        content: activeMarkdownView.editor.getValue(),
        selection: activeMarkdownView.editor.getSelection(),
        cursorLine: activeMarkdownView.editor.getCursor().line
      };
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.extension === "md") {
      return {
        file: activeFile,
        path: activeFile.path,
        content: await this.app.vault.read(activeFile),
        selection: "",
        cursorLine: 0
      };
    }

    return null;
  }

  async getActiveNoteContext(explicitContext) {
    if (explicitContext) {
      return explicitContext;
    }

    return this.getActiveMarkdownInfo();
  }

  async readMarkdownContextFiles(files, labelPrefix, maxFiles) {
    const blocks = [];
    for (const file of files.slice(0, maxFiles)) {
      try {
        blocks.push({
          label: labelPrefix,
          path: file.path,
          content: await this.app.vault.read(file)
        });
      } catch (error) {
      }
    }
    return blocks;
  }

  async getContextBlocks(contextMode, explicitContext) {
    if (explicitContext) {
      return [{
        label: "Explicit context",
        path: explicitContext.path,
        content: explicitContext.content
      }];
    }

    const mode = contextMode || this.settings.contextMode || "active-note";
    if (mode === "none") return [];

    const active = await this.getActiveMarkdownInfo();
    if (!active) return [];

    if (mode === "selection") {
      return [{
        label: active.selection.trim() ? "Selected text" : "Selected text (empty)",
        path: active.path,
        content: active.selection.trim() || "No text is currently selected."
      }];
    }

    if (mode === "section") {
      return [{
        label: "Current section",
        path: active.path,
        content: extractCurrentSection(active.content, active.cursorLine) || active.content
      }];
    }

    if (mode === "backlinks") {
      const backlinkData = this.app.metadataCache.getBacklinksForFile(active.file)?.data || {};
      const backlinkFiles = Object.keys(backlinkData)
        .map((filePath) => this.app.vault.getAbstractFileByPath(filePath))
        .filter((file) => file && file.extension === "md" && file.path !== active.path);
      return [
        { label: "Active note", path: active.path, content: active.content },
        ...(await this.readMarkdownContextFiles(backlinkFiles, "Backlink note", 5))
      ];
    }

    if (mode === "same-tag") {
      const activeTags = getTagsFromCache(this.app.metadataCache.getFileCache(active.file));
      if (activeTags.size === 0) {
        return [{ label: "Active note (no tags found)", path: active.path, content: active.content }];
      }
      const sameTagFiles = this.app.vault.getMarkdownFiles()
        .filter((file) => file.path !== active.path)
        .filter((file) => {
          const tags = getTagsFromCache(this.app.metadataCache.getFileCache(file));
          return Array.from(activeTags).some((tag) => tags.has(tag));
        });
      return [
        { label: `Active note (tags: ${Array.from(activeTags).join(", ")})`, path: active.path, content: active.content },
        ...(await this.readMarkdownContextFiles(sameTagFiles, "Same-tag note", 5))
      ];
    }

    return [{
      label: "Active note",
      path: active.path,
      content: active.content
    }];
  }

  async buildPrompt(userPrompt, options = {}) {
    const contextMode = options.contextMode || (options.includeActiveNoteContext === false ? "none" : this.settings.contextMode || "active-note");
    const maxContextChars = Number(this.settings.maxContextChars) || DEFAULT_SETTINGS.maxContextChars;
    const vaultPath = getVaultPath(this.app);
    const sections = [];

    if (this.settings.promptPrefix && this.settings.promptPrefix.trim()) {
      sections.push(this.settings.promptPrefix.trim());
    }

    if (vaultPath) {
      sections.push(`Vault absolute path: ${vaultPath}`);
    }

    const contextBlocks = await this.getContextBlocks(contextMode, options.explicitContext);
    if (contextBlocks.length > 0) {
      const perBlockLimit = Math.max(1000, Math.floor(maxContextChars / contextBlocks.length));
      sections.push(
        [
          `Obsidian context mode: ${contextMode}`,
          ...contextBlocks.map((context) => [
            "",
            `Context: ${context.label}`,
            `Path: ${context.path}`,
            "~~~markdown",
            clipText(context.content, perBlockLimit),
            "~~~"
          ].join("\n"))
        ].join("\n")
      );
    }

    sections.push(["User request:", userPrompt].join("\n"));
    return sections.join("\n\n---\n\n");
  }

  async runCodex(prompt, callbacks = {}) {
    const vaultPath = getVaultPath(this.app);
    if (!vaultPath) {
      throw new Error("Cannot determine this vault's filesystem path.");
    }

    const pluginDir = path.join(vaultPath, PLUGIN_DIR);
    fs.mkdirSync(pluginDir, { recursive: true });
    const activeWindow = this.getActiveWindow();
    const activeWindowId = activeWindow.id;
    const sessionId = activeWindow.sessionId || "";
    const outputFile = path.join(pluginDir, `${activeWindowId}-last-response.md`);
    try {
      fs.unlinkSync(outputFile);
    } catch (error) {
      // Fine when there is no previous response file.
    }

    const commandInfo = resolveCodexCommand(this.settings);
    const codexArgs = buildCodexArgs(this.settings, outputFile, sessionId);
    const args = [...commandInfo.args, ...codexArgs];
    const env = Object.assign({}, process.env, {
      PATH: getEnhancedPath(process.env.PATH || ""),
      NO_COLOR: "1",
      TERM: process.env.TERM || "xterm-256color"
    });

    const child = spawn(commandInfo.command, args, {
      cwd: vaultPath,
      env,
      windowsHide: true
    });

    this.currentProcess = child;
    let combinedOutput = "";

    callbacks.onStart?.({ command: commandInfo.command, args, cwd: vaultPath, isResume: Boolean(sessionId), sessionId });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      const displayText = filterCodexNoise(text);
      combinedOutput += displayText;
      if (displayText) callbacks.onStdout?.(displayText);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      const displayText = filterCodexNoise(text);
      combinedOutput += displayText;
      if (displayText) callbacks.onStderr?.(displayText);
    });

    child.stdin.on("error", () => {});
    child.stdin.end(prompt);

    return new Promise((resolve, reject) => {
      child.on("error", (error) => {
        this.currentProcess = null;
        reject(error);
      });

      child.on("close", async (code, signal) => {
        this.currentProcess = null;
        const cleanOutput = stripAnsi(combinedOutput).trim();
        const nextSessionId = extractSessionId(cleanOutput);
        let finalMessage = "";
        try {
          finalMessage = fs.readFileSync(outputFile, "utf8").trim();
        } catch (error) {
          finalMessage = cleanOutput;
        }

        if (nextSessionId) {
          await this.setSessionIdForWindow(activeWindowId, nextSessionId);
        }

        if (finalMessage) {
          await this.setLastResponseForWindow(activeWindowId, finalMessage);
          try {
            fs.writeFileSync(path.join(pluginDir, "last-response.md"), finalMessage);
          } catch (writeError) {
            // The per-window response is already saved by Codex.
          }
        }

        const result = { code, signal, output: cleanOutput, finalMessage };
        callbacks.onClose?.(result);

        if (code === 0) {
          resolve(result);
        } else {
          reject(new Error(`codex exited with code ${code}${signal ? ` (${signal})` : ""}`));
        }
      });
    });
  }

  stopCurrentRun() {
    if (!this.currentProcess) {
      return;
    }
    this.currentProcess.kill("SIGTERM");
    this.currentProcess = null;
    new Notice("已停止 Codex");
  }
}

class CodexSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("codex-settings");

    new Setting(containerEl).setName("Codex CLI").setHeading();

    new Setting(containerEl)
      .setName("Codex CLI path")
      .setDesc("留空会自动查找 codex。Obsidian 从 Dock 启动时 PATH 可能不完整，必要时填绝对路径。")
      .addText((text) => {
        text
          .setPlaceholder(detectCodexPath())
          .setValue(this.plugin.settings.codexCliPath)
          .onChange(async (value) => {
            this.plugin.settings.codexCliPath = value.trim();
            await this.plugin.saveSettings();
          });
      })
      .addButton((button) => {
        button.setButtonText("Auto").onClick(async () => {
          this.plugin.settings.codexCliPath = detectCodexPath();
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("可选。留空使用 Codex 默认模型。")
      .addText((text) => {
        text
          .setPlaceholder("default")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Enable web search")
      .setDesc("调用 codex --search exec。需要你的 Codex CLI 支持该参数。")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableSearch).onChange(async (value) => {
          this.plugin.settings.enableSearch = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("Safety").setHeading();

    new Setting(containerEl)
      .setName("Sandbox")
      .setDesc("默认 workspace-write：Codex 可以读写当前 vault。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("read-only", "read-only")
          .addOption("workspace-write", "workspace-write")
          .addOption("danger-full-access", "danger-full-access")
          .setValue(this.plugin.settings.sandbox)
          .onChange(async (value) => {
            this.plugin.settings.sandbox = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Approval policy")
      .setDesc("非交互调用建议使用 never，否则 Codex 可能等待命令行确认。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("never", "never")
          .addOption("on-request", "on-request")
          .addOption("untrusted", "untrusted")
          .setValue(this.plugin.settings.approvalPolicy)
          .onChange(async (value) => {
            this.plugin.settings.approvalPolicy = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Bypass approvals and sandbox")
      .setDesc("危险模式。只有你明确知道自己在做什么时再打开。")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.dangerouslyBypassApprovalsAndSandbox)
          .onChange(async (value) => {
            this.plugin.settings.dangerouslyBypassApprovalsAndSandbox = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("Context").setHeading();

    new Setting(containerEl)
      .setName("Default context mode")
      .setDesc("从 Codex 面板发送时，默认带入哪部分 Obsidian 上下文。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("none", "不带上下文")
          .addOption("selection", "选中文本")
          .addOption("section", "当前小节")
          .addOption("active-note", "整篇当前笔记")
          .addOption("backlinks", "当前笔记 + 反链")
          .addOption("same-tag", "当前笔记 + 同标签笔记")
          .setValue(this.plugin.settings.contextMode || "active-note")
          .onChange(async (value) => {
            this.plugin.settings.contextMode = value;
            this.plugin.settings.includeActiveNoteContext = value !== "none";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Max note context characters")
      .setDesc("当前笔记过长时会截断，避免一次塞太多上下文。")
      .addText((text) => {
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.maxContextChars))
          .setValue(String(this.plugin.settings.maxContextChars))
          .onChange(async (value) => {
            const parsed = Number(value);
            this.plugin.settings.maxContextChars = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.maxContextChars;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Prompt prefix")
      .setDesc("每次调用 Codex 前都会附加这段说明。")
      .addTextArea((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.promptPrefix)
          .setValue(this.plugin.settings.promptPrefix)
          .onChange(async (value) => {
            this.plugin.settings.promptPrefix = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
      });

    new Setting(containerEl)
      .setName("Extra codex exec args")
      .setDesc("追加到 codex exec 后、prompt 前，例如 --ignore-rules。")
      .addTextArea((text) => {
        text
          .setPlaceholder("--ignore-rules")
          .setValue(this.plugin.settings.extraArgs)
          .onChange(async (value) => {
            this.plugin.settings.extraArgs = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 3;
        text.inputEl.cols = 50;
      });
  }
}

module.exports = CodexPlugin;
