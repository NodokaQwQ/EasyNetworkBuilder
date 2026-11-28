import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const themeRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(themeRoot, "..");
const distDir = path.join(themeRoot, "dist");
const manifestPath = path.join(themeRoot, "Lite-theme.json");
const previewPath = path.join(themeRoot, "preview.png");
const bundledDest = path.join(
  repoRoot,
  "lite-plus",
  "web",
  "public",
  "bundledThemes",
  "enb-theme",
);
const zipOutput = path.join(themeRoot, "enb-theme.zip");

if (!existsSync(path.join(distDir, "index.html"))) {
  throw new Error("Missing dist/index.html — run `npm run build` first.");
}
if (!existsSync(manifestPath)) {
  throw new Error("Missing Lite-theme.json");
}
if (!existsSync(previewPath)) {
  throw new Error("Missing preview.png");
}

// 1. Sync into lite-plus/web/public/bundledThemes/enb-theme
rmSync(bundledDest, { recursive: true, force: true });
mkdirSync(bundledDest, { recursive: true });
cpSync(manifestPath, path.join(bundledDest, "Lite-theme.json"));
cpSync(previewPath, path.join(bundledDest, "preview.png"));
cpSync(distDir, path.join(bundledDest, "dist"), { recursive: true });

// 2. Build uploadable enb-theme.zip using Python standard zipfile (portable POSIX paths)
rmSync(zipOutput, { force: true });
execFileSync(
  "python3",
  [
    "-c",
    `
import os, sys, zipfile
src_dir, out_zip = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for root, dirs, files in os.walk(src_dir):
        dirs.sort()
        for f in sorted(files):
            full = os.path.join(root, f)
            rel = os.path.relpath(full, src_dir).replace(os.sep, "/")
            zf.write(full, rel)
`,
    bundledDest,
    zipOutput,
  ],
  { stdio: "inherit" },
);

console.log(`Packaged ENB Material You theme:
  - Bundled dir: ${bundledDest}
  - Uploadable zip: ${zipOutput}`);
