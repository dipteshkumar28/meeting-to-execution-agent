import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

/**
 * Browser dictation (Web Speech API). Works alongside Wispr Flow: Flow types into any focused
 * field system-wide, while this button gives one-click in-app dictation with live interim text.
 */
export default function VoiceButton({ onText, onInterim, label = "Dictate" }) {
  const [listening, setListening] = useState(false);
  const rec = useRef(null);
  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => () => rec.current?.stop(), []);

  if (!SR) {
    return <span className="text-xs text-zinc-500" title="Use Chrome/Edge for built-in dictation, or Wispr Flow anywhere">Mic unavailable in this browser</span>;
  }

  const toggle = () => {
    if (listening) { rec.current?.stop(); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) onText(t.trim() + " "); else interim += t;
      }
      onInterim?.(interim);
    };
    r.onend = () => { setListening(false); onInterim?.(""); };
    r.onerror = () => { setListening(false); onInterim?.(""); };
    rec.current = r; r.start(); setListening(true);
  };

  return (
    <button type="button" onClick={toggle} aria-pressed={listening}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${listening ? "animate-ring bg-rose-500 text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
      {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      {listening ? "Stop" : label}
    </button>
  );
}
