import React, { useState, useMemo, useEffect, useCallback } from "react";
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
  over:"#1B7F5C", under:"#D7263D", blue:"#2B4C7E", rematch:"#6D4AA8", bigday:"#E07B00",
};
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const API = "https://statsapi.mlb.com/api/v1";

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

/* ════════════════════════════ DAY SHEET ════════════════════════════ */
/* All games for a chosen day; each team's starting 9 with last-5 H / TB / K. */
function DaySheet() {
  const [date, setDate] = useState(todayISO());
  const season = new Date().getFullYear();           // current season for stat pulls
  const [games, setGames] = useState(null);          // schedule games
  const [byPk, setByPk] = useState({});               // gamePk -> lineup data
  const [busy, setBusy] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState(null);             // {name, ts} -> feeds Prop Lookup

  const loadSchedule = useCallback(async () => {
    setErr(""); setGames(null); setByPk({}); setBusy(true);
    try {
      const r = await fetch(
        `${API}/schedule?sportId=1&date=${date}` +
        `&hydrate=lineups,probablePitcher,team,venue`);
      if (!r.ok) throw new Error(`schedule ${r.status}`);
      const j = await r.json();
      const gs = (j.dates?.[0]?.games) || [];
      setGames(gs);
    } catch (e) {
      setErr(isNet(e.message)
        ? "Couldn't reach the MLB schedule. In your own React app this works from a normal browser tab."
        : e.message);
    } finally { setBusy(false); }
  }, [date]);

  /* last-5 H / TB / K plus this month's batting average for one player */
  const trendFor = useCallback(async (id) => {
    const r = await fetch(
      `${API}/people/${id}/stats?stats=gameLog&group=hitting&season=${season}&gameType=R`);
    if (!r.ok) return { h:[], tb:[], k:[], avg:null };
    const j = await r.json();
    const splits = (j.stats?.[0]?.splits || [])
      .slice().sort((a,b)=>a.date.localeCompare(b.date));
    const last5 = splits.slice(-5);
    // batting average over games in the selected month (YYYY-MM)
    const month = date.slice(0,7);
    let h = 0, ab = 0;
    splits.filter(s=>(s.date||"").startsWith(month)).forEach(s=>{
      h += Number(s.stat.hits)||0; ab += Number(s.stat.atBats)||0;
    });
    const avg = ab>0 ? (h/ab).toFixed(3).replace(/^0/,"") : null;
    return {
      h: last5.map(s=>valOf(s.stat,"hits")),
      tb: last5.map(s=>valOf(s.stat,"totalBases")),
      hrr: last5.map(s=>valOf(s.stat,"hits+runs+rbi")),
      avg,
    };
  }, [season, date]);

  /* resolve a team's starting 9 — confirmed lineup or last-game fallback */
  const lineupFor = useCallback(async (game, side) => {
    const lp = game.lineups?.[side+"Players"];
    if (lp && lp.length) {
      return { source:"confirmed",
        players: lp.slice(0,9).map((p,i)=>({ id:p.id, name:p.fullName, order:i+1 })) };
    }
    // fallback: most recent completed game's batting order
    const teamId = game.teams[side].team.id;
    const back = addDays(date,-14);
    const sr = await fetch(
      `${API}/schedule?sportId=1&teamId=${teamId}&startDate=${back}&endDate=${addDays(date,-1)}&gameType=R`);
    const sj = await sr.json();
    const prevGames = (sj.dates||[]).flatMap(d=>d.games||[])
      .filter(g=>g.status?.abstractGameState==="Final")
      .sort((a,b)=>a.gameDate.localeCompare(b.gameDate));
    const last = prevGames[prevGames.length-1];
    if (!last) return { source:"none", players:[] };
    const br = await fetch(`${API}/game/${last.gamePk}/boxscore`);
    const bj = await br.json();
    const which = last.teams.home.team.id===teamId ? "home" : "away";
    const t = bj.teams[which];
    const order = (t.battingOrder||[]).slice(0,9);
    const players = order.map((pid,i)=>({
      id:pid, name:t.players?.["ID"+pid]?.person?.fullName || `#${pid}`, order:i+1 }));
    return { source:"projected", players };
  }, [date]);

  const loadGame = useCallback(async (game) => {
    setByPk(p=>({ ...p, [game.gamePk]:{ status:"loading" } }));
    try {
      const sides = await Promise.all(["away","home"].map(async (side)=>{
        const lu = await lineupFor(game, side);
        const players = await mapPool(lu.players, 4, async (pl)=>({
          ...pl, ...(await trendFor(pl.id)) }));
        return { source:lu.source, players, team:game.teams[side].team.name };
      }));
      setByPk(p=>({ ...p, [game.gamePk]:{ status:"done", away:sides[0], home:sides[1] } }));
    } catch (e) {
      setByPk(p=>({ ...p, [game.gamePk]:{ status:"error", msg:e.message } }));
    }
  }, [lineupFor, trendFor]);

  const loadAll = useCallback(async () => {
    if (!games) return;
    setLoadingAll(true);
    await mapPool(games, 2, (g)=>loadGame(g));
    setLoadingAll(false);
  }, [games, loadGame]);

  return (
    <div>
      <Eyebrow n="01">Day sheet · starting nine, last 5 games</Eyebrow>

      <div style={{ display:"flex", gap:14, flexWrap:"wrap", alignItems:"flex-end", marginBottom:16 }}>
        <Field label="Date">
          <input type="date" style={inputStyle} value={date}
            onChange={e=>setDate(e.target.value)} />
        </Field>
        <button onClick={loadSchedule} disabled={busy} style={btn(true)}>
          {busy ? "Loading…" : "Load slate"}</button>
        {games && games.length>0 && (
          <button onClick={loadAll} disabled={loadingAll} style={btn(false)}>
            {loadingAll ? "Loading all…" : "Load all lineups"}</button>
        )}
        <button onClick={()=>setPick({ name:"", ts:Date.now() })} style={btn(false)}>
          Prop Lookup</button>
      </div>

      {err && <ErrBox>{err}</ErrBox>}

      {games && games.length===0 && (
        <div style={{ fontFamily:SANS, fontSize:14, color:C.inkSoft, padding:"18px 0" }}>
          No games scheduled on {prettyDay(date)}. Pick a date during the season.
        </div>
      )}

      {games && games.map((g)=>(
        <GameCard key={g.gamePk} g={g} data={byPk[g.gamePk]}
          onLoad={()=>loadGame(g)}
          onPick={(name, stat)=>setPick({ name, stat, ts:Date.now() })} />
      ))}

      {pick && <PropModal injected={pick.name ? pick : null} onClose={()=>setPick(null)} />}
    </div>
  );
}

