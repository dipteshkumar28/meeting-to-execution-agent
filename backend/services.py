"""Business logic: transcript extraction, cross-meeting conflict detection, memory Q&A.

Every LLM step has a deterministic fallback, so the demo never dies on stage.
"""
import json
import re
from datetime import date
from difflib import SequenceMatcher
from typing import Any

import database as db
from llm import LLMError, chat_json, llm_available

# --------------------------------------------------------------------------------------
# Prompts
# --------------------------------------------------------------------------------------
EXTRACTION_SYSTEM = """You are an elite meeting analyst. You receive a MESSY raw transcript (speech-to-text or
dictated: filler words, false starts, digressions, self-corrections, possibly missing speaker labels).

Do all of the following and return ONLY a JSON object:
{
  "summary": "2-3 sentence executive summary",
  "speakers": ["unique speaker names"],
  "segments": [{"speaker": "Name", "text": "original text", "clean_text": "same content without fillers/false starts"}],
  "decisions": [{"text": "one precise, self-contained decision sentence", "topic": "2-4 word topic label",
                 "speaker": "who made/announced it", "quote": "short verbatim supporting quote"}],
  "action_items": [{"task": "imperative task description", "owner": "person responsible or 'Unassigned'",
                    "deadline": "YYYY-MM-DD if resolvable else the stated phrase else ''",
                    "speaker": "who assigned/volunteered", "priority": "low|medium|high",
                    "quote": "short verbatim supporting quote"}]
}

RULES
- Speaker attribution: use explicit labels when present; otherwise infer from context (addressing by name,
  "I'll do X", replies). Never invent people. Use "Unknown" only if truly impossible.
- Self-corrections: ALWAYS use the FINAL stated value ("Friday... no wait, Monday" -> Monday).
- Ignore digressions, jokes, small talk. Drop filler (um, uh, like, you know, so yeah).
- A decision is a commitment/choice the group settled on (not a suggestion that was rejected).
  Preserve concrete facts: dates, quarters, numbers, vendors, owners.
- Resolve relative deadlines ("next Friday", "end of month") against the MEETING DATE given.
- An action item needs a real task. Do not duplicate decisions as tasks unless someone must do work.
- Be exhaustive but precise. No markdown, JSON only."""

CONFLICT_SYSTEM = """You are a rigorous decision-consistency auditor. You get NEW decisions from today's meeting and
CANDIDATE past decisions from earlier meetings. For each pair decide whether the new decision
contradicts or materially alters the old one (changed date/quarter/number/vendor/scope/owner/direction).
Ignore pairs that are unrelated or consistent/duplicates.
Return ONLY JSON:
{"conflicts": [{"new_index": int, "old_id": int, "kind": "contradiction|revision",
                "severity": "high|medium|low",
                "explanation": "1-2 sentences naming exactly what changed, e.g. 'Launch moved from Q2 to Q3'"}]}"""

ASK_SYSTEM = """You answer questions about a team's meeting history using ONLY the supplied decision log
and meeting summaries. Be concise (max 4 sentences), cite meeting titles/dates, mention if a decision was
superseded. If the answer is not in the data, say so. Return JSON: {"answer": "..."}"""

# --------------------------------------------------------------------------------------
# Fallback (heuristic) extraction
# --------------------------------------------------------------------------------------
FILLERS = re.compile(r"\b(um+|uh+|erm|you know|i mean|like,|sort of|kind of|basically|so yeah)\b[,.]?\s*", re.I)
DECISION_CUES = re.compile(r"\b(we (decided|agreed|are going|will go|'ll go)|we'?ll (switch|use|go with|move|push)|let'?s go with|going with|final decision|"
                           r"it'?s (settled|decided)|we'?re (moving|pushing|switching|launching)|approved)\b", re.I)
ACTION_CUES = re.compile(r"\b(i'?ll|i will|will you|can you|needs? to|should|please|action item|take (care|the lead))\b", re.I)


def _clean(t: str) -> str:
    return re.sub(r"\s{2,}", " ", FILLERS.sub("", t)).strip()


