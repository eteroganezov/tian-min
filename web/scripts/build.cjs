const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const distDir = path.join(root, "dist");
for (const required of ["index.html", "styles.css", "app.js"]) {
  if (!fs.existsSync(path.join(publicDir, required))) throw new Error(`Не найден web/public/${required}`);
}
const placeManifest = path.join(root, "data", "geonames", "manifest.json");
if (!fs.existsSync(placeManifest)) throw new Error("GeoNames snapshot is missing: web/data/geonames/manifest.json");
execFileSync(process.execPath, ["--check", path.join(publicDir, "app.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", path.join(root, "server.cjs")], { stdio: "inherit" });
fs.rmSync(distDir, { recursive: true, force: true });
fs.cpSync(publicDir, distDir, { recursive: true });
console.log("Web build готов: web/dist");
