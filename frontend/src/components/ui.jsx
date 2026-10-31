import { useEffect } from "react";
import { X } from "lucide-react";

const TONES = {
  zinc: "bg-zinc-800 text-zinc-300 ring-zinc-700",
  amber: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  emerald: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  rose: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
  cyan: "bg-cyan-500/10 text-cyan-300 ring-cyan-500/30",
  violet: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
};

export const Badge = ({ tone = "zinc", children, className = "" }) => (
  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tone]} ${className}`}>{children}</span>
);

export const STATUS_TONE = { pending: "amber", approved: "emerald", rejected: "rose", pushed: "cyan", active: "emerald", superseded: "zinc", open: "rose", adopted_new: "cyan", kept_old: "violet", dismissed: "zinc" };
export const STATUS_LABEL = { adopted_new: "new adopted", kept_old: "original kept" };

export const StatusBadge = ({ status }) => <Badge tone={STATUS_TONE[status] || "zinc"}>{STATUS_LABEL[status] || status}</Badge>;

const SPEAKER_HUES = ["text-cyan-300", "text-violet-300", "text-emerald-300", "text-amber-300", "text-rose-300", "text-sky-300", "text-fuchsia-300"];
export const speakerColor = (name = "") => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPEAKER_HUES[h % SPEAKER_HUES.length];
};

export const Card = ({ className = "", children }) => (
  <div className={`rounded-xl border border-zinc-800 bg-zinc-900/60 backdrop-blur ${className}`}>{children}</div>
);

export const Empty = ({ icon: Icon, title, hint }) => (
  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 py-16 text-center">
    <Icon className="mb-3 h-8 w-8 text-zinc-600" />
    <p className="font-semibold text-zinc-300">{title}</p>
    <p className="mt-1 max-w-sm text-sm text-zinc-500">{hint}</p>
  </div>
);

export function Modal({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg animate-slideIn rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-zinc-100">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Toasts = ({ items }) => (
  <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2" aria-live="polite">
    {items.map((t) => (
      <div key={t.id} className={`animate-slideIn rounded-lg border px-4 py-3 text-sm font-medium shadow-xl ${t.type === "error" ? "border-rose-500/40 bg-rose-950 text-rose-200" : "border-emerald-500/30 bg-zinc-900 text-emerald-200"}`}>{t.msg}</div>
    ))}
  </div>
);

export const btn = {
  primary: "inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40",
  ghost: "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40",
  success: "inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40",
  danger: "inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-40",
};
