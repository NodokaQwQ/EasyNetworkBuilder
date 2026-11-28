import { chartPaletteVariables } from "@/theme/chartPalette";

/** Also reaches tooltip/dialog portals, but never changes public dashboard themes. */
export default function AdminChartTokens() {
  return (
    <style>{`
      html[data-admin-shell-active="true"] { ${chartPaletteVariables("light")} }
      html.dark[data-admin-shell-active="true"] { ${chartPaletteVariables("dark")} }
    `}</style>
  );
}
