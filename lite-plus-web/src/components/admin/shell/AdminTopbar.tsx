import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { adminLetterAvatarSx } from "@/components/admin/SettingsChrome";
import { useAccount } from "@/contexts/AccountContext";
import { preloadAdminRoute } from "@/routes";
import { logout } from "./useAdminShell";
import { ChromeIconButton, LanguageMenu, ThemeMenu } from "./ChromeActions";
import { materialSymbol } from "@/theme/MaterialSymbol";

const Logout = materialSymbol("Logout");
const MenuIcon = materialSymbol("Menu");

type AdminTopbarProps = {
  isMobile: boolean;
  onOpenNav: () => void;
  updateAvailable: boolean;
  onOpenUpdate: () => void;
};

export default function AdminTopbar({
  isMobile,
  onOpenNav,
  updateAvailable,
  onOpenUpdate,
}: AdminTopbarProps) {
  const { t } = useTranslation();
  const { account } = useAccount();
  const navigate = useNavigate();
  const [userAnchor, setUserAnchor] = useState<HTMLElement | null>(null);
  const username = account?.username || "admin";
  const avatarUrl = account?.avatar_url || "";

  return (
    <AppBar
      position="sticky"
      color="inherit"
      sx={{
        bgcolor: (theme) =>
          theme.palette.mode === "light"
            ? "rgba(243, 242, 248, 0.88)"
            : "rgba(24, 24, 33, 0.88)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        backgroundImage: "none",
        color: "text.primary",
        boxShadow: "none",
        zIndex: 11,
        borderBottom: "1px solid",
        borderColor: "divider",
        transition: "none",
      }}
    >
      <Toolbar
        sx={{
          minHeight: { xs: 56, sm: 72 },
          px: { xs: 1, sm: 3 },
          alignItems: "center",
          pt: "var(--safe-area-top)",
        }}
      >
        {isMobile ? (
          <ChromeIconButton
            testId="mobile-sidebar-trigger"
            label={t("navigation.open")}
            onClick={onOpenNav}
          >
            <MenuIcon />
          </ChromeIconButton>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={0.25} sx={{ alignItems: "center" }}>
          {(
            <Chip
              data-testid="admin-update-button"
              clickable
               color={updateAvailable ? "error" : "primary"}
               variant={updateAvailable ? "filled" : "outlined"}
              size="small"
              label={updateAvailable ? t("common.update_available") : "ENB 更新"}
              onClick={onOpenUpdate}
              sx={{
                height: 32,
                mr: 0.75,
                fontWeight: 700,
              }}
            />
          )}
          <LanguageMenu />
          <ThemeMenu />
          <IconButton
            data-testid="admin-user-menu-button"
            aria-label={t("navigation.account", "Account")}
            onClick={(event: MouseEvent<HTMLElement>) =>
              setUserAnchor(event.currentTarget)
            }
            sx={{
              width: 40,
              height: 40,
              minWidth: 40,
              p: 0,
              borderRadius: "50%",
              ml: 0.5,
            }}
          >
            <Avatar
              src={avatarUrl || undefined}
              slotProps={{
                img: {
                  onError: (event) => {
                    (event.currentTarget as HTMLImageElement).style.display = "none";
                  },
                },
              }}
              sx={{
                width: 36,
                height: 36,
                fontSize: 14,
                ...adminLetterAvatarSx,
              }}
            >
              {username.slice(0, 1).toUpperCase()}
            </Avatar>
          </IconButton>
          <Menu
            anchorEl={userAnchor}
            open={Boolean(userAnchor)}
            onClose={() => setUserAnchor(null)}
            disableAutoFocusItem
            slotProps={{
              paper: {
                elevation: 0,
                sx: {
                  mt: 1,
                  minWidth: 188,
                  py: 0.75,
                  borderRadius: "var(--md-sys-shape-xs)",
                  border: "1px solid",
                  borderColor: "divider",
                  bgcolor: "var(--md-sys-color-surface-container)",
                  boxShadow: "var(--md-sys-elevation-2)",
                },
              },
            }}
            transformOrigin={{ horizontal: "right", vertical: "top" }}
            anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
          >
            <MenuItem disabled sx={{ borderRadius: 0, minHeight: 40, fontWeight: 600 }}>
              {username}
            </MenuItem>
            <MenuItem
              data-testid="admin-account-security-menu-item"
              sx={{ borderRadius: 0, minHeight: 40 }}
              onMouseEnter={() => {
                void preloadAdminRoute("/admin/settings/account-security");
              }}
              onClick={() => {
                setUserAnchor(null);
                void preloadAdminRoute("/admin/settings/account-security");
                void navigate("/admin/settings/account-security?tab=account");
              }}
            >
              {t("navigation.account_security")}
            </MenuItem>
            <MenuItem
              data-testid="admin-logout-menu-item"
              sx={{
                borderRadius: 0,
                minHeight: 40,
                fontWeight: 600,
                color: "var(--md-sys-color-on-error-container)",
                bgcolor: "var(--md-sys-color-error-container)",
                "&:hover": {
                  color: "var(--md-sys-color-on-error-container)",
                  bgcolor:
                    "color-mix(in srgb, var(--md-sys-color-on-error-container) 12%, var(--md-sys-color-error-container))",
                },
              }}
              onClick={() => {
                setUserAnchor(null);
                logout();
              }}
            >
              <Logout sx={{ fontSize: 18, mr: 1 }} />
              {t("common.logout", "Log out")}
            </MenuItem>
          </Menu>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
