import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const distDir = "dist";
const zipPath = path.join(distDir, `obsidian-codex-${manifest.version}.zip`);

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

for (const file of ["manifest.json", "main.js", "styles.css"]) {
  fs.copyFileSync(file, path.join(distDir, file));
}

childProcess.execFileSync("zip", ["-q", "-j", zipPath, "manifest.json", "main.js", "styles.css"], {
  stdio: "inherit"
});

console.log(`Wrote ${zipPath}`);
