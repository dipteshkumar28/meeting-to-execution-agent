import { useEffect, useState } from "react";
import { Brain, Search, Send } from "lucide-react";
import { api } from "../api.js";
import VoiceButton from "./VoiceButton.jsx";
import { Badge, Card, Empty, StatusBadge, btn } from "./ui.jsx";

export default function MemoryTab({ decisions, toast }) {
  const [q, setQ] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);

  const filtered = decisions.filter((d) => !q || (d.text + d.topic + d.meeting_title).toLowerCase().includes(q.toLowerCase()));
  const byMeeting = filtered.reduce((acc, d) => {
    const k = `${d.meeting_date}|${d.meeting_title}`;
    (acc[k] = acc[k] || []).push(d);
    return acc;
  }, {});

  const ask = async () => {
    setAsking(true);
    try { setAnswer(await api.ask(question)); } catch (e) { toast(e.message, "error"); } finally { setAsking(false); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div>
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter decisions by topic, keyword or meeting" aria-label="Filter decisions"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-3 text-sm placeholder:text-zinc-600" />
        </div>
        {Object.keys(byMeeting).length === 0 ? (
          <Empty icon={Brain} title="Memory is empty" hint="Every decision from every analysed meeting is stored here and checked against future meetings." />
        ) : (
          <div className="space-y-6">
            {Object.entries(byMeeting).map(([k, ds]) => {
              const [date, title] = k.split("|");
              return (
                <section key={k}>
                  <h3 className="mb-2 flex items-baseline gap-2 text-sm font-bold text-zinc-300">{title}<span className="font-mono text-xs font-normal text-zinc-500">{date}</span></h3>
                  <div className="space-y-2 border-l border-zinc-800 pl-4">
                    {ds.map((d) => (
                      <Card key={d.id} className="flex items-start justify-between gap-3 p-3">
                        <div>
                          <p className={`font-semibold ${d.status === "superseded" ? "text-zinc-500 line-through" : "text-zinc-100"}`}>{d.text}</p>
                          <p className="mt-1 text-xs text-zinc-500">{d.speaker}{d.topic && ` · ${d.topic}`}</p>
                        </div>
                        <StatusBadge status={d.status} />
                      </Card>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <Card className="h-fit p-5 lg:sticky lg:top-6">
        <h3 className="flex items-center gap-2 font-bold text-zinc-100"><Brain className="h-5 w-5 text-violet-300" />Ask your meeting memory</h3>
        <p className="mt-1 text-sm text-zinc-500">e.g. "What did we decide about payments?"</p>
        <textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Question"
          className="mt-3 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm" />
        <div className="mt-2 flex gap-2">
          <VoiceButton label="Speak" onText={(t) => setQuestion((x) => x + t)} />
          <button className={`${btn.primary} flex-1`} disabled={asking || question.trim().length < 3} onClick={ask}><Send className="h-4 w-4" />{asking ? "Thinking..." : "Ask"}</button>
        </div>
        {answer && (
          <div className="mt-4 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 text-sm leading-relaxed text-zinc-200">
            {answer.answer}
            <div className="mt-2"><Badge tone="violet">{answer.engine}</Badge></div>
          </div>
        )}
      </Card>
    </div>
  );
}
