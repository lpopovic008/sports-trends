import React, { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, ReferenceLine,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

/* ───────────────────────────── palette ─────────────────────────────
   Box-score / stat-sheet identity. Cool newsprint paper, ink-black
   tabular numerals, hairline rules like a ruled scorecard. Signature:
   a literal highlighter swipe behind every game that matches a trend. */
const C = {
  paper:"#E2E5EA", card:"#F8F9FA", ink:"#14181F", inkSoft:"#525A66",
  rule:"#CDD3DA", ruleDark:"#9AA3AD", marker:"#FFE94D", markerDeep:"#F4CE2A",
  over:"#1B7F5C", under:"#D7263D", blue:"#2B4C7E",
  /* indicator colors — a neon graffiti set, ordered so each swatch sits
     next to its nearest hue on the color wheel */
  boom:"#FF073A",          /* neon red: hot bats, 10+ hits last game */
  slump:"#0FF0FC",         /* neon cyan: cold bats, 6 or fewer hits last game */
  rematch:"#16A2DF",       /* neon blue: chess-move pitcher */
  rematchLight:"#A9E1F7",  /* light neon blue: faced but short outing */
  travel:"#8B5CF6",        /* neon violet: jet-lagged west→east */
  late:"#FF8C1A",          /* neon orange: clutch late-night drama */
  bigday:"#F4289B",        /* neon pink: 10-run scoreboard explosion */
  echo:"#A0EE26",          /* neon lime: momentum wave */
};
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
// self-hosted black-marker display font used only for the exported picture text
const MARKER = "'Permanent Marker', system-ui, sans-serif";
const API = "https://statsapi.mlb.com/api/v1";
const SEASON = new Date().getFullYear();

// Global notes via JSONBin.io — free, allows browser reads + writes.
// SETUP: step 1 — jsonbin.io → sign up → API Keys → copy your Access Key
//           with Read + Update enabled. step 2 — Create Bin with contents {"text":""},
//           copy the Bin ID from its URL.
// Paste both below. Leave NOTES_BIN empty to keep notes per-device only.
const NOTES_BIN = "6a43cd2bf5f4af5e2947d66d";   // e.g. 65a1b2c3dc74654018abcd12
const NOTES_KEY = "$2a$10$EzB/eCQ9ZvPSCyKLss3TxO/fUj0dDmaDEvWEphLhD6eQ7ivrryUVG";   // your JSONBin Access Key, sent as X-Access-Key
const NOTES_URL = NOTES_BIN ? `https://api.jsonbin.io/v3/b/${NOTES_BIN}` : "";

/* MLB home-park time zones for travel detection */
const TEAM_TZ = {
  108:"PT",109:"MT",110:"ET",111:"ET",112:"CT",113:"ET",114:"ET",115:"MT",
  116:"ET",117:"CT",118:"CT",119:"PT",120:"ET",121:"ET",133:"PT",134:"ET",
  135:"PT",136:"PT",137:"PT",138:"CT",139:"ET",140:"CT",141:"ET",142:"CT",
  143:"ET",144:"ET",145:"CT",146:"ET",147:"ET",158:"CT",
};
const TZ_RANK = { PT:0, MT:1, CT:2, ET:3 };
const TEAM_ABBR = {
  108:"LAA",109:"ARI",110:"BAL",111:"BOS",112:"CHC",113:"CIN",114:"CLE",115:"COL",
  116:"DET",117:"HOU",118:"KC",119:"LAD",120:"WSH",121:"NYM",133:"ATH",134:"PIT",
  135:"SD",136:"SEA",137:"SF",138:"STL",139:"TB",140:"TEX",141:"TOR",142:"MIN",
  143:"PHI",144:"ATL",145:"CWS",146:"MIA",147:"NYY",158:"MIL",
};
const TEAM_NAME = {
  108:"Angels",109:"Diamondbacks",110:"Orioles",111:"Red Sox",112:"Cubs",113:"Reds",
  114:"Guardians",115:"Rockies",116:"Tigers",117:"Astros",118:"Royals",119:"Dodgers",
  120:"Nationals",121:"Mets",133:"Athletics",134:"Pirates",135:"Padres",136:"Mariners",
  137:"Giants",138:"Cardinals",139:"Rays",140:"Rangers",141:"Blue Jays",142:"Twins",
  143:"Phillies",144:"Braves",145:"White Sox",146:"Marlins",147:"Yankees",158:"Brewers",
};
const HIT_STATS = [
  ["hits","Hits"],["totalBases","Total Bases"],["homeRuns","Home Runs"],
  ["rbi","RBIs"],["runs","Runs"],["baseOnBalls","Walks"],
  ["strikeOuts","Strikeouts"],["stolenBases","Stolen Bases"],
  ["doubles","Doubles"],["hits+runs+rbi","Hits+Runs+RBI"],
];

const todayISO = () => {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
};
const addDays = (iso,n) => {
  const d = new Date(iso+"T00:00:00"); d.setDate(d.getDate()+n);
  return d.toISOString().slice(0,10);
};
const prettyDay = (iso) =>
  new Date(iso+"T00:00:00").toLocaleDateString(undefined,
    { weekday:"short", month:"short", day:"numeric" });
const calDay = (iso) => {
  const d = new Date(iso+"T00:00:00");
  return { wd: d.toLocaleDateString(undefined,{weekday:"short"}),
    md: `${d.getMonth()+1}/${d.getDate()}` };
};

const valOf = (stat,key) =>
  key.split("+").reduce((s,k)=>s+(Number(stat[k])||0),0);

/* throttled async map so we don't fire hundreds of calls at once */
async function mapPool(items, n, fn) {
  const res = []; let i = 0;
  const workers = Array.from({length:Math.min(n,items.length)}, async () => {
    while (i < items.length) { const idx = i++; res[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers); return res;
}
const isNet = (m) => /Failed to fetch|NetworkError/i.test(m);
// MLB innings-pitched is reported in tenths standing for thirds ("6.1" =
// 6 innings + 1 out, "6.2" = +2 outs) — convert to a plain out count so
// workloads can be compared precisely instead of as a fake decimal.
const ipToOuts = (ip) => {
  const v = parseFloat(ip) || 0;
  const whole = Math.floor(v), frac = Math.round((v-whole)*10);
  return whole*3 + frac;
};
// season-average workload/rate context used to color an individual start:
// average outs per start, hits/walks per 9 innings, and ERA.
function pitcherSeasonAverages(splits) {
  if (!splits || !splits.length) return null;
  const sum = (k) => splits.reduce((s,g)=>s+(Number(g.stat?.[k])||0),0);
  const outs = splits.reduce((s,g)=>s+ipToOuts(g.stat?.inningsPitched), 0);
  if (!outs) return null;
  return {
    avgOuts: outs/splits.length,
    h9: sum("hits")*27/outs,
    bb9: sum("baseOnBalls")*27/outs,
    k9: sum("strikeOuts")*27/outs,
    era: sum("earnedRuns")*27/outs,
  };
}
// colors one pitcher start's IP/H/ER/BB/K line relative to the pitcher's own
// season pace (or fixed fallback thresholds if no season data exists yet).
// Shared by PLine's rendering and the pitcher-rematch trend indicator, which
// counts how many of these came back green vs red for a thumbs up/down.
function pitcherLineColors(st, season) {
  const col = (good, bad) => good ? C.over : bad ? C.under : C.ink;
  const outs = ipToOuts(st.inningsPitched);
  const h = Number(st.hits)||0, er = Number(st.earnedRuns)||0;
  const bb = Number(st.baseOnBalls)||0, k = Number(st.strikeOuts)||0;

  const ipCol = season
    ? col(outs > season.avgOuts+3, outs < season.avgOuts-3)
    : col(outs>=18, outs>0 && outs<12);

  // H/ER/BB/K: below a 2.0-inning outing (6 outs) the rate stats are too
  // noisy to judge against fixed benchmarks, so short outings still color
  // relative to the pitcher's own season pace (or the flat fallback, if no
  // season data exists yet). Longer outings use fixed per-9 benchmarks —
  // league-average-ish rates read as "bad" here since the goal is calling
  // out starts that were actually good, not just average.
  const SHORT_OUTING_OUTS = 6;   // 2.0 innings
  const longOuting = outs > SHORT_OUTING_OUTS;
  const rate9 = (n) => outs>0 ? n*27/outs : null;

  let hCol, bbCol, erCol, kCol;
  if (season && longOuting) {
    const h9 = rate9(h), bb9 = rate9(bb), era = rate9(er), k9 = rate9(k);
    hCol  = col(h9<=7.0, h9>=9.0);
    bbCol = col(bb9<=2.0, bb9>=4.0);
    erCol = col(era<=3.0, era>=4.0);
    kCol  = col(k9>=9.0, k9<=6.0);
  } else {
    const expH = season ? season.h9 * outs/27 : null;
    hCol = expH!=null ? col(h<=expH-1.5, h>=expH+1.5) : col(h<=3, h>=5);
    const expBB = season ? season.bb9 * outs/27 : null;
    bbCol = expBB!=null ? col(bb<=expBB-1, bb>=expBB+1) : col(bb<=1, bb>=3);
    const gameERA = outs>0 ? er*27/outs : null;
    erCol = (gameERA!=null && season)
      ? col(gameERA<=season.era-1, gameERA>=season.era+1)
      : col(er<=1, er>3);
    const expK = season ? season.k9 * outs/27 : null;
    kCol = expK!=null ? col(k>=expK+2, k<=expK-2) : col(k>=5, k<=3);
  }
  return { ipCol, hCol, erCol, bbCol, kCol };
}
const ord = (n) => n + (["th","st","nd","rd"][(n%100>>3^1&&n%10)||0] || "th");
// tags may be an old plain string or the new { text, away, home, date } object
const tagText = (entry) => !entry ? "" : (typeof entry === "string" ? entry : (entry.text || ""));
// settled-bet tint for a tagged game's exported background: W/L/P -> color, else null
const RESULT_BG = { W:"rgba(27,127,92,0.20)", L:"rgba(215,38,61,0.18)", P:"rgba(43,76,126,0.18)" };
const tagResultBg = (entry) => {
  const result = entry && typeof entry === "object" ? entry.result : null;
  return result ? RESULT_BG[result] : null;
};
const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" }); } catch { return ""; } };

// Draw the play call as red marker handwriting directly on the game — no
// background box — angled like it was scrawled on, vertically centered
// at (cx,cy) and shrunk to fit maxW if needed.
function drawRedTag(x, text, cx, cy, maxW, fontSize = 15) {
  if (!text) return;
  x.save();
  x.font = `400 ${fontSize}px ${MARKER}`;
  const rawW = x.measureText(text).width;
  const scale = rawW > maxW ? maxW / rawW : 1;
  x.translate(cx, cy);
  x.rotate(-4 * Math.PI/180);
  x.scale(scale, scale);
  x.fillStyle = "#D7263D";
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(text, 0, 0);
  x.restore();
}

// Copy a canvas to the clipboard as PNG. Called synchronously in the click
// handler and hands ClipboardItem a Promise<Blob> so the browser keeps the
// user-gesture context (Safari/iOS require this). Falls back to download.
// setStatus(code): "ok" | "dl" | "err".
function copyCanvas(cv, filename, setStatus) {
  const done = (s)=>{ setStatus(s); setTimeout(()=>setStatus(null), 2000); };
  const blobPromise = new Promise((resolve, reject)=>{
    cv.toBlob(b => b ? resolve(b) : reject(new Error("no blob")), "image/png");
  });
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      navigator.clipboard.write([ new window.ClipboardItem({ "image/png": blobPromise }) ])
        .then(()=>done("ok"))
        .catch(()=>{ blobPromise.then(b=>downloadBlob(b, filename)).then(()=>done("dl")).catch(()=>done("err")); });
    } else {
      blobPromise.then(b=>downloadBlob(b, filename)).then(()=>done("dl")).catch(()=>done("err"));
    }
  } catch { blobPromise.then(b=>downloadBlob(b, filename)).then(()=>done("dl")).catch(()=>done("err")); }
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// shared per-game tag store (global via JSONBin, local cache via localStorage).
// Returns { tags, tagStatus, setTag, setResult }.
function useTags() {
  const [tags, setTags] = useState({});
  const [tagStatus, setTagStatus] = useState(NOTES_URL ? "loading" : "local");
  const tagTimer = useRef(null);

  useEffect(() => {
    let alive = true;
    try { const c = window.localStorage.getItem("ts-tags"); if (c!=null) setTags(JSON.parse(c)||{}); } catch {}
    if (!NOTES_URL) return;
    (async () => {
      try {
        const r = await fetch(NOTES_URL + "/latest",
          { headers:{ "X-Master-Key":NOTES_KEY, "X-Access-Key":NOTES_KEY } });
        const j = await r.json();
        if (!alive) return;
        const stored = j?.record?.tags;
        if (stored && typeof stored === "object") {
          setTags(stored);
          try { window.localStorage.setItem("ts-tags", JSON.stringify(stored)); } catch {}
        }
        setTagStatus("saved");
      } catch { if (alive) setTagStatus("error"); }
    })();
    return () => { alive = false; };
  }, []);

  const persist = (next) => {
    try { window.localStorage.setItem("ts-tags", JSON.stringify(next)); } catch {}
    if (!NOTES_URL) return;
    setTagStatus("saving");
    if (tagTimer.current) clearTimeout(tagTimer.current);
    tagTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(NOTES_URL, { method:"PUT",
          headers:{ "Content-Type":"application/json",
            "X-Master-Key":NOTES_KEY, "X-Access-Key":NOTES_KEY },
          body:JSON.stringify({ tags:next }) });
        setTagStatus(r.ok ? "saved" : "error");
      } catch { setTagStatus("error"); }
    }, 700);
  };

  // setTag(game, text): create/update/remove a tag, keeping a self-describing snapshot
  const setTag = (game, text) => {
    setTags(prev => {
      const next = { ...prev };
      const v = (text||"").trim();
      if (v) {
        const existing = (typeof prev[game.gamePk] === "object") ? prev[game.gamePk] : {};
        next[game.gamePk] = { ...existing, text:v, away:game.awayName, home:game.homeName,
          awayId:game.awayId, homeId:game.homeId, time:game.time||"",
          date: game.gameDay || (game.time||"").slice(0,10) || "" };
      } else {
        delete next[game.gamePk];
      }
      persist(next);
      return next;
    });
  };

  // setResult(gamePk, "W"|"L"|null): mark or clear a win/loss on an existing tag
  const setResult = (gamePk, result) => {
    setTags(prev => {
      const entry = prev[gamePk];
      if (!entry) return prev;
      const obj = typeof entry === "string" ? { text:entry } : { ...entry };
      if (result) obj.result = result; else delete obj.result;
      const next = { ...prev, [gamePk]:obj };
      persist(next);
      return next;
    });
  };

  return { tags, tagStatus, setTag, setResult };
}

/* streak echo: a team that just snapped a long W or L streak. `results` is
   [{date,res:"W"|"L"}]. Returns the broken streak's length/result plus the
   "predicted" repeat (the result that ended the streak), or null. */
function detectStreakBreak(results, minLen) {
  if (!results || results.length < minLen + 1) return null;
  const r = results.slice().sort((a,b)=>a.date.localeCompare(b.date));
  const lastRes = r[r.length-1].res;              // the game that broke the streak
  // count the run of the OPPOSITE result immediately before the last game
  const prior = lastRes === "W" ? "L" : "W";
  let streakLen = 0;
  for (let i=r.length-2; i>=0; i--){
    if (r[i].res === prior) streakLen++; else break;
  }
  if (streakLen < minLen) return null;
  return { streakLen, streakRes: prior, predicted: lastRes };
}

/* late go-ahead: winner first took the lead in the 8th inning or later.
   `ls` is an MLB linescore; winnerSide is "home"|"away". Returns
   {firstLeadInning} or null. */
function detectLateComeback(ls, winnerSide) {
  const innings = ls?.innings || [];
  let homeCum = 0, awayCum = 0;
  for (const inn of innings) {
    homeCum += Number(inn.home?.runs)||0;
    awayCum += Number(inn.away?.runs)||0;
    const winnerAhead = winnerSide === "home" ? homeCum > awayCum : awayCum > homeCum;
    if (winnerAhead) {
      const num = inn.num || 0;
      return num >= 8 ? { firstLeadInning: num } : null;   // first lead must be 8th+
    }
  }
  return null;
}

/* ───────────────────────── shared UI bits ───────────────────────── */
const Eyebrow = ({ children, n }) => (
  <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:14 }}>
    {n && <span style={{ fontFamily:MONO, fontSize:12, color:C.ruleDark }}>{n}</span>}
    <span style={{ fontFamily:MONO, fontSize:11, letterSpacing:"0.18em",
      textTransform:"uppercase", color:C.inkSoft }}>{children}</span>
    <span style={{ flex:1, height:1, background:C.rule }} />
  </div>
);
const Field = ({ label, children }) => (
  <label style={{ display:"block" }}>
    <div style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.14em",
      textTransform:"uppercase", color:C.inkSoft, marginBottom:5 }}>{label}</div>
    {children}
  </label>
);
// iOS Safari zooms the page in on focus for any input/select with a
// computed font-size under 16px — keep it at 16 so focusing a field
// (the tag editor, the prop-analyzer fields) never triggers that zoom.
const inputStyle = {
  boxSizing:"border-box", padding:"9px 11px", border:`1px solid ${C.rule}`,
  borderRadius:2, background:"#fff", fontFamily:SANS, fontSize:16, color:C.ink, outline:"none",
};
const ErrBox = ({ children }) => (
  <div style={{ padding:"12px 14px", background:"#FCEBED", border:`1px solid ${C.under}`,
    borderRadius:2, color:C.under, fontFamily:SANS, fontSize:13, marginBottom:16 }}>{children}</div>
);
const Tag = ({ children, tone }) => (
  <span style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.06em", textTransform:"uppercase",
    padding:"1px 6px", borderRadius:2, border:`1px solid ${tone==="ok"?C.over:C.ruleDark}`,
    color: tone==="ok"?C.over:C.inkSoft }}>{children}</span>
);

