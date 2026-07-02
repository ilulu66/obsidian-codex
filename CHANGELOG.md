# Changelog

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
