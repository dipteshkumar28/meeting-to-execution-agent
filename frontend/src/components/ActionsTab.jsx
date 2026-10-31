import { useState } from "react";
import { CalendarClock, CheckCheck, ClipboardCheck, ExternalLink, Send, User, X } from "lucide-react";
import { api } from "../api.js";
import { Badge, Card, Empty, Modal, StatusBadge, btn } from "./ui.jsx";

const FILTERS = ["pending", "approved", "pushed", "rejected", "all"];
const PRI = { high: "rose", medium: "amber", low: "zinc" };
const field = "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm";

export default function ActionsTab({ actions, refresh, toast,trackerUrl }) {
  const [filter, setFilter] = useState("pending");
  const [confirm, setConfirm] = useState(null); // {mode:'approve'|'push'|'all', item, draft}
  const [busy, setBusy] = useState(false);

  const shown = actions.filter((a) => filter === "all" || a.status === filter);
  const counts = (f) => (f === "all" ? actions.length : actions.filter((a) => a.status === f).length);
  const pendingCount = counts("pending");

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); await refresh(); toast(okMsg); setConfirm(null); }
    catch (e) { toast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const doConfirm = () => {
    const { mode, item, draft } = confirm;
    if (mode === "approve") return run(() => api.updateAction(item.id, { ...draft, status: "approved" }), "Task approved");
    if (mode === "push") return run(() => api.pushAction(item.id), "Pushed to tracker");
    return run(() => api.approveAll(), "All pending tasks approved");
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize transition ${filter === f ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:bg-zinc-800"}`}>
            {f} <span className="ml-1 font-mono text-xs opacity-70">{counts(f)}</span>
          </button>
        ))}
        <button className={`${btn.success} ml-auto`} disabled={!pendingCount}
          onClick={() => setConfirm({ mode: "all" })}><CheckCheck className="h-4 w-4" />Approve all pending</button>
      </div>

      {shown.length === 0 ? (
        <Empty icon={ClipboardCheck} title={`No ${filter === "all" ? "" : filter + " "}tasks`} hint="Analyse a meeting and its action items will appear here for your review. Nothing is saved to a tracker until you approve it." />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {shown.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold leading-snug text-zinc-100">{a.task}</p>
                <StatusBadge status={a.status} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-400">
                <span className="inline-flex items-center gap-1.5"><User className="h-4 w-4" />{a.owner}</span>
                <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-4 w-4" />{a.deadline || "No deadline"}</span>
                <Badge tone={PRI[a.priority]}>{a.priority}</Badge>
              </div>
              {a.quote && <p className="mt-3 border-l-2 border-zinc-700 pl-2 font-mono text-xs text-zinc-500">"{a.quote}"</p>}
              <p className="mt-2 text-xs text-zinc-600">{a.meeting_title} · {a.meeting_date}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {a.status === "pending" && (<>
                  <button className={btn.success} onClick={() => setConfirm({ mode: "approve", item: a, draft: { task: a.task, owner: a.owner, deadline: a.deadline, priority: a.priority } })}>Review &amp; approve</button>
                  <button className={btn.danger} onClick={() => run(() => api.updateAction(a.id, { status: "rejected" }), "Task rejected")}><X className="h-4 w-4" />Reject</button>
                </>)}
                {a.status === "approved" && <button className={btn.primary} onClick={() => setConfirm({ mode: "push", item: a })}><Send className="h-4 w-4" />Push to tracker</button>}
                {a.status === "rejected" && <button className={btn.ghost} onClick={() => run(() => api.updateAction(a.id, { status: "pending" }), "Moved back to pending")}>Restore</button>}
                {a.status === "pushed" && (trackerUrl
                        ? <a href={trackerUrl} target="_blank" rel="noreferrer" title="Open tracker"><Badge tone="cyan" className="hover:bg-cyan-500/20"><ExternalLink className="h-3 w-3" />{a.external_ref}</Badge></a>
                      : <Badge tone="cyan"><ExternalLink className="h-3 w-3" />{a.external_ref}</Badge>)}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!confirm} onClose={() => setConfirm(null)}
        title={confirm?.mode === "approve" ? "Confirm task" : confirm?.mode === "push" ? "Push to tracker?" : "Approve all pending tasks?"}>
        {confirm?.mode === "approve" && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">Check what the agent extracted. Fix anything before it becomes a real task.</p>
            <label className="block text-xs font-semibold text-zinc-400">Task<textarea rows={2} className={`${field} mt-1`} value={confirm.draft.task} onChange={(e) => setConfirm({ ...confirm, draft: { ...confirm.draft, task: e.target.value } })} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-zinc-400">Owner<input className={`${field} mt-1`} value={confirm.draft.owner} onChange={(e) => setConfirm({ ...confirm, draft: { ...confirm.draft, owner: e.target.value } })} /></label>
              <label className="block text-xs font-semibold text-zinc-400">Deadline<input className={`${field} mt-1`} value={confirm.draft.deadline} placeholder="YYYY-MM-DD" onChange={(e) => setConfirm({ ...confirm, draft: { ...confirm.draft, deadline: e.target.value } })} /></label>
            </div>
            <label className="block text-xs font-semibold text-zinc-400">Priority
              <select className={`${field} mt-1`} value={confirm.draft.priority} onChange={(e) => setConfirm({ ...confirm, draft: { ...confirm.draft, priority: e.target.value } })}>
                <option>low</option><option>medium</option><option>high</option>
              </select>
            </label>
          </div>
        )}
        {confirm?.mode === "push" && <p className="text-sm text-zinc-400">"{confirm.item.task}" will be sent to <b className="text-zinc-200">{confirm.item.owner}</b>'s tracker. This can't be edited afterwards.</p>}
        {confirm?.mode === "all" && <p className="text-sm text-zinc-400">{pendingCount} pending tasks will be marked approved. You can still review each before pushing.</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className={btn.ghost} onClick={() => setConfirm(null)}>Cancel</button>
          <button className={btn.primary} disabled={busy} onClick={doConfirm}>{confirm?.mode === "push" ? "Push task" : "Approve"}</button>
        </div>
      </Modal>
    </div>
  );
}
