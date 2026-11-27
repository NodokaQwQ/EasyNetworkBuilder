import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useRPC2Call } from "@/contexts/RPC2Context";

type Peer = { id: string; hostname: string; ipv4: string; ipv6: string; version: string; local: boolean; hops: number; latency_ms: number };
type Profile = { peer_id: string; address: string; port: number; username: string; fingerprint: string; auth_type: string; sudo: boolean; node_uuid: string };
type Job = { id: string; peer_id: string; status: string; stage: string; error: string };
type Form = Omit<Profile, "node_uuid"> & { password: string; private_key: string; passphrase: string; sudo_password: string };

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
  const [probe, setProbe] = useState("");
  const [discoverError, setDiscoverError] = useState("");
  const refresh = useCallback(async () => {
    const [d, p, j] = await Promise.allSettled([
      call("admin:virtualnet.discover", {}), call("admin:virtualnet.profiles", {}), call("admin:virtualnet.jobs", {}),
    ]);
    if (d.status === "fulfilled") { setDiscovery(d.value); setDiscoverError(""); }
    else { setDiscovery(undefined); setDiscoverError(String(d.reason)); }
    if (p.status === "fulfilled") setProfiles(p.value || []);
    if (j.status === "fulfilled") setJobs(j.value || []);
    if (p.status === "rejected" || j.status === "rejected") throw Error(t("virtualnet.load_failed"));
  }, [call, t]);
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, [refresh]);
  useEffect(() => {
    if (!jobs.some(j => j.status === "running")) return;
    const timer = window.setInterval(() => { void call("admin:virtualnet.jobs", {}).then(v => setJobs(v || [])).catch(e => setError(String(e))); }, 3000);
    return () => window.clearInterval(timer);
  }, [call, jobs]);
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  function edit(peer: Peer) {
    const p = profiles.find(p => p.peer_id === peer.id);
    setForm({ peer_id: peer.id, address: p?.address || peer.ipv4 || peer.ipv6, port: p?.port || 22,
      username: p?.username || "root", fingerprint: p?.fingerprint || "", auth_type: p?.auth_type || "key", sudo: p?.sudo || false,
      password: "", private_key: "", passphrase: "", sudo_password: "" });
    setVerified(false); setProbe("");
  }
  const field = (key: keyof Form, value: string | boolean | number) => {
    if (!form) return;
    if (["fingerprint", "address", "port"].includes(key)) setVerified(false);
    setForm({ ...form, [key]: value });
  };
  return <Stack spacing={2}>
    <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
      <Typography variant="h5" component="h1">{t("virtualnet.title")}</Typography>
      <Button disabled={busy} onClick={() => void action(refresh)}>{t("virtualnet.refresh")}</Button>
    </Stack>
    <Alert severity="info">{t("virtualnet.readonly")}</Alert>
    {error && <Alert severity="error">{error}</Alert>}
    {message && <Alert severity="success">{message}</Alert>}
    {discoverError && <Alert severity="warning">{discoverError}</Alert>}
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
          <TableCell>{profile ? `${profile.username}@${profile.address}:${profile.port}` : t("virtualnet.not_configured")}{profile?.node_uuid && <Typography variant="caption" sx={{ display: "block" }}>Node: {profile.node_uuid}</Typography>}</TableCell>
          <TableCell>{!peer.local && <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
            <Button disabled={busy} onClick={() => edit(peer)}>{t("virtualnet.configure")}</Button>
            <Button disabled={busy || !profile} onClick={() => void action(async () => { await call("admin:virtualnet.test", { peer_id: peer.id }); setMessage(t("virtualnet.test_ok")); })}>{t("virtualnet.test")}</Button>
            <Button disabled={busy || !profile || !!profile.node_uuid} onClick={() => setConfirm(peer)}>{t("virtualnet.deploy")}</Button>
            <Button color="warning" disabled={busy || !profile} onClick={() => void action(async () => { await call("admin:virtualnet.delete", { peer_id: peer.id }); await refresh(); })}>{t("virtualnet.forget")}</Button>
          </Stack>}</TableCell>
        </TableRow>;
      })}</TableBody>
    </Table></Paper>
    <Typography variant="h6">{t("virtualnet.jobs")}</Typography>
    {jobs.map(job => <Paper key={job.id} sx={{ p: 2 }}><Typography>{job.peer_id} · {job.status} · {job.stage}</Typography>{job.error && <Alert severity="warning">{job.error}</Alert>}</Paper>)}
    <Dialog open={!!form} onClose={() => !busy && setForm(null)} maxWidth="sm" fullWidth>
      <DialogTitle>{t("virtualnet.configure")}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Alert severity="info">{t("virtualnet.credentials_notice")}</Alert>
        {error && <Alert severity="error">{error}</Alert>}
        {form && <>
          <TextField select label={t("virtualnet.addresses")} value={form.address} onChange={e => field("address", e.target.value)}>{[discovery?.peers.find(p => p.id === form.peer_id)?.ipv4, discovery?.peers.find(p => p.id === form.peer_id)?.ipv6].filter(Boolean).map(ip => <MenuItem key={ip} value={ip}>{ip}</MenuItem>)}</TextField>
          <TextField label={t("virtualnet.port")} type="number" value={form.port} onChange={e => field("port", Number(e.target.value))} />
          <TextField label={t("virtualnet.username")} value={form.username} onChange={e => field("username", e.target.value)} autoComplete="off" />
          <Button disabled={busy} onClick={() => void action(async () => { const v = await call("admin:virtualnet.fingerprint", { peer_id: form.peer_id, address: form.address, port: form.port }); setProbe(v.fingerprint); })}>{t("virtualnet.probe")}</Button>
          {probe && <Alert severity="warning" sx={{ overflowWrap: "anywhere" }}>{t("virtualnet.probe_warning")}<br />{probe}</Alert>}
          <TextField label={t("virtualnet.fingerprint")} value={form.fingerprint} onChange={e => field("fingerprint", e.target.value)} placeholder="SHA256:…" />
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
    <Dialog open={!!confirm} onClose={() => !busy && setConfirm(null)}>
      <DialogTitle>{t("virtualnet.deploy")} — {confirm?.hostname}</DialogTitle>
      <DialogContent><Alert severity="warning">{t("virtualnet.deploy_notice")}</Alert></DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setConfirm(null)}>{t("virtualnet.cancel")}</Button><Button disabled={busy} onClick={() => confirm && void action(async () => { await call("admin:virtualnet.deploy", { peer_id: confirm.id }); setConfirm(null); await refresh(); })}>{t("virtualnet.confirm_deploy")}</Button></DialogActions>
    </Dialog>
    <Box />
  </Stack>;
}