function PropModal({ injected, onClose }) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:50,
      background:"rgba(20,24,31,0.55)", display:"flex", alignItems:"flex-start",
      justifyContent:"center", padding:18, overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.paper,
        border:`1px solid ${C.ink}`, borderRadius:4, maxWidth:560, width:"100%",
        margin:"24px 0", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ padding:"14px 18px", borderBottom:`2px solid ${C.ink}`,
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontFamily:MONO, fontSize:11, letterSpacing:"0.16em",
            textTransform:"uppercase", color:C.inkSoft }}>Prop Lookup</span>
          <button onClick={onClose} style={{ border:`1px solid ${C.rule}`, background:"#fff",
            borderRadius:2, fontFamily:MONO, fontSize:12, padding:"4px 9px", cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ padding:"14px 18px 18px" }}>
          <PropAnalyzer compact injected={injected} />
        </div>
      </div>
    </div>
  );
}

function ProbLine({ g }) {
  const a = g.teams.away.probablePitcher?.fullName;
  const h = g.teams.home.probablePitcher?.fullName;
  if (!a && !h) return null;
  return (
    <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft }}>
      SP: {a||"TBD"} vs {h||"TBD"}
    </span>
  );
}

function GameCard({ g, data, onLoad, onPick }) {
  const tz = TEAM_TZ[g.teams.home.team.id] ?? "?";
  const time = new Date(g.gameDate).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
  return (
    <div style={{ border:`1px solid ${C.ruleDark}`, borderRadius:3, marginBottom:14, overflow:"hidden" }}>
      <div style={{ padding:"11px 14px", borderBottom:`1px solid ${C.rule}`, background:C.card,
        display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:10, flexWrap:"wrap" }}>
          <span style={{ fontFamily:SANS, fontWeight:700, fontSize:15 }}>
            {g.teams.away.team.name} <span style={{ color:C.inkSoft, fontWeight:400 }}>@</span> {g.teams.home.team.name}
          </span>
          <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft }}>{time} · {tz}</span>
        </div>
        <div style={{ display:"flex", gap:12, alignItems:"center" }}>
          <ProbLine g={g} />
          {!data && <button onClick={onLoad} style={{ ...btn(false), padding:"6px 12px" }}>Load lineups</button>}
        </div>
      </div>

      {data?.status==="loading" && (
        <div style={{ padding:14, fontFamily:MONO, fontSize:12, color:C.inkSoft }}>Pulling lineups & trends…</div>)}
      {data?.status==="error" && (
        <div style={{ padding:14, fontFamily:SANS, fontSize:13, color:C.under }}>Couldn’t load: {data.msg}</div>)}
      {data?.status==="done" && (
        <div className="ts-lineups">
          <LineupCol side={data.away} borderRight onPick={onPick} />
          <LineupCol side={data.home} onPick={onPick} />
        </div>)}
    </div>
  );
}

/* shared column template so header + every row line up exactly */
const ROW_COLS = "14px minmax(40px,1fr) 32px repeat(3, 66px)";

function LineupCol({ side, borderRight, onPick }) {
  return (
    <div className="ts-lineup-col" style={{ borderRight: borderRight?`1px solid ${C.rule}`:"none" }}>
      <div style={{ padding:"8px 12px", borderBottom:`1px solid ${C.rule}`,
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontFamily:SANS, fontWeight:600, fontSize:13 }}>{side.team}</span>
        {side.source==="confirmed" ? <Tag tone="ok">Confirmed</Tag>
          : side.source==="projected" ? <Tag>Projected · last game</Tag>
          : <Tag>No lineup</Tag>}
      </div>
      <div style={{ padding:"4px 0" }}>
        <div style={{ display:"grid", gridTemplateColumns:ROW_COLS, gap:6, padding:"2px 10px",
          fontFamily:MONO, fontSize:9, letterSpacing:"0.04em", textTransform:"uppercase",
          color:C.ruleDark, alignItems:"center" }}>
          <span>#</span><span>Hitter</span><span style={{ textAlign:"right" }}>AVG</span>
          <span style={{ textAlign:"center" }}>H</span>
          <span style={{ textAlign:"center" }}>TB</span>
          <span style={{ textAlign:"center" }}>HRR</span>
        </div>
        {side.players.length===0 && (
          <div style={{ padding:"8px 12px", fontFamily:SANS, fontSize:12, color:C.inkSoft }}>—</div>)}
        {side.players.map((p)=>{
          const hot = nameStreak(p);
          return (
          <div key={p.id} style={{ display:"grid", gridTemplateColumns:ROW_COLS, gap:6,
            padding:"3px 10px", alignItems:"center", borderTop:`1px solid #EEF0F2` }}>
            <span style={{ fontFamily:MONO, fontSize:11, color:C.ruleDark }}>{p.order}</span>
            <span style={{ fontFamily:SANS, fontSize:12.5, whiteSpace:"nowrap",
              overflow:"hidden", textOverflow:"ellipsis",
              background: hot ? "rgba(255,233,77,0.5)" : "transparent", borderRadius:1 }}
              title={p.name}>{p.name}</span>
            <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft, textAlign:"right" }}>{p.avg || "—"}</span>
            <SeqBlock arr={p.h} statKey="hits" label="hits" onPick={onPick && (()=>onPick(p.name,"hits"))} />
            <SeqBlock arr={p.tb} statKey="totalBases" label="total bases" onPick={onPick && (()=>onPick(p.name,"totalBases"))} />
            <SeqBlock arr={p.hrr} statKey="hits+runs+rbi" label="H+R+RBI" onPick={onPick && (()=>onPick(p.name,"hits+runs+rbi"))} />
          </div>
        );})}
      </div>
    </div>
  );
}

