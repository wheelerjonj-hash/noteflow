import { useState, useRef, useEffect, useCallback } from "react";

// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://loempsuntceusydhseri.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvZW1wc3VudGNldXN5ZGhzZXJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NzkyNzUsImV4cCI6MjA5NDI1NTI3NX0.0u_S82sxLaJwYhP6A0HRgd2Rv49jHRtbn-b6AQNdanE";

// ── Supabase helpers ──────────────────────────────────────────────────────────
const sb = {
  async select(table, order = "created_at", asc = false) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?order=${order}.${asc ? "asc" : "desc"}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    return res.json();
  },
  async insert(table, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json", Prefer: "return=representation",
      },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    return Array.isArray(json) ? json[0] : json;
  },
  async update(table, id, data) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  },
  async remove(table, id) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
  },
};

// ── Claude API ────────────────────────────────────────────────────────────────
async function analyzeWithClaude(transcript, onChunk) {
  const sys = `You are an expert meeting analyst for a vacation rental management and construction company on Anna Maria Island, FL (Beach Life Rentals and AMI Construction Group). Analyze the meeting transcript and return ONLY valid JSON with no markdown fences or extra text:
{
  "title": "concise 4-6 word meeting title",
  "summary": "2-3 sentence executive summary of key discussion points",
  "action_items": ["Owner/person: specific action item", ...],
  "insights": ["key decision or notable insight", ...],
  "speakers": ["Speaker 1", "Speaker 2", ...]
}
Be specific and business-focused. Identify action owners by name or role when mentioned.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      stream: true,
      system: sys,
      messages: [{ role: "user", content: `Transcript:\n${transcript}` }],
    }),
  });

  if (!res.ok) throw new Error("Claude API error");

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split("\n")) {
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (d === "[DONE]") break;
      try {
        const delta = JSON.parse(d).delta?.text || "";
        if (delta) { full += delta; onChunk(full); }
      } catch { /* skip */ }
    }
  }

  // Clean and parse
  const cleaned = full.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const Ic = ({ d, size = 20, fill = "none", stroke = "currentColor", sw = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} d={p} />)}
  </svg>
);

const Icons = {
  Mic: () => <Ic d={["M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z","M19 10v2a7 7 0 0 1-14 0v-2","M12 19v4","M8 23h8"]} />,
  Stop: () => <Ic d="M4 4h16v16H4z" fill="currentColor" stroke="none" />,
  Trash: () => <Ic d={["M3 6h18","M19 6l-1 14H6L5 6","M10 11v6","M14 11v6","M9 6V4h6v2"]} size={16} />,
  Copy: () => <Ic d={["M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2","M16 4h2a2 2 0 0 1 2 2v4","M21 14H11","M15 9l-5 5 5 5"]} size={16} />,
  Check: () => <Ic d="M20 6L9 17l-5-5" size={16} sw={2.5} />,
  Sparkle: () => <Ic d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" size={15} />,
  Back: () => <Ic d="M15 18l-6-6 6-6" size={20} />,
  Key: () => <Ic d={["M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"]} size={18} />,
  Phone: () => <Ic d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1.23h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.83a16 16 0 0 0 6.26 6.26l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" size={16} />,
  People: () => <Ic d={["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2","M23 21v-2a4 4 0 0 0-3-3.87","M16 3.13a4 4 0 0 1 0 7.75","M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"]} size={16} />,
  Site: () => <Ic d={["M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z","M9 22V12h6v10"]} size={16} />,
  Paste: () => <Ic d={["M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2","M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"]} size={16} />,
  Chevron: () => <Ic d="M9 18l6-6-6-6" size={16} />,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = {
  dur: s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`,
  date: ts => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
  time: ts => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
};

const TYPES = [
  { id: "phone",     label: "Phone Call",      Icon: Icons.Phone  },
  { id: "in-person", label: "In-Person",        Icon: Icons.People },
  { id: "site",      label: "Site Walkthrough", Icon: Icons.Site   },
];