const ROW_COLS = "14px minmax(36px,1fr) 30px 60px 9px 60px 9px 60px";
const SEP = <span style={{ textAlign:"center", fontFamily:MONO, fontSize:12,
  color:C.ruleDark, fontWeight:700 }}>|</span>;

const CAT = {
  ht: (v)=> v===0 ? "r" : v>=2 ? "g" : "b",   // hits / total bases / HRR
};
function last3Same(arr, fn) {
  if (!arr || arr.length < 3) return null;
  const c = arr.slice(-3).map(fn);
  if (c.every(x=>x==="r")) return "r";
  if (c.every(x=>x==="g")) return "g";
  return null;
}
/* hot if ANY of H / TB / HRR has its last 3 all red or all green */
function nameStreak(p) {
  return [last3Same(p.h, CAT.ht), last3Same(p.tb, CAT.ht), last3Same(p.hrr, CAT.ht)]
    .some(x => x === "r" || x === "g");
}

/* one stat's last-5 as a fixed 5-cell grid; marked + clickable when 3-in-a-row */
function SeqBlock({ arr, label, onPick }) {
  const on = !!last3Same(arr, CAT.ht);
  const hue = (v)=> v===0 ? C.under : v>=2 ? C.over : C.ink;
  const vals = arr && arr.length ? arr : [null,null,null,null,null];
  const cells = (
    <span style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", width:"100%" }}>
      {vals.map((v,i)=>(
        <span key={i} style={{ textAlign:"center", fontFamily:MONO, fontSize:11,
          color: v==null ? C.ruleDark : hue(v) }}>{v==null ? "·" : v}</span>
      ))}
    </span>
  );
  const base = { display:"block", width:"100%", borderRadius:1, boxSizing:"border-box",
    ...(on ? { background:"rgba(255,233,77,0.65)", boxShadow:`inset 0 0 0 1px ${C.markerDeep}` } : {}) };
  if (onPick) {
    return <button onClick={onPick} title={`Analyze ${label} prop`}
      style={{ ...base, border:"none", padding:0, cursor:"pointer", font:"inherit" }}>{cells}</button>;
  }
  return <span style={base}>{cells}</span>;
}

