import { ShieldCheck } from "lucide-react";
import { api } from "../api.js";
import ConflictCard from "./ConflictCard.jsx";
import { Empty } from "./ui.jsx";

export default function ConflictsTab({ conflicts, refresh, toast }) {
  const resolve = async (id, resolution) => {
    try {
      await api.resolveConflict(id, resolution);
      await refresh();
      toast(resolution === "adopt_new" ? "New decision adopted; the old one is now superseded." : resolution === "keep_old" ? "Original decision kept." : "Conflict dismissed.");
    } catch (e) { toast(e.message, "error"); }
  };
  if (!conflicts.length)
    return <Empty icon={ShieldCheck} title="No conflicts so far" hint="When a new meeting contradicts or changes a past decision, it shows up here with both quotes side by side." />;
  const open = conflicts.filter((c) => c.status === "open");
  const closed = conflicts.filter((c) => c.status !== "open");
  return (
    <div className="space-y-4">
      {open.map((c) => <ConflictCard key={c.id} c={c} onResolve={resolve} />)}
      {closed.length > 0 && <h3 className="pt-4 text-sm font-bold text-zinc-400">Resolved</h3>}
      {closed.map((c) => <ConflictCard key={c.id} c={c} onResolve={resolve} />)}
    </div>
  );
}
