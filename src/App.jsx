import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  ComposedChart, Bar, XAxis, YAxis, ReferenceLine,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

/* ───────────────────────────── palette ─────────────────────────────
   Box-score / stat-sheet identity. Cool newsprint paper, ink-black
   tabular numerals, hairline rules like a ruled scorecard. Signature:
   a literal highlighter swipe behind every game that matches a trend. */
const C = {
  paper:"#ECEEF1", card:"#F8F9FA", ink:"#14181F", inkSoft:"#525A66",
  rule:"#CDD3DA", ruleDark:"#9AA3AD", marker:"#FFE94D", markerDeep:"#F4CE2A",
  over:"#1B7F5C", under:"#D7263D", blue:"#2B4C7E",
  /* indicator colors — each evokes the trend */
  rematch:"#8B5CF6",       /* neon indigo/violet: chess-move pitcher */
  rematchLight:"#C4B5FD",  /* light neon violet: faced but short outing */
  bigday:"#FF8C1A",        /* neon amber-orange: 10-run scoreboard explosion */
  late:"#FF1F4B",          /* neon crimson: clutch late-night drama */
  echo:"#06D6E0",          /* neon teal/cyan: momentum wave */
  travel:"#A78BFA",        /* neon lavender: jet-lagged west→east */
};
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
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
const TEAMS = Object.keys(TEAM_ABBR).map(id=>({ id:Number(id), abbr:TEAM_ABBR[id], name:TEAM_NAME[id] }))
  .sort((a,b)=>a.name.localeCompare(b.name));