def _fallback_extract(transcript: str) -> dict[str, Any]:
    segments, speakers = [], []
    last = "Unknown"
    for line in [l.strip() for l in transcript.splitlines() if l.strip()]:
        m = re.match(r"^\[?([A-Z][\w .'-]{0,30}?)\]?\s*[:\-]\s+(.*)$", line)
        if m:
            last, text = m.group(1).strip(), m.group(2)
        else:
            text = line
        if last not in speakers:
            speakers.append(last)
        segments.append({"speaker": last, "text": text, "clean_text": _clean(text)})
    decisions, actions = [], []
    for s in segments:
        for sent in re.split(r"(?<=[.!?])\s+", s["clean_text"]):
            if DECISION_CUES.search(sent):
                decisions.append({"text": sent, "topic": " ".join(sent.split()[:3]), "speaker": s["speaker"], "quote": sent[:140]})
            elif ACTION_CUES.search(sent):
                dl = re.search(r"\bby ([A-Za-z0-9 ,]+?)(?:[.!?]|$)", sent)
                actions.append({"task": sent, "owner": s["speaker"] if re.search(r"\bI('ll| will)\b", sent) else "Unassigned",
                                "deadline": dl.group(1).strip() if dl else "", "speaker": s["speaker"],
                                "priority": "medium", "quote": sent[:140]})
    return {"summary": "Heuristic summary (LLM unavailable): " + (decisions[0]["text"] if decisions else "no decisions detected."),
            "speakers": speakers, "segments": segments, "decisions": decisions, "action_items": actions}


# --------------------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------------------
def _sanitize(data: dict[str, Any]) -> dict[str, Any]:
    def s(v, d=""):
        return str(v).strip() if v not in (None, "") else d

    segments = [{"speaker": s(x.get("speaker"), "Unknown"), "text": s(x.get("text")), "clean_text": s(x.get("clean_text") or x.get("text"))}
                for x in data.get("segments", []) if isinstance(x, dict) and s(x.get("text"))]
    decisions = [{"text": s(x.get("text")), "topic": s(x.get("topic")), "speaker": s(x.get("speaker"), "Unknown"), "quote": s(x.get("quote"))}
                 for x in data.get("decisions", []) if isinstance(x, dict) and s(x.get("text"))]
    actions = []
    for x in data.get("action_items", []):
        if not isinstance(x, dict) or not s(x.get("task")):
            continue
        pr = s(x.get("priority"), "medium").lower()
        actions.append({"task": s(x.get("task")), "owner": s(x.get("owner"), "Unassigned"), "deadline": s(x.get("deadline")),
                        "speaker": s(x.get("speaker")), "priority": pr if pr in ("low", "medium", "high") else "medium",
                        "quote": s(x.get("quote"))})
    speakers = list(dict.fromkeys([s(p) for p in data.get("speakers", []) if s(p)] + [g["speaker"] for g in segments]))
    return {"summary": s(data.get("summary")), "speakers": speakers, "segments": segments, "decisions": decisions, "action_items": actions}


def extract(transcript: str, meeting_date: str) -> tuple[dict[str, Any], str, str]:
    """Returns (data, engine, warning)."""
    if llm_available():
        try:
            raw = chat_json(EXTRACTION_SYSTEM, f"MEETING DATE: {meeting_date}\n\nTRANSCRIPT:\n{transcript}")
            data = _sanitize(raw)
            if data["segments"] or data["decisions"] or data["action_items"]:
                return data, "llm", ""
            raise LLMError("Model returned an empty extraction")
        except (LLMError, ValueError) as e:
            return _sanitize(_fallback_extract(transcript)), "fallback", f"LLM failed ({e}); used heuristic extractor."
    return _sanitize(_fallback_extract(transcript)), "fallback", "No GROQ_API_KEY set; used heuristic extractor."


