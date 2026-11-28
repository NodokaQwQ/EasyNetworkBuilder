import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import type { ReactNode } from "react";

import {
  LanguageMenu,
  ThemeMenu,
} from "@/components/admin/shell/ChromeActions";
import { LITE_BLUE, LITE_NAME } from "@/theme/brand";
import { getAppAssetUrl } from "@/utils/assetUrl";

export type MigrationProgress = {
  value: number;
  label: string;
  detail?: string;
  determinate?: boolean;
};

type MigrationGuideShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  progress?: MigrationProgress | null;
};

export default function MigrationGuideShell({
  title,
  subtitle,
  children,
  footer,
  progress,
}: MigrationGuideShellProps) {
  const theme = useTheme();
  const showProgress = Boolean(progress);

  return (
    <Box
      data-testid="migration-guide"
      sx={{
        minHeight: "100dvh",
        pt: "var(--safe-area-top)",
        pb: "var(--safe-area-bottom)",
        bgcolor: "background.default",
        "& .MuiOutlinedInput-root:not(.MuiInputBase-multiline)": {
          minHeight: 44,
        },
      }}
    >
      <Paper
        component="header"
        square
        elevation={0}
        sx={{
          height: { xs: 56, sm: 64 },
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "var(--md-sys-color-surface-container-low, var(--card))",
        }}
      >
        <Stack
          direction="row"
          sx={{
            height: "100%",
            px: { xs: 2, sm: 3.5 },
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            <Box
              component="img"
              src={getAppAssetUrl("assets/logo.png?v=enb-icon-5845ff")}
              alt={LITE_NAME}
              sx={{ width: 34, height: 34, objectFit: "contain" }}
            />
            <Typography
              component="span"
              sx={{
                color: theme.palette.mode === "light" ? LITE_BLUE : "primary.main",
                fontSize: 20,
                fontWeight: 700,
              }}
            >
              {LITE_NAME}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <LanguageMenu />
            <ThemeMenu />
          </Stack>
        </Stack>
      </Paper>

      <Box
        component="main"
        sx={{
          width: "100%",
          maxWidth: 880,
          mx: "auto",
          px: 2,
          py: 2,
          "@media (min-width: 768px)": { px: 3, py: 3 },
          "@media (min-width: 1200px)": { py: 5 },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            overflow: "hidden",
            borderRadius: "28px",
            border: 1,
            borderColor: "divider",
            boxShadow: "var(--md-sys-elevation-1)",
          }}
        >
          <Box sx={{ px: { xs: 2, sm: 4 }, py: { xs: 3, sm: 4 } }}>
            <Typography
              component="div"
              sx={{
                color: theme.palette.mode === "light" ? LITE_BLUE : "primary.main",
                fontSize: 20,
                fontWeight: 700,
                lineHeight: 1,
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              {LITE_NAME}
            </Typography>
            <Typography variant="h4" sx={{ mt: 0.35 }}>
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                {subtitle}
              </Typography>
            ) : null}

            {showProgress ? (
              <Box sx={{ mt: 2.5 }}>
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: "baseline", justifyContent: "space-between" }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {progress?.label}
                  </Typography>
                  {progress?.determinate !== false ? (
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {Math.round(progress?.value ?? 0)}%
                    </Typography>
                  ) : null}
                </Stack>
                <LinearProgress
                  variant={
                    progress?.determinate === false ? "indeterminate" : "determinate"
                  }
                  value={Math.min(100, Math.max(0, progress?.value ?? 0))}
                  sx={{
                    mt: 1,
                    height: 6,
                    borderRadius: "9999px",
                    bgcolor:
                      theme.palette.mode === "light"
                        ? "#DFDBFF"
                        : alpha(theme.palette.primary.main, 0.2),
                  }}
                />
                {progress?.detail ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 1 }}
                  >
                    {progress.detail}
                  </Typography>
                ) : null}
              </Box>
            ) : null}

            <Box sx={{ mt: showProgress ? 3 : 3.5 }}>{children}</Box>
          </Box>

          {footer ? (
            <Box
              sx={{
                borderTop: 1,
                borderColor: "divider",
                px: { xs: 2, sm: 4 },
                py: 1.75,
              }}
            >
              {footer}
            </Box>
          ) : null}
        </Paper>
      </Box>
    </Box>
  );
}
