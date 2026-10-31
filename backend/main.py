"""Meeting-to-Execution Agent - FastAPI backend."""
import json
import os
import re
from typing import Iterator

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

load_dotenv()

import database as db  # noqa: E402  (after load_dotenv so DB_PATH is honoured)
import services as svc  # noqa: E402
from llm import MODEL, llm_available  # noqa: E402
from models import ActionUpdate, AnalyzeRequest, AskRequest, ConflictResolution  # noqa: E402

app = FastAPI(title="Meeting-to-Execution Agent", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def _startup() -> None:
    db.init_db()


def _ev(stage: str, status: str, message: str = "", **extra) -> str:
    return json.dumps({"stage": stage, "status": status, "message": message, **extra}) + "\n"


def _meeting_payload(mid: int) -> dict:
    m = db.query_one("SELECT * FROM meetings WHERE id=?", (mid,))
    if not m:
        raise HTTPException(404, "Meeting not found")
    m["speakers"] = json.loads(m["speakers"] or "[]")
    m["segments"] = db.query("SELECT speaker, text, clean_text FROM segments WHERE meeting_id=? ORDER BY idx", (mid,))
    m["decisions"] = db.query("SELECT * FROM decisions WHERE meeting_id=? ORDER BY id", (mid,))
    m["action_items"] = db.query("SELECT * FROM action_items WHERE meeting_id=? ORDER BY id", (mid,))
    m["conflicts"] = svc.hydrate_conflicts("c.meeting_id=?", (mid,))
    return m

def _tracker_view_url() -> str:
    explicit = os.getenv("TRACKER_VIEW_URL", "").strip()
    if explicit:
        return explicit
    m = re.search(r"webhook\.site/([0-9a-fA-F-]{36})", os.getenv("TRACKER_WEBHOOK_URL", ""))
    return f"https://webhook.site/#!/view/{m.group(1)}" if m else ""

# ------------------------------------------------------------------ health / stats
@app.get("/api/health")
def health():
    return {"status": "ok", "llm_configured": llm_available(), "model": MODEL,"tracker_view_url": _tracker_view_url()}


@app.get("/api/stats")
def stats():
    one = lambda sql: db.query_one(sql)["n"]  # noqa: E731
    return {
        "meetings": one("SELECT COUNT(*) n FROM meetings"),
        "decisions": one("SELECT COUNT(*) n FROM decisions"),
        "pending_actions": one("SELECT COUNT(*) n FROM action_items WHERE status='pending'"),
        "approved_actions": one("SELECT COUNT(*) n FROM action_items WHERE status IN ('approved','pushed')"),
        "open_conflicts": one("SELECT COUNT(*) n FROM conflicts WHERE status='open'"),
    }


# ------------------------------------------------------------------ analysis pipeline (streamed)
@app.post("/api/meetings/analyze")
def analyze(req: AnalyzeRequest):
    """Streams newline-delimited JSON progress events so the UI can show real-time pipeline feedback."""
    meeting_date = req.meeting_date or svc.today()

    def pipeline() -> Iterator[str]:
        try:
            yield _ev("ingest", "done", f"Received {len(req.transcript.split())} words")
            yield _ev("extract", "running", "Cleaning speech, attributing speakers, extracting decisions & tasks...")
            data, engine, warning = svc.extract(req.transcript, meeting_date)
            yield _ev("extract", "done", f"{len(data['segments'])} segments, {len(data['decisions'])} decisions, "
                      f"{len(data['action_items'])} action items", warning=warning)

            yield _ev("memory", "running", "Saving to cross-meeting memory...")
            saved = svc.save_meeting(req.title, meeting_date, req.transcript, data, engine)
            yield _ev("memory", "done", "Stored in meetings_memory.db")

            yield _ev("conflicts", "running", "Comparing new decisions against historical decisions...")
            conflict_ids, c_engine = svc.detect_conflicts(saved["meeting_id"], saved["decision_ids"])
            yield _ev("conflicts", "done", f"{len(conflict_ids)} conflict(s) found" if conflict_ids else "No conflicts with past decisions",
                      count=len(conflict_ids), engine=c_engine)

            yield _ev("complete", "done", "Analysis complete", meeting=_meeting_payload(saved["meeting_id"]), warning=warning)
        except Exception as e:  # last-resort guard so the stream always terminates cleanly
            yield _ev("error", "error", f"Pipeline failed: {e}")

    return StreamingResponse(pipeline(), media_type="application/x-ndjson")


# ------------------------------------------------------------------ meetings
@app.get("/api/meetings")
def list_meetings():
    return db.query("""SELECT m.id, m.title, m.meeting_date, m.summary, m.engine,
        (SELECT COUNT(*) FROM decisions WHERE meeting_id=m.id) AS decisions,
        (SELECT COUNT(*) FROM action_items WHERE meeting_id=m.id) AS actions
        FROM meetings m ORDER BY m.meeting_date DESC, m.id DESC""")


@app.get("/api/meetings/{mid}")
def get_meeting(mid: int):
    return _meeting_payload(mid)


# ------------------------------------------------------------------ action items (human-in-the-loop)
@app.get("/api/actions")
def list_actions(status: str | None = None):
    sql = ("SELECT a.*, m.title AS meeting_title, m.meeting_date FROM action_items a "
           "JOIN meetings m ON m.id=a.meeting_id")
    rows = db.query(sql + (" WHERE a.status=?" if status else "") + " ORDER BY a.id DESC", (status,) if status else ())
    return rows


@app.patch("/api/actions/{aid}")
def update_action(aid: int, body: ActionUpdate):
    cur = db.query_one("SELECT * FROM action_items WHERE id=?", (aid,))
    if not cur:
        raise HTTPException(404, "Action item not found")
    if cur["status"] == "pushed":
        raise HTTPException(409, "Already pushed to tracker; it can no longer be edited")
    fields = body.model_dump(exclude_none=True)
    if not fields:
        return cur
    sets = ", ".join(f"{k}=?" for k in fields)
    db.execute(f"UPDATE action_items SET {sets} WHERE id=?", (*fields.values(), aid))
    return db.query_one("SELECT * FROM action_items WHERE id=?", (aid,))


@app.post("/api/actions/approve-all")
def approve_all():
    db.execute("UPDATE action_items SET status='approved' WHERE status='pending'")
    return {"ok": True}


def _push_to_tracker(item: dict) -> str:
    """Pushes to TRACKER_WEBHOOK_URL when configured; otherwise simulates a Jira-style ticket."""
    url = os.getenv("TRACKER_WEBHOOK_URL")
    ref = f"MEET-{1000 + item['id']}"
    if url:
        try:
            r = httpx.post(url, json={"ref": ref, "task": item["task"], "owner": item["owner"],
                                      "deadline": item["deadline"], "priority": item["priority"]}, timeout=10)
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(502, f"Tracker push failed: {e}")
    return ref


@app.post("/api/actions/{aid}/push")
def push_action(aid: int):
    item = db.query_one("SELECT * FROM action_items WHERE id=?", (aid,))
    if not item:
        raise HTTPException(404, "Action item not found")
    if item["status"] != "approved":  # hard server-side human-approval gate
        raise HTTPException(409, "Only human-approved tasks can be pushed to the tracker")
    ref = _push_to_tracker(item)
    db.execute("UPDATE action_items SET status='pushed', external_ref=? WHERE id=?", (ref, aid))
    return db.query_one("SELECT * FROM action_items WHERE id=?", (aid,))


# ------------------------------------------------------------------ memory + conflicts
@app.get("/api/decisions")
def list_decisions(q: str | None = None):
    rows = db.query("""SELECT d.*, m.title AS meeting_title, m.meeting_date FROM decisions d
                       JOIN meetings m ON m.id=d.meeting_id ORDER BY m.meeting_date DESC, d.id DESC""")
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in (r["text"] + " " + r["topic"] + " " + r["meeting_title"]).lower()]
    return rows