# --------------------------------------------------------------------------------------
# Persistence of one analysed meeting
# --------------------------------------------------------------------------------------
def save_meeting(title: str, meeting_date: str, transcript: str, data: dict[str, Any], engine: str) -> dict[str, Any]:
    mid = db.execute("INSERT INTO meetings(title, meeting_date, raw_transcript, summary, speakers, engine) VALUES (?,?,?,?,?,?)",
                     (title, meeting_date, transcript, data["summary"], json.dumps(data["speakers"]), engine))
    for i, s in enumerate(data["segments"]):
        db.execute("INSERT INTO segments(meeting_id, idx, speaker, text, clean_text) VALUES (?,?,?,?,?)",
                   (mid, i, s["speaker"], s["text"], s["clean_text"]))
    decision_ids = []
    for d in data["decisions"]:
        decision_ids.append(db.execute("INSERT INTO decisions(meeting_id, text, topic, speaker, quote) VALUES (?,?,?,?,?)",
                                       (mid, d["text"], d["topic"], d["speaker"], d["quote"])))
    # Action items are STAGED as 'pending' - nothing leaves without human approval.
    for a in data["action_items"]:
        db.execute("INSERT INTO action_items(meeting_id, task, owner, deadline, speaker, quote, priority) VALUES (?,?,?,?,?,?,?)",
                   (mid, a["task"], a["owner"], a["deadline"], a["speaker"], a["quote"], a["priority"]))
    return {"meeting_id": mid, "decision_ids": decision_ids}


# --------------------------------------------------------------------------------------
# Conflict detection (retrieve -> judge)
# --------------------------------------------------------------------------------------
STOP = set("the a an of to in on for and or we is are be will with by at this that it as from our us".split())
TOKEN = re.compile(r"[a-z0-9$%.]+")


def _tokens(t: str) -> set[str]:
    return {(w[:-1] if len(w) > 4 and w.endswith("s") else w) for w in TOKEN.findall(t.lower()) if w not in STOP and len(w) > 1}


