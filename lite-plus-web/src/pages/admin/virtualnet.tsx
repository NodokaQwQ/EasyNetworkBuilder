import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField as MuiTextField, Typography } from "@mui/material";
import type { TextFieldProps } from "@mui/material/TextField";
import { useTranslation } from "react-i18next";
import { useRPC2Call } from "@/contexts/RPC2Context";
import { virtualnetErrorKey } from "@/utils/virtualnet";

// The global medium input theme uses border-box with a content-only height.
// Use the supported compact size and reserve label/helper space in this dialog.
function TextField(props: TextFieldProps) {
  return <MuiTextField {...props} size="small" fullWidth slotProps={{ inputLabel: { shrink: true } }} />;
}

type Peer = { id: string; hostname: string; ipv4: string; ipv6: string; version: string; local: boolean; hops: number; latency_ms: number };
type Profile = { peer_id: string; address: string; port: number; username: string; fingerprint: string; auth_type: string; sudo: boolean; node_uuid: string; has_credentials: boolean; paused: boolean };
type Job = { id: string; peer_id: string; status: string; stage: string; error: string };
type Form = Omit<Profile, "node_uuid" | "has_credentials" | "paused"> & { password: string; private_key: string; passphrase: string; sudo_password: string };
type DeploymentSettings = { control_url: string; control_ip: string };
type InstallationCheck = { confirmation_token: string; requires_overwrite: boolean; directory: string; node_uuid: string; installation: { directory: boolean; compose: boolean; running: boolean } };

