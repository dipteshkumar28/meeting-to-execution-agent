const j = async (res) => {
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
};
const send = (method, url, body) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(j);

export const api = {
  health: () => fetch("/api/health").then(j),
  stats: () => fetch("/api/stats").then(j),
  meetings: () => fetch("/api/meetings").then(j),
  actions: () => fetch("/api/actions").then(j),
  decisions: (q = "") => fetch(`/api/decisions?q=${encodeURIComponent(q)}`).then(j),
  conflicts: () => fetch("/api/conflicts").then(j),
  updateAction: (id, body) => send("PATCH", `/api/actions/${id}`, body),
  approveAll: () => send("POST", "/api/actions/approve-all"),
  pushAction: (id) => send("POST", `/api/actions/${id}/push`),
  resolveConflict: (id, resolution) => send("PATCH", `/api/conflicts/${id}`, { resolution }),
  ask: (question) => send("POST", "/api/memory/ask", { question }),
  seed: () => send("POST", "/api/seed"),
  reset: () => send("POST", "/api/reset"),

  /** Streams NDJSON pipeline events: onEvent({stage,status,message,...}) */
  async analyze(payload, onEvent) {
    const res = await fetch("/api/meetings/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Analysis request failed");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      lines.filter(Boolean).forEach((l) => onEvent(JSON.parse(l)));
    }
    if (buf.trim()) onEvent(JSON.parse(buf));
  },
};