/* ════════════════════ MY TRENDS (yesterday → +5 days) ════════════════════ */
function TravelTrends({ tags, setTag, onReady }) {
  const start = todayISO();                    // anchor: today
  const minStreak = 10;                        // fixed threshold
  const [days, setDays] = useState(null);
  const [echoes, setEchoes] = useState(null);
  const [comebacks, setComebacks] = useState(null);
  const [faced, setFaced] = useState({});      // pitcherId -> Set(opponent team ids)
  const [runsMap, setRunsMap] = useState({});  // teamId -> { date -> runs scored }
  const [hitsMap, setHitsMap] = useState({});  // teamId -> { date -> hits }
  const [modal, setModal] = useState(null);    // { date, g, t } of clicked game
  const [now, setNow] = useState(()=>new Date());
  useEffect(()=>{ const id=setInterval(()=>setNow(new Date()), 60000); return ()=>clearInterval(id); }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showIndicators, setShowIndicators] = useState(true);
  const westThreshold = TZ_RANK.MT;             // PT/MT count as "west"
  // situational-trend data (echoes/comebacks/rematches/big-day/slump-boom)
  // only needs to be pulled & computed once per day — tracks the date it was
  // last loaded for, so a manual refresh can skip straight past it and just
  // re-pull live scores/state instead of redoing all of that work every click.
  const indicatorsLoadedForRef = useRef(null);

  const load = useCallback(async () => {
    const needIndicators = indicatorsLoadedForRef.current !== start;
    // keep showing the current calendar while refreshing (setDays isn't
    // cleared here) so a manual refresh doesn't unmount the scroll
    // container and reset which day is in view
    setErr("");
    if (needIndicators) { setEchoes(null); setComebacks(null); setFaced({}); setRunsMap({}); setHitsMap({}); }
    setBusy(true);
    try {
      /* ── window schedule (travel + next-game lookup + probable pitchers) ──
         fetch from 3 days back so the -2 day's travel has a "prev day". */
      const from = addDays(start,-3), to = addDays(start,4);
      const r = await fetch(`${API}/schedule?sportId=1&startDate=${from}&endDate=${to}` +
        `&gameType=R&hydrate=probablePitcher,linescore(runners),lineups`);
      if (!r.ok) throw new Error(`schedule ${r.status}`);
      const j = await r.json();
      const byTeamDate = {};   // teamId -> { date -> venueTz }
      const dayGames = {};     // date -> [games]
      (j.dates||[]).forEach(d=>{
        dayGames[d.date] = [];
        (d.games||[]).forEach(g=>{
          const home=g.teams.home.team, away=g.teams.away.team;
          const venueTz = TEAM_TZ[home.id] ?? "?";
          const ap = g.teams.away.probablePitcher, hp = g.teams.home.probablePitcher;
          const isFinal = g.status?.abstractGameState==="Final";
          const isLive = g.status?.abstractGameState==="Live";
          dayGames[d.date].push({ homeId:home.id, homeName:home.name,
            awayId:away.id, awayName:away.name, venueTz, time:g.gameDate,
            gameDay: g.officialDate || d.date,
            awayPid:ap?.id, awayPname:ap?.fullName, homePid:hp?.id, homePname:hp?.fullName,
            isFinal, isLive,
            awayScore: g.teams.away.score, homeScore: g.teams.home.score,
            awayHits: g.linescore?.teams?.away?.hits, homeHits: g.linescore?.teams?.home?.hits,
            inningNum: g.linescore?.currentInning, inningState: g.linescore?.inningState,
            outs: g.linescore?.outs,
            onFirst: !!g.linescore?.offense?.first, onSecond: !!g.linescore?.offense?.second,
            onThird: !!g.linescore?.offense?.third,
            gamePk:g.gamePk, _raw:g,
            pair:[away.id,home.id].sort((x,y)=>x-y).join("-") });
          [home.id, away.id].forEach(tid=>{
            (byTeamDate[tid] = byTeamDate[tid]||{})[d.date] = venueTz; });
        });
      });

      const buildList = (date) => {
        const prev = addDays(date,-1);
        return (dayGames[date]||[]).map(g=>{
          const todayTz = TZ_RANK[g.venueTz], travelers=[];
          [["away",g.awayId,g.awayName],["home",g.homeId,g.homeName]].forEach(([,tid,tname])=>{
            const prevTz = TZ_RANK[byTeamDate[tid]?.[prev]];
            if (prevTz!=null && todayTz===TZ_RANK.ET && prevTz<=westThreshold)
              travelers.push({ teamId:tid, tname, from:byTeamDate[tid][prev], to:g.venueTz });
          });
          return { ...g, travelers, flagged:travelers.length>0 };
        }).sort((a,b)=>a.time.localeCompare(b.time));
      };

      // ── Calendar layout — wavefront ─────────────────────────────────
      // 1. Place today's games. Each becomes a seed: find every matching
      //    game (same matchup, 1 off-day gap tolerated) across all columns
      //    and lock it into that seed's row + color (navy/gray for today).
      // 2. Expand outward one column on each side. Any game there still
      //    without a home fills the lowest empty gap (white/gray) and itself
      //    becomes a seed — its matchups are found and locked into its row.
      // 3. Repeat outward (2 cols, 3 cols, 4 cols) until the edges.
      // ────────────────────────────────────────────────────────────────

      const TODAY_DI = 2;
      const DATES = [];
      for(let i=-2;i<=4;i++) DATES.push(addDays(start,i));
      const perDay = DATES.map(d=>buildList(d));   // sorted by start time
      const numDays = DATES.length;

      // who each team played each day (undefined if off)
      const oppByTeamDay = Array.from({length:numDays}, ()=>({}));
      perDay.forEach((games,di)=>games.forEach(g=>{
        oppByTeamDay[di][g.awayId] = g.homeId;
        oppByTeamDay[di][g.homeId] = g.awayId;
      }));
      // doubleheaders put two games on the same pair/day — dayByPair only
      // keeps one game per pair per day (it's the anchor used to continue a
      // series row across other days), so always prefer the non-makeup game
      // as that anchor; the other game still gets its own row below since
      // placement is tracked per game, not per pair.
      const isMakeup = (g) => /makeup/i.test(g._raw?.description || "");
      const dayByPair = perDay.map(games=>{
        const m={};
        games.forEach(g=>{
          const existing = m[g.pair];
          if (!existing || (isMakeup(existing) && !isMakeup(g))) m[g.pair]=g;
        });
        return m;
      });

      const grid   = Array.from({length:numDays}, ()=>[]);    // grid[di][row]=game|"RESV"|null
      const placed = Array.from({length:numDays}, ()=>({}));  // di -> gamePk -> true
      const RESV = "__reserved__";   // blocks a cell (series gap) but renders blank
      const putAt = (di,row,g,shade)=>{
        while(grid[di].length<=row) grid[di].push(null);
        grid[di][row]=g; placed[di][g.gamePk]=true; g.seriesShade=shade;
      };
      const reserve = (di,row)=>{     // hold a cell blank if it's currently free
        while(grid[di].length<=row) grid[di].push(null);
        if(grid[di][row]==null) grid[di][row]=RESV;
      };
      const isFree = (v)=> v===undefined || v===null;   // RESV is NOT free
      const nextFreeFrom = (di,row)=>{
        let r=row<0?0:row;
        while(!isFree(grid[di][r])) r++;
        return r;
      };

      // A series (awayId vs homeId) is continuous from day a to day b if
      // neither team faced a DIFFERENT opponent on any day strictly between.
      // (off days in between are allowed — they don't break the series.)
      const continuous = (awayId, homeId, a, b)=>{
        const lo=Math.min(a,b)+1, hi=Math.max(a,b)-1;
        for(let d=lo; d<=hi; d++){
          const ao=oppByTeamDay[d][awayId], ho=oppByTeamDay[d][homeId];
          if(ao!=null && ao!==homeId) return false;
          if(ho!=null && ho!==awayId) return false;
        }
        return true;
      };

      // place a seed game, then lock every matching game (gap-tolerant) into
      // the SAME row + shade across all columns. When a match sits across a
      // one-day (or longer) off-day gap, RESERVE that row on the in-between
      // off-days so no other game breaks the series line — the cell stays blank.
      const seed = (di, row, g, shade)=>{
        putAt(di, row, g, shade);
        for(let d=0; d<numDays; d++){
          if(d===di) continue;
          const match = dayByPair[d][g.pair];
          if(match && !placed[d][match.gamePk] && continuous(g.awayId, g.homeId, di, d)){
            const r = nextFreeFrom(d, row);   // prefer the seed's row
            putAt(d, r, match, shade);
            // reserve the same row on the off-days between di and d
            const lo=Math.min(di,d)+1, hi=Math.max(di,d)-1;
            for(let b=lo; b<=hi; b++){
              if(!dayByPair[b][g.pair]) reserve(b, r);   // pair is off that day → hold blank
            }
          }
        }
      };

      // ---- step 1: seed today's games (navy/gray), each propagates ----
      perDay[TODAY_DI].forEach((g,row)=>{
        if(placed[TODAY_DI][g.gamePk]) return;
        seed(TODAY_DI, row, g, 2 + (row%2));   // 2=navy, 3=darker-gray
      });

      // ---- steps 2+: expand outward; new gap-fills (white/gray) re-seed ----
      for(let radius=1; radius<=Math.max(TODAY_DI, numDays-1-TODAY_DI); radius++){
        for(const di of [TODAY_DI-radius, TODAY_DI+radius]){
          if(di<0 || di>=numDays) continue;
          perDay[di].forEach(g=>{
            if(placed[di][g.gamePk]) return;     // already locked by a seed
            const r = nextFreeFrom(di, 0);
            seed(di, r, g, 0 + (r%2));           // white/light-gray, and re-seed
          });
        }
      }

      // ---- trim trailing nulls per column; RESV cells become blank (null) ----
      const out = DATES.map((d,di)=>{
        const col = grid[di].map(c => c===RESV ? null : c);
        let last=-1; col.forEach((g,i)=>{ if(g) last=i; });
        return { date:d, games: last===-1 ? [] : col.slice(0,last+1) };
      });
      setDays(out);

      // situational-trend data already loaded for today — the refresh button
      // only needed live scores/state, so stop here and leave it alone.
      if (!needIndicators) return;

      /* ── streak-break echo: pull ~5 wks of finals, find snapped streaks ──
         include today so a trend that completes today (game just went final)
         is picked up on refresh and shows up on the team's next game. */
      const lbFrom = addDays(start,-35), lbTo = start;
      const lr = await fetch(`${API}/schedule?sportId=1&startDate=${lbFrom}&endDate=${lbTo}` +
        `&gameType=R&hydrate=linescore`);
      const lj = await lr.json();
      const finals = (lj.dates||[]).flatMap(d=>d.games||[])
        .filter(g=>g.status?.abstractGameState==="Final")
        .sort((a,b)=>a.gameDate.localeCompare(b.gameDate));
      const byTeamRes = {};    // teamId -> [{date,res}]
      const teamName = {};
      const runsByDate = {};   // teamId -> { date -> runs scored }
      const hitsByDate = {};   // teamId -> { date -> hits }
      finals.forEach(g=>{
        const gd = g.officialDate || g.gameDate.slice(0,10);
        ["home","away"].forEach(side=>{
          const t = g.teams[side];
          if (typeof t.isWinner !== "boolean") return;
          teamName[t.team.id] = t.team.name;
          (byTeamRes[t.team.id] = byTeamRes[t.team.id]||[])
            .push({ date:g.gameDate, res: t.isWinner ? "W":"L" });
          const runs = Number(t.score);
          if (!isNaN(runs)) {
            const m = runsByDate[t.team.id] = runsByDate[t.team.id]||{};
            m[gd] = Math.max(m[gd] ?? 0, runs);   // max if a doubleheader
          }
          const hits = Number(g.linescore?.teams?.[side]?.hits);
          if (!isNaN(hits)) {
            const hm = hitsByDate[t.team.id] = hitsByDate[t.team.id]||{};
            // finals is sorted chronologically, so on a doubleheader date the
            // later game (the actual "most recent" one) is processed last and
            // simply overwrites — not maxed against — the earlier game's hits
            hm[gd] = hits;
          }
        });
      });
      // (state set together at the end so all markers appear at once, in order)
      const echoList = [];
      Object.entries(byTeamRes).forEach(([tid, res])=>{
        const sig = detectStreakBreak(res, Number(minStreak)||10);
        if (!sig) return;
        // find this team's next game strictly after the streak-breaking result
        // (not from a fixed "today" — if that result was today's own game,
        // searching from today would re-attach the marker to that same game)
        const lastDate = res[res.length-1].date.slice(0,10);
        let found = null;
        for (let i=1;i<=5 && !found;i++){
          const date = addDays(lastDate,i);
          (dayGames[date]||[]).forEach(g=>{
            if (!found && (g.homeId===Number(tid) || g.awayId===Number(tid)))
              found = { date, ...g };
          });
        }
        if (!found) return;
        echoList.push({ ...sig, teamId:Number(tid), team:teamName[tid],
          date:found.date, awayName:found.awayName, homeName:found.homeName,
          venueTz:found.venueTz });
      });
      echoList.sort((a,b)=>a.date.localeCompare(b.date));

      /* ── late go-ahead win: scan yesterday's (and today's, once final)
         finals via linescore, so a comeback that completes today shows up
         on the team's next game as soon as it's refreshed ── */
      const yISO = addDays(start,-1);
      const yGames = finals.filter(g => {
        const gd = g.officialDate || g.gameDate.slice(0,10);
        return gd === yISO || gd === start;
      });
      const cbResults = await mapPool(yGames, 4, async (g) => {
        const winnerSide = g.teams.home.isWinner ? "home" : "away";
        const gd = g.officialDate || g.gameDate.slice(0,10);
        try {
          const lr2 = await fetch(`${API}/game/${g.gamePk}/linescore`);
          if (!lr2.ok) return null;
          const ls = await lr2.json();
          const sig = detectLateComeback(ls, winnerSide);
          if (!sig) return null;
          const win = g.teams[winnerSide], lose = g.teams[winnerSide==="home"?"away":"home"];
          // this team's next scheduled game strictly after this win (not a
          // fixed "today" — if this win was today's own game, searching from
          // today would re-attach the marker to that same game)
          let next = null;
          for (let i=1;i<=5 && !next;i++){
            const date = addDays(gd,i);
            (dayGames[date]||[]).forEach(dg=>{
              if (!next && (dg.homeId===win.team.id || dg.awayId===win.team.id))
                next = { date, awayName:dg.awayName, homeName:dg.homeName };
            });
          }
          return { team:win.team.name, teamId:win.team.id, opp:lose.team.name,
            score:`${win.score}\u2013${lose.score}`, inning:sig.firstLeadInning, next };
        } catch { return null; }
      });
      const cbList = cbResults.filter(Boolean).sort((a,b)=>b.inning-a.inning);

      /* ── pitcher rematch: has each probable already faced today's opponent? ── */
      const pitcherIds = new Set();
      Object.values(dayGames).flat().forEach(g=>{
        if (g.awayPid) pitcherIds.add(g.awayPid);
        if (g.homePid) pitcherIds.add(g.homePid);
      });
      const facedMap = {};
      await mapPool([...pitcherIds], 4, async (pid)=>{
        try {
          const pr = await fetch(`${API}/people/${pid}/stats` +
            `?stats=gameLog&group=pitching&season=${SEASON}&gameType=R`);
          if (!pr.ok) return;
          const pj = await pr.json();
          const splits = pj.stats?.[0]?.splits || [];
          const list = [];
          splits.forEach(s=>{
            const ip = parseFloat(s.stat?.inningsPitched);
            if (s.opponent?.id)
              list.push({ oppId:s.opponent.id, date:s.date, ip: isNaN(ip)?0:ip, stat:s.stat });
          });
          // list: all prior facings (oppId/date/ip/full stat line); season:
          // this pitcher's own season averages, used to color that facing's
          // stat line for the rematch thumbs up/down indicator
          facedMap[pid] = { list, season: pitcherSeasonAverages(splits) };
        } catch { /* leave unset */ }
      });
      // all trend markers appear together (rematch · 10-run · late · echo · travel)
      setFaced(facedMap);
      setRunsMap(runsByDate);
      setHitsMap(hitsByDate);
      setComebacks(cbList);
      setEchoes(echoList);
      indicatorsLoadedForRef.current = start;
    } catch (e) {
      setErr(isNet(e.message) ? "Couldn't reach the MLB schedule service." : e.message);
    } finally { setBusy(false); }
  }, [start, westThreshold, minStreak]);
  useEffect(() => { load(); }, [load]);   // auto-load on open and when min streak changes

  // on mobile, scroll the calendar so today's column is in view on first load
  const calRef = useRef(null);
  const todayColRef = useRef(null);
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || !days || !days.length) return;
    if (window.innerWidth > 760) return;   // desktop shows all 7 columns already
    const container = calRef.current, el = todayColRef.current;
    if (container && el) {
      // center today's column within the horizontal scroller (no page scroll)
      container.scrollLeft = el.offsetLeft - (container.clientWidth - el.clientWidth) / 2;
      scrolledRef.current = true;
    }
  }, [days]);


  // ── copy today's whole slate as one image, tagged picks in red tags ──
  const [slateCopied, setSlateCopied] = useState(null);
  const copySlate = () => {
    try {
      const today = (days||[]).find(d=>d.date===start);
      const all = today ? today.games.filter(Boolean) : [];
      // only games that have a tag
      const games = all.filter(g => tagText(tags[g.gamePk]));
      if (!games.length) { setSlateCopied("empty"); setTimeout(()=>setSlateCopied(null),2000); return; }
      const scale = 3;
      // compact single-column layout, one tight row per tagged pick
      const CW = 300, RH = 40, GAP = 5, PADX = 12, HEAD = 40, PADB = 12;
      const W = PADX*2 + CW;
      const H = HEAD + games.length*RH + (games.length-1)*GAP + PADB;
      const cv = document.createElement("canvas");
      cv.width = W*scale; cv.height = H*scale;
      const x = cv.getContext("2d"); x.scale(scale, scale);
      x.fillStyle = "#E2E5EA"; x.fillRect(0,0,W,H);
      // header
      x.fillStyle = "#14181F"; x.font = "800 17px system-ui, sans-serif";
      x.textAlign = "left"; x.textBaseline = "alphabetic";
      x.fillText("MLB", PADX, 22);
      x.fillStyle = "#525A66"; x.font = "10px ui-monospace, Menlo, monospace";
      x.textAlign = "right";
      x.fillText(prettyDay(start).toUpperCase(), PADX+CW, 22);
      // one compact row per tagged pick: TIME · AWAY@HOME · tag
      games.forEach((g,i)=>{
        const gx = PADX, gy = HEAD + i*(RH+GAP);
        const bg = tagResultBg(tags[g.gamePk])
          || (g.seriesShade!=null ? SERIES_SHADE[g.seriesShade] : "#FFFFFF");
        const final = g.isFinal && g.awayScore!=null && g.homeScore!=null;
        const aw = TEAM_ABBR[g.awayId]||"?", hm = TEAM_ABBR[g.homeId]||"?";
        const time = final ? "FINAL" : new Date(g.time).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
        const rr = 4;
        x.fillStyle = bg; x.strokeStyle = "#C9CED6"; x.lineWidth = 1;
        x.beginPath();
        x.moveTo(gx+rr,gy); x.arcTo(gx+CW,gy,gx+CW,gy+RH,rr); x.arcTo(gx+CW,gy+RH,gx,gy+RH,rr);
        x.arcTo(gx,gy+RH,gx,gy,rr); x.arcTo(gx,gy,gx+CW,gy,rr); x.closePath(); x.fill(); x.stroke();
        // left: matchup (+ scores if final)
        x.textAlign = "left"; x.textBaseline = "middle"; x.fillStyle = "#14181F";
        x.font = "700 13px system-ui, sans-serif";
        let matchup = `${aw} @ ${hm}`;
        if (final) matchup += `  ${g.awayScore}-${g.homeScore}`;
        x.fillText(matchup, gx+10, gy+RH/2 - 6);
        // small time under matchup
        x.fillStyle = "#8A929E"; x.font = "9px ui-monospace, Menlo, monospace";
        x.fillText(time, gx+10, gy+RH/2 + 9);
        // right: red tag, vertically centered
        const tv = tagText(tags[g.gamePk]);
        drawRedTag(x, tv, gx + CW*0.73, gy + RH/2, CW*0.56, 22);
      });
      copyCanvas(cv, `mlb-picks-${start}.png`, setSlateCopied);
    } catch (e) {
      console.error("copySlate failed:", e);
      setSlateCopied("err"); setTimeout(()=>setSlateCopied(null),2000);
    }
  };
  useEffect(() => { if(onReady) onReady({ load, busy, copySlate, slateCopied }); }, [load, busy, onReady, slateCopied, days, tags]);

  /* which trends touch a game, attributed to the specific team they apply to */
  const gameTrends = (date, g) => {
    const echo = (echoes||[]).filter(e=>e.date===date &&
      (e.teamId===g.homeId || e.teamId===g.awayId));
    const cb = (comebacks||[]).filter(c=>c.next && c.next.date===date &&
      (c.teamId===g.homeId || c.teamId===g.awayId));
    const rematch = [];
    const rematchTier = {};                       // teamId -> 'strong' | 'weak'
    const rematchVerdict = {};                    // teamId -> 'up' | 'down' | 'even'
    const checkRematch = (pid, teamId, oppId, pitcher, oppName) => {
      if (!pid) return;
      const entry = faced[pid];
      const facings = (entry?.list||[]).filter(x => x.oppId===oppId && x.date < date);
      if (!facings.length) return;
      const strong = facings.some(x => x.ip >= 4);
      rematch.push({ pitcher, pid, opp:oppName, oppId, teamId, strong });
      // keyed by the PITCHER'S OWN team, so the box lights up in that
      // team's row — not the opponent they're facing again
      rematchTier[teamId] = strong ? "strong" : "weak";
      // most recent prior start against this opponent: color its IP/H/ER/BB/K
      // line the same way the pitcher's game log does, and count green vs red
      const mostRecent = facings.reduce((a,b) => b.date > a.date ? b : a);
      const colors = Object.values(pitcherLineColors(mostRecent.stat, entry.season));
      const greens = colors.filter(c=>c===C.over).length;
      const reds = colors.filter(c=>c===C.under).length;
      rematchVerdict[teamId] = greens>reds ? "up" : reds>greens ? "down" : "even";
    };
    checkRematch(g.awayPid, g.awayId, g.homeId, g.awayPname, g.homeName);
    checkRematch(g.homePid, g.homeId, g.awayId, g.homePname, g.awayName);

    // this team's probable starter's season ERA — independent of any rematch
    const pitcherEra = (tid) => {
      const pid = tid===g.awayId ? g.awayPid : tid===g.homeId ? g.homePid : null;
      const era = pid ? faced[pid]?.season?.era : null;
      return era!=null ? era : null;
    };

    const prevD = addDays(date,-1);
    const bigday = [];
    const aRuns = runsMap[g.awayId]?.[prevD], hRuns = runsMap[g.homeId]?.[prevD];
    if (aRuns>=10) bigday.push({ teamId:g.awayId, team:g.awayName, runs:aRuns });
    if (hRuns>=10) bigday.push({ teamId:g.homeId, team:g.homeName, runs:hRuns });

    // last game's hits for a team, and how that compares to the game before
    // it — feeds the number shown inside the "Slump/Boom" indicator box.
    // Scans back over the team's actual played dates (not a fixed "yesterday")
    // so an off-day doesn't leave the box blank.
    const hitsInfo = (tid) => {
      const m = hitsMap[tid];
      if (!m) return null;
      const pastDates = Object.keys(m).filter(d => d < date).sort().reverse();
      if (!pastDates.length) return null;
      const hits = m[pastDates[0]];
      const prevHits = pastDates.length>1 ? m[pastDates[1]] : null;
      return { hits, diff: prevHits!=null ? hits-prevHits : null };
    };
    // "hot" bats (10+ hits) or "cold" bats (6 or fewer) in the team's last game
    const batsState = (tid) => {
      const hi = hitsInfo(tid);
      if (!hi || hi.hits==null) return null;
      return hi.hits>=10 ? "hot" : hi.hits<=6 ? "cold" : null;
    };
    // hit-trend momentum: last game's hits vs 2 games back; if tied, the
    // 3rd-most-recent game breaks the tie. null once history runs out.
    const hitsMomentum = (tid) => {
      const m = hitsMap[tid];
      if (!m) return null;
      const pastDates = Object.keys(m).filter(d => d < date).sort().reverse();
      if (pastDates.length < 2) return null;
      const h1 = m[pastDates[0]], h2 = m[pastDates[1]];
      if (h1==null || h2==null) return null;
      if (h1 !== h2) return h1 > h2 ? "up" : "down";
      const h3 = pastDates.length>2 ? m[pastDates[2]] : null;
      if (h3==null || h3===h1) return "flat";
      return h1 > h3 ? "up" : "down";
    };

    // per-team keys for the 2x2 situational-trend grid
    const sideKeys = { [g.awayId]:new Set(), [g.homeId]:new Set() };
    const add = (tid, key) => { if (sideKeys[tid]) sideKeys[tid].add(key); };
    (g.travelers||[]).forEach(x=>add(x.teamId, "travel"));
    echo.forEach(e=>add(e.teamId, "echo"));
    cb.forEach(c=>add(c.teamId, "late"));
    bigday.forEach(b=>add(b.teamId, "bigday"));

    const any = !!g.flagged || echo.length>0 || cb.length>0 || rematch.length>0 || bigday.length>0;
    return { travel:!!g.flagged, travelers:g.travelers||[], echo, cb, rematch, bigday, any,
      keysFor:(tid)=>sideKeys[tid] || new Set(),
      rematchTier:(tid)=>rematchTier[tid] || null,
      rematchVerdict:(tid)=>rematchVerdict[tid] || null,
      pitcherEra,
      batsState,
      hitsInfo,
      hitsMomentum };
  };

  return (
    <div>
      {err && <ErrBox>{err}</ErrBox>}

      {/* ── 7-day calendar; past columns aligned to today's matchups ── */}
      {days && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            gap:12, flexWrap:"wrap", marginBottom:8 }}>
            <div style={{ opacity: showIndicators ? 1 : 0.4, transition:"opacity 0.15s",
              flex:"1 1 260px", minWidth:0 }}><Legend /></div>
            <button onClick={()=>setShowIndicators(v=>!v)}
              aria-label={showIndicators ? "Hide indicators" : "Show indicators"}
              title={showIndicators ? "Hide indicators" : "Show indicators"}
              style={{ flexShrink:0, width:32, height:32, borderRadius:4,
                border:`1px solid ${showIndicators ? C.rule : C.ink}`,
                background: showIndicators ? "#fff" : C.ink,
                color: showIndicators ? C.inkSoft : "#fff", cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>
              {showIndicators ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                  <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              )}
            </button>
          </div>
          <div className="ts-cal" ref={calRef} style={{ gap:5, paddingBottom:4 }}>
            {days.map(d=>{
              const isToday = d.date === start;
              const label = isToday ? "Today"
                : d.date===addDays(start,-1) ? "Yesterday"
                : d.date===addDays(start,-2) ? "2 days ago" : calDay(d.date).wd;
              return (
              <div key={d.date} ref={isToday?todayColRef:null} className="ts-cal-col" style={{ border:`1px solid ${isToday?C.ink:C.rule}`, borderRadius:3,
                overflow:"hidden" }}>
                <div style={{ padding:"5px 7px", borderBottom:`1px solid ${C.rule}`,
                  background:isToday?C.ink:C.card, display:"flex", alignItems:"baseline", gap:5 }}>
                  <span style={{ fontFamily:SANS, fontSize:14, fontWeight:700,
                    color:isToday?"#fff":C.ink }}>{calDay(d.date).md}</span>
                  <span style={{ fontFamily:MONO, fontSize:8.5, letterSpacing:"0.08em",
                    textTransform:"uppercase", color:isToday?"rgba(255,255,255,0.7)":C.inkSoft }}>{label}</span>
                </div>
                <div style={{ padding:4, display:"flex", flexDirection:"column", gap:4 }}>
                  {d.games.length===0
                    ? <div className="ts-cell" style={{ height:CARD_H, display:"flex", alignItems:"center",
                        justifyContent:"center", fontFamily:SANS, fontSize:12, color:C.ruleDark }}>—</div>
                    : (() => {
                        const lineIdx = isToday
                          ? d.games.filter(g=>g && new Date(g.time) <= now).length : -1;
                        const dayGames = d.games.filter(Boolean);   // real games this day, in order
                        const dayTrends = dayGames.map(g=>gameTrends(d.date, g));
                        const cells = [];
                        d.games.forEach((g,i)=>{
                          if(i===lineIdx) cells.push(<NowLine key="nl"/>);
                          if(!g) cells.push(<div key={i} className="ts-cell" style={{ height:CARD_H, borderRadius:2,
                            border:`1px dashed ${C.rule}`, opacity:0.4, boxSizing:"border-box" }}/>);
                          else {
                            const di = dayGames.indexOf(g);
                            const t = dayTrends[di];   // reuse; already computed above
                            cells.push(<CalCard key={i} g={g} t={t} tag={tagText(tags[g.gamePk])}
                              showInd={showIndicators} now={now}
                              onOpen={()=>setModal({ date:d.date, games:dayGames, trends:dayTrends,
                                idx:di })}/>);
                          }
                        });
                        if(lineIdx>=d.games.length) cells.push(<NowLine key="nl-end"/>);
                        return cells;
                      })()
                  }
                </div>
              </div>);
            })}
          </div>
        </div>
      )}

      {modal && <GameModal m={modal} tags={tags} setTag={setTag} onClose={()=>setModal(null)} />}
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
      {TREND_SLOTS.map(s=>(
        <div key={s.key} style={{ display:"flex", alignItems:"flex-start", gap:6, width:"100%" }}>
          <span style={{ width:13, height:9, borderRadius:2, background:s.color,
            flexShrink:0, marginTop:3 }} />
          <span style={{ display:"flex", flexDirection:"column", lineHeight:1.25, minWidth:0 }}>
            <span style={{ fontFamily:MONO, fontSize:10, fontWeight:700, color:C.ink }}>{s.label}</span>
            <span style={{ fontFamily:SANS, fontSize:10.5, color:C.inkSoft }}>{s.desc}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
function Pill({ children, color, title, textColor="#fff" }) {
  return <span title={title} style={{ fontFamily:MONO, fontSize:8.5, letterSpacing:"0.04em",
    color:textColor, background:color, borderRadius:2, padding:"1px 4px" }}>{children}</span>;
}

/* box geometry — the situational-trend boxes are one size, and the bigger
   pitcher/batter stat boxes (which have more empty space to fill in their
   row) are another. */
const BOX_W = 16, BOX_H = 14, BOX_GAP = 2, MID_GAP = 8;
const PB_BOX_W = 24, PB_BOX_H = 24, PB_GAP = 3;
const HEADER_H = 11;                       // PITCHER/BATTER label row
const MAIN_H = PB_BOX_H + 2;                // a team's row — tall enough for the pitcher/batter boxes
const BASES_W = 44;                        // reserved for the live bases display — never shifts
const CARD_H = 86;

/* fixed situational-trend slots, rendered as a 1x4 row per team (away row on
   top, home row on bottom — matching the Game/Pitcher-Batter sections). add
   new trends here and every card + the legend adjust automatically. */
const TREND_SLOTS = [
  { key:"bigday", color:C.bigday, label:"Big Day",
    desc:"Team scored 10+ runs yesterday" },
  { key:"late",   color:C.late,   label:"Late go-ahead",
    desc:"Team never led until the 8th inning or later yesterday" },
  { key:"echo",   color:C.echo,   label:"Streak echo",
    desc:"Team just snapped a 10+ game win or loss streak yesterday" },
  { key:"travel", color:C.travel, label:"B2B travel",
    desc:"West yesterday, East today on back-to-back days" },
];

/* one pitcher/batter stat box: a plain outline that always looks the same
   whether or not it has content. A dash ("checked, nothing to show yet")
   reads muted; an actual value (emoji or number) reads at full ink strength. */
function StatBox({ children, title, big=false }) {
  const has = children!=null && children!=="";
  const isDash = children==="–";
  return (
    <span title={title} style={{ position:"relative", width:PB_BOX_W, height:PB_BOX_H, flexShrink:0,
      borderRadius:3, boxShadow:`inset 0 0 0 1.5px ${C.inkSoft}`,
      display:"flex", alignItems:"center", justifyContent:"center" }}>
      {has && <span style={{ position:"relative", top:1, fontFamily: big ? SANS : MONO,
        fontSize: big ? 15 : 13, fontWeight:800, color: isDash ? C.ruleDark : C.ink,
        lineHeight:1 }}>{children}</span>}
    </span>
  );
}

/* one situational-trend box: filled solid with its color when lit, dimmed
   neutral outline when not. */
function TrendBox({ present, color, title }) {
  return <span title={title} style={{ width:BOX_W, height:BOX_H, borderRadius:2, flexShrink:0,
    background: present ? color : "transparent",
    boxShadow: present ? "none" : `inset 0 0 0 1.5px ${C.inkSoft}`,
    opacity: present ? 1 : 0.45 }} />;
}

function TeamLine({ abbr, score, hits, won, final, live }) {
  const showScore = final || live;
  return (
    <div style={{ display:"grid", gridTemplateColumns:"24px 16px 14px", alignItems:"center", gap:1 }}>
      <span style={{ fontFamily:MONO, fontSize:13,
        fontWeight: final ? (won?800:400) : 600,
        color: final ? (won?C.ink:C.inkSoft) : C.ink }}>{abbr}</span>
      <span style={{ fontFamily:MONO, fontSize:13, textAlign:"right",
        fontWeight: final && won ? 800 : 400,
        color: final ? (won?C.ink:C.inkSoft) : showScore ? C.ink : C.ruleDark }}>{showScore ? score : ""}</span>
      <span style={{ fontFamily:MONO, fontSize:10, textAlign:"right", color:C.ruleDark }}>
        {showScore && hits!=null ? hits : ""}</span>
    </div>
  );
}

/* series shading — two pairs, two waves:
   wave 0 (current/past series):  light gray  ↔  white
   wave 1 (future series):        soft navy   ↔  darker gray  */
/* 0=light-gray (leftovers even), 1=white (leftovers odd),
   2=soft-navy (today-series even), 3=darker-gray (today-series odd) */
const SERIES_SHADE = ["#EDEFF2", "#FFFFFF", "#BCC7D8", "#C2C8D0"];

/* the "current time" marker that rests in the gap between today's games */
function NowLine() {
  // sits between two cells without consuming row height: the negative vertical
  // margins cancel its own 2px plus the flex gap, so rows in today's column
  // stay aligned with every other column.
  return (
    <div aria-label="now" style={{ display:"flex", alignItems:"center", height:2,
      margin:"-3px 0", position:"relative", zIndex:1, pointerEvents:"none" }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:"#E5142B",
        flex:"0 0 auto", marginLeft:-2 }} />
      <span style={{ flex:1, height:2, background:"#E5142B" }} />
    </div>
  );
}

/* live-game status: inning on top, the mini three-base diamond in the
   middle, outs below — stacked top-to-bottom, docked next to the team lines. */
function LiveDiamond({ inningNum, inningState, outs, onFirst, onSecond, onThird }) {
  if (inningNum == null) return null;
  const arrow = inningState==="Bottom" || inningState==="End" ? "▼" : "▲";
  // diamonds as SVG polygons (not rotated CSS boxes) so all three bases are
  // drawn in one coordinate space — guarantees 2nd sits exactly centered
  // over 1st/3rd instead of relying on independently-positioned, separately
  // anti-aliased rotated elements to line up pixel-for-pixel.
  const diamond = (cx, cy, on) => {
    const r = 5.1;
    return <polygon points={`${cx},${cy-r} ${cx+r},${cy} ${cx},${cy+r} ${cx-r},${cy}`}
      fill={on ? C.ink : "none"} stroke={C.ink} strokeWidth="1.4" />;
  };
  return (
    <div style={{ flexShrink:0, width:BASES_W, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", gap:3 }}>
      <div style={{ fontFamily:MONO, fontSize:12, fontWeight:700, color:C.ink, whiteSpace:"nowrap" }}>
        {arrow}{inningNum}</div>
      <svg width="30" height="24" viewBox="0 0 30 24">
        {diamond(15, 6, onSecond)}
        {diamond(6, 16.5, onThird)}
        {diamond(24, 16.5, onFirst)}
      </svg>
      <div style={{ display:"flex", gap:2.5 }}>
        {[0,1,2].map(i=>(
          <span key={i} style={{ width:5.5, height:5.5, borderRadius:"50%",
            background: outs!=null && i<outs ? C.ink : "transparent",
            border:`1.4px solid ${C.ink}` }} />
        ))}
      </div>
    </div>
  );
}

/* this team's probable starter's rematch/ERA + hot-cold bats/momentum/hits,
   shown as the 6 pitcher/batter stat boxes. */
function pitcherBatterStats(t, tid) {
  const hasRematch = !!t.rematchTier(tid);
  const verdict = hasRematch ? t.rematchVerdict(tid) : null;
  const era = t.pitcherEra(tid);
  const bats = t.batsState(tid);
  const momentum = t.hitsMomentum(tid);
  const hi = t.hitsInfo(tid);
  return {
    p1: hasRematch ? "\u{1F501}" : null,
    p2: verdict==="up" ? "\u{1F44D}" : verdict==="down" ? "\u{1F44E}" : verdict==="even" ? "➖" : null,
    p3: era!=null ? era.toFixed(1) : "–",
    b1: bats==="hot" ? "\u{1F525}" : bats==="cold" ? "❄️" : null,
    b2: momentum==="up" ? "\u{1F4C8}" : momentum==="down" ? "\u{1F4C9}" : momentum==="flat" ? "➡️" : "–",
    b3: hi && hi.hits!=null ? String(hi.hits) : "–",
  };
}
/* PITCHER (rematch · rematch result · season ERA) and BATTER (hot/cold bats
   · hit-trend momentum · last game's hits) — bigger boxes, vertically
   centered against the team's name+trends rows combined. */
function PBBoxRow({ s }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:PB_GAP }}>
      <StatBox title="Pitcher rematch">{s.p1}</StatBox>
      <StatBox title="Rematch result">{s.p2}</StatBox>
      <StatBox title="Season ERA" big>{s.p3}</StatBox>
      <span style={{ width:MID_GAP, flexShrink:0 }} />
      <StatBox title="Hot/cold bats">{s.b1}</StatBox>
      <StatBox title="Hit-trend momentum">{s.b2}</StatBox>
      <StatBox title="Hits last game" big>{s.b3}</StatBox>
    </div>
  );
}
const pbHeaderCol = (label) => (
  <div style={{ width:PB_BOX_W*3+PB_GAP*2, textAlign:"center", fontFamily:MONO, fontSize:8.5,
    fontWeight:700, letterSpacing:"0.06em", color:C.inkSoft }}>{label}</div>
);

/* column 1 — Game: the two team lines, with a fixed-width slot next to the
   score reserved for the live bases display so nothing shifts when a game
   goes live. */
function GameSection({ g, aw, hm, awWon, hmWon, final, live, bases }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:`auto ${BASES_W}px`,
      gridTemplateRows:`${HEADER_H}px ${MAIN_H}px ${MAIN_H}px`, columnGap:6 }}>
      <div style={{ gridColumn:1, gridRow:1 }} />
      <div style={{ gridColumn:1, gridRow:2, display:"flex", alignItems:"center" }}>
        <TeamLine abbr={aw} score={g.awayScore} hits={g.awayHits} won={awWon} final={final} live={live} />
      </div>
      <div style={{ gridColumn:1, gridRow:3, display:"flex", alignItems:"center" }}>
        <TeamLine abbr={hm} score={g.homeScore} hits={g.homeHits} won={hmWon} final={final} live={live} />
      </div>
      <div style={{ gridColumn:2, gridRow:"2 / span 2", display:"flex",
        alignItems:"center", justifyContent:"center" }}>{bases}</div>
    </div>
  );
}