def _similarity(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    jac = len(ta & tb) / max(1, len(ta | tb))
    return max(jac, 0.6 * jac + 0.4 * SequenceMatcher(None, a.lower(), b.lower()).ratio())


def _facts(t: str) -> dict[str, set[str]]:
    t = t.lower()
    return {"quarter": set(re.findall(r"\bq[1-4]\b", t)),
            "money": set(re.findall(r"\$\s?\d[\d,.]*k?", t)),
            "month": set(re.findall(r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b", t))}


REVERSAL = re.compile(r"\b(not|no longer|instead|drop|cancel|switch|replace|move|moving|push|pushing|delay)\w*\b")


def _heuristic_judge(new: dict, old: dict) -> dict | None:
    nf, of = _facts(new["text"]), _facts(old["text"])
    for cat in ("quarter", "money", "month"):
        if nf[cat] and of[cat] and nf[cat] != of[cat]:
            return {"kind": "revision", "severity": "high",
                    "explanation": f"{cat.capitalize()} changed from {', '.join(sorted(of[cat])).upper()} to {', '.join(sorted(nf[cat])).upper()}."}
    if len(_tokens(new["text"]) & _tokens(old["text"])) >= 2 and REVERSAL.search(new["text"].lower()) and not REVERSAL.search(old["text"].lower()):
        return {"kind": "contradiction", "severity": "medium", "explanation": "New decision reverses or replaces the earlier direction."}
    return None


def detect_conflicts(meeting_id: int, decision_ids: list[int]) -> tuple[list[int], str]:
    new_rows = [db.query_one("SELECT * FROM decisions WHERE id=?", (i,)) for i in decision_ids]
    new_rows = [r for r in new_rows if r]
    past = db.query("SELECT d.*, m.title AS meeting_title, m.meeting_date FROM decisions d JOIN meetings m ON m.id=d.meeting_id "
                    "WHERE d.meeting_id != ? AND d.status='active'", (meeting_id,))
    if not new_rows or not past:
        return [], "none"

    # 1) Retrieval: top-3 most similar past decisions per new decision
    cands: dict[int, list[dict]] = {}
    for idx, n in enumerate(new_rows):
        scored = sorted(((_similarity(n["text"] + " " + n["topic"], p["text"] + " " + p["topic"]), p) for p in past),
                        key=lambda x: x[0], reverse=True)
        cands[idx] = [p for s, p in scored[:3] if s >= 0.05]
    if not any(cands.values()):
        return [], "none"

    verdicts: list[dict] = []
    engine = "llm"
    if llm_available():
        try:
            payload = {"new_decisions": [{"new_index": i, "text": n["text"], "topic": n["topic"]} for i, n in enumerate(new_rows)],
                       "candidate_past_decisions": [{"new_index": i, "old_id": p["id"], "text": p["text"], "meeting": p["meeting_title"],
                                                     "date": p["meeting_date"]} for i, cs in cands.items() for p in cs]}
            out = chat_json(CONFLICT_SYSTEM, json.dumps(payload))
            valid_pairs = {(i, p["id"]) for i, cs in cands.items() for p in cs}
            for c in out.get("conflicts", []):
                try:
                    pair = (int(c["new_index"]), int(c["old_id"]))
                except (KeyError, TypeError, ValueError):
                    continue
                if pair in valid_pairs:
                    verdicts.append({"new_index": pair[0], "old_id": pair[1], "kind": c.get("kind", "revision"),
                                     "severity": c.get("severity", "medium"), "explanation": str(c.get("explanation", ""))})
        except (LLMError, ValueError):
            engine = "heuristic"
            verdicts = []
    else:
        engine = "heuristic"

    if engine == "heuristic":
        for i, cs in cands.items():
            for p in cs:
                h = _heuristic_judge(new_rows[i], p)
                if h:
                    verdicts.append({"new_index": i, "old_id": p["id"], **h})

    ids = []
    seen = set()
    for v in verdicts:
        key = (v["new_index"], v["old_id"])
        if key in seen:
            continue
        seen.add(key)
        kind = v["kind"] if v["kind"] in ("contradiction", "revision") else "revision"
        sev = v["severity"] if v["severity"] in ("high", "medium", "low") else "medium"
        ids.append(db.execute("INSERT INTO conflicts(meeting_id,new_decision_id,old_decision_id,kind,severity,explanation) VALUES (?,?,?,?,?,?)",
                              (meeting_id, new_rows[v["new_index"]]["id"], v["old_id"], kind, sev, v["explanation"])))
    return ids, engine


def hydrate_conflicts(where: str = "1=1", params: tuple = ()) -> list[dict[str, Any]]:
    return db.query(f"""
        SELECT c.*, 
          nd.text AS new_text, nd.quote AS new_quote, nd.speaker AS new_speaker, nm.title AS new_meeting, nm.meeting_date AS new_date,
          od.text AS old_text, od.quote AS old_quote, od.speaker AS old_speaker, om.title AS old_meeting, om.meeting_date AS old_date
        FROM conflicts c
        JOIN decisions nd ON nd.id=c.new_decision_id JOIN meetings nm ON nm.id=nd.meeting_id
        JOIN decisions od ON od.id=c.old_decision_id JOIN meetings om ON om.id=od.meeting_id
        WHERE {where} ORDER BY c.id DESC""", params)


# --------------------------------------------------------------------------------------
# Memory Q&A
# --------------------------------------------------------------------------------------
def ask_memory(question: str) -> dict[str, str]:
    rows = db.query("SELECT d.id, d.text, d.topic, d.status, m.title, m.meeting_date FROM decisions d JOIN meetings m ON m.id=d.meeting_id "
                    "ORDER BY m.meeting_date DESC, d.id DESC LIMIT 150")
    if not rows:
        return {"answer": "Memory is empty - analyse a meeting first.", "engine": "none"}
    if llm_available():
        try:
            out = chat_json(ASK_SYSTEM, json.dumps({"question": question, "decision_log": rows}))
            return {"answer": str(out.get("answer", "")).strip() or "No answer found.", "engine": "llm"}
        except (LLMError, ValueError):
            pass
    qt = _tokens(question)
    best = sorted(rows, key=lambda r: len(qt & _tokens(r["text"] + " " + r["topic"])), reverse=True)[:3]
    best = [b for b in best if qt & _tokens(b["text"] + " " + b["topic"])]
    if not best:
        return {"answer": "I couldn't find a related decision in memory.", "engine": "keyword"}
    return {"answer": " | ".join(f'{b["meeting_date"]} {b["title"]}: {b["text"]} [{b["status"]}]' for b in best), "engine": "keyword"}


def today() -> str:
    return date.today().isoformat()
