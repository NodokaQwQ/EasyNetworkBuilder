import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  MD3_COLORS,
  MD3_ELEVATION,
  MD3_FONT_MONO,
  MD3_FONT_SANS,
  MD3_MOTION,
  MD3_SHAPE,
} from "../src/theme/md3Tokens.ts";
import { CHART_PALETTE_DARK, CHART_PALETTE_LIGHT } from "../src/theme/chartPalette.ts";

test("MD3 tonal color tokens match the EasyNetworkBuilder Material Design You specification", () => {
  assert.equal(MD3_COLORS.light.primary, "#5845FF");
  assert.equal(MD3_COLORS.light.onPrimary, "#FFFFFF");
  assert.equal(MD3_COLORS.light.primaryContainer, "#DFDBFF");
  assert.equal(MD3_COLORS.light.onPrimaryContainer, "#10085E");
  assert.equal(MD3_COLORS.light.secondary, "#554F87");
  assert.equal(MD3_COLORS.light.secondaryContainer, "#E0DEF2");
  assert.equal(MD3_COLORS.light.tertiary, "#D946EF");
  assert.equal(MD3_COLORS.light.surface, "#F9F8FC");
  assert.equal(MD3_COLORS.light.surfaceContainerLowest, "#FFFFFF");
  assert.equal(MD3_COLORS.light.surfaceContainerLow, "#F3F2F8");
  assert.equal(MD3_COLORS.light.surfaceContainer, "#EDECF4");
  assert.equal(MD3_COLORS.light.surfaceContainerHigh, "#E4E3EE");
  assert.equal(MD3_COLORS.light.surfaceContainerHighest, "#DCDAE7");
  assert.equal(MD3_COLORS.light.outlineVariant, "#C5C3D5");
  assert.equal(MD3_COLORS.light.error, "#F43F5E");
  assert.equal(MD3_COLORS.light.opsHealthy, "#10B981");
  assert.equal(MD3_COLORS.light.opsWarning, "#F59E0B");

  assert.equal(MD3_COLORS.dark.primary, "#ACA3FF");
  assert.equal(MD3_COLORS.dark.onPrimary, "#10066B");
  assert.equal(MD3_COLORS.dark.primaryContainer, "#1D0EAA");
  assert.equal(MD3_COLORS.dark.onPrimaryContainer, "#DFDBFF");
  assert.equal(MD3_COLORS.dark.secondary, "#B9B5DE");
  assert.equal(MD3_COLORS.dark.secondaryContainer, "#3A3663");
  assert.equal(MD3_COLORS.dark.tertiary, "#F2A6DE");
  assert.equal(MD3_COLORS.dark.surface, "#111118");
  assert.equal(MD3_COLORS.dark.surfaceContainerLowest, "#0B0A0F");
  assert.equal(MD3_COLORS.dark.surfaceContainerLow, "#181821");
  assert.equal(MD3_COLORS.dark.surfaceContainer, "#1F1E29");
  assert.equal(MD3_COLORS.dark.surfaceContainerHigh, "#282735");
  assert.equal(MD3_COLORS.dark.surfaceContainerHighest, "#323040");
  assert.equal(MD3_COLORS.dark.outlineVariant, "#434059");
  assert.equal(MD3_COLORS.dark.error, "#FFB4AB");
  assert.equal(MD3_COLORS.dark.opsHealthy, "#6EE7B7");
  assert.equal(MD3_COLORS.dark.opsWarning, "#FCD34D");
});

test("MD3 shape, motion, elevation, typography, and 24-color chart scales are complete", () => {
  assert.deepEqual(MD3_SHAPE, {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 28,
    full: 9999,
  });
  assert.equal(MD3_MOTION.easingStandard, "cubic-bezier(0.2, 0, 0, 1)");
  assert.equal(Object.keys(MD3_ELEVATION).length, 6);
  assert.equal(MD3_ELEVATION[0], "none");
  assert.match(MD3_FONT_SANS, /Inter/);
  assert.match(MD3_FONT_MONO, /JetBrains Mono/);
  assert.equal(CHART_PALETTE_LIGHT.length, 24);
  assert.equal(CHART_PALETTE_DARK.length, 24);
});