const HIT_STATS = [
  ["hits","Hits"],["totalBases","Total Bases"],["homeRuns","Home Runs"],
  ["rbi","RBIs"],["runs","Runs"],["baseOnBalls","Walks"],
  ["strikeOuts","Strikeouts"],["stolenBases","Stolen Bases"],
  ["doubles","Doubles"],["hits+runs+rbi","Hits+Runs+RBI"],
];
const PITCH_STATS = [
  ["strikeOuts","Strikeouts"],["hits","Hits Allowed"],
  ["earnedRuns","Earned Runs"],["baseOnBalls","Walks Allowed"],["outs","Outs Recorded"],
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
const ord = (n) => n + (["th","st","nd","rd"][(n%100>>3^1&&n%10)||0] || "th");
// tags may be an old plain string or the new { text, away, home, date } object
const tagText = (entry) => !entry ? "" : (typeof entry === "string" ? entry : (entry.text || ""));

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
          awayId:game.awayId, homeId:game.homeId,
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
const inputStyle = {
  boxSizing:"border-box", padding:"9px 11px", border:`1px solid ${C.rule}`,
  borderRadius:2, background:"#fff", fontFamily:SANS, fontSize:14, color:C.ink, outline:"none",
};
const btn = (primary) => ({
  padding:"10px 20px", border: primary ? "none" : `1px solid ${C.ink}`,
  borderRadius:2, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.ink,
  fontFamily:MONO, fontSize:12, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer",
});
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
function TravelTrends({ tags, setTag, tagStatus }) {
  const start = todayISO();                    // anchor: today
  const minStreak = 10;                        // fixed threshold
  const [days, setDays] = useState(null);
  const [echoes, setEchoes] = useState(null);
  const [comebacks, setComebacks] = useState(null);
  const [faced, setFaced] = useState({});      // pitcherId -> Set(opponent team ids)
  const [runsMap, setRunsMap] = useState({});  // teamId -> { date -> runs scored }
  const [modal, setModal] = useState(null);    // { date, g, t } of clicked game
  const [now, setNow] = useState(()=>new Date());
  useEffect(()=>{ const id=setInterval(()=>setNow(new Date()), 60000); return ()=>clearInterval(id); }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const westThreshold = TZ_RANK.MT;             // PT/MT count as "west"

  const load = useCallback(async () => {
    setErr(""); setDays(null); setEchoes(null); setComebacks(null); setFaced({}); setRunsMap({}); setBusy(true);
    try {
      /* ── window schedule (travel + next-game lookup + probable pitchers) ──
         fetch from 3 days back so the -2 day's travel has a "prev day". */
      const from = addDays(start,-3), to = addDays(start,4);
      const r = await fetch(`${API}/schedule?sportId=1&startDate=${from}&endDate=${to}` +
        `&gameType=R&hydrate=probablePitcher,linescore,lineups`);
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
          dayGames[d.date].push({ homeId:home.id, homeName:home.name,
            awayId:away.id, awayName:away.name, venueTz, time:g.gameDate,
            gameDay: g.officialDate || d.date,
            awayPid:ap?.id, awayPname:ap?.fullName, homePid:hp?.id, homePname:hp?.fullName,
            isFinal, awayScore: g.teams.away.score, homeScore: g.teams.home.score,
            awayHits: g.linescore?.teams?.away?.hits, homeHits: g.linescore?.teams?.home?.hits,
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
      const dayByPair = perDay.map(games=>{
        const m={}; games.forEach(g=>{ m[g.pair]=g; }); return m;
      });

      const grid   = Array.from({length:numDays}, ()=>[]);    // grid[di][row]=game|null
      const placed = Array.from({length:numDays}, ()=>({}));  // di -> pair -> true
      const putAt = (di,row,g,shade)=>{
        while(grid[di].length<=row) grid[di].push(null);
        grid[di][row]=g; placed[di][g.pair]=true; g.seriesShade=shade;
      };
      const nextFreeFrom = (di,row)=>{
        let r=row<0?0:row;
        while(grid[di][r]!==undefined && grid[di][r]!==null) r++;
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
      // the SAME row + shade across all columns.
      const seed = (di, row, g, shade)=>{
        putAt(di, row, g, shade);
        for(let d=0; d<numDays; d++){
          if(d===di) continue;
          const match = dayByPair[d][g.pair];
          if(match && !placed[d][g.pair] && continuous(g.awayId, g.homeId, di, d)){
            const r = nextFreeFrom(d, row);   // prefer the seed's row
            putAt(d, r, match, shade);
          }
        }
      };

      // ---- step 1: seed today's games (navy/gray), each propagates ----
      perDay[TODAY_DI].forEach((g,row)=>{
        if(placed[TODAY_DI][g.pair]) return;
        seed(TODAY_DI, row, g, 2 + (row%2));   // 2=navy, 3=darker-gray
      });

      // ---- steps 2+: expand outward; new gap-fills (white/gray) re-seed ----
      for(let radius=1; radius<=Math.max(TODAY_DI, numDays-1-TODAY_DI); radius++){
        for(const di of [TODAY_DI-radius, TODAY_DI+radius]){
          if(di<0 || di>=numDays) continue;
          perDay[di].forEach(g=>{
            if(placed[di][g.pair]) return;       // already locked by a seed
            const r = nextFreeFrom(di, 0);
            seed(di, r, g, 0 + (r%2));           // white/light-gray, and re-seed
          });
        }
      }

      // ---- trim trailing nulls per column ----
      const out = DATES.map((d,di)=>{
        const col = grid[di];
        let last=-1; col.forEach((g,i)=>{ if(g) last=i; });
        return { date:d, games: last===-1 ? [] : col.slice(0,last+1) };
      });
      setDays(out);

      /* ── streak-break echo: pull ~5 wks of finals, find snapped streaks ── */
      const lbFrom = addDays(start,-35), lbTo = addDays(start,-1);
      const lr = await fetch(`${API}/schedule?sportId=1&startDate=${lbFrom}&endDate=${lbTo}&gameType=R`);
      const lj = await lr.json();
      const finals = (lj.dates||[]).flatMap(d=>d.games||[])
        .filter(g=>g.status?.abstractGameState==="Final")
        .sort((a,b)=>a.gameDate.localeCompare(b.gameDate));
      const byTeamRes = {};    // teamId -> [{date,res}]
      const teamName = {};
      const runsByDate = {};   // teamId -> { date -> runs scored }
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
        });
      });
      // (state set together at the end so all markers appear at once, in order)
      const echoList = [];
      Object.entries(byTeamRes).forEach(([tid, res])=>{
        const sig = detectStreakBreak(res, Number(minStreak)||10);
        if (!sig) return;
        // find this team's next game from today forward
        let found = null;
        for (let i=0;i<=5 && !found;i++){
          const date = addDays(start,i);
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

      /* ── late go-ahead win: scan yesterday's finals via linescore ── */
      const yISO = addDays(start,-1);
      const yGames = finals.filter(g =>
        (g.officialDate || g.gameDate.slice(0,10)) === yISO);
      const cbResults = await mapPool(yGames, 4, async (g) => {
        const winnerSide = g.teams.home.isWinner ? "home" : "away";
        try {
          const lr2 = await fetch(`${API}/game/${g.gamePk}/linescore`);
          if (!lr2.ok) return null;
          const ls = await lr2.json();
          const sig = detectLateComeback(ls, winnerSide);
          if (!sig) return null;
          const win = g.teams[winnerSide], lose = g.teams[winnerSide==="home"?"away":"home"];
          // this team's next scheduled game from today forward
          let next = null;
          for (let i=0;i<=5 && !next;i++){
            const date = addDays(start,i);
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
          const list = [];
          (pj.stats?.[0]?.splits || []).forEach(s=>{
            const ip = parseFloat(s.stat?.inningsPitched);
            if (s.opponent?.id)
              list.push({ oppId:s.opponent.id, date:s.date, ip: isNaN(ip)?0:ip });
          });
          facedMap[pid] = list;     // [{oppId, date, ip}] — all prior facings
        } catch { /* leave unset */ }
      });
      // all trend markers appear together (rematch · 10-run · late · echo · travel)
      setFaced(facedMap);
      setRunsMap(runsByDate);
      setComebacks(cbList);
      setEchoes(echoList);
    } catch (e) {
      setErr(isNet(e.message) ? "Couldn't reach the MLB schedule service." : e.message);
    } finally { setBusy(false); }
  }, [start, westThreshold, minStreak]);
  useEffect(() => { load(); }, [load]);   // auto-load on open and when min streak changes

  /* which trends touch a game, attributed to the specific team they apply to */
  const gameTrends = (date, g) => {
    const echo = (echoes||[]).filter(e=>e.date===date &&
      (e.teamId===g.homeId || e.teamId===g.awayId));
    const cb = (comebacks||[]).filter(c=>c.next && c.next.date===date &&
      (c.teamId===g.homeId || c.teamId===g.awayId));
    const rematch = [];
    const rematchTier = {};                       // teamId -> 'strong' | 'weak'
    const checkRematch = (pid, oppId, pitcher, oppName) => {
      if (!pid) return;
      const facings = (faced[pid]||[]).filter(x => x.oppId===oppId && x.date < date);
      if (!facings.length) return;
      const strong = facings.some(x => x.ip >= 4);
      rematch.push({ pitcher, pid, opp:oppName, oppId, strong });
      rematchTier[oppId] = strong ? "strong" : "weak";   // oppId = team facing again
    };
    checkRematch(g.awayPid, g.homeId, g.awayPname, g.homeName);
    checkRematch(g.homePid, g.awayId, g.homePname, g.awayName);
    const prevD = addDays(date,-1);
    const bigday = [];
    const aRuns = runsMap[g.awayId]?.[prevD], hRuns = runsMap[g.homeId]?.[prevD];
    if (aRuns>=10) bigday.push({ teamId:g.awayId, team:g.awayName, runs:aRuns });
    if (hRuns>=10) bigday.push({ teamId:g.homeId, team:g.homeName, runs:hRuns });

    // per-team trend keys for the duplicated markers
    const sideKeys = { [g.awayId]:new Set(), [g.homeId]:new Set() };
    const add = (tid, key) => { if (sideKeys[tid]) sideKeys[tid].add(key); };
    (g.travelers||[]).forEach(x=>add(x.teamId, "travel"));
    echo.forEach(e=>add(e.teamId, "echo"));
    cb.forEach(c=>add(c.teamId, "late"));
    bigday.forEach(b=>add(b.teamId, "bigday"));
    rematch.forEach(m=>add(m.oppId, "rematch"));   // team facing the pitcher again

    const any = !!g.flagged || echo.length>0 || cb.length>0 || rematch.length>0 || bigday.length>0;
    return { travel:!!g.flagged, travelers:g.travelers||[], echo, cb, rematch, bigday, any,
      keysFor:(tid)=>sideKeys[tid] || new Set(),
      rematchTier:(tid)=>rematchTier[tid] || null };
  };

  return (
    <div>
      <Eyebrow n="03">My trends · 2 days back → 4 days ahead</Eyebrow>

      <div style={{ display:"flex", gap:14, flexWrap:"wrap", alignItems:"center", marginBottom:18 }}>
        <button onClick={load} disabled={busy} style={btn(false)}>
          {busy ? "Loading…" : "Refresh"}</button>
        {busy && <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft }}>
          pulling schedule…</span>}
        {NOTES_URL && (
          <span style={{ marginLeft:"auto", fontFamily:MONO, fontSize:10, color:C.ruleDark }}>
            tags {tagStatus==="loading" ? "syncing…" : tagStatus==="saving" ? "saving…"
              : tagStatus==="saved" ? "synced" : tagStatus==="error" ? "offline" : ""}</span>
        )}
      </div>

      {err && <ErrBox>{err}</ErrBox>}

      {/* ── 7-day calendar; past columns aligned to today's matchups ── */}
      {days && (
        <div>
          <Eyebrow>Calendar · past games line up with today’s matchup</Eyebrow>
          <Legend />
          <div className="ts-cal" style={{ gap:5, paddingBottom:4 }}>
            {days.map(d=>{
              const isToday = d.date === start;
              const label = isToday ? "Today"
                : d.date===addDays(start,-1) ? "Yesterday"
                : d.date===addDays(start,-2) ? "2 days ago" : calDay(d.date).wd;
              return (
              <div key={d.date} className="ts-cal-col" style={{ border:`1px solid ${isToday?C.ink:C.rule}`, borderRadius:3,
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
                    ? <div className="ts-cell" style={{ height:54, display:"flex", alignItems:"center",
                        justifyContent:"center", fontFamily:SANS, fontSize:12, color:C.ruleDark }}>—</div>
                    : (() => {
                        const lineIdx = isToday
                          ? d.games.filter(g=>g && new Date(g.time) <= now).length : -1;
                        const dayGames = d.games.filter(Boolean);   // real games this day, in order
                        const dayTrends = dayGames.map(g=>gameTrends(d.date, g));
                        const cells = [];
                        d.games.forEach((g,i)=>{
                          if(i===lineIdx) cells.push(<NowLine key="nl"/>);
                          if(!g) cells.push(<div key={i} className="ts-cell" style={{ height:54, borderRadius:2,
                            border:`1px dashed ${C.rule}`, opacity:0.4, boxSizing:"border-box" }}/>);
                          else {
                            const t=gameTrends(d.date,g);
                            cells.push(<CalCard key={i} g={g} t={t} tag={tagText(tags[g.gamePk])}
                              onOpen={()=>setModal({ date:d.date, games:dayGames, trends:dayTrends,
                                idx:dayGames.indexOf(g) })}/>);
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
    <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:8 }}>
      {TREND_SLOTS.map(s=>(
        <span key={s.key} style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ width:13, height:9, borderRadius:2, background:s.color }} />
          <span style={{ fontFamily:MONO, fontSize:9.5, color:C.inkSoft }}>{s.label}</span>
        </span>
      ))}
    </div>
  );
}
function Pill({ children, color, title }) {
  return <span title={title} style={{ fontFamily:MONO, fontSize:8.5, letterSpacing:"0.04em",
    color:"#fff", background:color, borderRadius:2, padding:"1px 4px" }}>{children}</span>;
}
/* fixed marker slots — same position on every card so trends read at a glance.
   order left→right; add new trends here and every card adjusts automatically. */
const TREND_SLOTS = [
  { key:"rematch", color:C.rematch, label:"pitcher rematch" },
  { key:"bigday",  color:C.bigday,  label:"10+ runs prior day" },
  { key:"late",    color:C.late,    label:"late go-ahead" },
  { key:"echo",    color:C.echo,    label:"streak echo" },
  { key:"travel",  color:C.travel,  label:"W→E back-to-back" },
];

function TeamRow({ abbr, score, hits, won, final, teamId, t }) {
  const keys = t.keysFor(teamId);
  return (
    <div style={{ display:"grid", gridTemplateColumns:"24px 14px 16px 1fr", alignItems:"center", gap:2 }}>
      <span style={{ fontFamily:MONO, fontSize:13,
        fontWeight: final ? (won?800:400) : 600,
        color: final ? (won?C.ink:C.inkSoft) : C.ink }}>{abbr}</span>
      <span style={{ fontFamily:MONO, fontSize:13, textAlign:"right",
        fontWeight: final && won ? 800 : 400,
        color: final ? (won?C.ink:C.inkSoft) : C.ruleDark }}>{final ? score : ""}</span>
      <span style={{ fontFamily:MONO, fontSize:10, textAlign:"right", color:C.ruleDark }}>
        {final && hits!=null ? hits : ""}</span>
      <span style={{ display:"flex", gap:2, justifyContent:"flex-end" }}>
        {TREND_SLOTS.map(slot=>{
          const present = keys.has(slot.key);
          let color = slot.color;
          if (slot.key==="rematch" && present)
            color = t.rematchTier(teamId)==="weak" ? C.rematchLight : C.rematch;
          return <span key={slot.key} title={present ? slot.label : undefined}
            style={{ width:13, height:11, borderRadius:2,
              background: present ? color : "transparent",
              boxShadow: present
                ? "none"
                : `inset 0 0 0 1.5px ${C.inkSoft}`,
              opacity: present ? 1 : 0.45 }} />;
        })}
      </span>
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

function CalCard({ g, t, tag, onOpen }) {
  const aw = TEAM_ABBR[g.awayId]||"?", hm = TEAM_ABBR[g.homeId]||"?";
  const time = new Date(g.time).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
  const final = g.isFinal && g.awayScore!=null && g.homeScore!=null;
  const awWon = final && g.awayScore > g.homeScore;
  const hmWon = final && g.homeScore > g.awayScore;
  const bg = g.seriesShade!=null ? SERIES_SHADE[g.seriesShade] : "#fff";
  return (
    <div onClick={onOpen||undefined} className="ts-cell"
      role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e)=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();onOpen();} } : undefined}
      style={{ border:`1px solid ${C.rule}`, borderRadius:2, boxSizing:"border-box",
      height:54, padding:"4px 7px", background:bg, overflow:"visible", position:"relative",
      cursor: onOpen ? "pointer" : "default" }}>
      {tag && (
        <div title={tag} style={{ position:"absolute", top:-7, left:-5, zIndex:3, maxWidth:"86%",
          background:"#F2657A", color:"#fff", border:"1px solid #D7263D", borderRadius:3,
          padding:"1px 5px", fontFamily:SANS, fontSize:9.5, fontWeight:700, lineHeight:1.25,
          boxShadow:"0 1px 3px rgba(120,0,20,0.3)", whiteSpace:"nowrap", overflow:"hidden",
          textOverflow:"ellipsis", transform:"rotate(-2deg)" }}>{tag}</div>
      )}
      <div style={{ fontFamily:MONO, fontSize:8, color:C.ruleDark, textAlign:"right", lineHeight:1.2 }}>
        {final ? "FINAL" : time}</div>
      <TeamRow abbr={aw} score={g.awayScore} hits={g.awayHits} won={awWon} final={final} teamId={g.awayId} t={t} />
      <TeamRow abbr={hm} score={g.homeScore} hits={g.homeHits} won={hmWon} final={final} teamId={g.homeId} t={t} />
    </div>
  );
}

/* ── game detail modal: probable pitchers, every prior matchup vs this team ── */
const pLine = (s) => {
  const st = s.stat;
  return `${st.inningsPitched} IP · ${st.hits} H · ${st.earnedRuns} ER · ` +
    `${st.baseOnBalls} BB · ${st.strikeOuts} K`;
};

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
    const ipOuts = log.reduce((s,g)=>{
      const ip = parseFloat(g.stat.inningsPitched)||0;
      const whole = Math.floor(ip); const frac = Math.round((ip-whole)*10);
      return s + whole*3 + frac;
    }, 0);
    const ip = `${Math.floor(ipOuts/3)}.${ipOuts%3}`;
    const er = sum("earnedRuns");
    const era = ipOuts>0 ? ((er*27)/ipOuts).toFixed(2) : "—";
    return { gs:log.length, ip, k:sum("strikeOuts"), bb:sum("baseOnBalls"), h:sum("hits"), er, era };
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
          <div style={{ display:"grid", gridTemplateColumns:"78px 40px 1fr",
            gap:8, padding:"4px 16px", fontFamily:MONO, fontSize:9, letterSpacing:"0.06em",
            textTransform:"uppercase", color:C.ruleDark }}>
            <span>Date</span><span>Opp</span><span>Line</span>
          </div>
          {log===undefined && <div style={{ padding:"10px 16px", fontFamily:MONO, fontSize:12, color:C.inkSoft }}>Loading…</div>}
          {log && log.length===0 && <div style={{ padding:"10px 16px", fontFamily:SANS, fontSize:13, color:C.inkSoft }}>No {SEASON} starts found.</div>}
          {log && log.map((s,i)=>(
            <div key={i} style={{ display:"grid", gridTemplateColumns:"78px 40px 1fr",
              gap:8, padding:"5px 16px", borderTop:`1px solid #EEF0F2`, alignItems:"baseline" }}>
              <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft }}>{s.date}</span>
              <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft }}>{s.opponent?.abbreviation||"—"}</span>
              <span style={{ fontFamily:MONO, fontSize:12.5, color:C.ink }}>{pLine(s)}</span>
            </div>
          ))}
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
                  <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft, minWidth:78 }}>{s.date}</span>
                  <span style={{ fontFamily:MONO, fontSize:13, color:C.ink }}>{pLine(s)}</span>
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
    const players = (t.battingOrder||[]).slice(0,9).map((pid,i)=>({
      id:pid, name:t.players?.["ID"+pid]?.person?.fullName || `#${pid}`, order:i+1 }));
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
    return { vs: splits.filter(s=>s.opponent?.id===oppId && s.date < date) };
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

async function loadH2H(aId, bId) {
  const r = await fetch(`${API}/schedule?sportId=1&season=${SEASON}&gameType=R&teamId=${aId}&hydrate=linescore`);
  if (!r.ok) throw new Error(`schedule ${r.status}`);
  const j = await r.json();
  const games = (j.dates||[]).flatMap(d=>d.games||[])
    .filter(g=>g.teams.home.team.id===bId || g.teams.away.team.id===bId)
    .sort((x,y)=>x.gameDate.localeCompare(y.gameDate));
  let aw=0,bw=0,ar=0,br=0,ah=0,bh=0,upcoming=0;
  games.forEach(g=>{
    const aHome = g.teams.home.team.id===aId;
    const aSide = aHome?"home":"away", bSide = aHome?"away":"home";
    const aS=g.teams[aSide].score, bS=g.teams[bSide].score;
    const aHits=g.linescore?.teams?.[aSide]?.hits, bHits=g.linescore?.teams?.[bSide]?.hits;
    if (g.status?.abstractGameState==="Final" && aS!=null && bS!=null) {
      ar+=aS; br+=bS; ah+=aHits||0; bh+=bHits||0;
      if (aS>bS) aw++; else if (bS>aS) bw++;
    } else upcoming++;
  });
  const played = aw+bw;
  return { aw,bw,ar,br,ah,bh,upcoming,played };
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
function TeamPanel({ teamName, lineup, oppName, pitcherName, pitcherId, pitcherInfo, onStat, oppPitcherName, oppPitcherId }) {
  const [view, setView] = useState("last5");      // "last5" | "vssp"
  const [vsData, setVsData] = useState({});       // batterId -> stat | null
  const [vsLoading, setVsLoading] = useState(false);
  const canVs = !!oppPitcherId && !!oppPitcherName;

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
        {tabBtn("last5","Last 5")}
        {tabBtn("vssp", canVs ? `vs ${oppPitcherName.split(" ").slice(-1)[0]}` : "vs SP", canVs)}
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

      {/* starting pitcher — visually separated from the hitters */}
      <div style={{ margin:"6px 10px 12px", padding:"10px 12px", borderRadius:3,
        background:"#fff", border:`1px solid ${C.rule}` }}>
        <div style={{ fontFamily:MONO, fontSize:9, letterSpacing:"0.12em", textTransform:"uppercase",
          color:C.ruleDark, marginBottom:4 }}>Starting pitcher</div>
        <PitcherBlock name={pitcherName} pid={pitcherId} vsName={oppName} info={pitcherInfo} bare />
      </div>
    </div>
  );
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
  const [pick,   setPick]   = useState(null);   // {name, stat, ts} -> prop analyzer
  const [ls,     setLs]     = useState(g.isFinal ? undefined : null);  // line score (final games only)
  const [tagEditing, setTagEditing] = useState(false);
  const tagVal = tagText(tags?.[g.gamePk]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // box score by inning (finished games only) — shown above H2H
      if (g.isFinal) loadLineScore(g.gamePk).then(r=>{ if(alive) setLs(r); });
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

  const aAbbr = TEAM_ABBR[g.awayId]||"?", hAbbr = TEAM_ABBR[g.homeId]||"?";
  const time = new Date(g.time).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:50,
      background:"rgba(20,24,31,0.55)", display:"flex", alignItems:"flex-start",
      justifyContent:"center", padding:"max(12px, env(safe-area-inset-top)) 12px 12px",
      overflowY:"auto" }}>

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

        {/* header */}
        <div className="ts-modal-head" style={{ padding:"14px 18px", borderBottom:`2px solid ${C.ink}`,
          display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10,
          position:"sticky", top:0, background:C.paper, zIndex:2, borderTopLeftRadius:6, borderTopRightRadius:6 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.14em",
              textTransform:"uppercase", color:C.inkSoft }}>{prettyDay(date)} · {time}
              {games.length>1 && <span style={{ color:C.ruleDark }}> · game {idx+1}/{games.length}</span>}</div>
            <div style={{ fontFamily:SANS, fontSize:18, fontWeight:800, letterSpacing:"-0.01em" }}>
              {g.awayName} <span style={{ color:C.inkSoft, fontWeight:400 }}>@</span> {g.homeName}</div>
          </div>
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
            <button onClick={onClose} style={{ border:`1px solid ${C.rule}`, background:"#fff",
              borderRadius:2, fontFamily:MONO, fontSize:13, padding:"4px 10px", cursor:"pointer" }}>✕</button>
          </div>
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

        {/* ── H2H OVERVIEW (top) ── */}
        <div style={{ padding:"12px 18px", borderBottom:`1px solid ${C.rule}`, background:C.card }}>
          <div style={{ fontFamily:MONO, fontSize:9.5, letterSpacing:"0.12em", textTransform:"uppercase",
            color:C.inkSoft, marginBottom:6 }}>Season head-to-head</div>
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
              <div style={{ display:"flex", gap:14, fontFamily:MONO, fontSize:11, color:C.inkSoft }}>
                <span>{aAbbr} {h2h.ar}R · {h2h.ah}H <span style={{color:C.ruleDark}}>({(h2h.ar/h2h.played).toFixed(1)}/g)</span></span>
                <span>{hAbbr} {h2h.br}R · {h2h.bh}H <span style={{color:C.ruleDark}}>({(h2h.br/h2h.played).toFixed(1)}/g)</span></span>
              </div>
              {h2h.upcoming>0 && <span style={{ fontFamily:MONO, fontSize:10.5, color:C.ruleDark }}>{h2h.upcoming} more scheduled</span>}
            </div>
          )}
        </div>

        {/* trend pills, if any */}
        {t && t.any && (
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", padding:"10px 18px 2px" }}>
            {t.travel && <Pill color={C.travel}>W→E back-to-back</Pill>}
            {t.echo.map((e,i)=><Pill key={i} color={C.echo}>streak echo → {e.predicted==="W"?"win":"loss"}</Pill>)}
            {t.cb.map((c,i)=><Pill key={i} color={C.late}>late go-ahead {ord(c.inning)}</Pill>)}
            {t.rematch.map((r,i)=><Pill key={i} color={C.rematch}>pitcher rematch</Pill>)}
            {t.bigday.map((b,i)=><Pill key={i} color={C.bigday}>{b.team.split(" ").slice(-1)[0]} {b.runs} runs prior day</Pill>)}
          </div>
        )}

        {/* ── lineups: away left, home right (stack on mobile) ── */}
        <div className="ts-lineups" style={{ gap:0 }}>
          <TeamPanel teamName={g.awayName} oppName={g.homeName}
            lineup={awayLU} pitcherName={g.awayPname} pitcherId={g.awayPid} pitcherInfo={awayP}
            oppPitcherName={g.homePname} oppPitcherId={g.homePid}
            onStat={(name,stat)=>setPick({ name, stat, ts:Date.now() })} />
          <div style={{ borderLeft:`1px solid ${C.rule}` }} className="ts-h2h-divider">
            <TeamPanel teamName={g.homeName} oppName={g.awayName}
              lineup={homeLU} pitcherName={g.homePname} pitcherId={g.homePid} pitcherInfo={homeP}
              oppPitcherName={g.awayPname} oppPitcherId={g.awayPid}
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
.ts-cal { display:grid; grid-template-columns: repeat(7, minmax(166px,1fr)); overflow-x:auto; }
.ts-cal-col { min-width:166px; }
.ts-lineups { display:grid; grid-template-columns:1fr 1fr; }
.ts-app { padding:28px 18px 60px; }
.ts-cell { box-sizing:border-box; }
@media (max-width:760px){
  .ts-cal { grid-auto-flow:column; grid-auto-columns:82%; grid-template-columns:none;
            overflow-x:auto; scroll-snap-type:x mandatory; scroll-padding-left:0; }
  .ts-cal-col { min-width:0; scroll-snap-align:start; }
  .ts-lineups { grid-template-columns:1fr; }
  .ts-lineup-col { border-right:none !important; }
  .ts-lineup-col + .ts-lineup-col { border-top:1px solid #CDD3DA; }
  .ts-h2h-divider { border-left:none !important; border-top:1px solid #CDD3DA; }
  .ts-app { padding:18px 12px 48px; }
  .ts-nav-arrow { display:none !important; }
  .ts-nav-inline { display:inline-flex !important; }
  .ts-modal-head { padding:10px 12px !important; gap:8px !important; }
}
* { -webkit-tap-highlight-color: transparent; }
`;

/* ════════════════════════ TAGS VIEW ════════════════════════ */
function TagsView({ tags, setResult }) {
  // build a list of tagged games, newest date first
  const rows = useMemo(() => {
    return Object.entries(tags || {})
      .map(([gamePk, entry]) => {
        if (typeof entry === "string") return { gamePk, text:entry, date:"", away:"", home:"", result:null };
        return { gamePk, text:entry.text||"", date:entry.date||"",
          away:entry.away||"", home:entry.home||"",
          awayId:entry.awayId, homeId:entry.homeId, result:entry.result||null };
      })
      .filter(r => r.text)
      .sort((a,b) => (b.date||"").localeCompare(a.date||""));
  }, [tags]);

  if (!rows.length) {
    return (
      <div style={{ padding:"40px 8px", fontFamily:SANS, fontSize:14, color:C.inkSoft }}>
        No tagged games yet. Open any game on the calendar and hit <b>Play</b> to tag it — your
        tags collect here, newest first.
      </div>
    );
  }

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

  const wins = rows.filter(r=>r.result==="W").length;
  const losses = rows.filter(r=>r.result==="L").length;
  const graded = wins + losses;
  const pct = graded > 0 ? Math.round((wins/graded)*100) : null;

  return (
    <div>
      <Eyebrow n="01">My plays · newest first</Eyebrow>

      {/* W/L record */}
      <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap",
        border:`1px solid ${C.ruleDark}`, borderRadius:4, background:C.card,
        padding:"12px 16px", margin:"14px 0 18px" }}>
        <div style={{ fontFamily:MONO, fontSize:24, fontWeight:700 }}>
          <span style={{ color:C.over }}>{wins}</span>
          <span style={{ color:C.ruleDark }}> – </span>
          <span style={{ color:C.under }}>{losses}</span>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
          <span style={{ fontFamily:MONO, fontSize:9.5, letterSpacing:"0.1em",
            textTransform:"uppercase", color:C.inkSoft }}>Record</span>
          <span style={{ fontFamily:MONO, fontSize:12, color:C.inkSoft }}>
            {pct!=null ? `${pct}% · ${graded} graded` : "none graded yet"}
            {rows.length>graded ? ` · ${rows.length-graded} untracked` : ""}</span>
        </div>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {rows.map(r => {
          const tint = r.result==="W" ? "rgba(27,127,92,0.10)"
                     : r.result==="L" ? "rgba(215,38,61,0.09)" : C.card;
          const edge = r.result==="W" ? C.over : r.result==="L" ? C.under : C.rule;
          return (
            <div key={r.gamePk} style={{ display:"flex", alignItems:"center", gap:12,
              border:`1px solid ${C.rule}`, borderLeft:`4px solid ${edge}`, borderRadius:4,
              background:tint, padding:"10px 12px" }}>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.08em",
                  textTransform:"uppercase", color:C.inkSoft }}>
                  {r.date ? prettyDay(r.date) : "—"}
                  {r.away && r.home && <span style={{ color:C.ruleDark }}>{"  ·  "}
                    {TEAM_ABBR[r.awayId]||r.away} @ {TEAM_ABBR[r.homeId]||r.home}</span>}
                </div>
                <div style={{ fontFamily:SANS, fontSize:15, fontWeight:700, marginTop:2,
                  color:C.ink, wordBreak:"break-word" }}>{r.text}</div>
              </div>
              <div style={{ display:"flex", gap:5, flexShrink:0 }}>
                {resBtn(r, "W", "W", C.over)}
                {resBtn(r, "L", "L", C.under)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("calendar");
  const { tags, tagStatus, setTag, setResult } = useTags();

  useEffect(() => {
    document.title = "The Trend Sheet";
    const svg = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 36 36'>` +
      `<ellipse cx='18' cy='18' rx='14' ry='10' fill='%23964B00' stroke='%23fff' stroke-width='1.5'/>` +
      `<line x1='10' y1='18' x2='26' y2='18' stroke='%23fff' stroke-width='1.5'/>` +
      `<line x1='14' y1='12' x2='14' y2='24' stroke='%23fff' stroke-width='1'/>` +
      `<line x1='18' y1='10' x2='18' y2='26' stroke='%23fff' stroke-width='1'/>` +
      `<line x1='22' y1='12' x2='22' y2='24' stroke='%23fff' stroke-width='1'/>` +
      `</svg>`;
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.href = svg;
  }, []);
  return (
    <div className="ts-app" style={{ minHeight:"100vh", background:C.paper, color:C.ink, fontFamily:SANS }}>
      <style>{RESPONSIVE_CSS}</style>
      <div style={{ maxWidth:1260, margin:"0 auto" }}>
        <header style={{ borderBottom:`2px solid ${C.ink}`, paddingBottom:14, marginBottom:6 }}>
          <div style={{ fontFamily:MONO, fontSize:11, letterSpacing:"0.22em",
            textTransform:"uppercase", color:C.inkSoft }}>Research Terminal · MLB live</div>
          <h1 style={{ margin:"6px 0 0", fontFamily:SANS, fontWeight:800, fontSize:34,
            letterSpacing:"-0.02em", lineHeight:1 }}>The Trend Sheet</h1>
        </header>
        <div style={{ height:6, borderBottom:`1px solid ${C.rule}`, marginBottom:18 }} />

        <div style={{ display:"flex", gap:4, marginBottom:22, flexWrap:"wrap" }}>
          {[["calendar","CALENDAR"],["tags","PLAYS"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>setTab(id)} style={{ padding:"8px 16px",
              border:`1px solid ${tab===id?C.ink:C.rule}`, borderRadius:2,
              background:tab===id?C.ink:"transparent", color:tab===id?"#fff":C.inkSoft,
              fontFamily:MONO, fontSize:12, letterSpacing:"0.08em", textTransform:"uppercase",
              cursor:"pointer" }}>{lbl}</button>))}
        </div>

        {tab==="tags"
          ? <TagsView tags={tags} setResult={setResult} />
          : <TravelTrends tags={tags} setTag={setTag} tagStatus={tagStatus} />}

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
