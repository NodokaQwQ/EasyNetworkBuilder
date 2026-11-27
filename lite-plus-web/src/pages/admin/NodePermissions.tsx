import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, MenuItem, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useRPC2Call } from "@/contexts/RPC2Context";
import { confirmAdminPasskey } from "@/utils/webauthn";
import HostTerminal from "./HostTerminal";
import { createRandomId } from "@/utils/randomId";

type Project = { name: string; directory: string };
type Policy = {
  peer_id: string; revision: number; node_image: string; projects: Project[];
  node_terminal: boolean; node_files: boolean; node_exec: boolean; node_mcp: boolean; node_firewall: boolean; node_protection: boolean;
  host_terminal: boolean; host_files: boolean; host_exec: boolean; node_docker: boolean;
};
type FileEntry = { name: string; size: number; directory: boolean; symlink: boolean };
const nodeKeys = ["node_terminal", "node_files", "node_exec", "node_mcp", "node_firewall", "node_protection"] as const;
const hostKeys = ["host_terminal", "host_files", "host_exec", "node_docker"] as const;

export default function NodePermissions({ peer, onClose }: { peer: { id: string; hostname: string }; onClose: () => void }) {
  const { t } = useTranslation(); const { call } = useRPC2Call();
  const [policy, setPolicy] = useState<Policy>(); const [saved, setSaved] = useState<Policy>();
  const [reported, setReported] = useState(""); const [associated, setAssociated] = useState(false);
  const [tab, setTab] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false); const [applyNode, setApplyNode] = useState(false);
  const [projects, setProjects] = useState(""); const [password, setPassword] = useState(""); const [otp, setOTP] = useState("");
  const grant = useRef(""); const pageID = useRef(createRandomId());
  const [authorized, setAuthorized] = useState(false); const [ticket, setTicket] = useState("");
  const [command, setCommand] = useState(""); const [output, setOutput] = useState("");
  const [filePath, setFilePath] = useState(""); const [entries, setEntries] = useState<FileEntry[]>([]);
  const [project, setProject] = useState("enb-managed-node");
  const load = async () => {
    const result = await call("admin:virtualnet.permissions", { peer_id: peer.id });
    setPolicy(result.policy); setSaved(result.policy); setAssociated(result.node_associated);
    setReported(result.agent ? `${result.agent.remote_control_enabled ? "on" : "off"} · ${result.agent.remote_permissions || t("hostctl.legacy")}` : "—");
    setProjects((result.policy.projects || []).map((p: Project) => `${p.name} ${p.directory}`).join("\n"));
  };
  useEffect(() => { let active = true; void call("admin:virtualnet.permissions", { peer_id: peer.id }).then(result => {
    if (!active) return; setPolicy(result.policy); setSaved(result.policy); setAssociated(result.node_associated);
    setReported(result.agent ? `${result.agent.remote_control_enabled ? "on" : "off"} · ${result.agent.remote_permissions || t("hostctl.legacy")}` : "—");
    setProjects((result.policy.projects || []).map((p: Project) => `${p.name} ${p.directory}`).join("\n"));
  }).catch(e => active && setError(String(e))); return () => { active = false; const token = grant.current; if (token) void fetch("/api/admin/client/remote/revoke", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant: token }), keepalive: true }); }; }, [call, peer.id, t]);
  async function action(fn: () => Promise<void>) { setBusy(true); setError(""); setMessage(""); try { await fn(); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  async function authorize(passkey = false) {
    const credentials = passkey ? await confirmAdminPasskey() : { password, otp };
    setPassword(""); setOTP("");
    const response = await fetch("/api/admin/client/remote/authorize", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...credentials, scope: "remote", page_id: pageID.current }) });
    const result = await response.json(); if (!response.ok || !result.data?.grant) throw Error(result.message || t("hostctl.auth_failed"));
    grant.current = result.data.grant; setAuthorized(true);
  }
  async function authorizedCall(method: string, params: object = {}) {
    // Never automatically replay a mutating SSH operation after WS failure.
    const response = await fetch("/api/rpc2", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: createRandomId(), method, params: { ...params, peer_id: peer.id, grant: grant.current, page_id: pageID.current } }), signal: AbortSignal.timeout(150000) });
    const payload = await response.json();
    if (!response.ok || payload.error) { setAuthorized(false); throw Error(payload.error?.message || `HTTP ${response.status}`); }
    const result = payload.result;
    if (result.next_grant) grant.current = result.next_grant;
    if (result.error) { await load(); setTicket(""); setConfirmed(false); throw Error(result.error); }
    return result;
  }
  async function host(params: object) { const result = await authorizedCall("admin:virtualnet.host", params); return result.result; }
  const dirty = policy && saved && (nodeKeys.some(k => policy[k] !== saved[k]) || policy.node_image !== saved.node_image);
  const toggle = (key: typeof nodeKeys[number] | typeof hostKeys[number], value: boolean) => { if (policy) { setPolicy({ ...policy, [key]: value }); setConfirmed(false); } };
  return <Dialog open onClose={() => !busy && onClose()} maxWidth="md" fullWidth>
    <DialogTitle>{t("hostctl.title")} — {peer.hostname || peer.id}</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ pt: 1, "& .MuiInputBase-root:not(.MuiInputBase-multiline)": { minHeight: 40 } }}>
      <Alert severity="warning">{t("hostctl.boundary")}</Alert>
      {error && <Alert severity="error">{error}</Alert>}{message && <Alert severity="success">{message}</Alert>}
      {!authorized ? <Stack spacing={2}>
        <Alert severity="info">{t("hostctl.reauth")}</Alert>
        <TextField size="small" label={t("hostctl.password")} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
        <TextField size="small" label={t("hostctl.otp")} autoComplete="one-time-code" value={otp} onChange={e => setOTP(e.target.value)} />
        <Stack direction="row" spacing={1}><Button disabled={busy} onClick={() => void action(() => authorize())}>{t("hostctl.authorize")}</Button><Button disabled={busy} onClick={() => void action(() => authorize(true))}>{t("hostctl.passkey")}</Button></Stack>
      </Stack> : <>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setTicket(""); }} variant="scrollable" scrollButtons="auto">{["permissions", "terminal", "files", "commands", "docker"].map(k => <Tab key={k} label={t(`hostctl.${k}`)} />)}</Tabs>
        {policy && tab === 0 && <>
          <Typography variant="h6">{t("hostctl.node_features")}</Typography><Typography variant="body2">{t("hostctl.reported")}: {reported}</Typography>
          <Box>{nodeKeys.map(k => <FormControlLabel key={k} control={<Checkbox checked={!!policy[k]} disabled={busy || !associated} onChange={(_, v) => toggle(k, v)} />} label={t(`hostctl.${k}`)} />)}</Box>
          <TextField size="small" label={t("hostctl.image")} value={policy.node_image || ""} disabled={busy || !associated} onChange={e => { setPolicy({ ...policy, node_image: e.target.value }); setConfirmed(false); }} helperText={t("hostctl.image_hint")} />
          <FormControlLabel control={<Checkbox checked={applyNode} disabled={busy || !associated} onChange={(_, v) => setApplyNode(v)} />} label={t("hostctl.apply_node")} />
          <Divider /><Typography variant="h6">{t("hostctl.host_features")}</Typography>
          <Box>{hostKeys.map(k => <FormControlLabel key={k} control={<Checkbox checked={!!policy[k]} disabled={busy} onChange={(_, v) => toggle(k, v)} />} label={t(`hostctl.${k}`)} />)}</Box>
          <TextField size="small" multiline minRows={3} label={t("hostctl.projects")} value={projects} disabled={busy} onChange={e => { setProjects(e.target.value); setConfirmed(false); }} helperText={t("hostctl.projects_hint")} />
          <Alert severity="warning">{t("hostctl.apply_notice")}</Alert>
          <FormControlLabel control={<Checkbox checked={confirmed} disabled={busy} onChange={(_, v) => setConfirmed(v)} />} label={t("hostctl.confirm")} />
          <Button variant="contained" disabled={busy || !confirmed || (!!dirty && !applyNode)} onClick={() => void action(async () => {
            const parsed = projects.split("\n").filter(s => s.trim()).map(line => { const match = line.trim().match(/^(\S+)\s+(.+)$/); if (!match) throw Error(t("hostctl.projects_hint")); return { name: match[1], directory: match[2] }; });
            await authorizedCall("admin:virtualnet.permissions.save", { ...policy, projects: parsed, confirmed, apply_node: applyNode }); setTicket(""); await load(); setConfirmed(false); setMessage(t("hostctl.saved"));
          })}>{t("hostctl.apply")}</Button>
        </>}
        {tab === 1 && <>
          <Alert severity="info">{t("hostctl.terminal_notice")}</Alert>
          <Button disabled={busy || !saved?.host_terminal} onClick={() => void action(async () => { const result = await authorizedCall("admin:virtualnet.host.terminal"); setTicket(result.ticket); })}>{t("hostctl.connect")}</Button>
          {ticket && <HostTerminal key={ticket} ticket={ticket} />}
        </>}
        {tab === 2 && <>
          <Alert severity="info">{t("hostctl.files_notice")}</Alert>
          <TextField size="small" label={t("hostctl.path")} value={filePath} onChange={e => setFilePath(e.target.value)} />
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button disabled={busy || !saved?.host_files} onClick={() => void action(async () => { const result = await host({ operation: "list", path: filePath }); setFilePath(result.path); setEntries(result.entries); if (result.truncated) setMessage(t("hostctl.list_truncated")); })}>{t("hostctl.list")}</Button>
            <Button disabled={busy || !saved?.host_files} onClick={() => void action(async () => { const result = await host({ operation: "download", path: filePath }); const b = Uint8Array.from(atob(result.data), c => c.charCodeAt(0)); const url = URL.createObjectURL(new Blob([b])); const a = document.createElement("a"); a.href = url; a.download = result.name; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); })}>{t("hostctl.download")}</Button>
            <Button component="label" disabled={busy || !saved?.host_files}>{t("hostctl.upload")}<input hidden type="file" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; void action(async () => { if (file.size > 8 * 1024 * 1024) throw Error(t("hostctl.files_notice")); const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); await host({ operation: "upload", path: filePath, data: btoa(binary) }); setMessage(t("hostctl.uploaded")); }); }} /></Button>
          </Stack>
          <Box sx={{ maxHeight: 300, overflow: "auto" }}>{entries.map(entry => <Button key={entry.name} fullWidth sx={{ justifyContent: "flex-start", textTransform: "none" }} onClick={() => setFilePath(`${filePath.replace(/\/$/, "")}/${entry.name}`)}>{entry.directory ? "📁" : entry.symlink ? "↗" : "—"} {entry.name} · {entry.size}</Button>)}</Box>
        </>}
        {tab === 3 && <>
          <TextField size="small" multiline minRows={3} label={t("hostctl.command")} value={command} onChange={e => setCommand(e.target.value)} />
          <Button color="warning" disabled={busy || !saved?.host_exec || !command.trim()} onClick={() => void action(async () => { const result = await host({ operation: "exec", command }); setOutput(`${result.output}\nexit=${result.exit_code}${result.truncated ? " (truncated)" : ""}`); setCommand(""); })}>{t("hostctl.execute")}</Button>
        </>}
        {tab === 4 && <>
          <Alert severity="warning">{t("hostctl.docker_notice")}</Alert>
          <TextField size="small" select label={t("hostctl.project")} value={project} onChange={e => setProject(e.target.value)}><MenuItem value="enb-managed-node">enb-managed-node</MenuItem>{saved?.projects?.map(p => <MenuItem key={p.name} value={p.name}>{p.name} · {p.directory}</MenuItem>)}</TextField>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>{["status", "logs", "start", "restart", "stop"].map(kind => <Button key={kind} color={kind === "stop" ? "warning" : "primary"} disabled={busy || (project === "enb-managed-node" ? !saved?.node_docker : !saved?.projects.some(p => p.name === project))} onClick={() => void action(async () => { const result = await host({ operation: "docker", project, action: kind }); setOutput(`${result.output}\nexit=${result.exit_code}`); })}>{t(`hostctl.${kind}`)}</Button>)}</Stack>
        </>}
        {output && (tab === 3 || tab === 4) && <Box component="pre" sx={{ maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{output}</Box>}
      </>}
    </Stack></DialogContent>
    <DialogActions><Button disabled={busy} onClick={onClose}>{t("virtualnet.cancel")}</Button></DialogActions>
  </Dialog>;
}
