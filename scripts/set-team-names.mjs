#!/usr/bin/env node
// BizPilot AI · Part 1 — Database & Security
// Owner: Member 1 (see TEAM.md)
// Replaces the "Member 1".."Member 4" placeholders in file headers and TEAM.md
// with real names.
// Usage: node scripts/set-team-names.mjs "Kofi Mensah" "Ama Owusu" "Yaw Boateng" "Efua Asante"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const names = process.argv.slice(2);
if (names.length !== 4 || names.some((n) => !n.trim())) {
  console.error('Give exactly four names, in part order: node scripts/set-team-names.mjs "Name 1" "Name 2" "Name 3" "Name 4"');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".next", ".git"]);
const TEXT = new Set([".ts", ".tsx", ".mjs", ".js", ".css", ".sql", ".sh", ".md", ".toml", ".svg", ""]);

let changed = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (TEXT.has(extname(entry)) || entry.startsWith(".")) {
      if (entry.startsWith(".env.local") || entry === "set-team-names.mjs") continue;
      const before = readFileSync(path, "utf8");
      // Word boundary so "Member 1" never matches inside "Member 10".
      const after = before.replace(/\bMember ([1-4])\b/g, (_, n) => names[Number(n) - 1].trim());
      if (after !== before) {
        writeFileSync(path, after);
        changed++;
      }
    }
  }
}
walk(root);
console.log(`Updated ${changed} files.`);