/* color category per stat value, then test if the last 3 share one color */
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
  if (on && onPick) {
    return <button onClick={onPick} title={`Analyze ${label} prop`}
      style={{ ...base, border:"none", padding:0, cursor:"pointer", font:"inherit" }}>{cells}</button>;
  }
  return <span style={base}>{cells}</span>;
}

/* ════════════════════════ PROP ANALYZER ════════════════════════ */
function PropAnalyzer({ compact = false, injected = null }) {
  const season = new Date().getFullYear();    // current season only
  const [name, setName] = useState("");
  const [group, setGroup] = useState("hitting");
  const [statKey, setStatKey] = useState("hits");
  const side = "over";                          // fixed
  const [line, setLine] = useState("1.5");
  const [sampleN, setSampleN] = useState("20"); // "5"|"10"|"15"|"20"|"month"|"season"
  const [manual, setManual] = useState("");
  const [roster, setRoster] = useState(null);
  const [games, setGames] = useState(null);
  const [resolved, setResolved] = useState("");
  const [latest, setLatest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const statList = group==="hitting" ? HIT_STATS : PITCH_STATS;

  const loadRoster = useCallback(async (yr) => {
    if (roster && roster.year===yr) return roster.people;
    const r = await fetch(`${API}/sports/1/players?season=${yr}`);
    if (!r.ok) throw new Error(`roster ${r.status}`);
    const j = await r.json();
    setRoster({ year:yr, people:j.people||[] });
    return j.people||[];
  }, [roster]);

  const analyzeLive = useCallback(async (override) => {
    const rawName = typeof override === "string" ? override : (override?.name ?? name);
    const rawStat = (override && typeof override === "object" && override.stat) ? override.stat : statKey;
    setErr(""); setGames(null); setResolved(""); setLatest(null); setBusy(true);
    try {
      const people = await loadRoster(season);
      const q = rawName.trim().toLowerCase();
      if (!q) throw new Error("Enter a player name (or use manual entry).");
      const hits = people.filter(p=>(p.fullName||"").toLowerCase().includes(q));
      if (!hits.length) throw new Error(`No ${season} MLB player matched "${rawName}".`);
      const player = hits[0];
      const r = await fetch(`${API}/people/${player.id}/stats?stats=gameLog&group=${group}&season=${season}&gameType=R`);
      if (!r.ok) throw new Error(`game log ${r.status}`);
      const j = await r.json();
      const splits = j.stats?.[0]?.splits || [];
      if (!splits.length) throw new Error(`No ${season} game logs for ${player.fullName} in this group.`);
      const rows = splits.map(s=>({ date:s.date,
        opp:s.opponent?.abbreviation||"", value:valOf(s.stat,rawStat) }))
        .sort((a,b)=>a.date.localeCompare(b.date));
      setLatest(rows[rows.length-1].date);
      setResolved(player.fullName); setGames(rows);
    } catch (e) {
      setErr(isNet(e.message)
        ? "Couldn't reach the MLB data service. This works from a normal browser tab in your own app."
        : e.message);
    } finally { setBusy(false); }
  }, [name, group, statKey, season, loadRoster]);

  // clicking a stat in the slate fills name + stat and runs
  useEffect(() => {
    if (injected && injected.name) {
      setName(injected.name);
      if (injected.stat) { setGroup("hitting"); setStatKey(injected.stat); }
      analyzeLive({ name:injected.name, stat:injected.stat });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injected?.ts]);

  const analyzeManual = useCallback(() => {
    setErr(""); setResolved(""); setLatest(null);
    const nums = manual.split(/[\s,]+/).map(Number).filter(x=>!isNaN(x));
    if (!nums.length) { setErr("Enter comma- or space-separated numbers."); return; }
    setGames(nums.map((v,i)=>({ date:`G${i+1}`, opp:"", value:v })));
    setResolved(name.trim()||"Manual entry");
  }, [manual, name]);

  const analysis = useMemo(() => {
    if (!games?.length) return null;
    const L = parseFloat(line);
    let recent, sampleLabel;
    if (sampleN === "season") {
      recent = games; sampleLabel = "Season";
    } else if (sampleN === "month") {
      const mo = String(games[games.length-1].date).slice(0,7);
      const m = games.filter(g=>String(g.date).startsWith(mo));
      recent = m.length ? m : games; sampleLabel = "This month";
    } else {
      const n = Number(sampleN);
      recent = games.slice(-n); sampleLabel = `Last ${n}`;
    }
    const avg = (a)=>a.reduce((s,g)=>s+g.value,0)/a.length;
    const clears = (g)=> g.value>L;            // over
    const hitN = recent.filter(clears).length;
    let streak = 0;
    for (let i=games.length-1;i>=0;i--){ if(clears(games[i])) streak++; else break; }
    const recentAvg = avg(recent);
    return { L, recent, recentAvg, seasonAvg:avg(games), hitN,
      hitRate:hitN/recent.length, streak, sampleLabel, edge: recentAvg-L };
  }, [games, line, sampleN]);

  const statLabel = statList.find(([k])=>k===statKey)?.[1] || statKey;

  return (
    <div>
      {!compact && <Eyebrow n="02">Prop vs. recent form</Eyebrow>}
      <div style={{ display:"grid", gap:14,
        gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", marginBottom:16 }}>
        <Field label="Player"><input style={{ ...inputStyle, width:"100%" }} value={name}
          placeholder="e.g. Aaron Judge" onChange={e=>setName(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&analyzeLive()} /></Field>
        <Field label="Group"><select style={{ ...inputStyle, width:"100%" }} value={group}
          onChange={e=>{const g=e.target.value;setGroup(g);setStatKey(g==="hitting"?"hits":"strikeOuts");}}>
          <option value="hitting">Hitting</option><option value="pitching">Pitching</option></select></Field>
        <Field label="Stat"><select style={{ ...inputStyle, width:"100%" }} value={statKey}
          onChange={e=>setStatKey(e.target.value)}>
          {statList.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Line"><input style={{ ...inputStyle, width:"100%" }} value={line}
          inputMode="decimal" onChange={e=>setLine(e.target.value)} /></Field>
        <Field label="Sample"><select style={{ ...inputStyle, width:"100%" }} value={sampleN}
          onChange={e=>setSampleN(e.target.value)}>
          <option value="5">Last 5</option>
          <option value="10">Last 10</option>
          <option value="15">Last 15</option>
          <option value="20">Last 20</option>
          <option value="month">This month</option>
          <option value="season">Season</option></select></Field>
      </div>

      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:8 }}>
        <button onClick={analyzeLive} disabled={busy} style={btn(true)}>
          {busy ? "Pulling…" : "Pull MLB game logs"}</button>
        <span style={{ fontFamily:SANS, fontSize:12, color:C.inkSoft, alignSelf:"center" }}>
          Live for MLB. Other sports → paste values below.</span>
      </div>

      <details style={{ marginBottom:18 }}>
        <summary style={{ fontFamily:MONO, fontSize:11, letterSpacing:"0.1em",
          textTransform:"uppercase", color:C.blue, cursor:"pointer" }}>Manual entry (any sport)</summary>
        <div style={{ marginTop:10, display:"flex", gap:10, flexWrap:"wrap" }}>
          <input style={{ ...inputStyle, flex:1, minWidth:240 }}
            placeholder="oldest → newest, e.g.  2, 1, 3, 0, 2" value={manual}
            onChange={e=>setManual(e.target.value)} />
          <button onClick={analyzeManual} style={btn(false)}>Analyze</button>
        </div>
      </details>

      {latest && <div style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft, marginBottom:14 }}>
        Latest game in data: <b style={{ color:C.ink }}>{latest}</b></div>}
      {err && <ErrBox>{err}</ErrBox>}
      {analysis && <Results a={analysis} resolved={resolved} statLabel={statLabel} />}
    </div>
  );
}

function StatCell({ label, value, sub, color }) {
  return (
    <div style={{ padding:"14px 16px", borderRight:`1px solid ${C.rule}` }}>
      <div style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.12em",
        textTransform:"uppercase", color:C.inkSoft, marginBottom:6 }}>{label}</div>
      <div style={{ fontFamily:MONO, fontSize:30, fontWeight:600, color:color||C.ink, lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontFamily:SANS, fontSize:12, color:C.inkSoft, marginTop:5 }}>{sub}</div>}
    </div>
  );
}
function Results({ a, resolved, statLabel }) {
  const edgeColor = a.edge>=0 ? C.over : C.under;
  const chartData = a.recent.map(g=>({ name:(String(g.date).slice(5)||g.date), value:g.value,
    clears: g.value>a.L }));
  return (
    <div style={{ border:`1px solid ${C.ruleDark}`, borderRadius:3, background:C.card, overflow:"hidden", marginTop:4 }}>
      <div style={{ padding:"12px 16px", borderBottom:`1px solid ${C.rule}`,
        display:"flex", justifyContent:"space-between", alignItems:"baseline", flexWrap:"wrap", gap:8 }}>
        <span style={{ fontFamily:SANS, fontWeight:700, fontSize:16 }}>{resolved}</span>
        <span style={{ fontFamily:MONO, fontSize:12, color:C.inkSoft, textTransform:"uppercase",
          letterSpacing:"0.08em" }}>over {a.L} {statLabel}</span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",
        borderBottom:`1px solid ${C.rule}` }}>
        <StatCell label={`${a.sampleLabel} avg`} value={a.recentAvg.toFixed(2)} sub={`season ${a.seasonAvg.toFixed(2)}`} />
        <StatCell label="Edge vs line" color={edgeColor}
          value={`${a.edge>=0?"+":""}${a.edge.toFixed(2)}`} sub={a.edge>=0?"form beats line":"line beats form"} />
        <StatCell label="Hit rate" value={`${Math.round(a.hitRate*100)}%`} sub={`${a.hitN} / ${a.recent.length} cleared`}
          color={a.hitRate>=0.6?C.over:a.hitRate<=0.4?C.under:C.ink} />
        <StatCell label="Streak" value={a.streak} sub={`game${a.streak===1?"":"s"} over`}
          color={a.streak>=3?C.over:C.ink} />
      </div>
      <div style={{ padding:"16px 12px 8px" }}>
        <div style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase",
          color:C.inkSoft, padding:"0 6px 8px" }}>Game-by-game · bar clears line = over</div>
        <ResponsiveContainer width="100%" height={210}>
          <ComposedChart data={chartData} margin={{ top:6, right:8, bottom:4, left:-18 }}>
            <XAxis dataKey="name" tick={{ fontFamily:MONO, fontSize:10, fill:C.inkSoft }}
              axisLine={{ stroke:C.rule }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontFamily:MONO, fontSize:10, fill:C.inkSoft }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill:"rgba(0,0,0,0.04)" }}
              contentStyle={{ fontFamily:MONO, fontSize:12, border:`1px solid ${C.ruleDark}`, borderRadius:2 }} />
            <Bar dataKey="value" radius={[2,2,0,0]} maxBarSize={34}>
              {chartData.map((d,i)=><Cell key={i} fill={d.clears?C.over:C.under} fillOpacity={d.clears?0.85:0.55} />)}
            </Bar>
            <ReferenceLine y={a.L} stroke={C.ink} strokeWidth={1.5} strokeDasharray="4 3"
              label={{ value:`line ${a.L}`, position:"right", fontFamily:MONO, fontSize:10, fill:C.ink }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* detect a team that just snapped a long streak.
   results: chronological [{date,res:'W'|'L'}] of completed games.
   Returns the echo signal when the LAST game broke a run of >= minStreak. */
function detectStreakBreak(results, minStreak) {
  if (results.length < minStreak + 1) return null;
  const last = results[results.length - 1];
  const runRes = results[results.length - 2].res;
  if (runRes === last.res) return null;            // last game continued, didn't break
  let run = 0;
  for (let i = results.length - 2; i >= 0; i--) {
    if (results[i].res === runRes) run++; else break;
  }
  if (run < minStreak) return null;
  return { streakLen: run, streakRes: runRes, predicted: last.res, breakDate: last.date };
}

/* did the winner first take the lead in the 8th inning or later?
   ls = linescore; winnerSide = 'home' | 'away'. */
function detectLateComeback(ls, winnerSide) {
  const innings = ls?.innings || [];
  if (innings.length < 8) return null;
  let aw = 0, hm = 0, firstLead = null;
  for (const inn of innings) {
    const i = inn.num;
    aw += inn.away?.runs || 0;                       // top half
    if (firstLead === null && (winnerSide==="away" ? aw>hm : hm>aw)) firstLead = i;
    hm += inn.home?.runs || 0;                       // bottom half
    if (firstLead === null && (winnerSide==="home" ? hm>aw : aw>hm)) firstLead = i;
  }
  if (firstLead !== null && firstLead >= 8) return { firstLeadInning: firstLead };
  return null;
}
const ord = (n) => {
  const s = ["th","st","nd","rd"], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
};

/* ════════════════════ MY TRENDS (yesterday → +5 days) ════════════════════ */
function TravelTrends() {
  const start = todayISO();                    // anchor: today
  const minStreak = 10;                        // fixed threshold
  const [days, setDays] = useState(null);
  const [echoes, setEchoes] = useState(null);
  const [comebacks, setComebacks] = useState(null);
  const [faced, setFaced] = useState({});      // pitcherId -> Set(opponent team ids)
  const [runsMap, setRunsMap] = useState({});  // teamId -> { date -> runs scored }
  const [modal, setModal] = useState(null);    // { date, g, t } of clicked game
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const westThreshold = TZ_RANK.MT;             // PT/MT count as "west"

  const load = useCallback(async () => {
    setErr(""); setDays(null); setEchoes(null); setComebacks(null); setFaced({}); setRunsMap({}); setBusy(true);
    try {
      /* ── window schedule (travel + next-game lookup + probable pitchers) ──
         fetch from 2 days back so yesterday's travel has a "prev day". */
      const from = addDays(start,-2), to = addDays(start,5);
      const r = await fetch(`${API}/schedule?sportId=1&startDate=${from}&endDate=${to}` +
        `&gameType=R&hydrate=probablePitcher`);
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
            awayPid:ap?.id, awayPname:ap?.fullName, homePid:hp?.id, homePname:hp?.fullName,
            isFinal, awayScore: g.teams.away.score, homeScore: g.teams.home.score });
          [home.id, away.id].forEach(tid=>{
            (byTeamDate[tid] = byTeamDate[tid]||{})[d.date] = venueTz; });
        });
      });
      const out = [];
      for (let i=-1;i<=5;i++){                  // yesterday, today, +5
        const date = addDays(start,i), prev = addDays(date,-1);
        const list = (dayGames[date]||[]).map(g=>{
          const todayTz = TZ_RANK[g.venueTz], travelers=[];
          [["away",g.awayId,g.awayName],["home",g.homeId,g.homeName]].forEach(([role,tid,tname])=>{
            const prevTz = TZ_RANK[byTeamDate[tid]?.[prev]];
            if (prevTz!=null && todayTz===TZ_RANK.ET && prevTz<=westThreshold)
              travelers.push({ tname, from:byTeamDate[tid][prev], to:g.venueTz });
          });
          return { ...g, travelers, flagged:travelers.length>0 };
        }).sort((a,b)=>Number(b.flagged)-Number(a.flagged)||a.time.localeCompare(b.time));
        out.push({ date, games:list, flaggedCount:list.filter(x=>x.flagged).length });
      }
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
      setRunsMap(runsByDate);
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
      setEchoes(echoList);

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
      setComebacks(cbResults.filter(Boolean).sort((a,b)=>b.inning-a.inning));

      /* ── pitcher rematch: has each probable already faced today's opponent? ── */
      const season = new Date().getFullYear();
      const pitcherIds = new Set();
      Object.values(dayGames).flat().forEach(g=>{
        if (g.awayPid) pitcherIds.add(g.awayPid);
        if (g.homePid) pitcherIds.add(g.homePid);
      });
      const facedMap = {};
      await mapPool([...pitcherIds], 4, async (pid)=>{
        try {
          const pr = await fetch(`${API}/people/${pid}/stats` +
            `?stats=gameLog&group=pitching&season=${season}&gameType=R`);
          if (!pr.ok) return;
          const pj = await pr.json();
          const list = [];
          (pj.stats?.[0]?.splits || []).forEach(s=>{
            if (s.opponent?.id) list.push({ oppId:s.opponent.id, date:s.date });
          });
          facedMap[pid] = list;     // [{oppId, date}] — keep dates to exclude same-day
        } catch { /* leave unset */ }
      });
      setFaced(facedMap);
    } catch (e) {
      setErr(isNet(e.message) ? "Couldn't reach the MLB schedule service." : e.message);
    } finally { setBusy(false); }
  }, [start, westThreshold, minStreak]);

  useEffect(() => { load(); }, [load]);   // auto-load on open and when min streak changes

  /* which trends touch a given game (for calendar highlighting) */
  const gameTrends = (date, g) => {
    const echo = (echoes||[]).filter(e=>e.date===date &&
      (e.teamId===g.homeId || e.teamId===g.awayId));
    const cb = (comebacks||[]).filter(c=>c.next && c.next.date===date &&
      (c.teamId===g.homeId || c.teamId===g.awayId));
    const rematch = [];
    const facedBefore = (pid, oppId) =>
      (faced[pid]||[]).some(x => x.oppId===oppId && x.date < date);
    if (g.awayPid && facedBefore(g.awayPid, g.homeId))
      rematch.push({ pitcher:g.awayPname, pid:g.awayPid, opp:g.homeName, oppId:g.homeId });
    if (g.homePid && facedBefore(g.homePid, g.awayId))
      rematch.push({ pitcher:g.homePname, pid:g.homePid, opp:g.awayName, oppId:g.awayId });
    const prevD = addDays(date,-1);
    const bigday = [];
    const aRuns = runsMap[g.awayId]?.[prevD], hRuns = runsMap[g.homeId]?.[prevD];
    if (aRuns>=10) bigday.push({ team:g.awayName, runs:aRuns });
    if (hRuns>=10) bigday.push({ team:g.homeName, runs:hRuns });
    return { travel:!!g.flagged, travelers:g.travelers||[], echo, cb, rematch, bigday,
      any: !!g.flagged || echo.length>0 || cb.length>0 || rematch.length>0 || bigday.length>0 };
  };

  return (
    <div>
      <Eyebrow n="03">My trends · yesterday → next 5 days</Eyebrow>

      <div style={{ display:"flex", gap:14, flexWrap:"wrap", alignItems:"center", marginBottom:18 }}>
        <button onClick={load} disabled={busy} style={btn(false)}>
          {busy ? "Loading…" : "Refresh"}</button>
        {busy && <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft }}>
          pulling schedule, results & pitchers…</span>}
      </div>

      {err && <ErrBox>{err}</ErrBox>}

      {/* ── 7-day calendar: all games, trend matches highlighted & clickable ── */}
      {days && (
        <div>
          <Eyebrow>7-day calendar · click a highlighted game</Eyebrow>
          <Legend />
          <div className="ts-cal" style={{ gap:8, paddingBottom:4 }}>
            {days.map(d=>{
              const isToday = d.date === start;
              return (
              <div key={d.date} className="ts-cal-col" style={{ border:`1px solid ${isToday?C.ink:C.rule}`, borderRadius:3,
                overflow:"hidden" }}>
                <div style={{ padding:"8px 10px", borderBottom:`1px solid ${C.rule}`,
                  background:isToday?C.ink:C.card }}>
                  <div style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.1em",
                    textTransform:"uppercase", color:isToday?"#fff":C.inkSoft }}>
                    {isToday ? "Today" : d.date===addDays(start,-1) ? "Yesterday" : calDay(d.date).wd}</div>
                  <div style={{ fontFamily:SANS, fontSize:15, fontWeight:700,
                    color:isToday?"#fff":C.ink }}>{calDay(d.date).md}</div>
                </div>
                <div style={{ padding:6, display:"flex", flexDirection:"column", gap:6 }}>
                  {d.games.length===0 && <div style={{ fontFamily:SANS, fontSize:12,
                    color:C.ruleDark, padding:"6px 4px" }}>—</div>}
                  {d.games.map((g,i)=>{
                    const t = gameTrends(d.date, g);
                    return <CalCard key={i} g={g} t={t}
                      onOpen={t.any ? ()=>setModal({ date:d.date, g, t }) : null} />;
                  })}
                </div>
              </div>);
            })}
          </div>
        </div>
      )}

      {modal && <GameModal m={modal} onClose={()=>setModal(null)} />}
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:12 }}>
      {TREND_SLOTS.map(s=>(
        <span key={s.key} style={{ display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ width:14, height:7, borderRadius:2, background:s.color }} />
          <span style={{ fontFamily:MONO, fontSize:10, color:C.inkSoft }}>{s.label}</span>
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
  { key:"rematch", color:C.rematch, label:"pitcher rematch",
    on:(t)=>t.rematch.length>0,
    title:(t)=>t.rematch.map(m=>`${m.pitcher} already faced ${m.opp} this season`).join("; ") },
  { key:"bigday", color:C.bigday, label:"10+ runs prior day",
    on:(t)=>t.bigday.length>0,
    title:(t)=>t.bigday.map(b=>`${b.team} scored ${b.runs} the day before`).join("; ") },
  { key:"late", color:C.under, label:"late go-ahead",
    on:(t)=>t.cb.length>0,
    title:(t)=>t.cb.map(c=>`${c.team} first led ${ord(c.inning)} yesterday`).join("; ") },
  { key:"echo", color:C.blue, label:"streak echo",
    on:(t)=>t.echo.length>0,
    title:(t)=>t.echo.map(e=>`${e.team}: broke ${e.streakLen}-game ${e.streakRes==="W"?"win":"loss"} streak`).join("; ") },
  { key:"travel", color:C.over, label:"W→E back-to-back",
    on:(t)=>t.travel,
    title:(t)=>t.travelers.map(x=>`${x.tname} ${x.from}→${x.to} · back-to-back`).join("; ") },
];

function CalCard({ g, t, onOpen }) {
  const aw = TEAM_ABBR[g.awayId]||"?", hm = TEAM_ABBR[g.homeId]||"?";
  const time = new Date(g.time).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
  const final = g.isFinal && g.awayScore!=null && g.homeScore!=null;
  const awWon = final && g.awayScore > g.homeScore;
  const hmWon = final && g.homeScore > g.awayScore;
  return (
    <div onClick={onOpen||undefined}
      role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e)=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();onOpen();} } : undefined}
      style={{ border:`1px solid ${t.any?C.markerDeep:C.rule}`, borderRadius:2,
      padding:"7px 8px", background: t.any ? "rgba(255,233,77,0.18)" : "#fff",
      cursor: onOpen ? "pointer" : "default" }}>
      {final ? (
        <div style={{ fontFamily:MONO, fontSize:12.5 }}>
          <div style={{ display:"flex", justifyContent:"space-between",
            fontWeight: awWon?800:400, color: awWon?C.ink:C.inkSoft }}>
            <span>{aw}</span><span>{g.awayScore}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between",
            fontWeight: hmWon?800:400, color: hmWon?C.ink:C.inkSoft }}>
            <span>{hm}</span><span>{g.homeScore}</span>
          </div>
          <div style={{ fontFamily:MONO, fontSize:8.5, color:C.ruleDark, textAlign:"right",
            marginTop:1 }}>FINAL</div>
        </div>
      ) : (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:4 }}>
          <span style={{ fontFamily:MONO, fontSize:12.5, fontWeight:600 }}>
            {aw}<span style={{ color:C.inkSoft }}>@</span>{hm}</span>
          <span style={{ fontFamily:MONO, fontSize:9.5, color:C.inkSoft }}>{time}</span>
        </div>
      )}
      {/* fixed quadrant markers — every card shows the same slots, filled or empty */}
      <div style={{ display:"flex", gap:3, marginTop:5 }}>
        {TREND_SLOTS.map(slot=>{
          const present = slot.on(t);
          return (
            <span key={slot.key} style={{ flex:1, display:"flex", justifyContent:"center" }}>
              <span title={present ? slot.title(t) : undefined}
                style={{ width:"100%", maxWidth:20, height:7, borderRadius:2,
                  background: present ? slot.color : "transparent",
                  boxShadow: present ? "none" : `inset 0 0 0 1px ${C.rule}`,
                  opacity: present ? 1 : 0.4 }} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ── game detail modal: probable pitchers, every prior matchup vs this team ── */
const pLine = (s) => {
  const st = s.stat;
  return `${st.inningsPitched} IP · ${st.hits} H · ${st.earnedRuns} ER · ` +
    `${st.baseOnBalls} BB · ${st.strikeOuts} K`;
};
function PitcherBlock({ name, vsName, info }) {
  return (
    <div style={{ borderTop:`1px solid ${C.rule}`, padding:"12px 0" }}>
      <div style={{ fontFamily:SANS, fontSize:15, fontWeight:700 }}>
        {name || "TBD"}
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
          No {new Date().getFullYear()} game log found.</div>
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
    </div>
  );
}

function GameModal({ m, onClose }) {
  const { g, date } = m;
  const [away, setAway] = useState(undefined);   // undefined = loading
  const [home, setHome] = useState(undefined);

  useEffect(() => {
    let alive = true;
    const season = new Date().getFullYear();
    const fetchP = async (pid, oppId) => {
      if (!pid) return null;
      try {
        const r = await fetch(`${API}/people/${pid}/stats` +
          `?stats=gameLog&group=pitching&season=${season}&gameType=R`);
        if (!r.ok) return null;
        const j = await r.json();
        const splits = (j.stats?.[0]?.splits || []).slice()
          .sort((a,b)=>a.date.localeCompare(b.date));
        if (!splits.length) return null;
        // every prior start vs this opponent, excluding the game being viewed
        const vs = splits.filter(s=>s.opponent?.id===oppId && s.date < date);
        return { vs };
      } catch { return null; }
    };
    (async () => {
      const a = await fetchP(g.awayPid, g.homeId); if (alive) setAway(a);
      const h = await fetchP(g.homePid, g.awayId); if (alive) setHome(h);
    })();
    return () => { alive = false; };
  }, [g, date]);

  const time = new Date(g.time).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:50,
      background:"rgba(20,24,31,0.55)", display:"flex", alignItems:"center",
      justifyContent:"center", padding:18 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.paper,
        border:`1px solid ${C.ink}`, borderRadius:4, maxWidth:520, width:"100%",
        maxHeight:"85vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ padding:"16px 20px", borderBottom:`2px solid ${C.ink}`,
          display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10 }}>
          <div>
            <div style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.16em",
              textTransform:"uppercase", color:C.inkSoft }}>{prettyDay(date)} · {time}</div>
            <div style={{ fontFamily:SANS, fontSize:20, fontWeight:800, letterSpacing:"-0.01em" }}>
              {g.awayName} <span style={{ color:C.inkSoft, fontWeight:400 }}>@</span> {g.homeName}</div>
          </div>
          <button onClick={onClose} style={{ border:`1px solid ${C.rule}`, background:"#fff",
            borderRadius:2, fontFamily:MONO, fontSize:12, padding:"4px 9px", cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ padding:"4px 20px 8px" }}>
          {m.t.any && (
            <div style={{ display:"flex", gap:5, flexWrap:"wrap", padding:"12px 0 4px" }}>
              {m.t.travel && <Pill color={C.over}>W→E back-to-back</Pill>}
              {m.t.echo.map((e,i)=><Pill key={i} color={C.blue}>
                streak echo → {e.predicted==="W"?"win":"loss"}</Pill>)}
              {m.t.cb.map((c,i)=><Pill key={i} color={C.under}>late go-ahead {ord(c.inning)}</Pill>)}
              {m.t.rematch.map((r,i)=><Pill key={i} color={C.rematch}>pitcher rematch</Pill>)}
              {m.t.bigday.map((b,i)=><Pill key={i} color={C.bigday}>{b.team.split(" ").slice(-1)[0]} {b.runs} runs prior day</Pill>)}
            </div>
          )}
          <div style={{ fontFamily:MONO, fontSize:10, letterSpacing:"0.14em",
            textTransform:"uppercase", color:C.inkSoft, paddingTop:10 }}>Probable starters</div>
          <PitcherBlock name={g.awayPname} vsName={g.homeName} info={away} />
          <PitcherBlock name={g.homePname} vsName={g.awayName} info={home} />
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════ shell ════════════════════════════ */
const RESPONSIVE_CSS = `
.ts-cal { display:grid; grid-template-columns: repeat(7, minmax(150px,1fr)); overflow-x:auto; }
.ts-cal-col { min-width:150px; }
.ts-lineups { display:grid; grid-template-columns:1fr 1fr; }
.ts-app { padding:28px 18px 60px; }
@media (max-width:760px){
  .ts-cal { grid-auto-flow:column; grid-auto-columns:82%; grid-template-columns:none;
            overflow-x:auto; scroll-snap-type:x mandatory; scroll-padding-left:0; }
  .ts-cal-col { min-width:0; scroll-snap-align:start; }
  .ts-lineups { grid-template-columns:1fr; }
  .ts-lineup-col { border-right:none !important; }
  .ts-lineup-col + .ts-lineup-col { border-top:1px solid #CDD3DA; }
  .ts-app { padding:18px 12px 48px; }
}
* { -webkit-tap-highlight-color: transparent; }
`;

export default function App() {
  const [tab, setTab] = useState("travel");
  return (
    <div className="ts-app" style={{ minHeight:"100vh", background:C.paper, color:C.ink, fontFamily:SANS }}>
      <style>{RESPONSIVE_CSS}</style>
      <div style={{ maxWidth:1040, margin:"0 auto" }}>
        <header style={{ borderBottom:`2px solid ${C.ink}`, paddingBottom:14, marginBottom:6 }}>
          <div style={{ fontFamily:MONO, fontSize:11, letterSpacing:"0.22em",
            textTransform:"uppercase", color:C.inkSoft }}>Research Terminal · MLB live</div>
          <h1 style={{ margin:"6px 0 0", fontFamily:SANS, fontWeight:800, fontSize:34,
            letterSpacing:"-0.02em", lineHeight:1 }}>The Trend Sheet</h1>
        </header>
        <div style={{ height:6, borderBottom:`1px solid ${C.rule}`, marginBottom:22 }} />
        <div style={{ display:"flex", gap:4, marginBottom:24, flexWrap:"wrap" }}>
          {[["travel","My Trends"],["day","Daily Slate"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>setTab(id)} style={{ padding:"8px 16px",
              border:`1px solid ${tab===id?C.ink:C.rule}`, borderRadius:2,
              background:tab===id?C.ink:"transparent", color:tab===id?"#fff":C.inkSoft,
              fontFamily:MONO, fontSize:12, letterSpacing:"0.08em", textTransform:"uppercase",
              cursor:"pointer" }}>{lbl}</button>))}
        </div>

        {tab==="day" ? <DaySheet/> : <TravelTrends/>}

        <footer style={{ marginTop:40, paddingTop:14, borderTop:`1px solid ${C.rule}`,
          fontFamily:MONO, fontSize:10.5, color:C.ruleDark, lineHeight:1.7 }}>
          Stats & schedule: MLB Stats API (free, no key). Lineups are confirmed only a few hours
          pre-game; before that, projected from each team’s last batting order. Monthly AVG is
          computed from the selected date’s month; H/TB/K show the last five games.
        </footer>
      </div>
    </div>
  );
}
