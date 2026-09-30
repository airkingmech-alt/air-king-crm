import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Pass filenames directly: Windows shells do not expand the Node 20 test glob.
const files = readdirSync("tests").filter(name => name.endsWith(".test.ts")).sort();
if (!files.length) throw new Error("No test files found.");
const result = spawnSync(process.execPath, ["--import", "tsx", "--test",
  ...files.map(name => `tests/${name}`)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
