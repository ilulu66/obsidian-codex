# 对话时间线

这份时间线按用户反馈顺序整理，方便写项目复盘时追溯产品演进。

## 1. 初始需求：在 Obsidian 里调用 Codex

用户原话：

> 我现在在用 obsidian+claudian，但是没有 codex 的插件，在 obsidian 就不方便调用你，你能做一个插件吗，参考 claudian 的做法

执行：

- 查看本地 Claudian 插件结构。
- 识别 Claudian 的核心模式：Obsidian 面板、命令入口、vault 工作目录。
- 创建 Codex 插件 MVP。

产出：

- `.obsidian/plugins/codex/manifest.json`
- `.obsidian/plugins/codex/main.js`
- `.obsidian/plugins/codex/styles.css`

## 2. 安装引导

用户原话：

> 需要重启嘛 需要你一步步指导我怎么开

执行：

- 给出重启 Obsidian、打开第三方插件、命令面板打开 Codex view 的步骤。
- 提醒如果找不到 Codex CLI，需要填 `Codex CLI path`。

## 3. 运行反馈不清楚

用户原话：

> 我能看到 codex 但发了消息 它好像不工作？

发现：

- 插件其实已经跑完，并写入了 `last-response.md`。
- 问题是 UI 没有清晰反馈。

执行：

- 增加运行状态。
- 增加“最近回复”按钮。
- 隐藏无关日志。

## 4. 多窗口需求

用户原话：

> 我希望这个也有5个窗口 像claudian一样

执行：

- 增加 5 个固定窗口。
- 每个窗口保存自己的消息和最近回复。
- 增加命令面板入口打开窗口 1-5。

发布：

- v0.2.0 基础多窗口版。

## 5. GitHub 打包

用户原话：

> 能不能帮我打包到github 我在claude好像做过打包的流程 你看看

执行：

- 参考 `codex-plugin-cc` 和 `topic-surgeon` 的仓库结构。
- 创建独立项目目录。
- 初始化 git。
- 创建 GitHub 仓库。
- 添加 CI、release workflow、package script。
- 创建 release。

产出：

- https://github.com/ilulu66/obsidian-codex

## 6. 中文说明

用户原话：

> 我感觉你能不能写个中文的说明能友好一点

执行：

- 重写 README 为中文用户指南。
- 重写 Release 说明为中文安装说明。

意义：

- 从工程说明变成用户说明。

## 7. 复制与输出体验

用户原话：

> 这个插件的对话区 内容没办法部分复制 也没办法选中 我觉得有问题 另外 前面会跑很多代码语言我觉得我好奇思考过程 但是代码不用给我看 思考过程 和 结果

执行：

- 允许对话区文本选择。
- 支持局部复制。
- 隐藏命令行日志。
- 默认输出“思考过程（简要）+ 结果”。

发布：

- v0.2.1

## 8. Enter 发送

用户原话：

> 另外就是回车没办法发送内容 ，还需要点一下发送按钮

执行：

- Enter 发送。
- Shift + Enter 换行。
- 中文输入法组合中不误发送。

发布：

- v0.2.2

## 9. 复盘请求

用户原话：

> 你帮我复盘梳理我们整个使用迭代逻辑 ，我给的启发有哪些？

输出：

- 总结路线：

```text
能跑通 -> 看得见 -> 像原工具 -> 能分发 -> 看得懂 -> 用得顺 -> 更像人类协作
```

## 10. 下一轮优化

用户原话：

> 你认为还有什么优化思路呢

提出方向：

1. 真正的多轮上下文
2. 结果结构更稳定
3. Markdown 渲染
4. 一键插入方式更细
5. 当前笔记上下文更可控
6. 更好的运行状态
7. 安装/更新体验
8. 窗口命名

用户选择：

> 1568可不可以先做

执行：

- 每个窗口保存真实 Codex session。
- 上下文范围可选。
- 运行状态更清楚。
- 窗口可命名。

发布：

- v0.3.0

## 11. 当前请求：打包对话给 Claude 写文章

用户原话：

> 你能把我们的所有对话打包到项目里 我要让claude来写项目复盘的文章

执行：

- 创建 `docs/project-retrospective-source-pack.md`
- 创建 `docs/conversation-timeline.md`
- 创建 `docs/claude-writing-brief.md`

