"""SQLite persistence layer - the cross-meeting memory lives here (meetings_memory.db)."""
import os
import sqlite3
from contextlib import contextmanager
from typing import Any, Optional

DB_PATH = os.getenv("DB_PATH", "meetings_memory.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  raw_transcript TEXT NOT NULL,
  summary TEXT DEFAULT '',
  speakers TEXT DEFAULT '[]',
  engine TEXT DEFAULT 'llm',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  clean_text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  topic TEXT DEFAULT '',
  speaker TEXT DEFAULT 'Unknown',
  quote TEXT DEFAULT '',
  status TEXT DEFAULT 'active',            -- active | superseded
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  owner TEXT DEFAULT 'Unassigned',
  deadline TEXT DEFAULT '',
  speaker TEXT DEFAULT '',
  quote TEXT DEFAULT '',
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'pending',           -- pending | approved | rejected | pushed
  external_ref TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  new_decision_id INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  old_decision_id INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  kind TEXT DEFAULT 'contradiction',       -- contradiction | revision
  severity TEXT DEFAULT 'high',            -- high | medium | low
  explanation TEXT DEFAULT '',
  status TEXT DEFAULT 'open',              -- open | adopted_new | kept_old | dismissed
  created_at TEXT DEFAULT (datetime('now'))
);
"""


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as c:
        c.executescript(SCHEMA)


def query(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with get_conn() as c:
        return [dict(r) for r in c.execute(sql, params).fetchall()]


def query_one(sql: str, params: tuple = ()) -> Optional[dict[str, Any]]:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: tuple = ()) -> int:
    with get_conn() as c:
        return c.execute(sql, params).lastrowid
