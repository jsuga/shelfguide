import fs from "fs";
import os from "os";
import path from "path";

const platform = process.platform;
const downloadsDir =
  platform === "win32"
    ? path.join(process.env.USERPROFILE || "", "Downloads")
    : path.join(os.homedir(), "Downloads");

const sourcePath = path.join(downloadsDir, "defaultBookLibrary.csv");
const destPath = path.join(process.cwd(), "public", "defaultBookLibrary.csv");
const destDir = path.dirname(destPath);

if (!fs.existsSync(sourcePath)) {
  console.error(`CSV template not found at ${sourcePath}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(sourcePath, destPath);
console.log(`CSV template copied to ${destPath}`);
