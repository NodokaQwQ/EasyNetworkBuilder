import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";

import {
  MATERIAL_SYMBOLS,
  type MaterialSymbolName,
} from "@/theme/materialSymbols.generated";

export type MaterialSymbolProps = Omit<SvgIconProps, "children"> & {
  /** FILL 1: used for selected navigation and other active states. */
  filled?: boolean;
};

export function materialSymbol(name: MaterialSymbolName) {
  const paths: { outline: string; fill?: string } = MATERIAL_SYMBOLS[name];
  function MaterialSymbolIcon({ filled = false, ...props }: MaterialSymbolProps) {
    return (
      <SvgIcon viewBox="0 -960 960 960" {...props}>
        <path d={filled && paths.fill ? paths.fill : paths.outline} />
      </SvgIcon>
    );
  }
  MaterialSymbolIcon.displayName = `MaterialSymbol(${name})`;
  return MaterialSymbolIcon;
}

export type MaterialSymbolComponent = ReturnType<typeof materialSymbol>;