@app.post("/api/memory/ask")
def ask(body: AskRequest):
    return svc.ask_memory(body.question)


@app.get("/api/conflicts")
def list_conflicts(status: str | None = None):
    return svc.hydrate_conflicts("c.status=?" if status else "1=1", (status,) if status else ())


@app.patch("/api/conflicts/{cid}")
def resolve_conflict(cid: int, body: ConflictResolution):
    c = db.query_one("SELECT * FROM conflicts WHERE id=?", (cid,))
    if not c:
        raise HTTPException(404, "Conflict not found")
    if body.resolution == "adopt_new":
        db.execute("UPDATE decisions SET status='superseded' WHERE id=?", (c["old_decision_id"],))
        status = "adopted_new"
    elif body.resolution == "keep_old":
        db.execute("UPDATE decisions SET status='superseded' WHERE id=?", (c["new_decision_id"],))
        status = "kept_old"
    else:
        status = "dismissed"
    db.execute("UPDATE conflicts SET status=? WHERE id=?", (status, cid))
    return svc.hydrate_conflicts("c.id=?", (cid,))[0]


# ------------------------------------------------------------------ demo seed
SEED_TRANSCRIPT = """Priya: Okay so, um, kickoff for Project Atlas. Big picture, we are launching the product in Q2.
Marcus: Agreed. Q2 launch, that's the target. And for payments, let's go with Stripe, it's the fastest integration.
Priya: Budget for the launch campaign is fifty thousand dollars. We decided that, final.
Marcus: I'll finalize the Stripe integration spec by 2026-03-15.
Dana: I will draft the launch landing page copy by 2026-03-20."""


