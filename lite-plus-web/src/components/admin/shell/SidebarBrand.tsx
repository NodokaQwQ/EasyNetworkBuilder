import Box from "@mui/material/Box";

import { LITE_NAME } from "@/theme/brand";

export default function SidebarBrand({
  mini,
  compact,
}: {
  mini: boolean;
  compact: boolean;
}) {
  return (
    <Box
      component="a"
      href="/"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={LITE_NAME}
      data-testid="sidebar-brand"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.5,
        minHeight: 40,
        minWidth: 40,
        flexShrink: 0,
        color: "text.primary",
        textDecoration: "none",
        borderRadius: 1,
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: 4,
        },
      }}
    >
      <Box
        component="svg"
        viewBox="0 0 32 32"
        aria-hidden="true"
        focusable="false"
        sx={{
          width: mini || compact ? 32 : 36,
          height: mini || compact ? 32 : 36,
          display: "block",
          flexShrink: 0,
        }}
      >
        <rect x="0" y="0" width="32" height="32" rx="7" fill="#5845FF" />
        <path d="M16 7 25 12.2v7.6L16 25l-9-5.2v-7.6L16 7Z" fill="none" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M16 16V7m0 9 8 4.6M16 16 8 20.6" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="16" cy="16" r="3.4" fill="white" />
      </Box>
      {mini ? null : (
        <Box
          component="span"
          aria-hidden="true"
          sx={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "3px",
            whiteSpace: "nowrap",
          }}
        >
          <Box
            component="span"
            data-testid="sidebar-brand-wordmark"
            sx={{
              position: "relative",
              display: "inline-block",
              color: "text.primary",
              fontSize: compact ? 14 : 15,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.4px",
            }}
          >
            EasyNetworkBuilder
          </Box>
          <Box
            component="span"
            sx={{
              color: "text.secondary",
              fontSize: 9,
              fontWeight: 500,
              lineHeight: 1.25,
              letterSpacing: "0.1em",
            }}
          >
            OPERATIONS CONSOLE
          </Box>
        </Box>
      )}
    </Box>
  );
}
