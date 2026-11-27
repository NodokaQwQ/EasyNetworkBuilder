import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useRPC2Call } from "@/contexts/RPC2Context";

type Release = { version: string; image: string; platform: string; notes: string };
type Job = { id: string; peer_id: string; status: string; stage: string; error: string };

export default function NodeUpgrade({ peerID, enabled, busy, submit }: {
  peerID: string; enabled: boolean; busy: boolean;
  submit: (version: string, image: string) => Promise<void>;
}) {
  const { call } = useRPC2Call();
  const [releases, setReleases] = useState<Release[]>([]);
  const [current, setCurrent] = useState("—");
  const [supported, setSupported] = useState(false);
  const [selected, setSelected] = useState("");
  const [confirmedImage, setConfirmedImage] = useState("");
  const [job, setJob] = useState<Job>();
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const [checkGeneration, setCheckGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    let forceCheck = checkGeneration > 0;
    let checking = false;
    const refresh = async () => {
      if (checking) return;
      checking = true;
      try {
        const [info, jobs] = await Promise.all([
          call("admin:virtualnet.node.releases", { peer_id: peerID, force: forceCheck }),
          call("admin:virtualnet.jobs"),
        ]);
        if (!active) return;
        setReleases(info.releases); setCurrent(info.current_version || "—"); setSupported(info.supported);
        setJob((jobs as Job[]).find(j => j.peer_id === peerID && j.stage.startsWith("node_update")));
        setCheckedAt(info.checked_at || ""); setError(info.check_error || "");
        forceCheck = false;
      } catch (e) { if (active) setError(String(e)); }
      finally { checking = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [call, peerID, checkGeneration]);
  const target = releases.find(r => r.image === selected);
  const blocked = job?.status === "running" || job?.status === "rollback_failed";
  return <Stack spacing={2}>
    <Typography variant="h6">ENB Node 版本升级</Typography>
    <Alert severity="warning">升级会重启 Node 和代理内核，现有连接会断开；不是零停机热更新。保留 Compose、Token、权限、网络和代理快照；失败时尝试恢复旧镜像与停机快照，升级期间的本地新增数据可能丢失。</Alert>
    <Alert severity="info">仅支持经 SSH 管理的 ~/enb/node；不迁移旧 ~/enb-test 或自定义部署。需要已保存的“受管 Node Docker”权限和本页二次认证。目标来自 Git 仓库 releases 发布清单，不直接运行 node-latest。</Alert>
    <Typography>当前 Agent：{current}</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    <Button disabled={busy || blocked} onClick={() => setCheckGeneration(value => value + 1)}>立即检查 Node 更新</Button>
    {checkedAt && <Typography variant="caption">上次检查：{new Date(checkedAt).toLocaleString()}（自动检查缓存30分钟）</Typography>}
    {!error && checkedAt && releases.length === 0 && <Alert severity="info">当前没有已发布的兼容 Node 更新。</Alert>}
    {!supported && <Alert severity="warning">当前节点未关联、已暂停或未保存 SSH 凭据，暂不支持升级。</Alert>}
    {job && <Alert severity={job.status === "succeeded" ? "success" : job.status === "running" ? "info" : "warning"}>任务 {job.id}：{job.status} / {job.stage} {job.error}</Alert>}
    <TextField select size="small" label="目标版本" value={selected} disabled={busy || blocked} onChange={event => { setSelected(event.target.value); setConfirmedImage(""); }}>
      {releases.map(release => <MenuItem key={release.image} value={release.image}>{release.version} · {release.platform}</MenuItem>)}
    </TextField>
    {target && <><Typography variant="body2">{target.notes}</Typography><Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>{target.image}</Typography></>}
    <FormControlLabel control={<Checkbox checked={!!target && confirmedImage === target.image} disabled={busy || blocked} onChange={(_, checked) => setConfirmedImage(checked && target ? target.image : "")} />} label="我确认节点与代理断线、快照恢复风险，并已安排维护窗口" />
    <Button variant="contained" disabled={busy || blocked || !enabled || !supported || !target || confirmedImage !== target.image} onClick={() => {
      if (!target) return;
      setConfirmedImage("");
      void submit(target.version, target.image).catch(e => setError(String(e)));
    }}>升级 ENB Node</Button>
  </Stack>;
}
