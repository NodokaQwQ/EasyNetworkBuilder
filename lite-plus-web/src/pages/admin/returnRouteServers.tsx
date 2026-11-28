import React, { useState } from "react";
import { AppDialogContent, Button, Dialog, Select, Switch, TextField } from "@/components/admin/ui";
import { usePingTask } from "@/contexts/PingTaskContext";
import { toast } from "sonner";
import type { Task, Template } from "./returnRoute";

type Node = { uuid: string; name: string };
type Target = Pick<Task, "id" | "target" | "carrier" | "expected_line" | "ip_version" | "region">;
const lines = {
  mobile: ["CMIN2", "CMI", "CMNET"],
  telecom: ["CN2 GIA", "CN2 GT", "163"],
  unicom: ["CUG VIP", "CUG 优化", "9929", "4837"],
};
const carriers = { mobile: "移动", telecom: "电信", unicom: "联通" };
const emptyTarget = (): Target => ({ target: "", carrier: "mobile", expected_line: "CMIN2", ip_version: 4, region: "华东" });

async function request(path: string, body: unknown) {
  const response = await fetch(`/api/admin/return-route${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || result.status === "error") throw new Error(result.message || "操作失败");
  return result.data;
}

export function ReturnRouteServerDialog({ tasks = [], nodes, templates, onSaved, children }: {
  tasks?: Task[]; nodes: Node[]; templates: Template[]; onSaved: () => void; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [client, setClient] = useState("");
  const [name, setName] = useState("");
  const [targets, setTargets] = useState<Target[]>([emptyTarget()]);
  const [existingTargetIDs, setExistingTargetIDs] = useState<number[]>([]);
  const [interval, setInterval] = useState("180");
  const [pingInterval, setPingInterval] = useState("");
  const [switchConfirm, setSwitchConfirm] = useState("2");
  const [recoveryConfirm, setRecoveryConfirm] = useState("3");
  const [cooldown, setCooldown] = useState("1800");
  const [enabled, setEnabled] = useState(true);
  const [notify, setNotify] = useState(true);
  const [notifyRecovery, setNotifyRecovery] = useState(true);
  const [mainland, setMainland] = useState(false);
  const [mainlandNotify, setMainlandNotify] = useState(true);
  const [mainlandRecovery, setMainlandRecovery] = useState(true);
  const { refresh } = usePingTask();
  const changeOpen = (value: boolean) => {
    if (saving) return;
    if (value) {
      const first = tasks[0];
      setExistingTargetIDs(tasks.flatMap((task) => task.id ? [task.id] : []));
      setClient(first?.client || ""); setName(first?.name || "");
      setTargets(tasks.length ? tasks.map(({ id, target, carrier, expected_line, ip_version, region }) => ({ id, target, carrier, expected_line, ip_version, region })) : [emptyTarget()]);
      setInterval(String(first?.interval || 180)); setPingInterval(first?.ping_interval ? String(first.ping_interval) : "");
      setSwitchConfirm(String(first?.switch_confirm || 2)); setRecoveryConfirm(String(first?.recovery_confirm || 3));
      setCooldown(String(first?.cooldown ?? 1800)); setEnabled(first?.enabled ?? true);
      setNotify(first?.notify ?? true); setNotifyRecovery(first?.notify_recovery ?? true);
      setMainland(first?.mainland_reachability_enabled ?? false);
      setMainlandNotify(first?.mainland_reachability_notify ?? true); setMainlandRecovery(first?.mainland_reachability_recovery_notify ?? true);
    }
    setOpen(value);
  };
  const updateTarget = (index: number, update: Partial<Target>) => setTargets((current) => current.map((target, i) => i === index ? { ...target, ...update } : target));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await request("/servers/save", {
        client, name, targets, existing_target_ids: existingTargetIDs, interval: Number(interval), ping_interval: Number(pingInterval),
        switch_confirm: Number(switchConfirm), recovery_confirm: Number(recoveryConfirm), cooldown: Number(cooldown),
        enabled, notify, notify_recovery: notifyRecovery, mainland_reachability_enabled: mainland,
        mainland_reachability_notify: mainlandNotify, mainland_reachability_recovery_notify: mainlandRecovery,
      });
      toast.success("服务器回程任务已保存，延迟监测已自动关联");
      setOpen(false); refresh(); onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  };
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild>{children}</Dialog.Trigger>
    <AppDialogContent maxWidth="900px">
      <Dialog.Title>{tasks.length ? "编辑服务器回程任务" : "新建服务器回程任务"}</Dialog.Title>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label>服务器<Select.Root value={client} disabled={tasks.length > 0} onValueChange={(value) => { setClient(value); if (!name) setName(`${nodes.find((node) => node.uuid === value)?.name || value} 回程`); }}>
            <Select.Trigger className="w-full" placeholder="选择一台服务器" /><Select.Content>{nodes.map((node) => <Select.Item key={node.uuid} value={node.uuid}>{node.name || node.uuid}</Select.Item>)}</Select.Content>
          </Select.Root></label>
          <label>任务名称<TextField.Root required value={name} onChange={(event) => setName(event.target.value)} /></label>
        </div>
        <p className="text-sm text-muted-foreground">一个服务器任务可配置多个目标，每个目标独立检测运营商、预期线路和延迟/丢包。编辑已有任务时，未修改目标的历史记录保持不变。</p>
        {templates.length > 0 && <Select.Root value="" onValueChange={(value) => {
          const template = templates.find((item) => String(item.id) === value);
          if (template) setTargets((current) => [...current.filter((target) => target.target.trim()), {
            target: template.target, carrier: template.carrier, expected_line: template.expected_line, ip_version: template.ip_version, region: template.region,
          }]);
        }}><Select.Trigger className="w-full" placeholder="从模板添加目标" /><Select.Content>{templates.map((template) => <Select.Item key={template.id} value={String(template.id)}>{template.name}</Select.Item>)}</Select.Content></Select.Root>}
        <div className="flex flex-col gap-3">{targets.map((target, index) => <fieldset key={target.id || `new-${index}`} className="rounded-xl border border-border p-3">
          <legend className="px-1 text-sm">目标 {index + 1}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label>目标 IP 或域名<TextField.Root required value={target.target} onChange={(event) => updateTarget(index, { target: event.target.value })} /></label>
            <label>运营商<Select.Root value={target.carrier} onValueChange={(value) => { const carrier = value as Target["carrier"]; updateTarget(index, { carrier, expected_line: lines[carrier][0] }); }}><Select.Trigger /><Select.Content>{Object.entries(carriers).map(([value, label]) => <Select.Item key={value} value={value}>{label}</Select.Item>)}</Select.Content></Select.Root></label>
            <label>预期线路<Select.Root value={target.expected_line} onValueChange={(expected_line) => updateTarget(index, { expected_line })}><Select.Trigger /><Select.Content>{lines[target.carrier].map((line) => <Select.Item key={line} value={line}>{line}</Select.Item>)}</Select.Content></Select.Root></label>
            <label>地址类型<Select.Root value={String(target.ip_version)} onValueChange={(value) => updateTarget(index, { ip_version: Number(value) })}><Select.Trigger /><Select.Content><Select.Item value="4">IPv4</Select.Item><Select.Item value="6">IPv6</Select.Item></Select.Content></Select.Root></label>
            <label>地区<TextField.Root value={target.region} onChange={(event) => updateTarget(index, { region: event.target.value })} /></label>
            <Button type="button" variant="soft" color="red" disabled={targets.length === 1 || saving} onClick={() => setTargets((current) => current.filter((_, i) => i !== index))}>移除此目标</Button>
          </div>
        </fieldset>)}</div>
        <Button type="button" variant="soft" disabled={targets.length >= 64 || saving} onClick={() => setTargets((current) => [...current, emptyTarget()])}>添加目标</Button>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label>回程检测间隔（秒）<TextField.Root required type="number" min="60" max="86400" step="1" value={interval} onChange={(event) => setInterval(event.target.value)} /></label>
          <label>延迟/丢包监测间隔（秒）<TextField.Root type="number" min="1" max={interval} step="1" value={pingInterval} placeholder={`跟随回程检测（${interval} 秒）`} onChange={(event) => setPingInterval(event.target.value)} /></label>
          <label>切线确认次数<TextField.Root required type="number" min="1" max="20" step="1" value={switchConfirm} onChange={(event) => setSwitchConfirm(event.target.value)} /></label>
          <label>恢复确认次数<TextField.Root required type="number" min="1" max="20" step="1" value={recoveryConfirm} onChange={(event) => setRecoveryConfirm(event.target.value)} /></label>
          <label>通知冷却时间（秒）<TextField.Root required type="number" min="0" max="604800" step="1" value={cooldown} onChange={(event) => setCooldown(event.target.value)} /></label>
        </div>
        <p className="text-sm text-muted-foreground">延迟间隔留空默认跟随回程检测，也可指定更短间隔。每个目标自动创建同节点、同目标 ICMP 监测，启停和删除随回程任务统一管理。告警使用现有延迟/丢包默认通知设置。</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between">启用任务<Switch checked={enabled} onCheckedChange={setEnabled} /></label>
          <label className="flex items-center justify-between">发送切线通知<Switch checked={notify} onCheckedChange={setNotify} /></label>
          <label className="flex items-center justify-between">发送恢复通知<Switch checked={notifyRecovery} onCheckedChange={setNotifyRecovery} /></label>
          <label className="flex items-center justify-between">参与疑似被墙判定（实验室功能）<Switch checked={mainland} onCheckedChange={setMainland} /></label>
          {mainland && <><label className="flex items-center justify-between">发送疑似被墙通知<Switch checked={mainlandNotify} onCheckedChange={setMainlandNotify} /></label>
            <label className="flex items-center justify-between">发送可达性恢复通知<Switch checked={mainlandRecovery} onCheckedChange={setMainlandRecovery} /></label></>}
        </div>
        <p className="text-sm text-muted-foreground">疑似被墙判定需要同一地址类型下至少两个不同运营商的目标，不会将同运营商多个 IP 当成多个运营商。</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="soft" disabled={saving} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={saving || !client}>{saving ? "保存中…" : "保存任务"}</Button></div>
      </form>
    </AppDialogContent>
  </Dialog.Root>;
}

export function ReturnRouteServerGroups({ tasks, nodes, templates, onSaved, renderTarget }: {
  tasks: Task[]; nodes: Node[]; templates: Template[]; onSaved: () => void; renderTarget: (task: Task) => React.ReactNode;
}) {
  const grouped = new Map<string, Task[]>();
  for (const task of tasks) grouped.set(task.client, [...(grouped.get(task.client) || []), task]);
  const [busy, setBusy] = useState<string | null>(null);
  const { refresh } = usePingTask();
  const remove = async (client: string, group: Task[]) => {
    if (!window.confirm(`删除此服务器的全部 ${group.length} 个回程目标、关联延迟监测及历史记录？`)) return;
    setBusy(client);
    try { await request("/delete", { ids: group.map((task) => task.id) }); refresh(); onSaved(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(null); }
  };
  return <div className="flex flex-col gap-4 p-3">{[...grouped].map(([client, group]) => <section key={client} className="rounded-xl border border-border p-3">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-medium">{nodes.find((node) => node.uuid === client)?.name || client}</h3><p className="text-sm text-muted-foreground">{group.length} 个探测目标 · 每个目标独立显示线路状态</p></div>
      <div className="flex gap-2"><ReturnRouteServerDialog tasks={group} nodes={nodes} templates={templates} onSaved={onSaved}><Button variant="soft">编辑任务与目标</Button></ReturnRouteServerDialog>
        <Button variant="soft" color="red" disabled={busy === client} onClick={() => remove(client, group)}>删除任务</Button></div>
    </div>
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{group.map(renderTarget)}</div>
  </section>)}</div>;
}