@app.post("/api/seed")
def seed():
    """Loads a historical meeting directly into memory so the conflict demo works instantly (no LLM needed)."""
    if db.query_one("SELECT id FROM meetings WHERE title='Project Atlas Kickoff'"):
        return {"ok": True, "message": "Already seeded"}
    data = {
        "summary": "Kickoff for Project Atlas: Q2 launch, Stripe payments, $50k launch budget.",
        "speakers": ["Priya", "Marcus", "Dana"],
        "segments": [{"speaker": l.split(":")[0], "text": l.split(": ", 1)[1], "clean_text": svc._clean(l.split(": ", 1)[1])}
                     for l in SEED_TRANSCRIPT.splitlines()],
        "decisions": [
            {"text": "Launch Project Atlas in Q2.", "topic": "Launch timeline", "speaker": "Priya", "quote": "we are launching the product in Q2"},
            {"text": "Use Stripe as the payment provider.", "topic": "Payment provider", "speaker": "Marcus", "quote": "let's go with Stripe"},
            {"text": "Launch campaign budget is $50,000.", "topic": "Launch budget", "speaker": "Priya", "quote": "Budget for the launch campaign is fifty thousand dollars"},
        ],
        "action_items": [
            {"task": "Finalize the Stripe integration spec", "owner": "Marcus", "deadline": "2026-03-15", "speaker": "Marcus", "priority": "high", "quote": "I'll finalize the Stripe integration spec"},
            {"task": "Draft launch landing page copy", "owner": "Dana", "deadline": "2026-03-20", "speaker": "Dana", "priority": "medium", "quote": "I will draft the launch landing page copy"},
        ],
    }
    mid = svc.save_meeting("Project Atlas Kickoff", "2026-03-02", SEED_TRANSCRIPT, data, "seed")["meeting_id"]
    db.execute("UPDATE action_items SET status='approved' WHERE meeting_id=?", (mid,))
    return {"ok": True, "meeting_id": mid}


@app.post("/api/reset")
def reset():
    for t in ("conflicts", "action_items", "decisions", "segments", "meetings"):
        db.execute(f"DELETE FROM {t}")
    return {"ok": True}
