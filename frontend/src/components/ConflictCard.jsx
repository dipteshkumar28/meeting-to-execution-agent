import { ArrowRight, CheckCircle2, Eraser, ShieldAlert, Undo2 } from "lucide-react";
import { Badge, StatusBadge, btn } from "./ui.jsx";

const SEV = { high: "rose", medium: "amber", low: "zinc" };

export default function ConflictCard({ c, onResolve, compact = false }) {
  const open = c.status === "open";
  return (
    <div className={`overflow-hidden rounded-xl border ${open ? "border-rose-500/40 bg-rose-950/20" : "border-zinc-800 bg-zinc-900/60"}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 px-4 py-3">
        <ShieldAlert className={`h-5 w-5 ${open ? "text-rose-400" : "text-zinc-500"}`} />
        <span className="font-bold text-zinc-100">Decision {c.kind === "contradiction" ? "contradiction" : "changed"}</span>
        <Badge tone={SEV[c.severity]}>{c.severity} severity</Badge>
        <StatusBadge status={c.status} />
      </div>
      <p className="px-4 pt-3 text-sm font-semibold text-amber-200">{c.explanation}</p>
      <div className="grid gap-3 p-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        <Side tone="old" title="Previously decided" meeting={c.old_meeting} date={c.old_date} text={c.old_text} quote={c.old_quote} who={c.old_speaker} />
        <ArrowRight className="hidden h-5 w-5 self-center text-zinc-500 md:block" />
        <Side tone="new" title="Now says" meeting={c.new_meeting} date={c.new_date} text={c.new_text} quote={c.new_quote} who={c.new_speaker} />
      </div>
      {open && onResolve && !compact && (
        <div className="flex flex-wrap gap-2 border-t border-zinc-800/80 px-4 py-3">
          <button className={btn.success} onClick={() => onResolve(c.id, "adopt_new")}><CheckCircle2 className="h-4 w-4" />Adopt new decision</button>
          <button className={btn.ghost} onClick={() => onResolve(c.id, "keep_old")}><Undo2 className="h-4 w-4" />Keep original</button>
          <button className={btn.ghost} onClick={() => onResolve(c.id, "dismiss")}><Eraser className="h-4 w-4" />Not a conflict</button>
        </div>
      )}
    </div>
  );
}

function Side({ tone, title, meeting, date, text, quote, who }) {
  const old = tone === "old";
  return (
    <div className={`rounded-lg border p-3 ${old ? "border-zinc-700 bg-zinc-900" : "border-cyan-500/30 bg-cyan-500/5"}`}>
      <p className="text-xs font-semibold text-zinc-500">{title} · {meeting} · {date}</p>
      <p className={`mt-1.5 font-semibold ${old ? "text-zinc-400 line-through decoration-rose-500/60" : "text-zinc-100"}`}>{text}</p>
      {quote && <p className="mt-2 border-l-2 border-zinc-700 pl-2 font-mono text-xs text-zinc-500">"{quote}" <span className="text-zinc-600">- {who}</span></p>}
    </div>
  );
}
