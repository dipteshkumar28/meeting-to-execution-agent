import { useState } from "react";
import { AlertTriangle, Check, FileText, Loader2, Sparkles, Users, Wand2 } from "lucide-react";
import { api } from "../api.js";
import { DEMO_TRANSCRIPT } from "../demo.js";
import VoiceButton from "./VoiceButton.jsx";
import ConflictCard from "./ConflictCard.jsx";
import { Badge, Card, btn, speakerColor } from "./ui.jsx";

const STAGES = [
  ["ingest", "Ingest transcript"],
  ["extract", "Extract decisions, tasks & speakers"],
  ["memory", "Save to memory"],
  ["conflicts", "Check past decisions for conflicts"],
];

export default function TranscriptTab({ toast, refresh, goto, result, setResult }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({});
  const [warning, setWarning] = useState("");

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  const run = async () => {
    setRunning(true); setResult(null); setProgress({}); setWarning("");
    try {
      await api.analyze({ title: title || "Untitled meeting", meeting_date: date, transcript: text }, (e) => {
        if (e.stage === "error") throw new Error(e.message);
        if (e.stage === "complete") { setResult(e.meeting); if (e.warning) setWarning(e.warning); return; }
        setProgress((p) => ({ ...p, [e.stage]: e }));
      });
      toast("Analysis complete. Review the extracted tasks before approving.");
      await refresh();
    } catch (err) {
      toast(err.message || "Analysis failed", "error");
    } finally { setRunning(false); }
  };

  const loadDemo = async () => {
    try { await api.seed(); await refresh(); } catch { /* seed is best-effort */ }
    setTitle("Atlas Replanning Sync"); setText(DEMO_TRANSCRIPT); setDate("2026-04-01");
    toast("Loaded the Atlas kickoff into memory and a messy follow-up transcript.");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold text-zinc-100"><FileText className="h-5 w-5 text-cyan-300" />New meeting</h2>
          <button className={btn.ghost} onClick={loadDemo}><Wand2 className="h-4 w-4" />Load demo</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_9.5rem]">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" aria-label="Meeting title"
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-600" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Meeting date"
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm" />
        </div>
        <textarea value={text + interim} onChange={(e) => { setText(e.target.value); setInterim(""); }} rows={16}
          placeholder={"Paste a messy transcript or just talk.\nSpeaker labels are optional: the agent infers who said what."}
          aria-label="Transcript" className="mt-3 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[13px] leading-relaxed placeholder:text-zinc-600" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <VoiceButton onText={(t) => setText((x) => (x ? x + (x.endsWith(" ") || x.endsWith("\n") ? "" : " ") : "") + t)} onInterim={setInterim} />
          <span className="text-xs text-zinc-500">Wispr Flow works here too: focus the box and hold your Flow hotkey.</span>
          <span className="ml-auto font-mono text-xs text-zinc-500">{words} words</span>
        </div>
        <button className={`${btn.primary} mt-4 w-full py-3`} disabled={running || text.trim().length < 10} onClick={run}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {running ? "Analysing..." : "Analyse meeting"}
        </button>
      </Card>

      <div className="space-y-4">
        {(running || Object.keys(progress).length > 0) && (
          <Card className="p-5">
            <ol className="space-y-3">
              {STAGES.map(([key, label]) => {
                const e = progress[key];
                const s = e?.status || "idle";
                return (
                  <li key={key} className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs ${s === "done" ? "bg-emerald-500 text-zinc-950" : s === "running" ? "bg-cyan-400/20 text-cyan-300" : "bg-zinc-800 text-zinc-600"}`}>
                      {s === "done" ? <Check className="h-4 w-4" /> : s === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : "·"}
                    </span>
                    <div>
                      <p className={`text-sm font-semibold ${s === "idle" ? "text-zinc-600" : "text-zinc-200"}`}>{label}</p>
                      {e?.message && <p className="text-xs text-zinc-500">{e.message}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        )}

        {warning && <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" />{warning}</div>}

        {result?.conflicts?.length > 0 && (
          <div className="space-y-3">
            {result.conflicts.map((c) => <ConflictCard key={c.id} c={c} compact />)}
            <button className={btn.danger} onClick={() => goto("conflicts")}>Resolve conflicts</button>
          </div>
        )}

        {result && (
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-zinc-100">{result.title}</h3>
              <Badge tone={result.engine === "llm" ? "cyan" : "amber"}>{result.engine === "llm" ? "LLM extraction" : result.engine}</Badge>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{result.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Users className="h-4 w-4 text-zinc-500" />
              {result.speakers.map((s) => <span key={s} className={`text-sm font-semibold ${speakerColor(s)}`}>{s}</span>)}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="cyan">{result.decisions.length} decisions</Badge>
              <button onClick={() => goto("actions")} className="cursor-pointer"><Badge tone="amber">{result.action_items.length} tasks awaiting your approval</Badge></button>
            </div>
            <h4 className="mb-2 mt-5 text-sm font-bold text-zinc-300">Decisions</h4>
            <ul className="space-y-2">
              {result.decisions.map((d) => (
                <li key={d.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">
                  <span className="font-semibold text-zinc-100">{d.text}</span>
                  <span className="ml-2 text-xs text-zinc-500">{d.topic} · {d.speaker}</span>
                </li>
              ))}
              {result.decisions.length === 0 && <li className="text-sm text-zinc-500">No decisions detected.</li>}
            </ul>
            <h4 className="mb-2 mt-5 text-sm font-bold text-zinc-300">Speaker-attributed transcript</h4>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {result.segments.map((s, i) => (
                <div key={i} className="text-sm leading-relaxed">
                  <span className={`font-bold ${speakerColor(s.speaker)}`}>{s.speaker}</span>
                  <span className="text-zinc-300"> {s.clean_text}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