test("system UI components apply MD3 capsule buttons, 28px dialogs, mobile drag handles, and frosted topbar", () => {
  const materialCss = readFileSync("src/adminMaterial.css", "utf8");
  const appTheme = readFileSync("src/theme/createAppTheme.ts", "utf8");
  const dialog = readFileSync("src/components/admin/ui/dialog.tsx", "utf8");
  const sheetDialog = readFileSync("src/components/admin/SettingsSheetDialog.tsx", "utf8");
  const topbar = readFileSync("src/components/admin/shell/AdminTopbar.tsx", "utf8");
  const sidebar = readFileSync("src/components/admin/shell/AdminSidebar.tsx", "utf8");

  assert.match(materialCss, /--md-sys-color-primary:\s*#5845FF/);
  assert.match(materialCss, /html\.dark\s*\{[\s\S]*--md-sys-color-primary:\s*#ACA3FF/);
  assert.match(appTheme, /MuiButton:[\s\S]*borderRadius:\s*MD3_SHAPE\.full/);
  assert.match(appTheme, /MuiDialog:[\s\S]*borderRadius:\s*MD3_SHAPE\.xl/);
  assert.match(dialog, /28px 28px 0 0/);
  assert.match(sheetDialog, /28px 28px 0 0/);
  assert.match(topbar, /backdropFilter:\s*"blur\(12px\)"/);
  assert.match(sidebar, /borderRadius:\s*"9999px"/);
});

test("status marks and app chrome no longer use the previous blue/green palette", () => {
  const files = [
    "src/components/admin/AdminNodeListFilters.tsx",
    "src/pages/admin/remote-management/firewall.tsx",
    "src/pages/admin/nodemgt/subPreview.tsx",
    "src/components/remote/RemoteExecNodeSelector.css",
    "vite.config.ts",
    "public/manifest.json",
    "index.html",
  ];
  for (const file of files) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /#22C55E|#FF5630|#0E86DD|#2563eb|rgba\(34, 197, 94|rgba\(255, 86, 48|lite-icon-0e86dd/i,
      file,
    );
  }
  const materialCss = readFileSync("src/adminMaterial.css", "utf8");
  assert.match(materialCss, /\.admin-table-header \{\s*color: var\(--muted-foreground\);/);
  assert.match(readFileSync("index.html", "utf8"), /favicon\.png\?v=enb-icon-5845ff/);
});

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|css)$/.test(entry.name) ? [full] : [];
  });

test("Inter and JetBrains Mono are bundled and used by sans, mono, chart and Tailwind tokens", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.dependencies["@fontsource-variable/inter"]);
  assert.ok(pkg.dependencies["@fontsource-variable/jetbrains-mono"]);
  const provider = readFileSync("src/theme/MuiAppProvider.tsx", "utf8");
  assert.match(provider, /import "@fontsource-variable\/inter";/);
  assert.match(provider, /import "@fontsource-variable\/jetbrains-mono";/);
  assert.match(MD3_FONT_SANS, /^"Inter Variable"/);
  assert.match(MD3_FONT_MONO, /^"JetBrains Mono Variable"/);
  const material = readFileSync("src/adminMaterial.css", "utf8");
  assert.match(material, /--font-sans: "Inter Variable"/);
  assert.match(material, /--font-mono: "JetBrains Mono Variable"/);
  assert.match(material, /--chart-mono: var\(--font-mono\)/);
  assert.match(material, /\.enb-mono\.enb-mono,[\s\S]*?font-family: var\(--font-mono\);\s*font-variant-numeric: tabular-nums;/);
  assert.match(readFileSync("src/global.css", "utf8"), /@theme \{\s*--font-mono: "JetBrains Mono Variable"/);
  for (const file of ["src/pages/admin/virtualnet.tsx", "src/pages/admin/sessions.tsx", "src/pages/admin/index.tsx", "src/pages/admin/remote-management/firewall.tsx"]) {
    assert.match(readFileSync(file, "utf8"), /className="enb-mono"/, file);
  }
  for (const file of sourceFiles("src").filter((f) => !f.includes("/pages/terminal/") && !f.endsWith("md3Tokens.ts"))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /fontFamily: "(ui-)?monospace|font-family: ui-monospace/, file);
  }
});

