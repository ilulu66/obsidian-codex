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
    lastResponse: ""
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
      title: String(index),
      messages: Array.isArray(existing.messages) ? existing.messages : [],
      lastResponse: typeof existing.lastResponse === "string" ? existing.lastResponse : ""
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

function buildCodexArgs(settings, outputFile) {
  const args = [];
  if (settings.enableSearch) {
    args.push("--search");
  }
  if (!settings.dangerouslyBypassApprovalsAndSandbox) {
    args.push("-a", settings.approvalPolicy || "never");
  }
  args.push("exec");

  if (settings.model && settings.model.trim()) {
    args.push("-m", settings.model.trim());
  }

  if (settings.dangerouslyBypassApprovalsAndSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("-s", settings.sandbox || "workspace-write");
  }

  args.push("--skip-git-repo-check");
  args.push("--color", "never");

  const extraArgs = splitCommandLine(settings.extraArgs || "");
  if (extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  args.push("-o", outputFile);
  args.push("-");
  return args;
}

class CodexView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.outputEl = null;
    this.inputEl = null;
    this.sendButtonEl = null;
    this.stopButtonEl = null;
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
        includeActiveNoteContext: true
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
    const contextInput = contextLabel.createEl("input", { type: "checkbox" });
    contextInput.checked = this.plugin.settings.includeActiveNoteContext;
    contextInput.addEventListener("change", async () => {
      this.plugin.settings.includeActiveNoteContext = contextInput.checked;
      await this.plugin.saveSettings();
    });
    contextLabel.createSpan({ text: "带当前笔记" });

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
      this.windowButtons.push(button);
    }
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
      includeActiveNoteContext: this.plugin.settings.includeActiveNoteContext
    });
  }

  async sendPrompt(text, options = {}) {
    if (this.plugin.currentProcess) {
      new Notice("Codex 还在运行，先等它结束或点击 Stop");
      return;
    }

    this.appendMessage("user", text);
    const assistantEl = this.appendMessage("assistant", "Codex 已启动，通常需要 10-60 秒...");
    this.activeMessageIndex = Number(assistantEl.dataset.messageIndex);
    this.activeAssistantEl = assistantEl;
    this.setRunning(true);
    const startedAt = Date.now();
    const statusTimer = window.setInterval(() => {
      if (!this.activeAssistantEl) return;
      const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      this.updateAssistantText(`Codex 正在运行... ${seconds}s`);
      this.scrollToBottom();
    }, 1000);

    try {
      const prompt = await this.plugin.buildPrompt(text, options);
      await this.plugin.runCodex(prompt, {
        onStart: () => {
          this.updateAssistantText([
            "Codex 已启动。",
            "我会隐藏命令行日志，结束后只显示「思考过程（简要）」和「结果」。"
          ].join("\n"));
        },
        onClose: (result) => {
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

  async getActiveNoteContext(explicitContext) {
    if (explicitContext) {
      return explicitContext;
    }

    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMarkdownView && activeMarkdownView.file) {
      return {
        path: activeMarkdownView.file.path,
        content: activeMarkdownView.editor.getValue()
      };
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.extension === "md") {
      return {
        path: activeFile.path,
        content: await this.app.vault.read(activeFile)
      };
    }

    return null;
  }

  async buildPrompt(userPrompt, options = {}) {
    const includeActiveNoteContext = options.includeActiveNoteContext ?? this.settings.includeActiveNoteContext;
    const maxContextChars = Number(this.settings.maxContextChars) || DEFAULT_SETTINGS.maxContextChars;
    const vaultPath = getVaultPath(this.app);
    const sections = [];

    if (this.settings.promptPrefix && this.settings.promptPrefix.trim()) {
      sections.push(this.settings.promptPrefix.trim());
    }

    if (vaultPath) {
      sections.push(`Vault absolute path: ${vaultPath}`);
    }

    if (includeActiveNoteContext || options.explicitContext) {
      const context = await this.getActiveNoteContext(options.explicitContext);
      if (context) {
        sections.push(
          [
            "Active Obsidian note context:",
            `Path: ${context.path}`,
            "~~~markdown",
            clipText(context.content, maxContextChars),
            "~~~"
          ].join("\n")
        );
      }
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
    const outputFile = path.join(pluginDir, `${activeWindowId}-last-response.md`);
    try {
      fs.unlinkSync(outputFile);
    } catch (error) {
      // Fine when there is no previous response file.
    }

    const commandInfo = resolveCodexCommand(this.settings);
    const codexArgs = buildCodexArgs(this.settings, outputFile);
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

    callbacks.onStart?.({ command: commandInfo.command, args, cwd: vaultPath });

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
        let finalMessage = "";
        try {
          finalMessage = fs.readFileSync(outputFile, "utf8").trim();
        } catch (error) {
          finalMessage = cleanOutput;
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
      .setName("Include active note by default")
      .setDesc("从 Codex 面板发送时，自动把当前 Markdown 笔记带入上下文。")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.includeActiveNoteContext).onChange(async (value) => {
          this.plugin.settings.includeActiveNoteContext = value;
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
