import { useCallback, useEffect, useState } from "react";
import { AlertOctagon, Brain, ClipboardCheck, FileText, ShieldAlert, Zap } from "lucide-react";
import { api } from "./api.js";
import TranscriptTab from "./components/TranscriptTab.jsx";
import ActionsTab from "./components/ActionsTab.jsx";
import MemoryTab from "./components/MemoryTab.jsx";
import ConflictsTab from "./components/ConflictsTab.jsx";
import { Badge, Toasts, btn } from "./components/ui.jsx";

const TABS = [
  { id: "transcript", label: "Transcripts", icon: FileText },
  { id: "actions", label: "Action items", icon: ClipboardCheck },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "conflicts", label: "Conflicts", icon: ShieldAlert },
];

export default function App() {
  const [tab, setTab] = useState("transcript");
  const [data, setData] = useState({ stats: {}, actions: [], decisions: [], conflicts: [] });
  const [health, setHealth] = useState(null);
  const [offline, setOffline] = useState(false);
  const [result, setResult] = useState(null);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((msg, type = "ok") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [stats, actions, decisions, conflicts] = await Promise.all([api.stats(), api.actions(), api.decisions(), api.conflicts()]);
      setData({ stats, actions, decisions, conflicts });
      setOffline(false);
    } catch { setOffline(true); }
  }, []);

  useEffect(() => { refresh(); api.health().then(setHealth).catch(() => setOffline(true)); }, [refresh]);

  const openConflicts = data.conflicts.filter((c) => c.status === "open");
  const badge = { actions: data.stats.pending_actions, conflicts: data.stats.open_conflicts };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400 text-zinc-950"><Zap className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-zinc-50">Meeting-to-Execution</h1>
            <p className="text-xs text-zinc-500">Talk it out. Approve it. Remember it.</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="zinc">{data.stats.meetings ?? 0} meetings</Badge>
          <Badge tone="zinc">{data.stats.decisions ?? 0} decisions remembered</Badge>
        </div>
      </header>

      {offline && <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-200">Can't reach the backend at :8000. Start it with <code className="font-mono">uvicorn main:app --reload</code> and refresh.</div>}

      {openConflicts.length > 0 && tab !== "conflicts" && (
        <button onClick={() => setTab("conflicts")} className="mb-5 flex w-full animate-slideIn items-center gap-3 rounded-xl border border-rose-500/50 bg-rose-950/40 px-4 py-3 text-left transition hover:bg-rose-950/60">
          <AlertOctagon className="h-6 w-6 shrink-0 text-rose-400" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-rose-100">{openConflicts.length} decision conflict{openConflicts.length > 1 ? "s" : ""} need your attention</p>
            <p className="truncate text-sm text-rose-200/80">{openConflicts[0].explanation}: "{openConflicts[0].old_text}" vs "{openConflicts[0].new_text}"</p>
          </div>
          <span className={btn.danger}>Review</span>
        </button>
      )}

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-zinc-800" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition ${tab === id ? "border-cyan-400 text-zinc-50" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>
            <Icon className="h-4 w-4" />{label}
            {badge[id] > 0 && <span className={`rounded-full px-1.5 py-0.5 font-mono text-[11px] font-bold ${id === "conflicts" ? "bg-rose-500 text-white" : "bg-amber-400 text-zinc-950"}`}>{badge[id]}</span>}
          </button>
        ))}
      </nav>

      <main>
        {tab === "transcript" && <TranscriptTab toast={toast} refresh={refresh} goto={setTab} result={result} setResult={setResult} />}
        {tab === "actions" && <ActionsTab actions={data.actions} refresh={refresh} toast={toast} trackerUrl={health?.tracker_view_url}/>}
        {tab === "memory" && <MemoryTab decisions={data.decisions} toast={toast} />}
        {tab === "conflicts" && <ConflictsTab conflicts={data.conflicts} refresh={refresh} toast={toast} />}
      </main>
      <Toasts items={toasts} />
    </div>
  );
}
