# Obsidian Codex

Call Codex from inside Obsidian, using the current vault as Codex's working directory.

This is a lightweight desktop-only Obsidian plugin inspired by Claudian's in-vault assistant workflow. It opens a Codex panel inside Obsidian and sends prompts to the local `codex` CLI.

## Features

- Five fixed Codex windows, similar to Claudian's multi-window workflow
- Each window keeps its own message history and last response
- Ask Codex from a side panel
- Send the current note as context
- Ask Codex about selected text or the current note from the command palette
- Insert the latest Codex response at the cursor
- Uses the vault root as Codex's working directory

## Requirements

- Obsidian desktop
- Codex CLI installed and authenticated

Install Codex CLI if needed:

```bash
npm install -g @openai/codex
codex login
```

## Manual Install

Download the latest release assets:

- `manifest.json`
- `main.js`
- `styles.css`

Create this folder inside your vault:

```text
.obsidian/plugins/codex
```

Put the three files there, then restart Obsidian and enable `Codex` in Community plugins.

## Usage

Open the command palette and run:

```text
Codex: Open Codex view
```

Useful commands:

- `Codex: Open Codex window 1` through `Codex: Open Codex window 5`
- `Codex: Ask Codex about selection`
- `Codex: Ask Codex about current note`
- `Codex: Insert last Codex response at cursor`
- `Codex: Stop current Codex run`

## Settings

If Obsidian cannot find Codex, set the Codex CLI path in plugin settings. Common examples:

```text
~/.npm-global/bin/codex
/opt/homebrew/bin/codex
/usr/local/bin/codex
```

Default execution settings:

- Sandbox: `workspace-write`
- Approval policy: `never`
- Web search: off

The plugin avoids `--dangerously-bypass-approvals-and-sandbox` by default.

## Development

This plugin is source-only. There is no bundling step.

```bash
npm test
npm run package
```

`npm run package` writes a release zip to `dist/`.

## Privacy

The plugin writes local runtime data in Obsidian's plugin data file, including recent messages and responses. That data is intentionally ignored by git and should not be published.

## License

MIT