const C = {
  bg:         "#1a1a1a",
  surface:    "rgba(255,255,255,0.10)",
  border:     "rgba(255,255,255,0.25)",
  gold:       "#ffd060",
  goldDim:    "rgba(255,208,96,0.20)",
  goldBorder: "rgba(255,208,96,0.60)",
  text:       "#ffffff",
  muted:      "#cccccc",
  dim:        "#999999",
  red:        "#ff5555",
};

// ── Spinner ───────────────────────────────────────────────────────────────────
const Spinner = ({ size = 16, color = C.gold }) => (
  <div style={{ width: size, height: size, border: `2px solid ${color}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
);

// ── Main ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]               = useState("home");
  const [meetings, setMeetings]           = useState([]);
  const [activeMeeting, setActiveMeeting] = useState(null);
  const [dgKey, setDgKey]                 = useState(() => localStorage.getItem("dg_key") || "");
  const [keyInput, setKeyInput]           = useState("");
  const [recording, setRecording]         = useState(false);
  const [elapsed, setElapsed]             = useState(0);
  const [transcript, setTranscript]       = useState("");
  const [interim, setInterim]             = useState("");
  const [meetingType, setMeetingType]     = useState("in-person");
  const [processing, setProcessing]       = useState(false);
  const [streamText, setStreamText]       = useState("");
  const [tab, setTab]                     = useState("summary");
  const [copied, setCopied]               = useState(false);
  const [bars, setBars]                   = useState(Array(24).fill(3));
  const [inputMode, setInputMode]         = useState("mic");
  const [pasteText, setPasteText]         = useState("");
  const [loading, setLoading]             = useState(true);
  const [editingTitle, setEditingTitle]   = useState(false);
  const [titleVal, setTitleVal]           = useState("");
  const [keySaved, setKeySaved]           = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [recordError, setRecordError] = useState("");

  const wsRef          = useRef(null);
  const mediaRef       = useRef(null);
  const timerRef       = useRef(null);
  const analyserRef    = useRef(null);
  const animRef        = useRef(null);
  const transcriptRef  = useRef("");
  const titleInputRef  = useRef(null);
  const transcriptEnd  = useRef(null);
  const wakeLockRef    = useRef(null);

  // Load meetings on mount
  useEffect(() => {
    sb.select("noteflow_meetings")
      .then(d => { setMeetings(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, interim]);

  // Waveform animation
  useEffect(() => {
    if (!recording) { setBars(Array(24).fill(3)); cancelAnimationFrame(animRef.current); return; }
    const tick = () => {
      if (analyserRef.current) {
        const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(buf);
        setBars(Array.from({ length: 24 }, (_, i) => {
          const v = buf[Math.floor((i / 24) * buf.length)] / 255;
          return Math.max(3, Math.min(36, v * 36));
        }));
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [recording]);

  // ── Recording ──────────────────────────────────────────────────────────────
  const cleanupRecording = useCallback(() => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(animRef.current);
    try { mediaRef.current?._recorder?.stop(); } catch {}
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    try { mediaRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    mediaRef.current = null;
    analyserRef.current = null;
    try { wakeLockRef.current?.release(); wakeLockRef.current = null; } catch {}
  }, []);

  const startRecording = useCallback(async () => {
    if (!dgKey) { setKeyInput(""); setScreen("settings"); return; }

    transcriptRef.current = "";
    setTranscript(""); setInterim(""); setElapsed(0);
    setProcessing(false); setStreamText(""); setRecordError("");

    // Switch to record screen FIRST so user sees something immediately
    setRecording(true);
    setScreen("record");

    // Request mic
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = stream;
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser(); analyser.fftSize = 64;
        src.connect(analyser); analyserRef.current = analyser;
      } catch { /* waveform optional */ }
    } catch {
      setRecording(false);
      setScreen("home");
      alert("Microphone access denied. Please allow microphone access and try again.");
      return;
    }

    // Wake lock - keep screen on
    try { if (navigator.wakeLock) wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch {}

    // Start timer
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);

    // Deepgram WebSocket - only if key exists
    if (!dgKey.trim()) return;

    try {
      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&diarize=true&interim_results=true&language=en-US&filler_words=false`,
        ["token", dgKey.trim()]
      );
      wsRef.current = ws;

      ws.onopen = () => {
        try {
          const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus" : "audio/webm";
          const recorder = new MediaRecorder(stream, { mimeType });
          recorder.ondataavailable = e => {
            if (ws.readyState === WebSocket.OPEN && e.data.size > 0) ws.send(e.data);
          };
          recorder.start(200);
          mediaRef.current._recorder = recorder;
        } catch (e) { console.error("MediaRecorder error:", e); }
      };

      ws.onmessage = msg => {
        try {
          const data = JSON.parse(msg.data);
          const alt = data?.channel?.alternatives?.[0];
          if (!alt?.transcript) return;
          if (data.is_final) {
            transcriptRef.current += alt.transcript + " ";
            setTranscript(t => transcriptRef.current);
            setInterim("");
          } else {
            setInterim(alt.transcript);
          }
        } catch { /* skip */ }
      };

      ws.onerror = (e) => {
        console.error("Deepgram WS error:", e);
        setRecordError("Deepgram connection failed. Check your API key in Settings.");
      };

      ws.onclose = (e) => {
        if (e.code !== 1000) {
          console.warn("WS closed unexpectedly:", e.code, e.reason);
        }
      };
    } catch (e) {
      console.error("WebSocket creation failed:", e);
      setRecordError("WebSocket failed: " + e.message);
    }
  }, [dgKey, cleanupRecording]);

  const stopRecording = useCallback(async () => {
    setRecording(false);
    cleanupRecording();
    const text = transcriptRef.current.trim();
    if (text) await processTranscript(text, elapsed);
    else setScreen("home");
  }, [elapsed, cleanupRecording]);

  const processTranscript = async (text, dur) => {
    setProcessing(true);
    setTab("summary");
    setScreen("meeting");

    // Save draft immediately so we can show the meeting screen
    const draft = await sb.insert("noteflow_meetings", {
      title: "Analyzing…",
      transcript: text,
      duration_seconds: dur,
      meeting_type: meetingType,
    }).catch(() => null);

    if (draft) {
      setActiveMeeting({ ...draft, title: "Analyzing…", action_items: [], insights: [], speakers: [] });
      setMeetings(prev => [{ ...draft, title: "Analyzing…", action_items: [], insights: [], speakers: [] }, ...prev]);
    }

    let parsed = {};
    try {
      parsed = await analyzeWithClaude(text, chunk => setStreamText(chunk));
    } catch (e) {
      parsed = {
        title: `Meeting – ${fmt.date(Date.now())}`,
        summary: "Analysis failed. Please check your Anthropic API connection.",
        action_items: [], insights: [], speakers: [],
      };
    }

    const updates = {
      title:        parsed.title        || "Untitled Meeting",
      summary:      parsed.summary      || "",
      action_items: parsed.action_items || [],
      insights:     parsed.insights     || [],
      speakers:     parsed.speakers     || [],
    };

    if (draft?.id) {
      await sb.update("noteflow_meetings", draft.id, updates).catch(() => {});
      const full = { ...draft, ...updates, transcript: text, duration_seconds: dur };
      setActiveMeeting(full);
      setMeetings(prev => prev.map(m => m.id === draft.id ? full : m));
    }

    setStreamText(""); setProcessing(false);
  };

  const submitPaste = async () => {
    const text = pasteText.trim();
    if (!text) return;
    transcriptRef.current = text;
    setTranscript(text); setPasteText("");
    await processTranscript(text, 0);
  };

  const openMeeting = m => {
    setActiveMeeting(m); setTranscript(m.transcript || "");
    setTab("summary"); setScreen("meeting");
  };

  const deleteMeeting = async id => {
    await sb.remove("noteflow_meetings", id);
    setMeetings(prev => prev.filter(m => m.id !== id));
    setDeleteConfirm(null);
    if (activeMeeting?.id === id) { setActiveMeeting(null); setScreen("home"); }
  };

  const saveTitle = async () => {
    setEditingTitle(false);
    if (!activeMeeting || titleVal === activeMeeting.title) return;
    await sb.update("noteflow_meetings", activeMeeting.id, { title: titleVal });
    const updated = { ...activeMeeting, title: titleVal };
    setActiveMeeting(updated);
    setMeetings(prev => prev.map(m => m.id === activeMeeting.id ? updated : m));
  };

  const copyMeeting = () => {
    const m = activeMeeting; if (!m) return;
    const txt = [
      `# ${m.title}`,
      `${fmt.date(m.created_at)} · ${fmt.time(m.created_at)}${m.duration_seconds > 0 ? ` · ${fmt.dur(m.duration_seconds)}` : ""}`,
      `Type: ${TYPES.find(t => t.id === m.meeting_type)?.label || "Meeting"}`, "",
      "## Summary", m.summary || "", "",
      "## Action Items", ...(m.action_items || []).map(a => `- ${a}`), "",
      "## Key Insights", ...(m.insights || []).map(i => `• ${i}`), "",
      "## Transcript", m.transcript || "",
    ].join("\n");
    navigator.clipboard.writeText(txt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const saveKey = () => {
    const k = keyInput.trim();
    localStorage.setItem("dg_key", k);
    setDgKey(k); setKeySaved(true);
    setTimeout(() => { setKeySaved(false); setScreen("home"); }, 800);
  };

  // ── Shared styles ─────────────────────────────────────────────────────────
  const btn = (active, extra = {}) => ({
    border: `1px solid ${active ? C.goldBorder : C.border}`,
    background: active ? C.goldDim : C.surface,
    color: active ? C.gold : C.muted,
    borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
    transition: "all 0.15s", ...extra,
  });

  const goldBtn = (disabled = false) => ({
    width: "100%", padding: "15px", borderRadius: 13, border: "none",
    background: disabled ? C.surface : "linear-gradient(135deg, #b4975a, #7a5c10)",
    color: disabled ? C.dim : "#f5f0e8",
    cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
    fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
    boxShadow: disabled ? "none" : "0 4px 24px rgba(180,151,90,0.25)",
    transition: "all 0.2s",
  });

  // ── HOME ──────────────────────────────────────────────────────────────────
  const HomeScreen = () => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%",  }}>
      {/* Header */}
      <div style={{ padding: "18px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.6px", color: "#f0ede8", fontFamily: "'DM Sans', sans-serif" }}>NoteFlow</div>
          <div style={{ fontSize: 11, color: "#cccccc", marginTop: 1, letterSpacing: "0.3px" }}>AI Meeting Notes · Anna Maria Island</div>
        </div>
        <button onClick={() => { setKeyInput(dgKey); setScreen("settings"); }}
          style={{ ...btn(!dgKey), width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
            background: dgKey ? "rgba(74,222,128,0.08)" : "rgba(239,68,68,0.12)",
            border: `1px solid ${dgKey ? "rgba(74,222,128,0.25)" : "rgba(239,68,68,0.3)"}`,
            color: dgKey ? "#4ade80" : "#ef4444" }}>
          <Icons.Key />
        </button>
      </div>

      {/* Meeting type */}
      <div style={{ padding: "0 20px 14px" }}>
        <div style={{ fontSize: 10, color: "#cccccc", letterSpacing: "1px", fontWeight: 600, marginBottom: 8 }}>MEETING TYPE</div>
        <div style={{ display: "flex", gap: 8 }}>
          {TYPES.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setMeetingType(id)}
              style={{ ...btn(meetingType === id), flex: 1, padding: "9px 4px", display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <Icon />
              <span style={{ fontSize: 10, fontWeight: 500 }}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Input mode toggle */}
      <div style={{ padding: "0 20px 14px", display: "flex", gap: 8 }}>
        {[["mic", <Icons.Mic />, "Record"], ["paste", <Icons.Paste />, "Paste Text"]].map(([mode, icon, label]) => (
          <button key={mode} onClick={() => setInputMode(mode)}
            style={{ ...btn(inputMode === mode), flex: 1, padding: "10px", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
            {icon}{label}
          </button>
        ))}
      </div>

      {/* CTA */}
      <div style={{ padding: "0 20px 20px" }}>
        {inputMode === "mic" ? (
          <button onClick={startRecording} style={goldBtn(!dgKey)}>
            <Icons.Mic />
            {dgKey ? "Start Recording" : "Add Deepgram Key to Record →"}
          </button>
        ) : (
          <>
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
              placeholder="Paste your transcript here…"
              style={{ width: "100%", height: 90, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", color: "#ffffff", fontSize: 13, fontFamily: "'DM Mono', monospace", resize: "none", lineHeight: 1.6, marginBottom: 8 }} />
            <button onClick={submitPaste} disabled={!pasteText.trim()} style={goldBtn(!pasteText.trim())}>
              <Icons.Sparkle /> Analyze with AI
            </button>
          </>
        )}
      </div>

      {/* Meetings list */}
      <div style={{ flex: 1, overflowY: "auto", borderTop: `1px solid ${C.border}` }}>
        <div style={{ padding: "12px 20px 6px", fontSize: 10, color: "#cccccc", letterSpacing: "1px", fontWeight: 600 }}>
          RECENT MEETINGS {!loading && meetings.length > 0 && `(${meetings.length})`}
        </div>

        {loading ? (
          <div style={{ padding: "24px", display: "flex", justifyContent: "center" }}><Spinner /></div>
        ) : meetings.length === 0 ? (
          <div style={{ padding: "24px 20px", color: "#bbbbbb", fontSize: 13, textAlign: "center", lineHeight: 1.8 }}>
            No meetings yet.<br />Record your first meeting above.
          </div>
        ) : meetings.map(m => (
          <div key={m.id} onClick={() => openMeeting(m)}
            style={{ padding: "13px 20px", borderBottom: `1px solid rgba(255,255,255,0.03)`, cursor: "pointer", transition: "background 0.1s", display: "flex", gap: 12, alignItems: "flex-start" }}
            onTouchStart={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
            onTouchEnd={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>{m.title}</div>
              <div style={{ display: "flex", gap: 8, fontSize: 11, color: "#cccccc", flexWrap: "wrap" }}>
                <span>{fmt.date(m.created_at)}</span>
                {m.duration_seconds > 0 && <span>· {fmt.dur(m.duration_seconds)}</span>}
                {m.action_items?.length > 0 && <span>· {m.action_items.length} actions</span>}
                <span style={{ color: "#bbbbbb", opacity: 0.7 }}>· {TYPES.find(t => t.id === m.meeting_type)?.label || "Meeting"}</span>
              </div>
            </div>
            <Icons.Chevron />
          </div>
        ))}
      </div>
    </div>
  );

  // ── RECORD ────────────────────────────────────────────────────────────────
  const RecordScreen = () => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%",  }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => { if (recording) stopRecording(); else setScreen("home"); }}
          style={{ background: "none", border: "none", color: "#ffffff", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13, padding: "4px 0" }}>
          <Icons.Back /> {recording ? "Stop & Save" : "Back"}
        </button>
        {recording && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.red }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.red, animation: "blink 1s step-end infinite" }} />
            LIVE
          </div>
        )}
      </div>

      {/* Timer */}
      <div style={{ textAlign: "center", padding: "12px 20px 8px" }}>
        <div style={{ fontSize: 56, fontFamily: "'DM Mono', monospace", fontWeight: 300, letterSpacing: "-2px", color: recording ? "#ffd060" : "#aaaaaa", lineHeight: 1 }}>
          {fmt.dur(elapsed)}
        </div>
        <div style={{ fontSize: 11, color: "#cccccc", marginTop: 6, letterSpacing: "0.8px" }}>
          {TYPES.find(t => t.id === meetingType)?.label.toUpperCase()} {recording ? "· RECORDING" : "· STOPPED"}
        </div>
      </div>

      {/* Waveform */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2.5, padding: "12px 20px", height: 60 }}>
        {bars.map((h, i) => (
          <div key={i} style={{
            width: 3.5, borderRadius: 2, height: h,
            background: recording ? `rgba(201,168,76,${0.25 + (h / 36) * 0.75})` : "rgba(255,255,255,0.07)",
            transition: recording ? "height 0.08s ease" : "none",
          }} />
        ))}
      </div>

      {/* Live transcript */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 16px" }}>
        <div style={{ fontSize: 10, color: "#cccccc", letterSpacing: "1px", fontWeight: 600, marginBottom: 10 }}>LIVE TRANSCRIPT</div>
        {recordError ? (
          <div style={{ padding: "12px", borderRadius: 10, background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", fontSize: 13, lineHeight: 1.6 }}>
            ⚠️ {recordError}
          </div>
        ) : !transcript && !interim && recording && (
          <div style={{ color: "#cccccc", fontSize: 14 }}>Listening — start speaking…</div>
        )}
        <div style={{ fontSize: 14, color: "#ffffff", lineHeight: 1.85, fontFamily: "'DM Mono', monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {transcript}
          <span style={{ color: C.gold, opacity: 0.6 }}>{interim}</span>
          {recording && <span style={{ display: "inline-block", width: 2, height: 14, background: C.gold, marginLeft: 3, animation: "blink 1s step-end infinite", verticalAlign: "middle" }} />}
        </div>
        <div ref={transcriptEnd} />
      </div>

      {/* Stop button */}
      {recording && (
        <div style={{ padding: "12px 20px 20px" }}>
          <button onClick={stopRecording} style={{ ...goldBtn(false), background: "linear-gradient(135deg, #dc2626, #991b1b)", boxShadow: "0 4px 24px rgba(220,38,38,0.3)" }}>
            <Icons.Stop /> Stop & Analyze
          </button>
        </div>
      )}

      {!recording && processing && (
        <div style={{ padding: "16px 20px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: C.gold, fontSize: 14 }}>
          <Spinner /> Analyzing with Claude…
        </div>
      )}
    </div>
  );

  // ── MEETING ───────────────────────────────────────────────────────────────
  const MeetingScreen = () => {
    const m = activeMeeting;
    if (!m) return null;
    const tabs = [
      ["summary",    "Summary"],
      ["actions",    `Actions${m.action_items?.length ? ` (${m.action_items.length})` : ""}`],
      ["insights",   "Insights"],
      ["transcript", "Transcript"],
    ];
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%",  }}>
        {/* Header */}
        <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
            <button onClick={() => setScreen("home")} style={{ background: "none", border: "none", color: "#ffffff", cursor: "pointer", padding: "3px 6px 3px 0" }}>
              <Icons.Back />
            </button>
            {editingTitle ? (
              <input ref={titleInputRef} value={titleVal} onChange={e => setTitleVal(e.target.value)}
                onBlur={saveTitle} onKeyDown={e => e.key === "Enter" && saveTitle()}
                style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.goldBorder}`, borderRadius: 7, padding: "5px 8px", color: "#f0ede8", fontFamily: "inherit", fontSize: 15, fontWeight: 600 }} />
            ) : (
              <div onClick={() => { if (!processing) { setTitleVal(m.title); setEditingTitle(true); setTimeout(() => titleInputRef.current?.focus(), 40); } }}
                style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "#ffffff", letterSpacing: "-0.3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: processing ? "default" : "text" }}>
                {m.title}
              </div>
            )}
            <button onClick={copyMeeting} style={{ background: "none", border: "none", color: copied ? "#4ade80" : C.muted, cursor: "pointer", padding: "3px" }}>
              {copied ? <Icons.Check /> : <Icons.Copy />}
            </button>
            <button onClick={() => setDeleteConfirm(m.id)} style={{ background: "none", border: "none", color: "#ffffff", cursor: "pointer", padding: "3px" }}>
              <Icons.Trash />
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#cccccc", paddingLeft: 28, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span>{fmt.date(m.created_at)} · {fmt.time(m.created_at)}</span>
            {m.duration_seconds > 0 && <span>· {fmt.dur(m.duration_seconds)}</span>}
            <span>· {TYPES.find(t => t.id === m.meeting_type)?.label}</span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0, overflowX: "auto" }}>
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: "11px 12px", fontSize: 12, fontFamily: "inherit", border: "none",
              background: "none", cursor: "pointer", whiteSpace: "nowrap",
              color: tab === key ? C.gold : C.dim,
              borderBottom: `2px solid ${tab === key ? C.gold : "transparent"}`,
              fontWeight: tab === key ? 600 : 400, transition: "all 0.15s",
            }}>{label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>

          {processing && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.gold, fontSize: 13, marginBottom: 16 }}>
              <Spinner size={14} /> Analyzing recording with Claude…
            </div>
          )}

          {tab === "summary" && (
            <div>
              {m.speakers?.length > 1 && (
                <div style={{ marginBottom: 16, padding: "10px 12px", borderRadius: 10, background: C.goldDim, border: `1px solid ${C.goldBorder}` }}>
                  <div style={{ fontSize: 10, color: "#cccccc", letterSpacing: "1px", fontWeight: 600, marginBottom: 6 }}>SPEAKERS DETECTED</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {m.speakers.map((s, i) => <span key={i} style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6, background: "rgba(201,168,76,0.15)", color: C.gold }}>{s}</span>)}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 10, color: "#cccccc", letterSpacing: "1px", fontWeight: 600, marginBottom: 10 }}>EXECUTIVE SUMMARY</div>
              <div style={{ fontSize: 15, color: "#ffffff", lineHeight: 1.78 }}>
                {m.summary || (processing ? "Generating summary…" : "No summary available.")}
              </div>
            </div>
          )}

          {tab === "actions" && (
            <div>
              <div style={{ fontSize: 10, color: "#cccccc", letterSpacing: "1px", fontWeight: 600, marginBottom: 12 }}>ACTION ITEMS</div>
              {!m.action_items?.length ? (
                <div style={{ color: "#bbbbbb", fontSize: 14 }}>{processing ? "Extracting actions…" : "No action items detected."}</div>
              ) : m.action_items.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "12px", borderRadius: 10, background: C.goldDim, border: `1px solid ${C.goldBorder}`, marginBottom: 8,  }}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid rgba(180,151,90,0.5)`, flexShrink: 0, marginTop: 1 }} />
                  <div style={{ fontSize: 14, color: "#ffffff", lineHeight: 1.55 }}>{a}</div>
                </div>
              ))}
            </div>
          )}

          {tab === "insights" && (
            <div>
              <div style={{ fontSize: 10, color: "#cccccc", letterSpacing: "1px", fontWeight: 600, marginBottom: 12 }}>KEY INSIGHTS</div>
              {!m.insights?.length ? (
                <div style={{ color: "#bbbbbb", fontSize: 14 }}>{processing ? "Extracting insights…" : "No insights extracted."}</div>
              ) : m.insights.map((ins, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "12px", borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, marginBottom: 8,  }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
                  <div style={{ fontSize: 14, color: "#ffffff", lineHeight: 1.55 }}>{ins}</div>
                </div>
              ))}
            </div>
          )}

          {tab === "transcript" && (
            <div>
              <div style={{ fontSize: 10, color: "#cccccc", letterSpacing: "1px", fontWeight: 600, marginBottom: 12 }}>FULL TRANSCRIPT</div>
              <div style={{ fontSize: 13, color: "#b0a080", lineHeight: 1.9, fontFamily: "'DM Mono', monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {m.transcript || "No transcript available."}
              </div>
            </div>
          )}
        </div>

        {/* Delete confirm sheet */}
        {deleteConfirm === m.id && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "flex-end", zIndex: 100 }}
            onClick={() => setDeleteConfirm(null)}>
            <div style={{ width: "100%", background: "#1a1510", borderRadius: "16px 16px 0 0", padding: "24px 20px 36px" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#ffffff", marginBottom: 8 }}>Delete this meeting?</div>
              <div style={{ fontSize: 13, color: "#c8b8a0", marginBottom: 20 }}>This will permanently remove the recording and all notes from Supabase.</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setDeleteConfirm(null)} style={{ ...btn(false), flex: 1, padding: "12px", fontSize: 14, fontWeight: 500 }}>Cancel</button>
                <button onClick={() => deleteMeeting(m.id)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "#dc2626", color: "white", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── SETTINGS ──────────────────────────────────────────────────────────────
  const SettingsScreen = () => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "20px",  }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <button onClick={() => setScreen("home")} style={{ background: "none", border: "none", color: "#ffffff", cursor: "pointer" }}><Icons.Back /></button>
        <div style={{ fontSize: 18, fontWeight: 600, color: "#ffffff" }}>Settings</div>
      </div>

      <div style={{ fontSize: 10, color: "#cccccc", letterSpacing: "1px", fontWeight: 600, marginBottom: 10 }}>DEEPGRAM API KEY</div>
      <div style={{ fontSize: 13, color: "#bbbbbb", lineHeight: 1.65, marginBottom: 14 }}>
        Required for live transcription. Free account at{" "}
        <a href="https://deepgram.com" target="_blank" rel="noreferrer" style={{ color: C.gold, textDecoration: "none" }}>deepgram.com</a>
        {" "}— includes $200 free credits (~45,000 min).
      </div>
      <input value={keyInput} onChange={e => setKeyInput(e.target.value)} type="password"
        placeholder="Paste your Deepgram API key…"
        style={{ width: "100%", padding: "13px 14px", borderRadius: 10, border: `1px solid ${keyInput ? C.goldBorder : C.border}`, background: C.surface, color: "#ffffff", fontFamily: "'DM Mono', monospace", fontSize: 13, marginBottom: 10 }} />
      <button onClick={saveKey} disabled={!keyInput.trim()} style={goldBtn(!keyInput.trim())}>
        {keySaved ? <><Icons.Check /> Saved!</> : <><Icons.Check /> Save Key</>}
      </button>

      {dgKey && (
        <div style={{ marginTop: 14, padding: "10px 13px", borderRadius: 10, background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)", display: "flex", alignItems: "center", gap: 8 }}>
          <Icons.Check /> <span style={{ fontSize: 12, color: "#4ade80" }}>API key saved and active</span>
        </div>
      )}

      <div style={{ marginTop: 28, padding: "14px", borderRadius: 10, background: C.surface, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 10, color: "#cccccc", letterSpacing: "1px", fontWeight: 600, marginBottom: 8 }}>STACK</div>
        <div style={{ fontSize: 12, color: "#bbbbbb", lineHeight: 1.8 }}>
          🎙 Deepgram Nova-2 — real-time transcription + speaker diarization<br />
          🤖 Claude Sonnet — summaries, actions, insights<br />
          🗄 Supabase beach-life-ops — persistent meeting storage<br />
          📱 PWA — add to iPhone home screen
        </div>
      </div>
    </div>
  );

  // ── Shell ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: "100%", maxWidth: 430, margin: "0 auto",
      height: "100vh", height: "100dvh",
      background: "#1a1a1a", color: "#ffffff",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      display: "flex", flexDirection: "column",
      position: "relative", overflow: "hidden",
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');`}</style>



      <div style={{ flex: 1, overflowY: "auto" }}>
        {screen === "home"     && <HomeScreen />}
        {screen === "record"   && <RecordScreen />}
        {screen === "meeting"  && <MeetingScreen />}
        {screen === "settings" && <SettingsScreen />}
      </div>
    </div>
  );
}