/* column 2 — Pitcher/Batter: PITCHER (rematch · rematch result · season ERA)
   and BATTER (hot/cold bats · hit-trend momentum · last game's hits), one
   row per team. */
function PitcherBatterSection({ g, t }) {
  return (
    <div style={{ display:"grid", gridTemplateRows:`${HEADER_H}px ${MAIN_H}px ${MAIN_H}px` }}>
      <div style={{ display:"flex", alignItems:"center", gap:BOX_GAP }}>
        {pbHeaderCol("PITCHER")}
        <span style={{ width:MID_GAP, flexShrink:0 }} />
        {pbHeaderCol("BATTER")}
      </div>
      <div style={{ display:"flex", alignItems:"center" }}>
        <PBBoxRow s={pitcherBatterStats(t, g.awayId)} />
      </div>
      <div style={{ display:"flex", alignItems:"center" }}>
        <PBBoxRow s={pitcherBatterStats(t, g.homeId)} />
      </div>
    </div>
  );
}

/* column 3 — Trends: a row of 4 situational-trend boxes per team. */
function TrendsSection({ g, t }) {
  return (
    <div style={{ display:"grid", gridTemplateRows:`${HEADER_H}px ${MAIN_H}px ${MAIN_H}px` }}>
      <div />
      <div style={{ display:"flex", alignItems:"center", gap:BOX_GAP }}>
        {TREND_SLOTS.map(slot=>{
          const present = t.keysFor(g.awayId).has(slot.key);
          return <TrendBox key={slot.key} present={present} color={slot.color}
            title={present ? slot.label : undefined} />;
        })}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:BOX_GAP }}>
        {TREND_SLOTS.map(slot=>{
          const present = t.keysFor(g.homeId).has(slot.key);
          return <TrendBox key={slot.key} present={present} color={slot.color}
            title={present ? slot.label : undefined} />;
        })}
      </div>
    </div>
  );
}

function CalCard({ g, t, tag, showInd=true, now, onOpen }) {
  const aw = TEAM_ABBR[g.awayId]||"?", hm = TEAM_ABBR[g.homeId]||"?";
  const time = new Date(g.time).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
  const final = g.isFinal && g.awayScore!=null && g.homeScore!=null;
  // MLB's API sometimes flips a game to "Live" a little ahead of its listed
  // start time — hold off on the LIVE badge (and the bases display) until
  // that time has actually passed, then defer entirely to the API.
  const live = g.isLive && !final && now.getTime() >= new Date(g.time).getTime();
  const awWon = final && g.awayScore > g.homeScore;
  const hmWon = final && g.homeScore > g.awayScore;
  const bg = g.seriesShade!=null ? SERIES_SHADE[g.seriesShade] : "#fff";
  const tagInCorner = tag && showInd;        // indicators on → tag overlaps corner
  const tagInMarkers = tag && !showInd;      // indicators off → tag sits where markers were
  const bases = live && <LiveDiamond inningNum={g.inningNum} inningState={g.inningState} outs={g.outs}
    onFirst={g.onFirst} onSecond={g.onSecond} onThird={g.onThird} />;
  return (
    <div onClick={onOpen||undefined} className="ts-cell"
      role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e)=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();onOpen();} } : undefined}
      style={{ border:`1px solid ${C.rule}`, borderRadius:2, boxSizing:"border-box",
      minHeight:CARD_H, padding:"4px 7px", background:bg, overflow:"visible", position:"relative",
      cursor: onOpen ? "pointer" : "default" }}>
      {tagInCorner && (
        <div title={tag} style={{ position:"absolute", top:-4, left:-5, zIndex:3, maxWidth:"86%",
          background:"#F2657A", color:"#fff", border:"1px solid #D7263D", borderRadius:3,
          padding:"1px 5px", fontFamily:SANS, fontSize:9.5, fontWeight:700, lineHeight:1.25,
          boxShadow:"0 1px 3px rgba(120,0,20,0.3)", whiteSpace:"nowrap", overflow:"hidden",
          textOverflow:"ellipsis", transform:"rotate(-2deg)" }}>{tag}</div>
      )}
      {tagInMarkers && (
        <div title={tag} style={{ position:"absolute", right:6, top:"50%", zIndex:3, maxWidth:"64%",
          transform:"translateY(-50%) rotate(-2deg)",
          background:"#F2657A", color:"#fff", border:"1px solid #D7263D", borderRadius:3,
          padding:"1px 6px", fontFamily:SANS, fontSize:9.5, fontWeight:700, lineHeight:1.3,
          boxShadow:"0 1px 3px rgba(120,0,20,0.3)", whiteSpace:"nowrap", overflow:"hidden",
          textOverflow:"ellipsis" }}>{tag}</div>
      )}
      <div style={{ fontFamily:MONO, fontSize:8, lineHeight:1.2,
        display:"flex", alignItems:"center", justifyContent:"flex-end", gap:3,
        color: live ? "#E5142B" : C.ruleDark, fontWeight: live ? 700 : 400, marginBottom:2 }}>
        {live && <span style={{ width:6, height:6, borderRadius:"50%", background:"#E5142B",
          flexShrink:0 }} />}
        {final ? "FINAL" : live ? "LIVE" : time}</div>
      <div className="ts-card-grid" style={{ display:"grid",
        gridTemplateColumns: showInd ? "auto auto auto" : "auto", columnGap:12 }}>
        <GameSection g={g} aw={aw} hm={hm} awWon={awWon} hmWon={hmWon} final={final} live={live} bases={bases} />
        {showInd && <PitcherBatterSection g={g} t={t} />}
        {showInd && <TrendsSection g={g} t={t} />}
      </div>
    </div>
  );
}

/* ── game detail modal: probable pitchers, every prior matchup vs this team ── */
// colored stat line for a pitcher start, relative to this pitcher's own
// season averages (falls back to flat thresholds until a season average
// is available):
//  IP  black within 2 outs of their average outing · shorter red · longer green
//  H   black within 1.5 hits of the rate their season H/9 predicts for
//      this many outs · fewer green · more red
//  ER  black within 1.00 of season ERA (this game's ER as an ERA) · lower green · higher red
//  BB  black within 1.0 walk of the rate their season BB/9 predicts · fewer green · more red
//  K   black within 2 of the rate their season K/9 predicts · more green · fewer red
//
// laid out as a fixed 5-column grid (not flowing text) so every stat sits
// in the same horizontal position on every row — a double-digit value
// never shifts the columns after it — and stretches to fill the row.
const PLINE_COLS = "minmax(0,1.15fr) minmax(0,0.95fr) minmax(0,0.95fr) minmax(0,0.95fr) minmax(0,0.85fr)";
function PLine({ s, season, maxSize = 13, minSize = 7.5 }) {
  const ref = useRef(null);
  const [fontSize, setFontSize] = useState(maxSize);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let size = maxSize;
      el.style.fontSize = size + "px";
      const overflowing = () => Array.from(el.children).some(c => c.scrollWidth > c.clientWidth + 0.5);
      while (overflowing() && size > minSize) {
        size -= 0.5;
        el.style.fontSize = size + "px";
      }
      setFontSize(size);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [s, season, maxSize, minSize]);
  const st = s.stat;
  const { ipCol, hCol, erCol, bbCol, kCol } = pitcherLineColors(st, season);

  const cells = [
    [`${st.inningsPitched} IP`, ipCol],
    [`${st.hits} H`,            hCol],
    [`${st.earnedRuns} ER`,     erCol],
    [`${st.baseOnBalls} BB`,    bbCol],
    [`${st.strikeOuts} K`,      kCol],
  ];
  return (
    <div ref={ref} style={{ display:"grid", gridTemplateColumns:PLINE_COLS,
      width:"100%", fontSize }}>
      {cells.map(([txt,c],i)=>(
        <span key={i} style={{ display:"block", color:c, whiteSpace:"nowrap", overflow:"hidden",
          borderLeft: i>0 ? `1px solid ${C.rule}` : "none", paddingLeft: i>0 ? 6 : 0 }}>{txt}</span>
      ))}
    </div>
  );
}

// full season game-by-game log for a pitcher (most recent first)
async function loadPitcherSeason(pid) {
  if (!pid) return [];
  try {
    const r = await fetch(`${API}/people/${pid}/stats?stats=gameLog&group=pitching&season=${SEASON}&gameType=R`);
    if (!r.ok) return [];
    const j = await r.json();
    const splits = j.stats?.[0]?.splits || [];
    return splits.slice().sort((a,b)=>b.date.localeCompare(a.date));
  } catch { return []; }
}