export default function VirtualNetwork() {
  const { t } = useTranslation();
  const { call } = useRPC2Call();
  const [discovery, setDiscovery] = useState<{ rpc: string; instance: string; peers: Peer[] }>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [verified, setVerified] = useState(false);
  const [confirm, setConfirm] = useState<Peer | null>(null);
  const [installationCheck, setInstallationCheck] = useState<InstallationCheck | null>(null);
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [lifecycleConfirm,setLifecycleConfirm] = useState<{peer:Peer;action:"pause"|"resume";check:InstallationCheck}|null>(null);
  const [probe, setProbe] = useState("");
  const [discoverError, setDiscoverError] = useState("");
  const [settings, setSettings] = useState<DeploymentSettings>();
  const [settingsForm, setSettingsForm] = useState<DeploymentSettings | null>(null);
  const refresh = useCallback(async () => {
    const [d, p, j, s] = await Promise.allSettled([
      call("admin:virtualnet.discover", {}), call("admin:virtualnet.profiles", {}), call("admin:virtualnet.jobs", {}),
      call("admin:virtualnet.settings", {}),
    ]);
    if (d.status === "fulfilled") { setDiscovery(d.value); setDiscoverError(""); }
    else { setDiscovery(undefined); setDiscoverError(String(d.reason)); }
    if (p.status === "fulfilled") setProfiles(p.value || []);
    if (j.status === "fulfilled") setJobs(j.value || []);
    if (s.status === "fulfilled") setSettings(s.value);
    else setSettings(undefined);
    if (p.status === "rejected" || j.status === "rejected" || s.status === "rejected") throw Error(t("virtualnet.load_failed"));
  }, [call, t]);
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, [refresh]);
  // Admin routes can stay mounted while visiting Servers. Refresh lightweight
  // associations on return, not the EasyTier CLI on every focus/poll.
  const refreshAssociations = useCallback(async () => {
    const [p, j] = await Promise.all([call("admin:virtualnet.profiles", {}), call("admin:virtualnet.jobs", {})]);
    setProfiles(p || []); setJobs(j || []);
  }, [call]);
  useEffect(() => {
    const onReturn = () => { if (document.visibilityState === "visible") void refreshAssociations().catch(e => setError(String(e))); };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    const timer = window.setInterval(onReturn, 5000);
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); window.clearInterval(timer); };
  }, [refreshAssociations]);
  useEffect(() => {
    if (!jobs.some(j => j.status === "running")) return;
    const timer = window.setInterval(() => { void refreshAssociations().catch(e => setError(String(e))); }, 3000);
    return () => window.clearInterval(timer);
  }, [refreshAssociations, jobs]);
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); } catch (e) { const key = virtualnetErrorKey(e); setError(key ? t(key) : String(e)); } finally { setBusy(false); }
  }
  async function inspectDeployment(peer: Peer,force=false) {
    if (profiles.find(p=>p.peer_id===peer.id)?.paused && !force) { await inspectLifecycle(peer,"resume"); return; }
    setInstallationCheck(null); setOverwriteConfirmed(false);
    const result = await call("admin:virtualnet.inspect", { peer_id: peer.id });
    setInstallationCheck(result); setConfirm(peer);
  }
  async function inspectLifecycle(peer:Peer,action:"pause"|"resume") {
    const check = await call("admin:virtualnet.inspect", {peer_id:peer.id,action});
    setLifecycleConfirm({peer,action,check});
  }
  function edit(peer: Peer) {
    const p = profiles.find(p => p.peer_id === peer.id);
    setForm({ peer_id: peer.id, address: p?.address || peer.ipv4 || peer.ipv6, port: p?.port || 22,
      username: p?.username || "root", fingerprint: p?.fingerprint || "", auth_type: p?.auth_type || "key", sudo: p?.sudo || false,
      password: "", private_key: "", passphrase: "", sudo_password: "" });
    setVerified(false); setProbe(""); setError(""); setMessage("");
  }
  const field = (key: keyof Form, value: string | boolean | number) => {
    if (!form) return;
    if (["fingerprint", "address", "port"].includes(key)) setVerified(false);
    if (["address", "port"].includes(key)) setProbe("");
    setForm({ ...form, [key]: value });
  };
  return <Stack spacing={2}>
    <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
      <Typography variant="h5" component="h1">{t("virtualnet.title")}</Typography>
      <Stack direction="row" spacing={1}>
        <Button disabled={busy || !settings} onClick={() => { setError(""); setSettingsForm({ control_url: settings?.control_url || "", control_ip: settings?.control_ip || "" }); }}>{t("virtualnet.deployment_settings")}</Button>
        <Button disabled={busy} onClick={() => void action(refresh)}>{t("virtualnet.refresh")}</Button>
      </Stack>
    </Stack>
    <Alert severity="info">{t("virtualnet.readonly")}</Alert>
    <Alert severity="info">{t("virtualnet.deletion_notice")}</Alert>
    {!settings && <Alert severity="warning">{t("virtualnet.load_failed")}</Alert>}
    {settings && !settings.control_url && <Alert severity="warning" action={<Button color="inherit" onClick={() => setSettingsForm({ ...settings })}>{t("virtualnet.deployment_settings")}</Button>}>{t("virtualnet.control_missing")}</Alert>}
    {error && <Alert severity="error">{error}</Alert>}
    {message && <Alert severity="success">{message}</Alert>}
    {discoverError && <Alert severity="warning">{discoverError}</Alert>}
    {settings?.control_url && <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{t("virtualnet.control_url")}: {settings.control_url}{settings.control_ip && ` → ${settings.control_ip}`}</Typography>}
    {discovery && <Typography variant="body2">RPC: {discovery.rpc} · {t("virtualnet.instance")}: {discovery.instance || t("virtualnet.default_instance")}</Typography>}
    <Paper sx={{ overflowX: "auto" }}><Table size="small">
      <TableHead><TableRow>{["device", "addresses", "route", "version", "ssh", "actions"].map(k => <TableCell key={k}>{t(`virtualnet.${k}`)}</TableCell>)}</TableRow></TableHead>
      <TableBody>{discovery?.peers.map(peer => {
        const profile = profiles.find(p => p.peer_id === peer.id);
        return <TableRow key={peer.id}>
          <TableCell>{peer.hostname || peer.id}{peer.local && ` (${t("virtualnet.local")})`}<Typography variant="caption" sx={{ display: "block" }}>{peer.id}</Typography></TableCell>
          <TableCell>{peer.ipv4 || "—"}<br />{peer.ipv6 || "—"}</TableCell>
          <TableCell>{peer.local ? "—" : `${peer.hops} hop · ${peer.latency_ms} ms`}</TableCell>
          <TableCell>{peer.version}</TableCell>
           <TableCell>{profile?.has_credentials ? `${profile.username}@${profile.address}:${profile.port}` : t("virtualnet.not_configured")}{profile?.node_uuid && <Typography variant="caption" sx={{ display: "block" }}>Node: {profile.node_uuid}</Typography>}{profile?.paused && <Typography variant="caption" color="warning.main">{t("virtualnet.paused")}</Typography>}</TableCell>
          <TableCell>{!peer.local && <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
            <Button disabled={busy} onClick={() => edit(peer)}>{t("virtualnet.configure")}</Button>
            <Button disabled={busy || !profile?.has_credentials} onClick={() => void action(async () => { await call("admin:virtualnet.test", { peer_id: peer.id }); setMessage(t("virtualnet.test_ok")); })}>{t("virtualnet.test")}</Button>
            <Button disabled={busy || !profile?.has_credentials || !settings?.control_url} onClick={() => void action(() => inspectDeployment(peer))}>{t("virtualnet.deploy")}</Button>
            <Button color="warning" disabled={busy || !profile?.has_credentials} onClick={() => void action(() => inspectLifecycle(peer,"pause"))}>{t("virtualnet.pause")}</Button>
            <Button disabled={busy || !profile?.has_credentials || !profile.node_uuid} onClick={() => void action(() => inspectLifecycle(peer,"resume"))}>{t("virtualnet.resume")}</Button>
            {profile?.paused && <Button color="error" disabled={busy || !profile.has_credentials || !settings?.control_url} onClick={()=>void action(()=>inspectDeployment(peer,true))}>{t("virtualnet.force_deploy")}</Button>}
            <Button color="warning" disabled={busy || !profile?.has_credentials} onClick={() => void action(async () => { await call("admin:virtualnet.delete", { peer_id: peer.id }); await refresh(); })}>{t("virtualnet.forget")}</Button>
          </Stack>}</TableCell>
        </TableRow>;
      })}</TableBody>
    </Table></Paper>
    <Typography variant="h6">{t("virtualnet.jobs")}</Typography>
    {jobs.map(job => <Paper key={job.id} sx={{ p: 2 }}><Typography>{job.peer_id} · {job.status} · {job.stage}</Typography>{job.error && <Alert severity="warning">{job.error}</Alert>}</Paper>)}
    <Dialog className="enb-virtualnet-ssh-dialog" open={!!form} onClose={() => !busy && setForm(null)} maxWidth="sm" fullWidth>
      <DialogTitle>{t("virtualnet.configure")}</DialogTitle>
      <DialogContent><Stack spacing={2.5} sx={{ pt: 1, "& .MuiTextField-root": { flexShrink: 0 }, "& .MuiInputBase-root:not(.MuiInputBase-multiline)": { height: 40, minHeight: 40 }, "& .MuiFormHelperText-root": { mx: 0, mt: 0.75 }, "& .MuiFormControlLabel-root": { mx: 0, alignItems: "flex-start" }, "& .MuiFormControlLabel-label": { pt: 1, overflowWrap: "anywhere" } }}>
        <Alert severity="info">{t("virtualnet.credentials_notice")}</Alert>
        {error && <Alert severity="error">{error}</Alert>}
        {form && <>
          <TextField select label={t("virtualnet.addresses")} value={form.address} onChange={e => field("address", e.target.value)}>{[discovery?.peers.find(p => p.id === form.peer_id)?.ipv4, discovery?.peers.find(p => p.id === form.peer_id)?.ipv6].filter(Boolean).map(ip => <MenuItem key={ip} value={ip}>{ip}</MenuItem>)}</TextField>
          <TextField label={t("virtualnet.port")} type="number" value={form.port} onChange={e => field("port", Number(e.target.value))} />
          <TextField label={t("virtualnet.username")} value={form.username} onChange={e => field("username", e.target.value)} autoComplete="off" />
          <Alert severity="info">{t("virtualnet.connection_hint")}</Alert>
          <Button disabled={busy} onClick={() => void action(async () => { const v = await call("admin:virtualnet.fingerprint", { peer_id: form.peer_id, address: form.address, port: form.port }); setProbe(v.fingerprint); })}>{t("virtualnet.probe")}</Button>
          {probe && <Alert severity="warning" sx={{ overflowWrap: "anywhere" }}>{t("virtualnet.probe_warning")}<br />{probe}</Alert>}
          <TextField label={t("virtualnet.fingerprint")} value={form.fingerprint} onChange={e => field("fingerprint", e.target.value.trim())} placeholder="SHA256:…" />
          <FormControlLabel control={<Checkbox checked={verified} onChange={(_, v) => setVerified(v)} />} label={t("virtualnet.verified")} />
          <TextField select label={t("virtualnet.auth")} value={form.auth_type} onChange={e => field("auth_type", e.target.value)}><MenuItem value="key">{t("virtualnet.key")}</MenuItem><MenuItem value="password">{t("virtualnet.password")}</MenuItem></TextField>
          {form.auth_type === "key" ? <>
            <TextField label={t("virtualnet.key")} type="password" value={form.private_key} onChange={e => field("private_key", e.target.value)} autoComplete="new-password" helperText={t("virtualnet.key_hint")} />
            <Button component="label">{t("virtualnet.import_key")}<input hidden type="file" onChange={e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 65536) { setError(t("virtualnet.key_too_large")); return; } void file.text().then(v => field("private_key", v)); }} /></Button>
            <TextField label={t("virtualnet.passphrase")} type="password" value={form.passphrase} onChange={e => field("passphrase", e.target.value)} autoComplete="new-password" />
          </> : <TextField label={t("virtualnet.password")} type="password" value={form.password} onChange={e => field("password", e.target.value)} autoComplete="new-password" />}
          <FormControlLabel control={<Checkbox checked={form.sudo} onChange={(_, v) => field("sudo", v)} />} label={t("virtualnet.sudo")} />
          {form.sudo && <TextField label={t("virtualnet.sudo_password")} type="password" value={form.sudo_password} onChange={e => field("sudo_password", e.target.value)} autoComplete="new-password" helperText={t("virtualnet.sudo_hint")} />}
        </>}
      </Stack></DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setForm(null)}>{t("virtualnet.cancel")}</Button><Button disabled={busy || !verified} onClick={() => form && void action(async () => { await call("admin:virtualnet.save", form); setForm(null); await refresh(); })}>{t("virtualnet.save")}</Button></DialogActions>
    </Dialog>
    <Dialog open={!!lifecycleConfirm} onClose={()=>!busy&&setLifecycleConfirm(null)} maxWidth="sm" fullWidth>
      <DialogTitle>{t(lifecycleConfirm?.action==="pause"?"virtualnet.pause":"virtualnet.resume")} — {lifecycleConfirm?.peer.hostname}</DialogTitle>
      <DialogContent><Stack spacing={2}>
        <Alert severity="warning">{t(lifecycleConfirm?.action==="pause"?"virtualnet.pause_notice":"virtualnet.resume_notice")}</Alert>
        <Typography>{t("virtualnet.installation_detected",{directory:lifecycleConfirm?.check.installation.directory?t("virtualnet.detected_yes"):t("virtualnet.detected_no"),compose:lifecycleConfirm?.check.installation.compose?t("virtualnet.detected_yes"):t("virtualnet.detected_no"),running:lifecycleConfirm?.check.installation.running?t("virtualnet.detected_yes"):t("virtualnet.detected_no")})}</Typography>
        {error&&<Alert severity="error">{error}</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button disabled={busy} onClick={()=>setLifecycleConfirm(null)}>{t("virtualnet.cancel")}</Button><Button disabled={busy} onClick={()=>lifecycleConfirm&&void action(async()=>{await call(`admin:virtualnet.${lifecycleConfirm.action}`,{peer_id:lifecycleConfirm.peer.id,confirmation_token:lifecycleConfirm.check.confirmation_token});setLifecycleConfirm(null);await refresh();})}>{t("virtualnet.confirm_lifecycle")}</Button></DialogActions>
    </Dialog>
    <Dialog open={settingsForm !== null} onClose={() => !busy && setSettingsForm(null)} maxWidth="sm" fullWidth>
      <DialogTitle>{t("virtualnet.deployment_settings")}</DialogTitle>
      <DialogContent><Stack spacing={2.5} sx={{ pt: 1, "& .MuiInputBase-root": { minHeight: 40 }, "& .MuiFormHelperText-root": { mx: 0 } }}>
        <Alert severity="info">{t("virtualnet.control_hint")}</Alert>
        {error && <Alert severity="error">{error}</Alert>}
        {settingsForm && <>
          <TextField label={t("virtualnet.control_url")} value={settingsForm.control_url} onChange={e => setSettingsForm({ ...settingsForm, control_url: e.target.value })} placeholder="https://head.example.com" helperText={t("virtualnet.control_url_hint")} />
          <TextField label={t("virtualnet.control_ip")} value={settingsForm.control_ip} onChange={e => setSettingsForm({ ...settingsForm, control_ip: e.target.value })} helperText={t("virtualnet.control_ip_hint")} />
        </>}
      </Stack></DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setSettingsForm(null)}>{t("virtualnet.cancel")}</Button><Button disabled={busy} onClick={() => settingsForm && void action(async () => { await call("admin:virtualnet.settings.save", settingsForm); setSettingsForm(null); await refresh(); setMessage(t("virtualnet.settings_saved")); })}>{t("virtualnet.save_settings")}</Button></DialogActions>
    </Dialog>
    <Dialog open={!!confirm} onClose={() => !busy && setConfirm(null)}>
      <DialogTitle>{t("virtualnet.deploy")} — {confirm?.hostname}</DialogTitle>
      <DialogContent><Stack spacing={2}>
        <Alert severity="warning">{t("virtualnet.deploy_notice")}</Alert>
        <Typography sx={{ overflowWrap: "anywhere" }}>{t("virtualnet.control_url")}: {settings?.control_url}{settings?.control_ip && ` → ${settings.control_ip}`}</Typography>
        <Typography>{t("virtualnet.installation_detected", { directory: installationCheck?.installation.directory ? t("virtualnet.detected_yes") : t("virtualnet.detected_no"), compose: installationCheck?.installation.compose ? t("virtualnet.detected_yes") : t("virtualnet.detected_no"), running: installationCheck?.installation.running ? t("virtualnet.detected_yes") : t("virtualnet.detected_no") })}</Typography>
        {installationCheck?.requires_overwrite && <>
          <Alert severity="error">{t("virtualnet.overwrite_warning")}</Alert>
          <FormControlLabel control={<Checkbox checked={overwriteConfirmed} onChange={(_,v) => setOverwriteConfirmed(v)} />} label={t("virtualnet.overwrite_confirm")} />
        </>}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setConfirm(null)}>{t("virtualnet.cancel")}</Button><Button color={installationCheck?.requires_overwrite ? "error" : "primary"} disabled={busy || !installationCheck || (!!installationCheck.requires_overwrite && !overwriteConfirmed)} onClick={() => confirm && installationCheck && void action(async () => { await call("admin:virtualnet.deploy", { peer_id: confirm.id, confirmation_token: installationCheck.confirmation_token, overwrite_confirmed: overwriteConfirmed }); setConfirm(null); await refresh(); })}>{installationCheck?.requires_overwrite ? t("virtualnet.force_deploy") : t("virtualnet.confirm_deploy")}</Button></DialogActions>
    </Dialog>
    <Box />
  </Stack>;
}
