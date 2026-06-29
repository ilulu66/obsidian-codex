import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));

const requiredFiles = ["main.js", "manifest.json", "styles.css", "README.md", "LICENSE"];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing required file: ${file}`);
  }
}

if (pkg.version !== manifest.version) {
  throw new Error(`package.json version ${pkg.version} does not match manifest.json version ${manifest.version}`);
}

if (!versions[manifest.version]) {
  throw new Error(`versions.json is missing manifest version ${manifest.version}`);
}

if (manifest.id !== "codex") {
  throw new Error(`Expected manifest id "codex", got "${manifest.id}"`);
}

if (!manifest.isDesktopOnly) {
  throw new Error("Codex plugin must be desktop-only because it shells out to the local Codex CLI");
}

console.log(`Manifest OK: ${manifest.id}@${manifest.version}`);