test("icons use Material Symbols Rounded with FILL 1 for selected navigation", () => {
  const offenders = sourceFiles("src").filter((file) =>
    /from "@mui\/icons-material\/(?!GitHub")[A-Za-z0-9]+"/.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(offenders, []);
  const generated = readFileSync("src/theme/materialSymbols.generated.ts", "utf8");
  assert.match(generated, /@material-symbols\/svg-400@0\.49\.0 \(rounded\), Apache License 2\.0/);
  const manifest = JSON.parse(readFileSync("script/material-symbols.json", "utf8"));
  assert.equal(manifest.style, "rounded");
  for (const [name, entry] of Object.entries(manifest.icons) as [string, { mode: string }][]) {
    const line = generated.split("\n").find((row) => row.startsWith(`  ${name}: `));
    assert.ok(line, name);
    assert.equal(line.includes('"fill":'), entry.mode === "toggle", name);
  }
  const symbol = readFileSync("src/theme/MaterialSymbol.tsx", "utf8");
  assert.match(symbol, /viewBox="0 -960 960 960"/);
  assert.match(symbol, /filled && paths\.fill \? paths\.fill : paths\.outline/);
  assert.match(readFileSync("src/utils/iconHelper.ts", "utf8"), /\.\.\.\(filled \? \{ filled \} : \{\}\)/);
  assert.match(readFileSync("src/components/admin/shell/AdminSidebar.tsx", "utf8"), /<Icon size=\{20\} filled=\{active\} \/>/);
  assert.match(readFileSync("src/pages/terminal/RemoteSession.tsx", "utf8"), /<Files size=\{20\} filled=\{sidePanel === "files"\} \/>/);
});

test("menus, snackbars, dialogs, switches, chips and easing follow the MD3 component parameters", () => {
  const theme = readFileSync("src/theme/createAppTheme.ts", "utf8");
  assert.match(theme, /MuiMenu:[\s\S]*?paper: \{\s*borderRadius: MD3_SHAPE\.xs,[\s\S]*?backgroundColor: tokens\.surfaceContainer,/);
  assert.match(theme, /MuiDialog:[\s\S]*?backgroundColor: tokens\.surfaceContainerHigh,/);
  assert.match(theme, /MuiSwitch:[\s\S]*?width: 48,\s*height: 28,/);
  assert.match(theme, /thumb: \{\s*width: 14,\s*height: 14,/);
  assert.match(theme, /"& \.MuiSwitch-thumb": \{\s*width: 20,\s*height: 20,/);
  const menu = readFileSync("src/components/admin/adminMenu.ts", "utf8");
  assert.match(menu, /borderRadius: "var\(--md-sys-shape-xs\)"/);
  assert.match(menu, /bgcolor: "var\(--md-sys-color-surface-container\)"/);
  const material = readFileSync("src/adminMaterial.css", "utf8");
  assert.match(material, /\[data-sonner-toast\][\s\S]*?border-radius: var\(--md-sys-shape-xs\) !important;/);
  assert.match(material, /\.km-admin-filter-chip\.MuiChip-root \{\s*border-radius: var\(--md-sys-shape-sm\);/);
  for (const file of sourceFiles("src")) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /cubic-bezier\(0\.22, 1, 0\.36, 1\)|cubic-bezier\(0\.4, 0, 1, 1\)/, file);
  }
});
