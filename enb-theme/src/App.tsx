import React, { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { IconLock } from "@/components/Icons";
import { TopBar } from "@/components/TopBar";
import { useI18n } from "@/i18n/locales";
import { useDashboardData } from "@/lib/DataContext";
import { HomePage } from "@/pages/HomePage";
import { ServerDetailPage } from "@/pages/ServerDetailPage";
import { ThemeProvider } from "@/theme/tokens";

const ShellBody: React.FC = () => {
  const { publicSettings, me, refreshNow } = useDashboardData();
  const { t } = useI18n();
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth <= 768 : false,
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const desktopBg = publicSettings.theme_settings?.CustomBackgroundImage?.trim() || "";
  const mobileBg =
    publicSettings.theme_settings?.CustomMobileBackgroundImage?.trim() || desktopBg;
  const activeBg = isMobile ? mobileBg : desktopBg;

  const isPrivateBlocked = Boolean(publicSettings.private_site && !me.logged_in);

  return (
    <div
      className={`enb-shell ${activeBg ? "has-custom-bg" : ""}`}
      style={activeBg ? { backgroundImage: `url("${activeBg}")` } : undefined}
    >
      <TopBar />

      <main className="enb-main">
        {isPrivateBlocked ? (
          <div
            style={{
              maxWidth: 460,
              width: "100%",
              margin: "64px auto",
              padding: "36px 28px",
              borderRadius: "var(--md-sys-shape-xl)",
              background: "var(--enb-card-bg)",
              border: "1px solid var(--md-sys-color-outline-variant)",
              boxShadow: "var(--md-sys-elevation-2)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                margin: "0 auto 18px",
                borderRadius: "50%",
                background: "var(--md-sys-color-primary-container)",
                color: "var(--md-sys-color-on-primary-container)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IconLock size={26} />
            </div>
            <h1 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700 }}>
              {t("privateTitle")}
            </h1>
            <p
              style={{
                margin: "0 0 22px",
                fontSize: 13.5,
                lineHeight: 1.6,
                color: "var(--md-sys-color-on-surface-variant)",
              }}
            >
              {t("privateHint")}
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              <a href="/admin" className="enb-btn enb-btn-filled">
                {t("login")}
              </a>
              <button
                type="button"
                className="enb-btn enb-btn-tonal"
                onClick={() => void refreshNow()}
              >
                {t("privateRefresh")}
              </button>
            </div>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/server/:uuid" element={<ServerDetailPage />} />
            <Route path="/instance/:uuid" element={<ServerDetailPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>

      <footer className="enb-footer">
        <span>
          {publicSettings.sitename?.trim() || "Lite-Plus"} · Material Design You
        </span>
        <span>
          Powered by{" "}
          <a
            href="https://github.com/NodokaQwQ/EasyNetworkBuilder"
            target="_blank"
            rel="noreferrer"
          >
            EasyNetworkBuilder
          </a>
        </span>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  const { publicSettings } = useDashboardData();
  return (
    <ThemeProvider forceTheme={publicSettings.theme_settings?.ForceTheme}>
      <ShellBody />
    </ThemeProvider>
  );
};
