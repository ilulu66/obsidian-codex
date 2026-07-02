# Obsidian Codex

在 Obsidian 里直接调用 Codex。

如果你已经习惯用 Obsidian 写笔记、整理知识库，又想像 Claudian 那样在库里随手叫 AI 帮你读笔记、改结构、提建议、处理选中文本，这个插件就是为这个场景做的。

它不是一个云端机器人，而是调用你电脑本地已经安装好的 `codex` 命令行工具。Codex 会把当前 Obsidian vault 当作工作目录来运行。

## 它能做什么

- 在 Obsidian 右侧打开一个 Codex 面板
- 像 Claudian 一样默认提供 5 个窗口：`1 2 3 4 5`
- 可以点顶部 `+` 继续新增窗口，最多 20 个
- 每个窗口单独保存聊天记录和最近一次回复
- 运行时能看到当前状态：正在读取上下文、正在调用 Codex、已运行多少秒、停止按钮、失败原因
- 可以把当前笔记作为上下文发给 Codex
- 可以选择上下文范围：不带、选中、小节、整篇、反链、同标签
- 支持添加图片：点 `图片`、粘贴图片、拖拽图片到输入框都可以
- 可以让 Codex 分析当前选中的文字
- 可以让 Codex 阅读当前笔记并给建议
- 可以把最近一次 Codex 回复插入到光标位置
- 每个窗口会保存自己的 Codex 会话，后续提问会自动续接
- 每个窗口可以单独命名
- 默认只在当前 vault 工作，不会开启危险的全盘权限模式
- 手机端支持同步查看模式：能看到全部窗口和聊天记录，能复制回复、插入笔记

## 安装前准备

你需要先有：

- Obsidian 桌面版（运行 Codex 必须在桌面版；手机端只用来查看和使用同步过来的记录）
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

[下载 Obsidian Codex 最新版](https://github.com/ilulu66/obsidian-codex/releases/latest)

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

你可以点 `+` 新增窗口，点 `命名` 给当前窗口改名字，也可以双击顶部窗口标签改名。窗口名变长以后，顶部窗口栏可以左右滚动，不会挡住新增按钮。

输入框上方的 `上下文` 下拉框可以选择这次要带给 Codex 的内容：

- `不带`：只发你的问题
- `选中`：带当前选中的文字
- `小节`：带光标所在小节
- `整篇`：带当前笔记全文
- `反链`：带当前笔记和最多 5 篇反链笔记
- `同标签`：带当前笔记和最多 5 篇同标签笔记

第一次测试建议输入：

```text
只回复 OK
```

然后按 `Enter` 发送。

想在输入框里换行时，按 `Shift + Enter`。

想发图片时，可以点输入框上方的 `图片`，也可以直接把截图粘贴进去，或者把图片拖到输入框里。

如果能看到 `OK`，说明插件已经跑通了。

## 在手机上使用

从 v0.5.0 开始，插件可以在 Obsidian 手机版加载，工作台会以「同步查看模式」出现在手机上。

手机端能做什么：

- 打开 Codex 面板，看到全部窗口和窗口名
- 查看从电脑同步过来的完整聊天记录
- 复制最近一次 Codex 回复
- 用 `Insert last Codex response at cursor` 把回复插入手机上的笔记

手机端不能做什么：

- 不能运行 Codex（Codex CLI 只存在于你的电脑上）
- 不能发送新消息、不能添加图片

怎么把工作台同步到手机：

1. 先让你的 vault 在电脑和手机之间同步（Obsidian Sync、iCloud、Syncthing 等都可以）
2. 如果用 Obsidian Sync，在 `设置 -> 同步` 里勾选与第三方插件相关的选项（已安装的插件和插件设置），这样 `.obsidian/plugins/codex` 里的插件文件和聊天记录（`data.json`）才会同步
3. 在手机上打开 `设置 -> 第三方插件`，启用 `Codex`
4. 打开命令面板，运行 `Codex: Open Codex view`

之后你在电脑上和 Codex 的每次对话，都会随 vault 同步出现在手机的工作台里。

## 关闭后怎么恢复

如果你把右侧 Codex 面板关掉了，不用担心，聊天记录还在本地。

重新打开的方法：

```text
Cmd + P -> Codex: Open Codex view
```

也可以搜索：

```text
Codex: Restore Codex panel / 恢复 Codex 面板
```

注意：这个插件是通过本地 Codex CLI 创建会话，Obsidian 面板里的对话不一定会出现在 Codex 桌面端的侧边栏里。恢复 Obsidian 里的对话，请以上面两个命令为准。

## 常用命令

在 Obsidian 命令面板里可以搜索这些命令：

- `Codex: Open Codex view`：打开 Codex 面板
- `Codex: Restore Codex panel / 恢复 Codex 面板`：重新打开已经关闭的 Codex 面板
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

- 窗口聊天记录
- 每个窗口最近一次 Codex 回复
- 每个窗口的 Codex 会话 id
- 通过粘贴上传的图片附件
- 插件设置

这些数据只在你的 vault 本地，不会被这个 GitHub 仓库收集。

## 开发者说明

这个插件目前不需要构建步骤，源码就是发布文件。

```bash
npm test
npm run package
```

`npm run package` 会在 `dist/` 里生成可发布的 zip。

## 项目复盘素材

如果你想写这个插件的项目复盘文章，可以看：

- `docs/project-retrospective-source-pack.md`：完整素材包
- `docs/conversation-timeline.md`：对话时间线
- `docs/claude-writing-brief.md`：给 Claude 的写作 brief

## License

MIT
