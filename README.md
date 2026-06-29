# Obsidian Codex

在 Obsidian 里直接调用 Codex。

如果你已经习惯用 Obsidian 写笔记、整理知识库，又想像 Claudian 那样在库里随手叫 AI 帮你读笔记、改结构、提建议、处理选中文本，这个插件就是为这个场景做的。

它不是一个云端机器人，而是调用你电脑本地已经安装好的 `codex` 命令行工具。Codex 会把当前 Obsidian vault 当作工作目录来运行。

## 它能做什么

- 在 Obsidian 右侧打开一个 Codex 面板
- 像 Claudian 一样提供 5 个固定窗口：`1 2 3 4 5`
- 每个窗口单独保存聊天记录和最近一次回复
- 可以把当前笔记作为上下文发给 Codex
- 可以让 Codex 分析当前选中的文字
- 可以让 Codex 阅读当前笔记并给建议
- 可以把最近一次 Codex 回复插入到光标位置
- 默认只在当前 vault 工作，不会开启危险的全盘权限模式

## 安装前准备

你需要先有：

- Obsidian 桌面版
- 已安装并登录的 Codex CLI

如果你还没装 Codex CLI，可以在终端里运行：

```bash
npm install -g @openai/codex
codex login
```

确认是否安装成功：

```bash
codex --version
```

## 安装插件

打开最新版 Release：

[下载 Obsidian Codex v0.2.0](https://github.com/ilulu66/obsidian-codex/releases/tag/v0.2.0)

下载这三个文件：

- `manifest.json`
- `main.js`
- `styles.css`

然后在你的 Obsidian vault 里创建这个文件夹：

```text
.obsidian/plugins/codex
```

把上面三个文件放进去。

接着：

1. 完全退出 Obsidian
2. 重新打开 Obsidian
3. 进入 `设置 -> 第三方插件`
4. 找到 `Codex`
5. 打开它

## 第一次使用

按 `Cmd + P` 打开命令面板，搜索：

```text
Codex: Open Codex view
```

打开后，你会看到 Codex 面板顶部有 `1 2 3 4 5` 五个窗口。

第一次测试建议输入：

```text
只回复 OK
```

然后点击发送，或者按 `Cmd + Enter`。

如果能看到 `OK`，说明插件已经跑通了。

## 常用命令

在 Obsidian 命令面板里可以搜索这些命令：

- `Codex: Open Codex view`：打开 Codex 面板
- `Codex: Open Codex window 1` 到 `Codex: Open Codex window 5`：打开指定窗口
- `Codex: Ask Codex about selection`：让 Codex 分析当前选中的文字
- `Codex: Ask Codex about current note`：让 Codex 阅读当前笔记
- `Codex: Insert last Codex response at cursor`：把最近一次回复插入当前位置
- `Codex: Stop current Codex run`：停止正在运行的 Codex

## 如果它没有反应

先别急，通常是 Obsidian 找不到 `codex` 命令。

打开：

```text
设置 -> Codex -> Codex CLI path
```

尝试填入下面其中一个路径：

```text
~/.npm-global/bin/codex
/opt/homebrew/bin/codex
/usr/local/bin/codex
```

如果你不知道自己的 Codex 路径，在终端运行：

```bash
which codex
```

把输出结果填进 `Codex CLI path`。

## 默认安全设置

插件默认使用：

- `sandbox`: `workspace-write`
- `approval policy`: `never`
- `web search`: 关闭

意思是：Codex 可以在当前 vault 里工作，但默认不会开启 `--dangerously-bypass-approvals-and-sandbox` 那种全盘无保护模式。

如果你要让它联网搜索，可以在插件设置里打开 `Enable web search`。

## 本地数据说明

插件会在 Obsidian 本地保存：

- 五个窗口的聊天记录
- 每个窗口最近一次 Codex 回复
- 插件设置

这些数据只在你的 vault 本地，不会被这个 GitHub 仓库收集。

## 开发者说明

这个插件目前不需要构建步骤，源码就是发布文件。

```bash
npm test
npm run package
```

`npm run package` 会在 `dist/` 里生成可发布的 zip。

## License

MIT
