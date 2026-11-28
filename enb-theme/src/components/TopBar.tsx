import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  EnbLogoMark,
  IconCheck,
  IconMoon,
  IconSun,
  IconTranslate,
} from "@/components/Icons";
import { LOCALE_LABELS, useI18n, type LocaleCode } from "@/i18n/locales";
import { useDashboardData } from "@/lib/DataContext";
import { useThemeMode, type ThemePreference } from "@/theme/tokens";

export const TopBar: React.FC = () => {
  const { publicSettings, me, wsConnected } = useDashboardData();
  const { locale, setLocale, t } = useI18n();
  const { preference, resolved, forced, setPreference } = useThemeMode();

  const [langOpen, setLangOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const langRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);

  const customLogo = publicSettings.theme_settings?.CustomLogo?.trim() || "/favicon.ico";
  const siteName = publicSettings.sitename?.trim() || "Lite-Plus";
  const siteDesc = publicSettings.description?.trim() || "";

  useEffect(() => {
    setLogoFailed(false);
  }, [customLogo]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (langRef.current && !langRef.current.contains(target)) {
        setLangOpen(false);
      }
      if (themeRef.current && !themeRef.current.contains(target)) {
        setThemeOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const initial = (me.username?.trim()?.[0] || "A").toUpperCase();

  return (
    <header className="enb-topbar">
      <div className="enb-topbar-inner">
        <Link to="/" className="enb-brand">
          {logoFailed ? (
            <EnbLogoMark size={34} />
          ) : (
            <img
              src={customLogo}
              alt={siteName}
              className="enb-brand-logo"
              onError={() => setLogoFailed(true)}
            />
          )}
          <span className="enb-brand-title">{siteName}</span>
          {siteDesc ? (
            <>
              <span className="enb-brand-divider" aria-hidden="true" />
              <span className="enb-brand-subtitle">{siteDesc}</span>
            </>
          ) : null}
        </Link>

        <div className="enb-topbar-actions">
          <span
            className={`enb-pill ${wsConnected ? "enb-pill-healthy" : "enb-pill-neutral"}`}
            style={{ height: 28, padding: "0 10px" }}
            title={wsConnected ? t("wsLive") : t("wsConnecting")}
          >
            <span className="enb-pill-dot" />
            <span style={{ fontSize: 11.5 }}>
              {wsConnected ? t("wsLive") : t("wsConnecting")}
            </span>
          </span>

          {/* Language Menu */}
          <div className="enb-menu-wrap" ref={langRef}>
            <button
              type="button"
              className="enb-icon-btn"
              aria-label="Language"
              onClick={() => {
                setLangOpen((v) => !v);
                setThemeOpen(false);
              }}
            >
              <IconTranslate />
            </button>
            {langOpen ? (
              <div className="enb-menu" role="menu">
                {(Object.keys(LOCALE_LABELS) as LocaleCode[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    role="menuitem"
                    className={`enb-menu-item ${locale === code ? "is-active" : ""}`}
                    onClick={() => {
                      setLocale(code);
                      setLangOpen(false);
                    }}
                  >
                    <span>{LOCALE_LABELS[code]}</span>
                    {locale === code ? <IconCheck /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Theme Switcher */}
          {!forced ? (
            <div className="enb-menu-wrap" ref={themeRef}>
              <button
                type="button"
                className="enb-icon-btn"
                aria-label="Theme"
                onClick={() => {
                  setThemeOpen((v) => !v);
                  setLangOpen(false);
                }}
              >
                {resolved === "dark" ? <IconMoon /> : <IconSun />}
              </button>
              {themeOpen ? (
                <div className="enb-menu" role="menu">
                  {(
                    [
                      ["light", t("themeLight")],
                      ["dark", t("themeDark")],
                      ["system", t("themeSystem")],
                    ] as Array<[ThemePreference, string]>
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      role="menuitem"
                      className={`enb-menu-item ${preference === mode ? "is-active" : ""}`}
                      onClick={() => {
                        setPreference(mode);
                        setThemeOpen(false);
                      }}
                    >
                      <span>{label}</span>
                      {preference === mode ? <IconCheck /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Admin / Login Entry */}
          {me.logged_in ? (
            <a href="/admin" className="enb-avatar-btn" title={t("adminConsole")}>
              <span className="enb-avatar-circle">
                {me.avatar_url ? (
                  <img
                    src={me.avatar_url}
                    alt={me.username || ""}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  initial
                )}
              </span>
              <span>{t("adminConsole")}</span>
            </a>
          ) : (
            <a href="/admin" className="enb-btn enb-btn-tonal" style={{ height: 36, padding: "0 16px" }}>
              {t("login")}
            </a>
          )}
        </div>
      </div>
    </header>
  );
};