function PitcherSeasonModal({ pid, name, onClose }) {
  const [log, setLog] = useState(undefined);
  useEffect(() => {
    let alive = true;
    loadPitcherSeason(pid).then(r=>{ if(alive) setLog(r); });
    return () => { alive = false; };
  }, [pid]);

  const tot = useMemo(() => {
    if (!log || !log.length) return null;
    const sum = (k)=>log.reduce((s,g)=>s+(Number(g.stat[k])||0),0);
    const ipOuts = log.reduce((s,g)=>s+ipToOuts(g.stat.inningsPitched), 0);
    const ip = `${Math.floor(ipOuts/3)}.${ipOuts%3}`;
    const er = sum("earnedRuns");
    const era = ipOuts>0 ? ((er*27)/ipOuts).toFixed(2) : "—";
    return { gs:log.length, ip, k:sum("strikeOuts"), bb:sum("baseOnBalls"), h:sum("hits"), er, era };
  }, [log]);
  // season averages for coloring each start's line relative to this pitcher's own pace
  const seasonAvg = useMemo(() => pitcherSeasonAverages(log), [log]);

  // count starts per opponent so a repeat matchup can be bolded in the log
  const oppCounts = useMemo(() => {
    const m = {};
    (log||[]).forEach(s=>{ const id = s.opponent?.id; if (id!=null) m[id] = (m[id]||0)+1; });
    return m;
  }, [log]);

  return (
    <div onClick={e=>{ e.stopPropagation(); onClose(); }} style={{ position:"fixed", inset:0, zIndex:60,
      background:"rgba(20,24,31,0.55)", display:"flex", alignItems:"flex-start",
      justifyContent:"center", padding:"max(12px, env(safe-area-inset-top)) 12px 12px", overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.paper,
        border:`1px solid ${C.ink}`, borderRadius:6, maxWidth:560, width:"100%",
        margin:"12px 0 40px", boxShadow:"0 20px 60px rgba(0,0,0,0.35)" }}>
        <div style={{ padding:"14px 18px", borderBottom:`2px solid ${C.ink}`,
          display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
          <div>
            <div style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.14em",
              textTransform:"uppercase", color:C.inkSoft }}>{SEASON} game log</div>
            <div style={{ fontFamily:SANS, fontSize:18, fontWeight:800 }}>{name}</div>
          </div>
          <button onClick={onClose} style={{ border:`1px solid ${C.rule}`, background:"#fff",
            borderRadius:2, fontFamily:MONO, fontSize:13, padding:"4px 10px", cursor:"pointer" }}>✕</button>
        </div>

        {tot && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(70px,1fr))",
            borderBottom:`1px solid ${C.rule}`, background:C.card }}>
            {[["GS",tot.gs],["IP",tot.ip],["ERA",tot.era],["K",tot.k],["BB",tot.bb],["H",tot.h]].map(([l,v])=>(
              <div key={l} style={{ padding:"8px 10px", borderRight:`1px solid ${C.rule}` }}>
                <div style={{ fontFamily:MONO, fontSize:9, letterSpacing:"0.08em",
                  textTransform:"uppercase", color:C.inkSoft }}>{l}</div>
                <div style={{ fontFamily:MONO, fontSize:15, fontWeight:700 }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ padding:"8px 0 14px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"38px 32px minmax(0,1fr)",
            gap:6, padding:"4px 12px", fontFamily:MONO, fontSize:9, letterSpacing:"0.06em",
            textTransform:"uppercase", color:C.ruleDark }}>
            <span>Date</span><span>Opp</span><span>Line</span>
          </div>
          {log===undefined && <div style={{ padding:"10px 16px", fontFamily:MONO, fontSize:12, color:C.inkSoft }}>Loading…</div>}
          {log && log.length===0 && <div style={{ padding:"10px 16px", fontFamily:SANS, fontSize:13, color:C.inkSoft }}>No {SEASON} starts found.</div>}
          {log && log.map((s,i)=>{
            const repeatOpp = s.opponent?.id!=null && oppCounts[s.opponent.id] > 1;
            return (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"38px 32px minmax(0,1fr)",
              gap:6, padding:"5px 12px", borderTop:`1px solid #EEF0F2`, alignItems:"baseline" }}>
              <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft }}>{calDay(s.date).md}</span>
              <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft,
                fontWeight: repeatOpp ? 800 : 400 }}>{
                TEAM_ABBR[s.opponent?.id] || s.opponent?.abbreviation
                || s.opponent?.name?.split(" ").slice(-1)[0] || "—"}</span>
              <span style={{ fontFamily:MONO, minWidth:0 }}><PLine s={s} season={seasonAvg} maxSize={12.5} /></span>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function PitcherBlock({ name, pid, vsName, info, bare }) {
  const [showLog, setShowLog] = useState(false);
  return (
    <div style={ bare ? {} : { borderTop:`1px solid ${C.rule}`, padding:"12px 0" }}>
      <div style={{ fontFamily:SANS, fontSize:15, fontWeight:700 }}>
        {!name ? "TBD" : pid ? (
          <button onClick={()=>setShowLog(true)} title={`${name} — ${SEASON} game log`}
            style={{ font:"inherit", fontWeight:700, color:C.blue, cursor:"pointer",
              border:"none", background:"transparent", padding:0,
              textDecoration:"underline", textDecorationColor:C.blue, textUnderlineOffset:2 }}>{name}</button>
        ) : name}
        <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft, fontWeight:400 }}>
          {"  vs "}{vsName}</span>
      </div>
      {!name ? (
        <div style={{ fontFamily:SANS, fontSize:13, color:C.inkSoft, marginTop:4 }}>
          No probable starter posted yet.</div>
      ) : info === undefined ? (
        <div style={{ fontFamily:MONO, fontSize:12, color:C.inkSoft, marginTop:6 }}>Loading…</div>
      ) : !info ? (
        <div style={{ fontFamily:SANS, fontSize:13, color:C.inkSoft, marginTop:4 }}>
          No {SEASON} game log found.</div>
      ) : (
        <div style={{ marginTop:8 }}>
          <div style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.1em",
            textTransform:"uppercase", color:C.rematch, marginBottom:6 }}>
            This season vs {vsName} · {info.vs.length} start{info.vs.length===1?"":"s"}</div>
          {info.vs.length===0 ? (
            <div style={{ fontFamily:SANS, fontSize:13, color:C.inkSoft }}>
              Has not faced them this season.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {info.vs.map((s,i)=>(
                <div key={i} style={{ display:"flex", justifyContent:"space-between",
                  gap:10, alignItems:"baseline", borderBottom:`1px solid #EEF0F2`, paddingBottom:4 }}>
                  <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft, minWidth:34, flexShrink:0 }}>{calDay(s.date).md}</span>
                  <span style={{ fontFamily:MONO, flex:"1 1 auto", minWidth:0 }}>
                    <PLine s={s} season={info.season} maxSize={13} /></span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {showLog && <PitcherSeasonModal pid={pid} name={name} onClose={()=>setShowLog(false)} />}
    </div>
  );
}

// one pitcher's line in the game's box score — name opens the same season
// game-log modal as everywhere else.
function PitcherStatLine({ p }) {
  const [showLog, setShowLog] = useState(false);
  return (
    <div>
      <button onClick={()=>setShowLog(true)} title={`${p.name} — ${SEASON} game log`}
        style={{ font:"inherit", fontFamily:SANS, fontSize:13, fontWeight:700, color:C.blue,
          cursor:"pointer", border:"none", background:"transparent", padding:0,
          textDecoration:"underline", textDecorationColor:C.blue, textUnderlineOffset:2,
          display:"block", maxWidth:"100%", textAlign:"left", whiteSpace:"nowrap",
          overflow:"hidden", textOverflow:"ellipsis" }}>{p.name}</button>
      <div style={{ marginTop:2 }}>
        <PLine s={{ stat:p.stat }} season={null} maxSize={13} />
      </div>
      {showLog && <PitcherSeasonModal pid={p.pid} name={p.name} onClose={()=>setShowLog(false)} />}
    </div>
  );
}

/* ════════════════════════ PROP ANALYZER ════════════════════════ */
function PropAnalyzer({ injected = null }) {
  const [name, setName] = useState("");
  const [statKey, setStatKey] = useState("hits");
  const [line, setLine] = useState("1.5");
  const [sampleN, setSampleN] = useState("20");   // "5"|"10"|"15"|"20"|"month"|"season"
  const [roster, setRoster] = useState(null);
  const [games, setGames] = useState(null);
  const [resolved, setResolved] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadRoster = useCallback(async () => {
    if (roster) return roster;
    const r = await fetch(`${API}/sports/1/players?season=${SEASON}`);
    if (!r.ok) throw new Error(`roster ${r.status}`);
    const j = await r.json();
    const people = j.people || [];
    setRoster(people);
    return people;
  }, [roster]);

  const analyzeLive = useCallback(async (override) => {
    const rawName = typeof override === "string" ? override : (override?.name ?? name);
    const rawStat = (override && typeof override === "object" && override.stat) ? override.stat : statKey;
    setErr(""); setGames(null); setResolved(""); setBusy(true);
    try {
      const people = await loadRoster();
      const q = rawName.trim().toLowerCase();
      if (!q) throw new Error("Enter a player name.");
      const hits = people.filter(p=>(p.fullName||"").toLowerCase().includes(q));
      if (!hits.length) throw new Error(`No ${SEASON} MLB player matched "${rawName}".`);
      const player = hits[0];
      const r = await fetch(`${API}/people/${player.id}/stats?stats=gameLog&group=hitting&season=${SEASON}&gameType=R`);
      if (!r.ok) throw new Error(`game log ${r.status}`);
      const j = await r.json();
      const splits = j.stats?.[0]?.splits || [];
      if (!splits.length) throw new Error(`No ${SEASON} game logs for ${player.fullName}.`);
      const rows = splits.map(s=>({ date:s.date, opp:s.opponent?.abbreviation||"",
        value:valOf(s.stat, rawStat) })).sort((a,b)=>a.date.localeCompare(b.date));
      setResolved(player.fullName); setGames(rows);
    } catch (e) {
      setErr(isNet(e.message)
        ? "Couldn't reach the MLB data service. This works from a normal browser tab in your own app."
        : e.message);
    } finally { setBusy(false); }
  }, [name, statKey, loadRoster]);

  // clicking a stat fills name + stat and runs immediately
  useEffect(() => {
    if (injected && injected.name) {
      setName(injected.name);
      if (injected.stat) setStatKey(injected.stat);
      analyzeLive({ name:injected.name, stat:injected.stat });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injected?.ts]);

  const analysis = useMemo(() => {
    if (!games?.length) return null;
    const L = parseFloat(line);
    let recent, sampleLabel;
    if (sampleN === "season") { recent = games; sampleLabel = "Season"; }
    else if (sampleN === "month") {
      const mo = String(games[games.length-1].date).slice(0,7);
      const m = games.filter(g=>String(g.date).startsWith(mo));
      recent = m.length ? m : games; sampleLabel = "This month";
    } else { const n=Number(sampleN); recent = games.slice(-n); sampleLabel = `Last ${n}`; }
    const avg = a => a.reduce((s,g)=>s+g.value,0)/a.length;
    const clears = g => g.value > L;
    const hitN = recent.filter(clears).length;
    let streak = 0;
    for (let i=games.length-1;i>=0;i--){ if(clears(games[i])) streak++; else break; }
    const recentAvg = avg(recent);
    return { L, recent, recentAvg, seasonAvg:avg(games), hitN,
      hitRate:hitN/recent.length, streak, sampleLabel, edge:recentAvg-L };
  }, [games, line, sampleN]);

  const statLabel = (HIT_STATS.find(s=>s[0]===statKey)||[statKey,statKey])[1];

  return (
    <div>
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end", marginBottom:14 }}>
        <Field label="Player"><input style={{ ...inputStyle, minWidth:150 }} value={name}
          placeholder="e.g. Aaron Judge"
          onChange={e=>setName(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") analyzeLive(); }} /></Field>
        <Field label="Stat"><select style={{ ...inputStyle, minWidth:120 }} value={statKey}
          onChange={e=>setStatKey(e.target.value)}>
          {HIT_STATS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Line"><input style={{ ...inputStyle, width:70 }} value={line}
          inputMode="decimal" onChange={e=>setLine(e.target.value)} /></Field>
        <Field label="Sample"><select style={{ ...inputStyle, width:120 }} value={sampleN}
          onChange={e=>setSampleN(e.target.value)}>
          <option value="5">Last 5</option><option value="10">Last 10</option>
          <option value="15">Last 15</option><option value="20">Last 20</option>
          <option value="month">This month</option><option value="season">Season</option></select></Field>
        <button onClick={()=>analyzeLive()} disabled={busy} style={{ padding:"8px 16px",
          border:`1px solid ${C.ink}`, borderRadius:2, background:busy?C.rule:C.ink, color:"#fff",
          fontFamily:MONO, fontSize:12, letterSpacing:"0.06em", textTransform:"uppercase",
          cursor:busy?"default":"pointer" }}>{busy?"…":"Analyze"}</button>
      </div>

      {err && <ErrBox>{err}</ErrBox>}

      {analysis && (
        <div style={{ border:`1px solid ${C.ruleDark}`, borderRadius:3, background:C.card, overflow:"hidden" }}>
          <div style={{ padding:"12px 16px", borderBottom:`1px solid ${C.rule}`,
            display:"flex", justifyContent:"space-between", alignItems:"baseline", flexWrap:"wrap", gap:8 }}>
            <span style={{ fontFamily:SANS, fontWeight:700, fontSize:16 }}>{resolved}</span>
            <span style={{ fontFamily:MONO, fontSize:12, color:C.inkSoft, textTransform:"uppercase",
              letterSpacing:"0.08em" }}>over {analysis.L} {statLabel}</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",
            borderBottom:`1px solid ${C.rule}` }}>
            {[[`${analysis.sampleLabel} avg`, analysis.recentAvg.toFixed(2), `season ${analysis.seasonAvg.toFixed(2)}`, C.ink],
              ["Edge vs line", `${analysis.edge>=0?"+":""}${analysis.edge.toFixed(2)}`, analysis.edge>=0?"form beats line":"line beats form", analysis.edge>=0?C.over:C.under],
              ["Hit rate", `${Math.round(analysis.hitRate*100)}%`, `${analysis.hitN}/${analysis.recent.length} cleared`, analysis.hitRate>=0.6?C.over:analysis.hitRate<=0.4?C.under:C.ink],
              ["Streak", analysis.streak, `game${analysis.streak===1?"":"s"} over`, analysis.streak>=3?C.over:C.ink],
            ].map(([lab,val,sub,col],i)=>(
              <div key={i} style={{ padding:"10px 14px", borderRight:`1px solid ${C.rule}` }}>
                <div style={{ fontFamily:MONO, fontSize:9, letterSpacing:"0.08em",
                  textTransform:"uppercase", color:C.inkSoft }}>{lab}</div>
                <div style={{ fontFamily:MONO, fontSize:18, fontWeight:700, color:col, marginTop:2 }}>{val}</div>
                <div style={{ fontFamily:MONO, fontSize:10, color:C.ruleDark, marginTop:1 }}>{sub}</div>
              </div>
            ))}
          </div>
          <div style={{ padding:"16px 12px 8px" }}>
            <div style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase",
              color:C.inkSoft, padding:"0 6px 8px" }}>Game-by-game · bar clears line = over</div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={analysis.recent.map(g=>({ name:String(g.date).slice(5), value:g.value,
                clears:g.value>analysis.L }))} margin={{ top:4, right:16, bottom:4, left:-18 }}>
                <XAxis dataKey="name" tick={{ fontFamily:MONO, fontSize:9, fill:C.inkSoft }}
                  axisLine={{ stroke:C.rule }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontFamily:MONO, fontSize:10, fill:C.inkSoft }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill:"rgba(0,0,0,0.04)" }}
                  contentStyle={{ fontFamily:MONO, fontSize:11, borderRadius:2, border:`1px solid ${C.rule}` }} />
                <Bar dataKey="value" radius={[2,2,0,0]}>
                  {analysis.recent.map((g,i)=>(
                    <Cell key={i} fill={g.value>analysis.L ? C.over : C.under} />
                  ))}
                </Bar>
                <ReferenceLine y={analysis.L} stroke={C.ink} strokeWidth={1.5} strokeDasharray="4 3"
                  label={{ value:`line ${analysis.L}`, position:"right", fontFamily:MONO, fontSize:10, fill:C.ink }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function PropModal({ injected, onClose }) {
  return (
    <div onClick={e=>{ e.stopPropagation(); onClose(); }} style={{ position:"fixed", inset:0, zIndex:60,
      background:"rgba(20,24,31,0.55)", display:"flex", alignItems:"flex-start",
      justifyContent:"center", padding:"max(12px, env(safe-area-inset-top)) 12px 12px", overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.paper,
        border:`1px solid ${C.ink}`, borderRadius:6, maxWidth:600, width:"100%",
        margin:"12px 0 40px", boxShadow:"0 20px 60px rgba(0,0,0,0.35)" }}>
        <div style={{ padding:"14px 18px", borderBottom:`2px solid ${C.ink}`,
          display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
          <span style={{ fontFamily:SANS, fontWeight:700, fontSize:16 }}>Prop Lookup</span>
          <button onClick={onClose} style={{ border:`1px solid ${C.rule}`, background:"#fff",
            borderRadius:2, fontFamily:MONO, fontSize:13, padding:"4px 10px", cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ padding:"14px 18px 20px" }}>
          <PropAnalyzer injected={injected} />
        </div>
      </div>
    </div>
  );
}

/* ─────────── shared loaders for the unified game modal ─────────── */

// last-5 H / TB / HRR + this-month AVG for one batter (date = game date)
async function loadBatterTrend(id, date) {
  try {
    const r = await fetch(`${API}/people/${id}/stats?stats=gameLog&group=hitting&season=${SEASON}&gameType=R`);
    if (!r.ok) return { h:[], tb:[], hrr:[], avg:null };
    const j = await r.json();
    const splits = (j.stats?.[0]?.splits||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
    const last5 = splits.slice(-5);
    const month = date.slice(0,7);
    let h=0, ab=0;
    splits.filter(s=>(s.date||"").startsWith(month)).forEach(s=>{
      h+=Number(s.stat.hits)||0; ab+=Number(s.stat.atBats)||0;
    });
    return {
      h:   last5.map(s=>valOf(s.stat,"hits")),
      tb:  last5.map(s=>valOf(s.stat,"totalBases")),
      hrr: last5.map(s=>valOf(s.stat,"hits+runs+rbi")),
      avg: ab>0 ? (h/ab).toFixed(3).replace(/^0/,"") : null,
    };
  } catch { return { h:[], tb:[], hrr:[], avg:null }; }
}

// resolve a team's starting nine: confirmed lineup, else last completed game's order
async function loadLineup(game, side, date) {
  const lp = game.lineups?.[side+"Players"];
  if (lp && lp.length) {
    return { source:"confirmed",
      players: lp.slice(0,9).map((p,i)=>({ id:p.id, name:p.fullName, order:i+1 })) };
  }
  const teamId = game.teams[side].team.id;
  const back = addDays(date,-14);
  try {
    const sr = await fetch(`${API}/schedule?sportId=1&teamId=${teamId}&startDate=${back}&endDate=${addDays(date,-1)}&gameType=R`);
    const sj = await sr.json();
    const prev = (sj.dates||[]).flatMap(d=>d.games||[])
      .filter(g=>g.status?.abstractGameState==="Final")
      .sort((a,b)=>a.gameDate.localeCompare(b.gameDate));
    const last = prev[prev.length-1];
    if (!last) return { source:"none", players:[] };
    const br = await fetch(`${API}/game/${last.gamePk}/boxscore`);
    const bj = await br.json();
    const which = last.teams.home.team.id===teamId ? "home" : "away";
    const t = bj.teams[which];
    // battingOrder on each player is "SO0" (slot, sub#00 = started that slot);
    // filter to starters only so a mid-game substitution doesn't bump the
    // original starter out of the projected lineup.
    const starters = Object.values(t.players||{})
      .filter(p=>typeof p.battingOrder==="string" && p.battingOrder.endsWith("00"))
      .sort((a,b)=>a.battingOrder.localeCompare(b.battingOrder));
    const players = starters.slice(0,9).map((p,i)=>({
      id:p.person.id, name:p.person.fullName, order:i+1 }));
    return { source:"projected", players };
  } catch { return { source:"none", players:[] }; }
}

// a pitcher's prior starts vs a specific opponent this season (before `date`)
async function loadPitcherVs(pid, oppId, date) {
  if (!pid) return null;
  try {
    const r = await fetch(`${API}/people/${pid}/stats?stats=gameLog&group=pitching&season=${SEASON}&gameType=R`);
    if (!r.ok) return null;
    const j = await r.json();
    const splits = (j.stats?.[0]?.splits||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
    const prior = splits.filter(s=>s.date < date);
    return { vs: prior.filter(s=>s.opponent?.id===oppId), season: pitcherSeasonAverages(prior) };
  } catch { return null; }
}

// season head-to-head summary between two teams
// full per-inning line score for a finished game
async function loadLineScore(gamePk) {
  if (!gamePk) return null;
  try {
    const r = await fetch(`${API}/game/${gamePk}/linescore`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.innings || !j.innings.length) return null;
    return j;
  } catch { return null; }
}

// every pitcher who has appeared in this game so far, in order, with their
// current line (live games update as it goes; finished games are final).
async function loadBoxscorePitchers(gamePk) {
  if (!gamePk) return null;
  try {
    const r = await fetch(`${API}/game/${gamePk}/boxscore`);
    if (!r.ok) return null;
    const j = await r.json();
    const side = (teamObj) => (teamObj?.pitchers || []).map(pid => {
      const p = teamObj.players?.[`ID${pid}`];
      const stat = p?.stats?.pitching;
      if (!p || !stat || stat.inningsPitched == null) return null;
      return { pid, name: p.person?.fullName, stat };
    }).filter(Boolean);
    return { away: side(j.teams?.away), home: side(j.teams?.home) };
  } catch { return null; }
}

async function loadH2H(aId, bId) {
  const r = await fetch(`${API}/schedule?sportId=1&season=${SEASON}&gameType=R&teamId=${aId}&hydrate=linescore`);
  if (!r.ok) throw new Error(`schedule ${r.status}`);
  const j = await r.json();
  const games = (j.dates||[]).flatMap(d=>d.games||[])
    .filter(g=>g.teams.home.team.id===bId || g.teams.away.team.id===bId)
    .sort((x,y)=>x.gameDate.localeCompare(y.gameDate));
  let aw=0,bw=0,upcoming=0;
  const meetings = [];
  games.forEach(g=>{
    const aHome = g.teams.home.team.id===aId;
    const aSide = aHome?"home":"away", bSide = aHome?"away":"home";
    const aS=g.teams[aSide].score, bS=g.teams[bSide].score;
    const aHits=g.linescore?.teams?.[aSide]?.hits, bHits=g.linescore?.teams?.[bSide]?.hits;
    if (g.status?.abstractGameState==="Final" && aS!=null && bS!=null) {
      if (aS>bS) aw++; else if (bS>aS) bw++;
      meetings.push({ date: g.officialDate || g.gameDate.slice(0,10),
        aScore:aS, bScore:bS, aHits:aHits||0, bHits:bHits||0 });
    } else upcoming++;
  });
  meetings.reverse();   // most recent meeting first
  const played = aw+bw;
  return { aw,bw,upcoming,played,meetings };
}

// a batter's career line vs a specific pitcher (single split row of stats)
async function loadBatterVs(batterId, pitcherId) {
  if (!batterId || !pitcherId) return null;
  try {
    const r = await fetch(`${API}/people/${batterId}/stats` +
      `?stats=vsPlayer&opposingPlayerId=${pitcherId}&group=hitting&gameType=R`);
    if (!r.ok) return null;
    const j = await r.json();
    return j.stats?.[0]?.splits?.[0]?.stat || null;
  } catch { return null; }
}

/* one team's column: lineup of 9 hitters, then its starting pitcher block below */
const HV_COLS = "14px minmax(40px,1fr) 34px 34px 30px 48px";   // # name AB H HR AVG
function TeamPanel({ teamName, lineup, oppName, pitcherName, pitcherId, pitcherInfo, onStat, oppPitcherName, oppPitcherId, showBoxPitching, boxPitchers }) {
  const canVs = !!oppPitcherId && !!oppPitcherName;
  const [view, setView] = useState(() => canVs ? "vssp" : "last5");   // "last5" | "vssp"
  const [vsData, setVsData] = useState({});       // batterId -> stat | null
  const [vsLoading, setVsLoading] = useState(false);

  // lazy-load batter-vs-pitcher lines the first time the toggle flips
  useEffect(() => {
    if (view !== "vssp" || !canVs || !lineup?.players?.length) return;
    let alive = true;
    setVsLoading(true);
    (async () => {
      const data = {};
      await mapPool(lineup.players, 4, async p=>{
        data[p.id] = await loadBatterVs(p.id, oppPitcherId);
      });
      if (alive) { setVsData(data); setVsLoading(false); }
    })();
    return () => { alive = false; };
  }, [view, canVs, oppPitcherId, lineup]);

  const tabBtn = (id,label,enabled=true) => (
    <button onClick={()=>enabled&&setView(id)} disabled={!enabled}
      style={{ flex:1, padding:"5px 8px", border:"none", cursor:enabled?"pointer":"not-allowed",
        fontFamily:MONO, fontSize:9.5, letterSpacing:"0.06em", textTransform:"uppercase",
        background: view===id ? C.ink : "transparent", color: view===id ? "#fff" : (enabled?C.inkSoft:C.rule),
        borderRadius:2 }}>{label}</button>
  );

  return (
    <div className="ts-lineup-col" style={{ minWidth:0 }}>
      <div style={{ padding:"8px 12px", borderBottom:`1px solid ${C.rule}`,
        display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
        <span style={{ fontFamily:SANS, fontWeight:700, fontSize:14 }}>{teamName}</span>
        {!lineup ? <Tag>…</Tag>
          : lineup.source==="confirmed" ? <Tag tone="ok">Confirmed</Tag>
          : lineup.source==="projected" ? <Tag>Projected</Tag> : <Tag>No lineup</Tag>}
      </div>

      {/* view toggle */}
      <div style={{ display:"flex", gap:3, padding:"6px 10px 2px", borderBottom:`1px solid #EEF0F2` }}>
        {tabBtn("vssp", canVs ? `vs ${oppPitcherName.split(" ").slice(-1)[0]}` : "vs SP", canVs)}
        {tabBtn("last5","Last 5")}
      </div>

      <div style={{ padding:"4px 0" }}>
        {/* header row depends on view */}
        {view==="last5" ? (
          <div style={{ display:"grid", gridTemplateColumns:ROW_COLS, gap:6, padding:"2px 10px",
            fontFamily:MONO, fontSize:9, letterSpacing:"0.04em", textTransform:"uppercase",
            color:C.ruleDark, alignItems:"center" }}>
            <span>#</span><span>Hitter</span><span style={{ textAlign:"right" }}>AVG</span>
            <span style={{ textAlign:"center" }}>H</span>{SEP}
            <span style={{ textAlign:"center" }}>TB</span>{SEP}
            <span style={{ textAlign:"center" }}>HRR</span>
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:HV_COLS, gap:6, padding:"2px 10px",
            fontFamily:MONO, fontSize:9, letterSpacing:"0.04em", textTransform:"uppercase",
            color:C.ruleDark, alignItems:"center" }}>
            <span>#</span><span>Hitter</span>
            <span style={{ textAlign:"right" }}>AB</span><span style={{ textAlign:"right" }}>H</span>
            <span style={{ textAlign:"right" }}>HR</span><span style={{ textAlign:"right" }}>AVG</span>
          </div>
        )}

        {!lineup && <div style={{ padding:"10px 12px", fontFamily:MONO, fontSize:12, color:C.inkSoft }}>Loading lineup…</div>}
        {lineup && lineup.players.length===0 &&
          <div style={{ padding:"8px 12px", fontFamily:SANS, fontSize:12, color:C.inkSoft }}>—</div>}

        {lineup && lineup.players.map(p=>{
          const hot = nameStreak(p);
          if (view==="last5") {
            return (
            <div key={p.id} style={{ display:"grid", gridTemplateColumns:ROW_COLS, gap:6,
              padding:"3px 10px", alignItems:"center", borderTop:`1px solid #EEF0F2` }}>
              <span style={{ fontFamily:MONO, fontSize:11, color:C.ruleDark }}>{p.order}</span>
              <span style={{ fontFamily:SANS, fontSize:12.5, whiteSpace:"nowrap",
                overflow:"hidden", textOverflow:"ellipsis",
                background: hot ? "rgba(255,233,77,0.5)" : "transparent", borderRadius:1 }}
                title={p.name}>{p.name}</span>
              <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft, textAlign:"right" }}>{p.avg || "—"}</span>
              <SeqBlock arr={p.h} label="hits" onPick={onStat && (()=>onStat(p.name,"hits"))} />{SEP}
              <SeqBlock arr={p.tb} label="total bases" onPick={onStat && (()=>onStat(p.name,"totalBases"))} />{SEP}
              <SeqBlock arr={p.hrr} label="H+R+RBI" onPick={onStat && (()=>onStat(p.name,"hits+runs+rbi"))} />
            </div>
            );
          }
          // vs-pitcher view
          const st = vsData[p.id];
          return (
          <div key={p.id} style={{ display:"grid", gridTemplateColumns:HV_COLS, gap:6,
            padding:"3px 10px", alignItems:"center", borderTop:`1px solid #EEF0F2` }}>
            <span style={{ fontFamily:MONO, fontSize:11, color:C.ruleDark }}>{p.order}</span>
            <span style={{ fontFamily:SANS, fontSize:12.5, whiteSpace:"nowrap",
              overflow:"hidden", textOverflow:"ellipsis" }} title={p.name}>{p.name}</span>
            {vsLoading && !st ? (
              <span style={{ gridColumn:"3 / span 4", fontFamily:MONO, fontSize:10,
                color:C.ruleDark, textAlign:"right" }}>…</span>
            ) : !st || Number(st.atBats)===0 ? (
              <span style={{ gridColumn:"3 / span 4", fontFamily:MONO, fontSize:10,
                color:C.ruleDark, textAlign:"right" }}>no history</span>
            ) : (
              <>
                <span style={{ fontFamily:MONO, fontSize:12, textAlign:"right", color:C.ink }}>{st.atBats}</span>
                <span style={{ fontFamily:MONO, fontSize:12, textAlign:"right",
                  color: Number(st.hits)>0?C.over:C.ink }}>{st.hits}</span>
                <span style={{ fontFamily:MONO, fontSize:12, textAlign:"right",
                  color: Number(st.homeRuns)>0?C.over:C.ink }}>{st.homeRuns}</span>
                <span style={{ fontFamily:MONO, fontSize:12, textAlign:"right", fontWeight:700,
                  color: (parseFloat(st.avg)||0) < 0.200 ? C.under
                       : (parseFloat(st.avg)||0) > 0.250 ? C.over : C.ink }}>{st.avg}</span>
              </>
            )}
          </div>
          );
        })}
        {view==="vssp" && !canVs && (
          <div style={{ padding:"8px 12px", fontFamily:SANS, fontSize:12, color:C.inkSoft }}>
            No probable starter posted for {oppName} yet.</div>)}
      </div>

      {/* starting pitcher (upcoming games) or the full game's pitching line
          (live/finished games) — visually separated from the hitters */}
      <div style={{ margin:"6px 10px 12px", padding:"10px 12px", borderRadius:3,
        background:"#fff", border:`1px solid ${C.rule}` }}>
        {showBoxPitching ? (
          <>
            <div style={{ fontFamily:MONO, fontSize:9, letterSpacing:"0.12em", textTransform:"uppercase",
              color:C.ruleDark, marginBottom:6 }}>Pitching</div>
            {!boxPitchers ? (
              <div style={{ fontFamily:MONO, fontSize:12, color:C.inkSoft }}>Loading…</div>
            ) : boxPitchers.length===0 ? (
              <div style={{ fontFamily:SANS, fontSize:13, color:C.inkSoft }}>No pitching stats yet.</div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {boxPitchers.map(p => <PitcherStatLine key={p.pid} p={p} />)}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontFamily:MONO, fontSize:9, letterSpacing:"0.12em", textTransform:"uppercase",
              color:C.ruleDark, marginBottom:4 }}>Starting pitcher</div>
            <PitcherBlock name={pitcherName} pid={pitcherId} vsName={oppName} info={pitcherInfo} bare />
          </>
        )}
      </div>
    </div>
  );
}

// single-line text that shrinks its font-size to fit the container's width
// instead of wrapping or ellipsis-truncating.
function FitTitle({ text, maxSize = 18, minSize = 12, style }) {
  const ref = useRef(null);
  const [fontSize, setFontSize] = useState(maxSize);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let size = maxSize;
      el.style.fontSize = size + "px";
      while (el.scrollWidth > el.clientWidth && size > minSize) {
        size -= 1;
        el.style.fontSize = size + "px";
      }
      setFontSize(size);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [text, maxSize, minSize]);
  return <div ref={ref} style={{ whiteSpace:"nowrap", overflow:"hidden", fontSize, ...style }}>{text}</div>;
}

function GameModal({ m, tags, setTag, onClose }) {
  const { date, games, trends } = m;
  const [idx, setIdx] = useState(m.idx || 0);
  const g = games[idx];
  const t = trends[idx];
  const hasPrev = idx > 0, hasNext = idx < games.length - 1;
  const go = (delta) => { setTagEditing(false); setIdx(i => Math.min(games.length-1, Math.max(0, i+delta))); };
  const [awayLU, setAwayLU] = useState(null);
  const [homeLU, setHomeLU] = useState(null);
  const [awayP,  setAwayP]  = useState(undefined);   // away SP vs home
  const [homeP,  setHomeP]  = useState(undefined);   // home SP vs away
  const [h2h,    setH2H]    = useState(undefined);
  const [h2hOpen, setH2hOpen] = useState(false);
  const [pick,   setPick]   = useState(null);   // {name, stat, ts} -> prop analyzer
  const [ls,     setLs]     = useState(g.isFinal ? undefined : null);  // line score (final games only)
  // live/finished games show the game's actual pitching box score instead
  // of the probable-starter preview
  const showBoxPitching = g.isFinal || g.isLive;
  const [boxPitching, setBoxPitching] = useState(showBoxPitching ? undefined : null);
  const [tagEditing, setTagEditing] = useState(false);
  const [copied, setCopied] = useState(null);   // ok|dl|err feedback for Export
  const tagVal = tagText(tags?.[g.gamePk]);

  // export a clean PNG of this game's calendar card (indicators-off look) + tag
  const exportCard = () => {
    try {
      const scale = 3, W = 300, H = 96;                // logical size, upscaled for crispness
      const cv = document.createElement("canvas");
      cv.width = W*scale; cv.height = H*scale;
      const x = cv.getContext("2d"); x.scale(scale, scale);
      const bg = tagResultBg(tags?.[g.gamePk])
        || (g.seriesShade!=null ? SERIES_SHADE[g.seriesShade] : "#FFFFFF");
      const final = g.isFinal && g.awayScore!=null && g.homeScore!=null;
      const aw = TEAM_ABBR[g.awayId]||"?", hm = TEAM_ABBR[g.homeId]||"?";
      const time = new Date(g.time).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
      // card
      x.fillStyle = "#E2E5EA"; x.fillRect(0,0,W,H);          // paper margin
      const pad = 10, cx = pad, cy = pad, cw = W-pad*2, ch = H-pad*2;
      x.fillStyle = bg; x.strokeStyle = "#C9CED6"; x.lineWidth = 1;
      const rr = 4;
      x.beginPath();
      x.moveTo(cx+rr,cy); x.arcTo(cx+cw,cy,cx+cw,cy+ch,rr); x.arcTo(cx+cw,cy+ch,cx,cy+ch,rr);
      x.arcTo(cx,cy+ch,cx,cy,rr); x.arcTo(cx,cy,cx+cw,cy,rr); x.closePath(); x.fill(); x.stroke();
      // time / FINAL, top-right
      x.fillStyle = "#8A929E"; x.font = "9px ui-monospace, Menlo, monospace";
      x.textAlign = "right"; x.fillText(final?"FINAL":time, cx+cw-8, cy+14);
      // teams + scores
      x.textAlign = "left"; x.fillStyle = "#14181F";
      x.font = "700 15px system-ui, sans-serif";
      x.fillText(aw, cx+12, cy+34);
      x.fillText(hm, cx+12, cy+56);
      if (final) {
        x.textAlign = "right"; x.font = "700 15px ui-monospace, Menlo, monospace";
        x.fillStyle = g.awayScore>g.homeScore ? "#14181F" : "#79818D";
        x.fillText(String(g.awayScore), cx+cw-14, cy+34);
        x.fillStyle = g.homeScore>g.awayScore ? "#14181F" : "#79818D";
        x.fillText(String(g.homeScore), cx+cw-14, cy+56);
      }
      // tagged play written big, filling most of the empty space to the
      // right of the team names/scores
      if (tagVal) {
        drawRedTag(x, tagVal, cx + cw*0.60, cy + ch/2, cw*0.78, 36);
      }
      copyCanvas(cv, `${aw}-${hm}-${(g.time||"").slice(0,10)}.png`, setCopied);
    } catch (e) {
      console.error("exportCard failed:", e);
      setCopied("err"); setTimeout(()=>setCopied(null), 2000);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      // box score by inning (finished games only) — shown above H2H
      if (g.isFinal) loadLineScore(g.gamePk).then(r=>{ if(alive) setLs(r); });
      // full game pitching line (live/finished games only)
      if (g.isFinal || g.isLive) loadBoxscorePitchers(g.gamePk).then(r=>{ if(alive) setBoxPitching(r); });
      // H2H summary (top-of-modal overview)
      try { const s = await loadH2H(g.awayId, g.homeId); if(alive) setH2H(s); }
      catch { if(alive) setH2H(null); }
      // pitchers vs opposing team
      loadPitcherVs(g.awayPid, g.homeId, date).then(r=>{ if(alive) setAwayP(r); });
      loadPitcherVs(g.homePid, g.awayId, date).then(r=>{ if(alive) setHomeP(r); });
      // lineups + per-batter trends
      for (const side of ["away","home"]) {
        loadLineup(g._raw, side, date).then(async lu=>{
          const players = await mapPool(lu.players, 4, async pl=>({ ...pl, ...(await loadBatterTrend(pl.id, date)) }));
          if(!alive) return;
          (side==="away"?setAwayLU:setHomeLU)({ ...lu, players });
        });
      }
    })();
    return () => { alive = false; };
  }, [g, date]);

  // arrow keys navigate between the day's games
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [games.length]);

  // lock background scroll while open, so scrolling the modal never
  // leaks through to the page behind it once you hit the top/bottom
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const aAbbr = TEAM_ABBR[g.awayId]||"?", hAbbr = TEAM_ABBR[g.homeId]||"?";
  const time = new Date(g.time).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:50,
      background:"rgba(20,24,31,0.55)", display:"flex", alignItems:"flex-start",
      justifyContent:"center", padding:"max(12px, env(safe-area-inset-top)) 12px 12px",
      overflowY:"auto", overscrollBehavior:"contain" }}>

      {/* side nav arrows — same day's games only */}
      {hasPrev && (
        <button onClick={e=>{ e.stopPropagation(); go(-1); }} aria-label="Previous game"
          className="ts-nav-arrow" style={{ position:"fixed", left:8, top:"50%", transform:"translateY(-50%)",
          zIndex:55, width:42, height:42, borderRadius:"50%", border:`1px solid ${C.ink}`,
          background:C.paper, color:C.ink, fontFamily:MONO, fontSize:18, cursor:"pointer",
          boxShadow:"0 4px 14px rgba(0,0,0,0.25)", display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
      )}
      {hasNext && (
        <button onClick={e=>{ e.stopPropagation(); go(1); }} aria-label="Next game"
          className="ts-nav-arrow" style={{ position:"fixed", right:8, top:"50%", transform:"translateY(-50%)",
          zIndex:55, width:42, height:42, borderRadius:"50%", border:`1px solid ${C.ink}`,
          background:C.paper, color:C.ink, fontFamily:MONO, fontSize:18, cursor:"pointer",
          boxShadow:"0 4px 14px rgba(0,0,0,0.25)", display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
      )}

      <div onClick={e=>e.stopPropagation()} style={{ background:C.paper,
        border:`1px solid ${C.ink}`, borderRadius:6, maxWidth:760, width:"100%",
        margin:"12px 0 40px", boxShadow:"0 20px 60px rgba(0,0,0,0.35)" }}>

        {/* sticky region: header + tag editor scroll together */}
        <div style={{ position:"sticky", top:0, zIndex:3, background:C.paper,
          borderTopLeftRadius:6, borderTopRightRadius:6 }}>
        {/* header */}
        <div className="ts-modal-head" style={{ padding:"14px 18px", borderBottom:`2px solid ${C.ink}`,
          background:C.paper, borderTopLeftRadius:6, borderTopRightRadius:6 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
            <div style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.14em",
              textTransform:"uppercase", color:C.inkSoft, minWidth:0 }}>{prettyDay(date)} · {time}
              {games.length>1 && <span style={{ color:C.ruleDark }}> · game {idx+1}/{games.length}</span>}</div>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
              {games.length>1 && (
                <span className="ts-nav-inline" style={{ display:"none", gap:4 }}>
                  <button onClick={()=>go(-1)} disabled={!hasPrev} aria-label="Previous game"
                    style={{ width:32, height:32, borderRadius:4, border:`1px solid ${C.rule}`,
                      background:"#fff", color:hasPrev?C.ink:C.rule, fontFamily:MONO, fontSize:16,
                      cursor:hasPrev?"pointer":"default", lineHeight:1 }}>‹</button>
                  <button onClick={()=>go(1)} disabled={!hasNext} aria-label="Next game"
                    style={{ width:32, height:32, borderRadius:4, border:`1px solid ${C.rule}`,
                      background:"#fff", color:hasNext?C.ink:C.rule, fontFamily:MONO, fontSize:16,
                      cursor:hasNext?"pointer":"default", lineHeight:1 }}>›</button>
                </span>
              )}
              <button onClick={()=>setTagEditing(v=>!v)}
                title={tagVal ? "Edit play tag" : "Tag this game"}
                style={{ border:`1px solid ${tagVal?"#D7263D":C.rule}`,
                  background:tagVal?"#F2657A":"#fff", color:tagVal?"#fff":C.ink,
                  borderRadius:3, fontFamily:MONO, fontSize:11, letterSpacing:"0.08em",
                  textTransform:"uppercase", padding:"5px 10px", cursor:"pointer", fontWeight:700 }}>
                {tagVal ? "Play ✓" : "Play"}</button>
              <button onClick={exportCard} title="Copy game image to clipboard"
                aria-label="Copy game image"
                style={{ border:`1px solid ${copied==="ok"?C.over:C.rule}`, background:"#fff",
                  color:copied==="ok"?C.over:C.ink,
                  borderRadius:3, fontFamily:MONO, fontSize:11, letterSpacing:"0.08em",
                  textTransform:"uppercase", padding:"5px 10px", cursor:"pointer" }}>
                {copied==="ok" ? "Copied ✓" : copied==="dl" ? "Saved ✓" : copied==="err" ? "Failed" : "Copy"}</button>
              <button onClick={onClose} style={{ border:`1px solid ${C.rule}`, background:"#fff",
                borderRadius:2, fontFamily:MONO, fontSize:13, padding:"4px 10px", cursor:"pointer" }}>✕</button>
            </div>
          </div>
          <FitTitle text={`${g.awayName} @ ${g.homeName}`} maxSize={18} minSize={12}
            style={{ fontFamily:SANS, fontWeight:800, letterSpacing:"-0.01em", marginTop:4 }} />
        </div>

        {/* tag editor */}
        {tagEditing && (
          <div style={{ padding:"10px 18px", borderBottom:`1px solid ${C.rule}`, background:"#FFF3F4",
            display:"flex", gap:8, alignItems:"center" }}>
            <input autoFocus defaultValue={tagVal}
              placeholder="e.g. PLAY · over 8.5 · fade the public"
              onKeyDown={e=>{ if(e.key==="Enter"){ setTag(g, e.target.value); setTagEditing(false); } }}
              onBlur={e=>{ setTag(g, e.target.value); }}
              style={{ flex:1, ...inputStyle }} />
            <button onMouseDown={e=>{ e.preventDefault(); setTag(g, ""); setTagEditing(false); }}
              style={{ border:`1px solid ${C.rule}`, background:"#fff", borderRadius:2,
                fontFamily:MONO, fontSize:11, padding:"6px 10px", cursor:"pointer", color:C.under }}>Remove</button>
          </div>
        )}
        </div>
        {/* end sticky region */}

        {/* ── BOX SCORE BY INNING (finished games, above H2H) ── */}
        {g.isFinal && ls !== null && (
          <div style={{ padding:"12px 18px", borderBottom:`1px solid ${C.rule}` }}>
            <div style={{ fontFamily:MONO, fontSize:9.5, letterSpacing:"0.12em", textTransform:"uppercase",
              color:C.inkSoft, marginBottom:6 }}>Final · line score</div>
            {ls === undefined ? (
              <div style={{ fontFamily:MONO, fontSize:12, color:C.inkSoft }}>Loading…</div>
            ) : (() => {
              const innings = ls.innings || [];
              const tot = ls.teams || {};
              const cell = { fontFamily:MONO, fontSize:12, textAlign:"center", padding:"3px 0" };
              const head = { ...cell, fontSize:9, color:C.ruleDark, letterSpacing:"0.04em" };
              const tcol = "minmax(54px,1fr)";
              const cols = `${tcol} repeat(${innings.length}, 18px) 10px 22px 22px 22px`;
              const Row = ({ side, label }) => {
                const t = tot[side] || {};
                return (
                  <div style={{ display:"grid", gridTemplateColumns:cols, gap:3, alignItems:"center" }}>
                    <span style={{ fontFamily:SANS, fontSize:12.5, fontWeight:700, whiteSpace:"nowrap",
                      overflow:"hidden", textOverflow:"ellipsis" }}>{label}</span>
                    {innings.map((inn,i)=>{
                      const v = inn[side]?.runs;
                      return <span key={i} style={cell}>{v==null?"-":v}</span>;
                    })}
                    <span/>
                    <span style={{ ...cell, fontWeight:700 }}>{t.runs ?? 0}</span>
                    <span style={cell}>{t.hits ?? 0}</span>
                    <span style={cell}>{t.errors ?? 0}</span>
                  </div>
                );
              };
              return (
                <div style={{ overflowX:"auto" }}>
                  <div style={{ display:"grid", gridTemplateColumns:cols, gap:3 }}>
                    <span/>
                    {innings.map((inn,i)=><span key={i} style={head}>{inn.num||i+1}</span>)}
                    <span/>
                    <span style={{ ...head, fontWeight:700, color:C.inkSoft }}>R</span>
                    <span style={head}>H</span>
                    <span style={head}>E</span>
                  </div>
                  <Row side="away" label={aAbbr} />
                  <Row side="home" label={hAbbr} />
                </div>
              );
            })()}
          </div>
        )}

        {/* ── H2H OVERVIEW (top) — tap to expand the past meetings ── */}
        <div style={{ padding:"12px 18px", borderBottom:`1px solid ${C.rule}`, background:C.card }}>
          <div onClick={()=> h2h && h2h.played>0 && setH2hOpen(v=>!v)}
            style={{ cursor: h2h && h2h.played>0 ? "pointer" : "default" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
              <div style={{ fontFamily:MONO, fontSize:9.5, letterSpacing:"0.12em", textTransform:"uppercase",
                color:C.inkSoft, marginBottom:6 }}>Season head-to-head</div>
              {h2h && h2h.played>0 && (
                <span style={{ fontFamily:MONO, fontSize:10, color:C.inkSoft, marginBottom:6,
                  transform: h2hOpen?"rotate(180deg)":"none", transition:"transform 0.15s" }}>▾</span>
              )}
            </div>
            {h2h===undefined ? (
              <div style={{ fontFamily:MONO, fontSize:12, color:C.inkSoft }}>Loading…</div>
            ) : !h2h || h2h.played===0 ? (
              <div style={{ fontFamily:SANS, fontSize:13, color:C.inkSoft }}>
                No completed meetings yet this season{h2h&&h2h.upcoming>0?` · ${h2h.upcoming} scheduled`:""}.</div>
            ) : (
              <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
                <div style={{ fontFamily:MONO, fontSize:20, fontWeight:700 }}>
                  <span style={{ color: h2h.aw>h2h.bw?C.over:C.ink }}>{aAbbr} {h2h.aw}</span>
                  <span style={{ color:C.ruleDark }}> – </span>
                  <span style={{ color: h2h.bw>h2h.aw?C.over:C.ink }}>{h2h.bw} {hAbbr}</span>
                </div>
                {h2h.upcoming>0 && <span style={{ fontFamily:MONO, fontSize:10.5, color:C.ruleDark }}>{h2h.upcoming} more scheduled</span>}
              </div>
            )}
          </div>
          {h2hOpen && h2h && h2h.played>0 && (
            <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.rule}`,
              display:"flex", flexDirection:"column", gap:6 }}>
              {h2h.meetings.map((mg,i)=>(
                <div key={i} style={{ display:"flex", alignItems:"baseline", gap:10,
                  fontFamily:MONO, fontSize:11.5 }}>
                  <span style={{ color:C.ruleDark, width:38, flexShrink:0 }}>{calDay(mg.date).md}</span>
                  <span style={{ flex:1, textAlign:"right", fontWeight: mg.aScore>mg.bScore?700:400,
                    color: mg.aScore>mg.bScore?C.over:C.inkSoft }}>
                    {aAbbr} {mg.aScore}<span style={{color:C.ruleDark, fontWeight:400}}>({mg.aHits})</span></span>
                  <span style={{ color:C.ruleDark }}>–</span>
                  <span style={{ flex:1, fontWeight: mg.bScore>mg.aScore?700:400,
                    color: mg.bScore>mg.aScore?C.over:C.inkSoft }}>
                    {mg.bScore}<span style={{color:C.ruleDark, fontWeight:400}}>({mg.bHits})</span> {hAbbr}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* trend pills, if any */}
        {t && t.any && (
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", padding:"10px 18px 2px" }}>
            {t.travel && <Pill color={C.travel} title="Played out west yesterday, East today on back-to-back days">B2B travel</Pill>}
            {t.echo.map((e,i)=><Pill key={i} color={C.echo} title="Just snapped a 10+ game win or loss streak yesterday">streak echo → {e.predicted==="W"?"win":"loss"}</Pill>)}
            {t.cb.map((c,i)=><Pill key={i} color={C.late} title="Never led until the 8th inning or later yesterday">late go-ahead {ord(c.inning)}</Pill>)}
            {t.rematch.map((r,i)=><Pill key={i} color={C.rematch} title="Has faced this pitcher this year already">pitcher rematch</Pill>)}
            {t.bigday.map((b,i)=><Pill key={i} color={C.bigday} title="Scored 10+ runs yesterday">{b.team.split(" ").slice(-1)[0]} {b.runs} runs prior day</Pill>)}
          </div>
        )}

        {/* ── lineups: away left, home right (stack on mobile) ── */}
        <div className="ts-lineups" style={{ gap:0 }}>
          <TeamPanel teamName={g.awayName} oppName={g.homeName}
            lineup={awayLU} pitcherName={g.awayPname} pitcherId={g.awayPid} pitcherInfo={awayP}
            oppPitcherName={g.homePname} oppPitcherId={g.homePid}
            showBoxPitching={showBoxPitching} boxPitchers={boxPitching?.away}
            onStat={(name,stat)=>setPick({ name, stat, ts:Date.now() })} />
          <div style={{ borderLeft:`1px solid ${C.rule}` }} className="ts-h2h-divider">
            <TeamPanel teamName={g.homeName} oppName={g.awayName}
              lineup={homeLU} pitcherName={g.homePname} pitcherId={g.homePid} pitcherInfo={homeP}
              oppPitcherName={g.awayPname} oppPitcherId={g.awayPid}
              showBoxPitching={showBoxPitching} boxPitchers={boxPitching?.home}
              onStat={(name,stat)=>setPick({ name, stat, ts:Date.now() })} />
          </div>
        </div>

        <div style={{ padding:"8px 18px 16px", fontFamily:MONO, fontSize:9.5, color:C.ruleDark, lineHeight:1.6 }}>
          Tap a hitter’s name for their career vs the opposing starter; tap any H · TB · HRR
          last-5 line to open the prop analyzer for that stat.
        </div>
      </div>

      {pick && <PropModal injected={pick} onClose={()=>setPick(null)} />}
    </div>
  );
}

/* ════════════════════════════ shell ════════════════════════════ */
const RESPONSIVE_CSS = `
/* kill the browser's default body margin so the app reaches every edge
   of the viewport instead of leaving a rim of the page's default white */
html, body { margin:0; padding:0; background:${C.paper}; overscroll-behavior-y:none; }
#root { min-height:100vh; }
@font-face {
  font-family: 'Permanent Marker';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('${import.meta.env.BASE_URL}fonts/PermanentMarker-Regular.woff2') format('woff2');
}
@keyframes ts-spin { to { transform: rotate(360deg); } }
.ts-cal { display:grid; grid-template-columns: repeat(7, minmax(400px,1fr)); overflow-x:auto; }
.ts-cal-col { min-width:400px; }
.ts-lineups { display:grid; grid-template-columns:1fr 1fr; }
.ts-app { padding:calc(28px + env(safe-area-inset-top)) calc(18px + env(safe-area-inset-right))
  calc(60px + env(safe-area-inset-bottom)) calc(18px + env(safe-area-inset-left)); }
.ts-cell { box-sizing:border-box; }
@media (max-width:760px){
  .ts-cal { grid-auto-flow:column; grid-auto-columns:94%; grid-template-columns:none;
            overflow-x:auto; scroll-snap-type:x mandatory; scroll-padding-left:0; }
  .ts-cal-col { min-width:0; scroll-snap-align:start; }
  .ts-lineups { grid-template-columns:1fr; }
  .ts-lineup-col { border-right:none !important; }
  .ts-lineup-col + .ts-lineup-col { border-top:1px solid #CDD3DA; }
  .ts-h2h-divider { border-left:none !important; border-top:1px solid #CDD3DA; }
  .ts-app { padding:calc(14px + env(safe-area-inset-top)) calc(6px + env(safe-area-inset-right))
    calc(36px + env(safe-area-inset-bottom)) calc(6px + env(safe-area-inset-left)); }
  .ts-nav-arrow { display:none !important; }
  .ts-nav-inline { display:inline-flex !important; }
  .ts-modal-head { padding:10px 12px !important; gap:8px !important; }
  .ts-record-chart { flex:1 1 100% !important; min-width:0 !important; width:100%; }
}
* { -webkit-tap-highlight-color: transparent; }
`;

/* ════════════════════════ TAGS VIEW ════════════════════════ */
function TagsView({ tags, setResult }) {
  const [range, setRange] = useState("all");   // all|month|lastmonth|7d|30d

  // build a list of tagged games: newest DAY first, earliest game-time first within a day
  const allRows = useMemo(() => {
    return Object.entries(tags || {})
      .map(([gamePk, entry]) => {
        if (typeof entry === "string") return { gamePk, text:entry, date:"", time:"", away:"", home:"", result:null };
        return { gamePk, text:entry.text||"", date:entry.date||"", time:entry.time||"",
          away:entry.away||"", home:entry.home||"",
          awayId:entry.awayId, homeId:entry.homeId, result:entry.result||null };
      })
      .filter(r => r.text)
      .sort((a,b) => {
        const d = (b.date||"").localeCompare(a.date||"");   // newest day first
        if (d !== 0) return d;
        return (b.time||"").localeCompare(a.time||"");        // latest first-pitch first
      });
  }, [tags]);

  // date-range filter
  const { rows, rangeLabel } = useMemo(() => {
    const today = new Date();
    const iso = (d)=>d.toISOString().slice(0,10);
    let from = null, to = null, label = "All time";
    if (range === "month") {
      from = iso(new Date(today.getFullYear(), today.getMonth(), 1));
      label = "This month";
    } else if (range === "lastmonth") {
      from = iso(new Date(today.getFullYear(), today.getMonth()-1, 1));
      to   = iso(new Date(today.getFullYear(), today.getMonth(), 0));
      label = "Last month";
    } else if (range === "7d") {
      const d=new Date(today); d.setDate(d.getDate()-6); from=iso(d); label="Last 7 days";
    } else if (range === "30d") {
      const d=new Date(today); d.setDate(d.getDate()-29); from=iso(d); label="Last 30 days";
    }
    const filtered = allRows.filter(r => {
      if (!r.date) return range === "all";      // undated tags only show in All time
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      return true;
    });
    return { rows: filtered, rangeLabel: label };
  }, [allRows, range]);

  const wins = rows.filter(r=>r.result==="W").length;
  const losses = rows.filter(r=>r.result==="L").length;
  const pushes = rows.filter(r=>r.result==="P").length;
  const decided = wins + losses;   // pushes don't count toward win% or net
  const graded = decided + pushes;
  const pct = decided > 0 ? Math.round((wins/decided)*100) : null;

  // cumulative net (W = +1, L = -1). Pushes don't move the record, so they're
  // left off the graph entirely. Built from the SAME ordered list as the
  // plays section: the list is newest-first, so we reverse it to run oldest→
  // newest for a correct running total, then plot left-to-right. Each point
  // gets a unique index + matchup so clicking it is unambiguous.
  const chartData = useMemo(() => {
    const chrono = rows.filter(r=>r.result==="W" || r.result==="L").slice().reverse();
    if (!chrono.length) return [];
    let net = 0;
    const origin = { i:0, label:"", net:0, result:null, matchup:"", text:"" };
    const points = chrono.map((r,i) => {
      net += r.result==="W" ? 1 : -1;
      const matchup = r.away && r.home
        ? `${TEAM_ABBR[r.awayId]||r.away}@${TEAM_ABBR[r.homeId]||r.home}` : "";
      return {
        i: i+1,
        label: r.date ? r.date.slice(5) : `#${i+1}`,
        net, result:r.result, matchup,
        text: r.text.length>22 ? r.text.slice(0,21)+"…" : r.text,
      };
    });
    return [origin, ...points];
  }, [rows]);
  // dots only at local highs/lows (direction changes) plus the first/last point
  const dotIdx = useMemo(() => {
    const s = new Set();
    chartData.forEach((d,i)=>{
      if (i===0 || i===chartData.length-1) { s.add(i); return; }
      const prev = chartData[i-1].net, next = chartData[i+1].net;
      if ((d.net>prev && d.net>next) || (d.net<prev && d.net<next)) s.add(i);
    });
    return s;
  }, [chartData]);

  const resBtn = (r, val, label, color) => {
    const on = r.result === val;
    return (
      <button onClick={()=>setResult(r.gamePk, on ? null : val)}
        title={on ? `Clear ${label}` : `Mark ${label}`}
        style={{ width:30, height:28, borderRadius:3, cursor:"pointer",
          border:`1px solid ${on ? color : C.rule}`,
          background: on ? color : "#fff", color: on ? "#fff" : C.inkSoft,
          fontFamily:MONO, fontSize:12, fontWeight:700 }}>{label}</button>
    );
  };

  const FILTERS = [["all","All"],["month","This month"],["lastmonth","Last month"],
    ["7d","7 days"],["30d","30 days"]];

  if (!allRows.length) {
    return (
      <div style={{ padding:"40px 8px", fontFamily:SANS, fontSize:14, color:C.inkSoft }}>
        No tagged games yet. Open any game on the calendar and hit <b>Play</b> to tag it — your
        plays collect here with a running record and chart.
      </div>
    );
  }

  return (
    <div>
      {/* ─────────── RECORD DASHBOARD (visually distinct) ─────────── */}
      <div style={{ border:`2px solid ${C.ink}`, borderRadius:6, overflow:"hidden",
        background:C.ink, marginBottom:26 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          gap:10, padding:"10px 16px", flexWrap:"wrap" }}>
          <span style={{ fontFamily:MONO, fontSize:11, letterSpacing:"0.18em",
            textTransform:"uppercase", color:"rgba(255,255,255,0.6)" }}>Track Record</span>
          {/* filters */}
          <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
            {FILTERS.map(([id,lbl])=>(
              <button key={id} onClick={()=>setRange(id)} style={{ padding:"4px 9px",
                border:`1px solid ${range===id?"#fff":"rgba(255,255,255,0.25)"}`, borderRadius:2,
                background:range===id?"#fff":"transparent", color:range===id?C.ink:"rgba(255,255,255,0.75)",
                fontFamily:MONO, fontSize:10, letterSpacing:"0.04em", textTransform:"uppercase",
                cursor:"pointer" }}>{lbl}</button>))}
          </div>
        </div>

        <div style={{ background:C.paper, padding:"16px", display:"flex", gap:20,
          flexWrap:"wrap", alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:MONO, fontSize:38, fontWeight:700, lineHeight:1 }}>
              <span style={{ color:C.over }}>{wins}</span>
              <span style={{ color:C.ruleDark }}>–</span>
              <span style={{ color:C.under }}>{losses}</span>
            </div>
            <div style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft, marginTop:4 }}>
              {rangeLabel}{pct!=null ? ` · ${pct}% win` : ""}</div>
            <div style={{ fontFamily:MONO, fontSize:10, color:C.ruleDark, marginTop:1 }}>
              {graded} graded{rows.length>graded ? ` · ${rows.length-graded} untracked` : ""}</div>
          </div>

          {/* cumulative net chart */}
          <div className="ts-record-chart" style={{ flex:1, minWidth:220, height:240 }}>
            {chartData.length < 2 ? (
              <div style={{ fontFamily:MONO, fontSize:11, color:C.ruleDark,
                display:"flex", alignItems:"center", height:"100%" }}>
                Grade at least 1 play in this range to see the trend.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top:8, right:14, bottom:0, left:0 }}>
                  <XAxis dataKey="i" type="number" domain={[0, chartData.length-1]}
                    tick={{ fontFamily:MONO, fontSize:8, fill:C.inkSoft }}
                    axisLine={{ stroke:C.rule }} tickLine={false}
                    allowDecimals={false} minTickGap={16} padding={{ left:6, right:6 }} />
                  <YAxis tick={{ fontFamily:MONO, fontSize:9, fill:C.inkSoft }}
                    axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                  <Tooltip content={({ active, payload })=>{
                    if(!active || !payload || !payload.length) return null;
                    const d = payload[0].payload;
                    if (!d.result) return (
                      <div style={{ background:"#fff", border:`1px solid ${C.rule}`, borderRadius:3,
                        padding:"6px 9px", fontFamily:MONO, fontSize:11, lineHeight:1.5 }}>
                        <div style={{ color:C.inkSoft }}>Start</div>
                      </div>
                    );
                    return (
                      <div style={{ background:"#fff", border:`1px solid ${C.rule}`, borderRadius:3,
                        padding:"6px 9px", fontFamily:MONO, fontSize:11, lineHeight:1.5 }}>
                        <div style={{ color:C.inkSoft }}>#{d.i} · {d.label}
                          {d.matchup ? ` · ${d.matchup}` : ""}</div>
                        <div>{d.text}</div>
                        <div>
                          <span style={{ color:d.result==="W"?C.over:d.result==="L"?C.under:C.blue, fontWeight:700 }}>{d.result}</span>
                          <span style={{ color:C.ruleDark }}>{"  ·  net "}</span>
                          <span style={{ fontWeight:700,
                            color:d.net>0?C.over:d.net<0?C.under:C.ink }}>{d.net>0?"+":""}{d.net}</span>
                        </div>
                      </div>
                    );
                  }} />
                  <ReferenceLine y={0} stroke={C.ruleDark} strokeDasharray="3 3" />
                  <Line type="linear" dataKey="net" stroke={C.blue} strokeWidth={2}
                    dot={(p)=>{
                      if (!dotIdx.has(p.index)) return <React.Fragment key={p.index} />;
                      return <circle key={p.index} cx={p.cx} cy={p.cy} r={2.5} fill={C.blue} />;
                    }}
                    activeDot={{ r:4 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ─────────── PLAY LIST ─────────── */}
      <Eyebrow n="01">Plays · newest first{range!=="all" ? ` · ${rangeLabel.toLowerCase()}` : ""}</Eyebrow>
      {rows.length===0 ? (
        <div style={{ padding:"18px 4px", fontFamily:SANS, fontSize:13, color:C.inkSoft }}>
          No plays in this range.</div>
      ) : (
      <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:14 }}>
        {rows.map(r => {
          const graded = r.result==="W" || r.result==="L" || r.result==="P";
          const tint = r.result==="W" ? "rgba(27,127,92,0.10)"
                     : r.result==="L" ? "rgba(215,38,61,0.09)"
                     : r.result==="P" ? "rgba(43,76,126,0.09)" : "#fff";
          const edge = r.result==="W" ? C.over : r.result==="L" ? C.under
                     : r.result==="P" ? C.blue : C.rule;

          if (graded) {
            // compact one-line row so more plays fit on screen
            return (
              <div key={r.gamePk} style={{ display:"flex", alignItems:"center", gap:10,
                border:`1px solid ${C.rule}`, borderLeft:`4px solid ${edge}`, borderRadius:4,
                background:tint, padding:"5px 10px" }}>
                <span style={{ fontFamily:MONO, fontSize:12, fontWeight:700,
                  color: r.result==="W"?C.over:r.result==="L"?C.under:C.blue, flexShrink:0, width:14 }}>{r.result}</span>
                <span style={{ fontFamily:MONO, fontSize:10.5, fontWeight:700, color:C.inkSoft,
                  flexShrink:0, whiteSpace:"nowrap" }}>
                  {r.away && r.home ? `${TEAM_ABBR[r.awayId]||r.away}@${TEAM_ABBR[r.homeId]||r.home}` : ""}</span>
                <span style={{ fontFamily:SANS, fontSize:13, fontWeight:600, color:C.ink,
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", flex:1, minWidth:0 }}
                  title={r.text}>{r.text}</span>
                <span style={{ fontFamily:MONO, fontSize:9.5, color:C.ruleDark, flexShrink:0,
                  whiteSpace:"nowrap", textAlign:"right" }}>
                  {r.date ? calDay(r.date).md : ""}{r.time ? ` · ${fmtTime(r.time)}` : ""}</span>
                <button onClick={()=>setResult(r.gamePk, null)} title="Undo result"
                  style={{ flexShrink:0, width:26, height:24, borderRadius:3, cursor:"pointer",
                    border:`1px solid ${C.rule}`, background:"#fff", color:C.inkSoft,
                    fontFamily:MONO, fontSize:13, lineHeight:1, padding:0 }}>↩</button>
              </div>
            );
          }

          // ungraded — full row with W/L buttons
          return (
            <div key={r.gamePk} style={{ display:"flex", alignItems:"center", gap:12,
              border:`1px solid ${C.rule}`, borderLeft:`4px solid ${edge}`, borderRadius:4,
              background:tint, padding:"10px 12px" }}>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ fontFamily:MONO, fontSize:11, fontWeight:700, letterSpacing:"0.04em",
                  color:C.inkSoft }}>
                  {r.away && r.home
                    ? `${TEAM_ABBR[r.awayId]||r.away} @ ${TEAM_ABBR[r.homeId]||r.home}`
                    : "—"}</div>
                <div style={{ fontFamily:SANS, fontSize:15, fontWeight:700, marginTop:2,
                  color:C.ink, wordBreak:"break-word" }}>{r.text}</div>
              </div>
              <div style={{ fontFamily:MONO, fontSize:10, color:C.ruleDark, textAlign:"right",
                flexShrink:0, lineHeight:1.4 }}>
                <div>{r.date ? calDay(r.date).md : ""}</div>
                {r.time && <div>{fmtTime(r.time)}</div>}
              </div>
              <div style={{ display:"flex", gap:5, flexShrink:0 }}>
                {resBtn(r, "W", "W", C.over)}
                {resBtn(r, "L", "L", C.under)}
                {resBtn(r, "P", "P", C.blue)}
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("calendar");
  const { tags, tagStatus, setTag, setResult } = useTags();
  const [cal, setCal] = useState(null);   // { load, busy } from TravelTrends

  useEffect(() => {
    document.title = "MLB";
    // warm the export font early so it's ready well before anyone hits export
    if (document.fonts?.load) document.fonts.load("400 20px 'Permanent Marker'").catch(()=>{});
  }, []);
  return (
    <div className="ts-app" style={{ minHeight:"100vh", background:C.paper, color:C.ink, fontFamily:SANS }}>
      <style>{RESPONSIVE_CSS}</style>
      <div style={{ maxWidth:1260, margin:"0 auto" }}>
        <header style={{ borderBottom:`2px solid ${C.ink}`, paddingBottom:14, marginBottom:6 }}>
          <div style={{ fontFamily:MONO, fontSize:11, letterSpacing:"0.22em",
            textTransform:"uppercase", color:C.inkSoft }}>
            Terminal · MLB live
            {NOTES_URL && <span style={{ color:C.ruleDark }}> · tags {
              tagStatus==="loading" ? "syncing…" : tagStatus==="saving" ? "saving…"
              : tagStatus==="saved" ? "synced" : tagStatus==="error" ? "offline" : ""}</span>}
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            gap:16, flexWrap:"wrap", marginTop:6 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <h1 style={{ margin:0, fontFamily:SANS, fontWeight:800, fontSize:34,
                letterSpacing:"-0.02em", lineHeight:1 }}>MLB</h1>
              {tab==="calendar" && cal && (
                <button onClick={()=>cal.load && cal.load()} disabled={cal.busy}
                  aria-label="Refresh" title="Refresh schedule & stats"
                  style={{ width:30, height:30, borderRadius:5, border:`1px solid ${C.ink}`,
                    background:C.ink, color:"#fff", cursor:cal.busy?"default":"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
                    padding:0 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                    style={{ animation: cal.busy ? "ts-spin 0.8s linear infinite" : "none" }}>
                    <path d="M4 6.5A8 8 0 0 1 19 8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
                    <path d="M20 3.5V8h-4.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M20 17.5A8 8 0 0 1 5 16" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
                    <path d="M4 20.5V16h4.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
              {tab==="calendar" && cal && cal.copySlate && (
                <button onClick={()=>cal.copySlate()}
                  aria-label="Copy today's slate"
                  title={cal.slateCopied==="empty" ? "No tagged picks today — hit Play on a game first"
                    : cal.slateCopied==="err" ? "Copy failed — try again"
                    : "Copy today's slate with tagged picks"}
                  style={{ width:30, height:30, borderRadius:5,
                    border:`1px solid ${cal.slateCopied==="ok"?C.over
                      : (cal.slateCopied==="empty"||cal.slateCopied==="err") ? C.under : C.ink}`,
                    background:cal.slateCopied==="ok"?C.over
                      : (cal.slateCopied==="empty"||cal.slateCopied==="err") ? C.under : "#fff",
                    color:cal.slateCopied==="ok"||cal.slateCopied==="empty"||cal.slateCopied==="err" ? "#fff" : C.ink,
                    cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
                    padding:0 }}>
                  {cal.slateCopied==="ok" ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="2.4"
                        strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (cal.slateCopied==="empty" || cal.slateCopied==="err") ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/>
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="7" width="18" height="14" rx="2" stroke={C.ink} strokeWidth="2"/>
                      <path d="M8 7l1.5-2.5h5L16 7" stroke={C.ink} strokeWidth="2" strokeLinejoin="round"/>
                      <circle cx="12" cy="14" r="3.2" stroke={C.ink} strokeWidth="2"/>
                    </svg>
                  )}
                </button>
              )}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              {[["calendar","CALENDAR"],["tags","PLAYS"]].map(([id,lbl])=>(
                <button key={id} onClick={()=>setTab(id)} style={{ padding:"7px 15px",
                  border:`1px solid ${tab===id?C.ink:C.rule}`, borderRadius:2,
                  background:tab===id?C.ink:"transparent", color:tab===id?"#fff":C.inkSoft,
                  fontFamily:MONO, fontSize:12, letterSpacing:"0.08em", textTransform:"uppercase",
                  cursor:"pointer" }}>{lbl}</button>))}
            </div>
          </div>
        </header>
        <div style={{ height:6, borderBottom:`1px solid ${C.rule}`, marginBottom:18 }} />

        {tab==="tags"
          ? <TagsView tags={tags} setResult={setResult} />
          : <TravelTrends tags={tags} setTag={setTag} onReady={setCal} />}

        <footer style={{ marginTop:40, paddingTop:14, borderTop:`1px solid ${C.rule}`,
          fontFamily:MONO, fontSize:10.5, color:C.ruleDark, lineHeight:1.7 }}>
          Stats & schedule: MLB Stats API (free, no key). Click any game for lineups, the
          probable starters’ history vs the opponent, and the season head-to-head. Lineups are
          confirmed only a few hours pre-game; before that they’re projected from each team’s
          last batting order.
        </footer>
      </div>
    </div>
  );
}
