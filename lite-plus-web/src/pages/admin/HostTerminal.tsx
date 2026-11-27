import { useEffect, useRef, useState } from "react";
import { Alert, Box } from "@mui/material";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useTranslation } from "react-i18next";

export default function HostTerminal({ ticket }: { ticket: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const { t } = useTranslation();
  useEffect(() => {
    if (!container.current) return;
    const terminal = new Terminal({ cursorBlink: true, disableStdin: true, fontSize: 13 });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(container.current);
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/admin/client/host-terminal`);
    ws.binaryType = "arraybuffer";
    let ready = false;
    const resize = () => { fit.fit(); if (ready && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows })); };
    const observer = new ResizeObserver(resize); observer.observe(container.current);
    ws.onopen = () => ws.send(JSON.stringify({ ticket }));
    ws.onmessage = event => {
      if (event.data instanceof ArrayBuffer) { terminal.write(new Uint8Array(event.data)); return; }
      try {
        const message = JSON.parse(event.data);
        if (message.ready) { ready = true; terminal.options.disableStdin = false; resize(); terminal.focus(); }
        if (message.error) setError(String(message.error));
      } catch { setError(t("hostctl.connection_failed")); }
    };
    const input = terminal.onData(data => { if (ready && ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data)); });
    const heartbeat = window.setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "heartbeat" })); }, 15000);
    ws.onclose = () => { terminal.options.disableStdin = true; setError(t("hostctl.disconnected")); };
    ws.onerror = () => setError(t("hostctl.connection_failed"));
    return () => { ws.onclose = null; ws.onerror = null; window.clearInterval(heartbeat); input.dispose(); observer.disconnect(); ws.close(); terminal.dispose(); };
  }, [ticket, t]);
  return <Box>{error && <Alert severity="warning">{error}</Alert>}<Box ref={container} sx={{ height: 420, minWidth: 0, bgcolor: "#000", p: 1 }} /></Box>;
}
