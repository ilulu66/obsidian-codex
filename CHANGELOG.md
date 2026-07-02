# Changelog

## 0.5.0

- Allow the plugin to load on Obsidian mobile in sync-view mode.
- On mobile you can browse every Codex window, read synced chat history, copy the last response, and insert it into notes.
- Running Codex, attaching images, and sending prompts stay desktop-only; mobile shows a clear notice instead of failing.
- Guard all Node-only APIs (`child_process`, `fs`, `os`, `path`) so the plugin no longer requires a desktop runtime to load.

## 0.4.0

- Add a visible running status panel with current stage, elapsed seconds, stop action, and failure reason.
- Add a `+` button for creating more Codex windows, up to 20 total windows.
- Make the window tab bar horizontally scrollable so renamed windows do not hide other controls.
- Add image attachments through the image button, paste, and drag-and-drop.
- Add a restore command for reopening the Codex panel after the Obsidian pane is closed.

## 0.3.0

- Keep a real Codex session id per window and resume it on follow-up messages.
- Add context modes: no context, selected text, current section, active note, backlinks, and same-tag notes.
- Add a rename action for each Codex window.
- Add clearer running status for context preparation, session creation/resume, and completion.
- Reset a window's Codex session when clearing that window.

## 0.2.2

- Send messages with `Enter`.
- Use `Shift + Enter` for a newline.
- Avoid sending while a Chinese/Japanese/Korean IME composition is active.

## 0.2.1

- Allow selecting and partially copying message text in the Codex panel.
- Hide Codex CLI startup logs and command details from the chat area.
- Default responses now ask for `思考过程（简要）` and `结果`.
- Avoid showing large code/log output unless explicitly requested.

## 0.2.0

- Add five fixed Codex windows.
- Save message history and latest response per window.
- Add command palette entries for opening Codex windows 1-5.
- Prevent switching windows while Codex is running.

## 0.1.1

- Improve running status display.
- Add a recent response button.
- Filter noisy Codex skill-loading diagnostics from the panel.

## 0.1.0

- Initial Obsidian panel for calling `codex exec`.
- Add current note and selection commands.
