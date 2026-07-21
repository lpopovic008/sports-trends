import React, { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, ReferenceLine,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import hotNutLogo from "./assets/hot-nut-logo.png";

/* ───────────────────────────── palette ─────────────────────────────
   Box-score / stat-sheet identity. Cool newsprint paper, ink-black
   tabular numerals, hairline rules like a ruled scorecard. Signature:
   a literal highlighter swipe behind every game that matches a trend. */
const C = {
  paper:"#E2E5EA", card:"#F8F9FA", ink:"#14181F", inkSoft:"#525A66",
  rule:"#CDD3DA", ruleDark:"#9AA3AD", marker:"#FFE94D", markerDeep:"#F4CE2A",
  over:"#1B7F5C", under:"#D7263D", blue:"#2B4C7E",
  softOver:"rgba(27,127,92,0.32)", softUnder:"rgba(215,38,61,0.30)",
  softEven:"rgba(59,130,246,0.28)",
  /* today's-slate dark cells — light text/outline equivalents of ink/inkSoft/
     ruleDark/rule, used only when a card sits on the dark charcoal/navy pair */
  darkText:"#F2F4F7", darkTextSoft:"#AEB7C4", darkOutline:"#57616F", darkBorder:"#3A4250",
  // same green/red highlights, tuned brighter so a translucent tint still
  // pops against a dark charcoal/navy card instead of reading muddy; the
  // "wash" state is a soft blue glow instead of grey, so it reads as a
  // highlight rather than another shade of grey against the dark card
  darkSoftOver:"rgba(46,204,146,0.4)", darkSoftUnder:"rgba(255,107,117,0.38)",
  darkSoftEven:"rgba(96,165,250,0.4)",
  /* indicator colors — a neon graffiti set, ordered so each swatch sits
     next to its nearest hue on the color wheel */
  boom:"#FF073A",          /* neon red: hot bats, 10+ hits last game */
  slump:"#0FF0FC",         /* neon cyan: cold bats, 6 or fewer hits last game */
  rematch:"#16A2DF",       /* neon blue: chess-move pitcher */
  rematchLight:"#A9E1F7",  /* light neon blue: faced but short outing */
  travel:"#8B5CF6",        /* neon violet: jet-lagged west→east */
  late:"#A0EE26",          /* neon lime: clutch late-night drama */
  bigday:"#F4289B",        /* neon pink: 10-run scoreboard explosion */
  echo:"#FF8C1A",          /* neon orange: momentum wave */
  gauntlet:"#0FF0FC",      /* neon cyan: a brutal stretch of ace pitching, just survived */
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
// hits+walks (times on base) plus total bases (hits, plus extra credit for
// doubles/triples/homers when present) allowed or produced in one game/
// stint — the same OPS-flavored "combined production" figure used by both
// the batting score (a team's own output) and the pitcher score (what a
// pitcher allowed), just read from whichever side's stat line.
function combinedProduction(stat) {
  const h = Number(stat?.hits)||0, bb = Number(stat?.baseOnBalls)||0;
  const doubles = Number(stat?.doubles)||0, triples = Number(stat?.triples)||0, hr = Number(stat?.homeRuns)||0;
  const totalBases = h + doubles + 2*triples + 3*hr;
  return (h+bb) + totalBases;
}
// same "combined production" concept, but as a rate — per 9 innings for a
// pitcher's own season line, or per team-game (treated as a stand-in for
// "per 9 innings faced") for a team's season hitting line.
function combinedProduction9(rates) {
  return (rates.h9+rates.bb9) + (rates.h9 + rates.doubles9 + 2*rates.triples9 + 3*rates.hr9);
}
// roughly modern-MLB league-average rates, used only when a pitcher's or
// team's own season log isn't available yet.
const LEAGUE_AVG_RATES = { h9:8.7, bb9:3.1, hr9:1.2, doubles9:1.6, triples9:0.15 };
// clamp(5 + 4.5*ln(ratio), 0, 10) — 5.0 is exactly par. `invert` flips which
// direction "doing well" means: a batter wants actual production above
// expected; a pitcher wants actual allowed below expected.
function qualityScore(actual, expected, invert=false) {
  if (!(expected>0)) return null;
  const ratio = invert ? expected/actual : actual/expected;
  return Math.max(0, Math.min(10, 5 + 4.5*Math.log(ratio)));
}
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

// Draw the tagged play as green monospace "code" text, right-aligned at
// (rightX, cy) — matching today's-slate's terminal look instead of the old
// red marker handwriting. Shrinks to fit maxW if needed, no rotation.
function drawGreenTag(x, text, leftX, cy, maxW, fontSize = 14) {
  if (!text) return;
  x.save();
  let size = fontSize;
  x.font = `700 ${size}px ${MONO}`;
  while (x.measureText(text).width > maxW && size > 8) {
    size -= 0.5;
    x.font = `700 ${size}px ${MONO}`;
  }
  x.fillStyle = "#39D98A";
  x.textAlign = "left"; x.textBaseline = "middle";
  x.fillText(text, leftX, cy);
  x.restore();
}

// preloaded once at module scope so it's already decoded by the time an
// export runs. exportCard/copySlate stay synchronous right up to their
// copyCanvas() call (see its own comment) — Safari/iOS only honors the
// clipboard write as a direct user gesture if nothing async (like awaiting
// an image load) happens in between, so the logo has to already be ready.
const hotNutLogoImg = (() => {
  if (typeof Image === "undefined") return null;
  const img = new Image();
  img.src = hotNutLogo;
  return img;
})();

function roundedRectPath(x, left, top, w, h, r) {
  x.beginPath();
  x.moveTo(left+r,top); x.arcTo(left+w,top,left+w,top+h,r); x.arcTo(left+w,top+h,left,top+h,r);
  x.arcTo(left,top+h,left,top,r); x.arcTo(left,top,left+w,top,r); x.closePath();
}

// small logo icon in the gap between the team names and the play indicator
// on an exported card row — skipped silently if the image hasn't finished
// decoding yet (only possible if export is clicked within moments of the
// page loading).
function drawLogoIcon(x, centerX, centerY, size) {
  if (!hotNutLogoImg || !hotNutLogoImg.complete || !hotNutLogoImg.naturalWidth) return;
  x.drawImage(hotNutLogoImg, centerX - size/2, centerY - size/2, size, size);
}

// a play's grade indicator box: empty outline until graded, then filled
// solid with a check (win), ex (loss), or "P" (push).
function drawPlayIndicator(x, result, bx, by, size = 14) {
  const rr = 3;
  x.save();
  x.beginPath();
  x.moveTo(bx+rr,by); x.arcTo(bx+size,by,bx+size,by+size,rr); x.arcTo(bx+size,by+size,bx,by+size,rr);
  x.arcTo(bx,by+size,bx,by,rr); x.arcTo(bx,by,bx+size,by,rr); x.closePath();
  if (result === "W" || result === "L" || result === "P") {
    x.fillStyle = result==="W" ? "#1B7F5C" : result==="L" ? "#D7263D" : "#2B4C7E";
    x.fill();
    x.fillStyle = "#fff"; x.font = `700 ${Math.round(size*0.72)}px ${MONO}`;
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(result==="W" ? "✓" : result==="L" ? "✕" : "P", bx+size/2, by+size/2+0.5);
  } else {
    x.strokeStyle = "#57616F"; x.lineWidth = 1.4; x.stroke();
  }
  x.restore();
}

// strips a leading "PLAY" convention off a tagged pick before drawing it —
// redundant on an exported image that's already understood to be a play
const stripPlayPrefix = (t) => (t||"").replace(/^\s*play\s*[·:\-–]?\s*/i, "");

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

  // setStarred(gamePk, bool): toggle a play as a standout pick
  const setStarred = (gamePk, starred) => {
    setTags(prev => {
      const entry = prev[gamePk];
      if (!entry) return prev;
      const obj = typeof entry === "string" ? { text:entry } : { ...entry };
      if (starred) obj.starred = true; else delete obj.starred;
      const next = { ...prev, [gamePk]:obj };
      persist(next);
      return next;
    });
  };

  return { tags, tagStatus, setTag, setResult, setStarred };
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
  // anchor: today by default, adjustable — see the CALENDAR tab button,
  // which doubles as a date picker once it's already the active tab
  const [anchor, setAnchor] = useState(todayISO());
  const start = anchor;
  const minStreak = 10;                        // fixed threshold
  const [days, setDays] = useState(null);
  const [echoes, setEchoes] = useState(null);
  const [comebacks, setComebacks] = useState(null);
  const [faced, setFaced] = useState({});      // pitcherId -> Set(opponent team ids)
  const [formerTeams, setFormerTeams] = useState({});  // pitcherId -> Set(team ids ever played for)
  const [runsMap, setRunsMap] = useState({});  // teamId -> { date -> runs scored }
  const [hitsMap, setHitsMap] = useState({});  // teamId -> { date -> hits }
  const [battingScoreMap, setBattingScoreMap] = useState({});  // teamId -> { date -> 0-10 score }
  const [scheduleMap, setScheduleMap] = useState({});  // teamId -> [{date, oppPid}] sorted ascending
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
    if (needIndicators) { setEchoes(null); setComebacks(null); setFaced({}); setFormerTeams({}); setRunsMap({}); setHitsMap({}); setBattingScoreMap({}); setScheduleMap({}); }
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
      const scheduleByTeam = {};  // teamId -> [{date, oppPid}] — every probable
                                  // starter each team is scheduled to face across
                                  // the visible window, in order, for the gauntlet
                                  // (2-3 straight sub-3.00-ERA starters) trend
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
          // gamePk (not just date) identifies the exact game — a doubleheader
          // puts two of these in a row for the same team on the same date
          if (hp?.id) (scheduleByTeam[away.id] = scheduleByTeam[away.id]||[]).push({ date:d.date, time:g.gameDate, gamePk:g.gamePk, oppPid:hp.id });
          if (ap?.id) (scheduleByTeam[home.id] = scheduleByTeam[home.id]||[]).push({ date:d.date, time:g.gameDate, gamePk:g.gamePk, oppPid:ap.id });
        });
      });
      Object.values(scheduleByTeam).forEach(list=>list.sort((a,b)=>a.time.localeCompare(b.time)));

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
      const runsByDate = {};   // teamId -> { gameTime -> runs scored }
      const hitsByDate = {};   // teamId -> { gameTime -> hits }
      const gamePkByDate = {}; // teamId -> { gameTime -> { gamePk, side } } — which
                               // specific game fed that entry, and which side this
                               // team batted from (used below to look up the
                               // opposing pitchers' box-score lines). Keyed by the
                               // exact game timestamp, not just the date — a
                               // doubleheader's two games share a date, and keying
                               // by date alone would let the second game silently
                               // overwrite the first instead of both counting as
                               // separate "previous games."
      finals.forEach(g=>{
        ["home","away"].forEach(side=>{
          const t = g.teams[side];
          if (typeof t.isWinner !== "boolean") return;
          teamName[t.team.id] = t.team.name;
          (byTeamRes[t.team.id] = byTeamRes[t.team.id]||[])
            .push({ date:g.gameDate, res: t.isWinner ? "W":"L" });
          const runs = Number(t.score);
          if (!isNaN(runs)) {
            const m = runsByDate[t.team.id] = runsByDate[t.team.id]||{};
            m[g.gameDate] = runs;
          }
          const hits = Number(g.linescore?.teams?.[side]?.hits);
          if (!isNaN(hits)) {
            const hm = hitsByDate[t.team.id] = hitsByDate[t.team.id]||{};
            hm[g.gameDate] = hits;
            (gamePkByDate[t.team.id] = gamePkByDate[t.team.id]||{})[g.gameDate] = { gamePk:g.gamePk, side };
          }
        });
      });
      // scheduleByTeam (built from the main window fetch, -3..+4 days) only
      // covers the visible calendar; merge in any earlier games this fetch
      // found (up to 35 days back) that aren't already in it, so "the game
      // right before this one" can still be found correctly for a game
      // sitting near the start of the visible window, whose real previous
      // game may be further back than the window itself reaches.
      Object.entries(gamePkByDate).forEach(([tid, games])=>{
        const list = scheduleByTeam[tid] = scheduleByTeam[tid] || [];
        const known = new Set(list.map(s=>s.gamePk));
        Object.entries(games).forEach(([time, { gamePk }])=>{
          if (!known.has(gamePk)) list.push({ date:time.slice(0,10), time, gamePk, oppPid:null });
        });
      });
      Object.values(scheduleByTeam).forEach(list=>list.sort((a,b)=>a.time.localeCompare(b.time)));
      setScheduleMap(scheduleByTeam);
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
      /* ── former team: has each probable ever pitched for the team he's
         facing today (any prior MLB season/stint, not just this one) —
         a "revenge game," distinct from the in-season rematch above. ── */
      const formerTeamMap = {};
      await mapPool([...pitcherIds], 4, async (pid)=>{
        try {
          const pr = await fetch(`${API}/people/${pid}/stats?stats=yearByYear&group=pitching&sportId=1`);
          if (!pr.ok) return;
          const pj = await pr.json();
          const splits = pj.stats?.[0]?.splits || [];
          const teams = new Set();
          splits.forEach(s=>{ if (s.team?.id) teams.add(Number(s.team.id)); });
          formerTeamMap[pid] = teams;
        } catch { /* leave unset */ }
      });
      /* ── quality-adjusted batting score: for every team shown, how well did
         they hit (times on base + total bases — an OPS-flavored view, not
         just raw hits) in each of their last 3 games relative to the
         quality of every pitcher they actually faced that game (not just
         the starter)? 0-10, 5.0 = exactly what that pitching staff's own
         season rate stats (not just their ERA) would predict. Only fetches
         box scores for the specific past games that feed a "last 3" trio
         somewhere in the visible window, deduped by gamePk so a shared
         game (e.g. yesterday's, feeding two different
         cells) is only fetched once. ── */
      const neededGamePks = new Set();
      DATES.forEach(date=>{
        (dayGames[date]||[]).forEach(g=>{
          // compares against this exact game's own start time, not just its
          // calendar date — on a doubleheader, the earlier game is a valid
          // "previous game" for the later one despite sharing a date
          [g.awayId, g.homeId].forEach(tid=>{
            const m = gamePkByDate[tid];
            if (!m) return;
            Object.keys(m).filter(t=>t<g.time).sort().reverse().slice(0,3)
              .forEach(t=>neededGamePks.add(m[t].gamePk));
          });
        });
      });
      const boxCache = {};   // gamePk -> { away:[{pid,name,stat}], home:[...] }
      await mapPool([...neededGamePks], 4, async (gamePk) => {
        const bx = await loadBoxscorePitchers(gamePk);
        if (bx) boxCache[gamePk] = bx;
      });
      // every pitcher who appeared in any of those box scores (either side —
      // a single historical game can feed both participating teams' own
      // trios if both are shown somewhere in the window) needs their own
      // season rate stats to judge the quality of the batting performance
      // against them — not just their ERA, which different pitchers can
      // reach through very different walk/home-run mixes (a control pitcher
      // and a bat-misser can post the same ERA while allowing very
      // different amounts of "on base for free" and "hit for power").
      const pitcherSeasonCache = {};   // pid -> { h9, bb9, hr9, doubles9, triples9 }
      const boxPids = new Set();
      Object.values(boxCache).forEach(bx=>{
        (bx.away||[]).forEach(p=>boxPids.add(p.pid));
        (bx.home||[]).forEach(p=>boxPids.add(p.pid));
      });
      await mapPool([...boxPids], 4, async (pid) => {
        try {
          const r = await fetch(`${API}/people/${pid}/stats?stats=season&group=pitching&season=${SEASON}`);
          if (!r.ok) return;
          const j = await r.json();
          const stat = j.stats?.[0]?.splits?.[0]?.stat;
          const outs = ipToOuts(stat?.inningsPitched);
          if (!stat || !outs) return;   // e.g. a rookie with no innings logged yet
          pitcherSeasonCache[pid] = {
            h9: Number(stat.hits||0)*27/outs,
            bb9: Number(stat.baseOnBalls||0)*27/outs,
            hr9: Number(stat.homeRuns||0)*27/outs,
            doubles9: Number(stat.doubles||0)*27/outs,
            triples9: Number(stat.triples||0)*27/outs,
          };
        } catch { /* fall back to league-average below */ }
      });
      const battingScoreByDate = {};   // teamId -> { gameTime -> score(0-10) }
      Object.entries(gamePkByDate).forEach(([tid, games])=>{
        Object.entries(games).forEach(([gt, { gamePk, side }])=>{
          const bx = boxCache[gamePk];
          const pitchers = bx?.[side==="home"?"away":"home"];
          if (!pitchers || !pitchers.length) return;
          let actual = 0, expected = 0;
          pitchers.forEach(p=>{
            const trueIP = ipToOuts(p.stat?.inningsPitched)/3;
            if (!trueIP) return;
            actual += combinedProduction(p.stat);
            expected += combinedProduction9(pitcherSeasonCache[p.pid] || LEAGUE_AVG_RATES) / 9 * trueIP;
          });
          const score = qualityScore(actual, expected);
          if (score!=null) (battingScoreByDate[tid] = battingScoreByDate[tid]||{})[gt] = score;
        });
      });

      // all trend markers appear together (rematch · 10-run · late · echo · travel)
      setFaced(facedMap);
      setFormerTeams(formerTeamMap);
      setRunsMap(runsByDate);
      setHitsMap(hitsByDate);
      setBattingScoreMap(battingScoreByDate);
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
      // one card per tagged pick, styled like today's slate's calendar card:
      // teams stacked, time/FINAL top-right, the play (with its grade
      // indicator) anchored at a fixed indent shared by every card so the
      // indicator boxes line up in a column going down
      const CW = 300, RH = 64, GAP = 6, PADX = 12, HEAD = 40, PADB = 12;
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
      // one card per tagged pick, matching the calendar card's own layout
      games.forEach((g,i)=>{
        const gx = PADX, gy = HEAD + i*(RH+GAP), midY = gy + RH/2;
        const resultTint = tagResultBg(tags[g.gamePk]);
        const final = g.isFinal && g.awayScore!=null && g.homeScore!=null;
        const aw = TEAM_ABBR[g.awayId]||"?", hm = TEAM_ABBR[g.homeId]||"?";
        const time = final ? "FINAL" : new Date(g.time).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
        const rr = 4;
        roundedRectPath(x, gx, gy, CW, RH, rr);
        x.fillStyle = "#20232A"; x.fill();
        if (resultTint) { x.fillStyle = resultTint; x.fill(); }
        x.strokeStyle = "#3A4250"; x.lineWidth = 1; x.stroke();
        // time / FINAL, top-right
        x.fillStyle = "#AEB7C4"; x.font = "9px ui-monospace, Menlo, monospace";
        x.textAlign = "right"; x.textBaseline = "alphabetic";
        x.fillText(final?"FINAL":time, gx+CW-10, gy+16);
        // teams stacked, left
        const row1Y = gy+26, row2Y = gy+46;
        x.textAlign = "left"; x.fillStyle = "#F2F4F7";
        x.font = "700 14px system-ui, sans-serif";
        x.fillText(aw, gx+12, row1Y);
        x.fillText(hm, gx+12, row2Y);
        // scores, right (if final)
        if (final) {
          x.textAlign = "right"; x.font = "700 14px ui-monospace, Menlo, monospace";
          x.fillStyle = g.awayScore>g.homeScore ? "#F2F4F7" : "#AEB7C4";
          x.fillText(String(g.awayScore), gx+CW-14, row1Y);
          x.fillStyle = g.homeScore>g.awayScore ? "#F2F4F7" : "#AEB7C4";
          x.fillText(String(g.homeScore), gx+CW-14, row2Y);
        }
        // logo icon in the gap between the team names and the play — same
        // spot on every card, going down the slate
        drawLogoIcon(x, gx + CW*0.25, midY, 24);
        // the play: grade indicator box + green code text, anchored at the
        // same fixed indent on every card so the indicators line up going down
        const tv = stripPlayPrefix(tagText(tags[g.gamePk]));
        const entry = tags[g.gamePk];
        const gradeResult = entry && typeof entry === "object" ? entry.result : null;
        const indentX = gx + CW*0.36;
        drawPlayIndicator(x, gradeResult, indentX, midY-7, 14);
        const rightLimit = final ? gx+CW-40 : gx+CW-10;
        drawGreenTag(x, tv, indentX+20, midY, rightLimit-(indentX+20), 13);
      });
      copyCanvas(cv, `mlb-picks-${start}.png`, setSlateCopied);
    } catch (e) {
      console.error("copySlate failed:", e);
      setSlateCopied("err"); setTimeout(()=>setSlateCopied(null),2000);
    }
  };
  useEffect(() => { if(onReady) onReady({ load, busy, copySlate, slateCopied, modalOpen: !!modal,
    showIndicators, setShowIndicators, anchor, setAnchor });
  }, [load, busy, onReady, slateCopied, days, tags, modal, showIndicators, anchor]);

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
      const facings = (entry?.list||[]).filter(x => Number(x.oppId)===Number(oppId) && x.date < date);
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
      // "up"/"down" need a 2+ stat margin — a single green or red stat isn't
      // a strong enough signal to soft-highlight the ERA box over
      rematchVerdict[teamId] = (greens-reds)>=2 ? "up" : (reds-greens)>=2 ? "down" : "even";
    };
    checkRematch(g.awayPid, g.awayId, g.homeId, g.awayPname, g.homeName);
    checkRematch(g.homePid, g.homeId, g.awayId, g.homePname, g.awayName);

    // "revenge game": this team's probable starter previously pitched FOR
    // the team he's facing today, at some point in his career (not just an
    // in-season repeat matchup, which is the rematch trend above)
    const formerTeam = [];
    const checkFormerTeam = (pid, teamId, oppId, pitcher, oppName) => {
      if (!pid) return;
      const teams = formerTeams[pid];
      if (!teams || !teams.has(Number(oppId))) return;
      formerTeam.push({ pitcher, pid, opp:oppName, oppId, teamId });
    };
    checkFormerTeam(g.awayPid, g.awayId, g.homeId, g.awayPname, g.homeName);
    checkFormerTeam(g.homePid, g.homeId, g.awayId, g.homePname, g.awayName);

    // this team's probable starter's season ERA — independent of any rematch
    const pitcherEra = (tid) => {
      const pid = tid===g.awayId ? g.awayPid : tid===g.homeId ? g.homePid : null;
      const era = pid ? faced[pid]?.season?.era : null;
      return era!=null ? era : null;
    };

    // "the gauntlet": this team just came through a run of 2-3 straight
    // games against a starter with a sub-3.00 ERA — looks strictly at the
    // games BEFORE this one (today's own opposing starter doesn't count
    // toward it), same as the other "yesterday"-style trend markers. Matches
    // on this exact game's gamePk (not just its date) so a doubleheader's
    // second game correctly finds its own first game as "the previous one,"
    // rather than an ambiguous date match landing on either game. A game
    // with no posted starter yet, or an unknown ERA, simply breaks the run
    // there, same "actual games, not calendar days" logic as the other
    // streaks.
    const gauntlet = [];
    [[g.awayId,g.awayName],[g.homeId,g.homeName]].forEach(([tid,tname])=>{
      const sched = scheduleMap[tid];
      if (!sched) return;
      const idx = sched.findIndex(s=>s.gamePk===g.gamePk);
      if (idx===-1) return;
      const qualifies = (i) => {
        const pid = sched[i]?.oppPid;
        const era = pid ? faced[pid]?.season?.era : null;
        return era!=null && era < 3.00;
      };
      let runLen = 0;
      for (let i=idx-1; i>=0 && qualifies(i); i--) runLen++;
      if (runLen>=2) gauntlet.push({ teamId:tid, team:tname, len:runLen });
    });

    // the specific game(s) immediately before this one in the team's real
    // schedule (using scheduleMap's sequential order, same idea as the
    // gauntlet lookup above) — NOT "the most recent completed game found
    // anywhere," which would keep matching the same old result across every
    // future game in the visible window whenever one or more games in
    // between haven't been played yet.
    const prevScheduledGames = (tid, count) => {
      const sched = scheduleMap[tid];
      if (!sched) return [];
      const idx = sched.findIndex(s=>s.gamePk===g.gamePk);
      if (idx===-1) return [];
      return sched.slice(Math.max(0,idx-count), idx).reverse();
    };
    // this team's game immediately before this one — only counts if that
    // specific game has actually been played (an unplayed game simply has
    // no entry in runsMap, so this correctly comes back empty rather than
    // reaching past it to some earlier result).
    const prevGameRuns = (tid) => {
      const prev = prevScheduledGames(tid, 1)[0];
      const runs = prev ? runsMap[tid]?.[prev.time] : null;
      return runs!=null ? runs : null;
    };
    const bigday = [];
    const aRuns = prevGameRuns(g.awayId), hRuns = prevGameRuns(g.homeId);
    if (aRuns>=10) bigday.push({ teamId:g.awayId, team:g.awayName, runs:aRuns });
    if (hRuns>=10) bigday.push({ teamId:g.homeId, team:g.homeName, runs:hRuns });

    // did this team score 10+ runs in each of the two games immediately
    // before this one (same strict adjacency as above, not just "the last
    // two completed games found anywhere")?
    const bigDayStreak = (tid) => {
      const [prev1, prev2] = prevScheduledGames(tid, 2);
      if (!prev1 || !prev2) return false;
      const r1 = runsMap[tid]?.[prev1.time], r2 = runsMap[tid]?.[prev2.time];
      return r1>=10 && r2>=10;
    };

    // this team's last 3 games' quality-adjusted batting score (0-10),
    // left-to-right oldest to most recent — feeds the 3 batter boxes. Scans
    // by exact prior game start time (not date) so an off-day doesn't leave
    // a box blank and a doubleheader's earlier game still counts as the
    // later game's own "previous game" instead of being skipped entirely;
    // the actual value shown comes from battingScoreMap.
    const hitsTrio = (tid) => {
      const m = hitsMap[tid];
      if (!m) return [null, null, null];
      const scores = battingScoreMap[tid] || {};
      const priorTimes = Object.keys(m).filter(t => t < g.time).sort().reverse();
      const at = (i) => priorTimes[i]!=null ? (scores[priorTimes[i]] ?? null) : null;
      return [at(2), at(1), at(0)];
    };

    // per-team keys for the 2x2 situational-trend grid
    const sideKeys = { [g.awayId]:new Set(), [g.homeId]:new Set() };
    const add = (tid, key) => { if (sideKeys[tid]) sideKeys[tid].add(key); };
    (g.travelers||[]).forEach(x=>add(x.teamId, "travel"));
    echo.forEach(e=>add(e.teamId, "echo"));
    cb.forEach(c=>add(c.teamId, "late"));
    bigday.forEach(b=>add(b.teamId, "bigday"));
    gauntlet.forEach(x=>add(x.teamId, "gauntlet"));
    formerTeam.forEach(x=>add(x.teamId, "formerTeam"));

    const any = !!g.flagged || echo.length>0 || cb.length>0 || rematch.length>0 || bigday.length>0 || gauntlet.length>0 || formerTeam.length>0;
    return { travel:!!g.flagged, travelers:g.travelers||[], echo, cb, rematch, bigday, gauntlet, formerTeam, any,
      keysFor:(tid)=>sideKeys[tid] || new Set(),
      rematchTier:(tid)=>rematchTier[tid] || null,
      rematchVerdict:(tid)=>rematchVerdict[tid] || null,
      pitcherEra,
      bigDayStreak,
      hitsTrio };
  };

  return (
    <div>
      {err && <ErrBox>{err}</ErrBox>}

      {/* ── 7-day calendar; past columns aligned to today's matchups ── */}
      {days && (
        <div>
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
          <div style={{ opacity: showIndicators ? 1 : 0.4, transition:"opacity 0.15s",
            marginTop:12 }}><Legend /></div>
        </div>
      )}

      {modal && <GameModal m={modal} tags={tags} setTag={setTag} now={now} onClose={()=>setModal(null)} />}
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

/* box geometry — the situational-trend boxes are still real bordered boxes;
   the pitcher/batter numbers are plain text but keep this same slot width
   so everything still lines up under the PITCHER/BATTER headers. */
const BOX_W = 14, BOX_H = 13, BOX_GAP = 1.5, MID_GAP = 5;
const PB_BOX_W = 21, PB_GAP = 2;
const ERA_BOX_W = 26;   // wider than PB_BOX_W — "12.34" needs ~24px at this font, hits never do
const MAIN_H = 19;                         // a team's row height
const BASES_W = 26;                        // reserved for the live bases display — never shifts
const CARD_H = 58;

/* fixed situational-trend slots, rendered as a 1x5 row per team (away row on
   top, home row on bottom — matching the Game/Pitcher-Batter sections). add
   new trends here and every card + the legend adjust automatically. */
const TREND_SLOTS = [
  { key:"bigday", color:C.bigday, label:"Big Day",
    desc:"Scored 10+ runs in their last game" },
  { key:"late",   color:C.late,   label:"Late go-ahead",
    desc:"Team never led until the 8th inning or later yesterday" },
  { key:"gauntlet", color:C.gauntlet, label:"The Gauntlet",
    desc:"Just faced 2-3 straight starters with a sub-3.00 ERA" },
  { key:"formerTeam", color:C.boom, label:"Revenge game",
    desc:"Probable pitcher used to play for the team he's facing today" },
  { key:"echo",   color:C.echo,   label:"Streak echo",
    desc:"Team just snapped a 10+ game win or loss streak yesterday" },
  { key:"travel", color:C.travel, label:"B2B travel",
    desc:"West yesterday, East today on back-to-back days" },
];
// total rendered width of the trend-box strip — a fixed constant (the slot
// count never changes per-game), used to reserve matching blank space in
// the header row so the time/FINAL label's own right edge lines up with
// the trend boxes' right edge one row below.
const TRENDS_W = BOX_W*TREND_SLOTS.length + BOX_GAP*(TREND_SLOTS.length-1);

/* a monospace font gives "." the same full character-cell width as a digit,
   which visibly wastes room in these small fixed-width number boxes (badly
   enough that the boldest one was overflowing its box by a couple of
   pixels). Splits a decimal string like "9.1" or "12.34" so the dot's own
   cell can be narrowed — but the "." glyph itself isn't drawn centered
   within its own cell (most fonts give it a lopsided side-bearing so it
   hugs the preceding digit), so text-align:center on a narrowed box still
   came out closer to the left digit. Draws a plain circle instead, sized
   and placed by hand: an empty inline-block with no explicit vertical-align
   has no baseline of its own, so its bottom margin edge sits exactly on the
   surrounding text's baseline — `bottom:0.03em` then lifts it from there to
   0.1em above baseline, matching where a real period's ink actually sits
   (measured via canvas text metrics at this font/weight). */
function TightDecimal({ text }) {
  const i = text.indexOf(".");
  if (i === -1) return text;
  return <>{text.slice(0,i)}<span style={{ display:"inline-block", position:"relative",
    bottom:"0.03em", width:"0.14em", height:"0.14em", margin:"0 0.09em",
    borderRadius:"50%", background:"currentColor" }} />{text.slice(i+1)}</>;
}

/* the pitcher's season ERA (unrounded past the hundredth — no border around
   it, just a soft highlight fill). Soft green fill if they've faced this
   team already this season and had a clearly good outing (2+ stat margin),
   soft red if clearly bad, soft grey if they've faced them but it was too
   close to call either way — the text itself always stays its resting ink
   color, never tinted green or red. */
function EraNum({ era, verdict, dark }) {
  const has = era != null;
  const bg = verdict==="up" ? (dark?C.darkSoftOver:C.softOver)
    : verdict==="down" ? (dark?C.darkSoftUnder:C.softUnder)
    : verdict==="even" ? (dark?C.darkSoftEven:C.softEven) : "transparent";
  const color = has ? (dark?C.darkText:C.ink) : (dark?C.darkTextSoft:C.ruleDark);
  return (
    <span title="Season ERA" style={{ width:ERA_BOX_W, flexShrink:0, textAlign:"center",
      fontFamily:MONO, fontSize:8, fontWeight:700, color, whiteSpace:"nowrap",
      background:bg, borderRadius:3 }}>{has ? <TightDecimal text={era.toFixed(2)} /> : "–"}</span>
  );
}

/* one of the team's last 3 games' quality-adjusted batting score (0-10, 5.0
   = exactly the times-on-base + total-bases production the pitching staff
   they faced that day would be expected to allow), no border around it,
   just a soft highlight fill. The most recent game matches the score's
   font/size; the two before it match the game box's own hits column (small
   mono, muted gray). Soft green at 7.0+ ("hot" — meaningfully more
   production than expected), soft red at 3.0 or below ("cold" —
   meaningfully less) — the text itself always stays its resting color,
   never tinted. */
function BatScoreNum({ score, big=false, dark }) {
  const has = score != null;
  const bg = has && score>=7.0 ? (dark?C.darkSoftOver:C.softOver)
    : has && score<=3.0 ? (dark?C.darkSoftUnder:C.softUnder) : "transparent";
  const restColor = dark ? C.darkTextSoft : C.ruleDark;
  const color = has ? (big ? (dark?C.darkText:C.ink) : restColor) : restColor;
  // "10.0" (the one 4-char case, at the very top of the scale) doesn't fit
  // this box at this font size even with the dot tightened up — drop the
  // decimal just for that ceiling value rather than widen the box.
  const label = has ? (score.toFixed(1)==="10.0" ? "10" : score.toFixed(1)) : "–";
  return (
    <span title={big ? "Batting score, last game" : "Batting score"} style={{ width:PB_BOX_W, flexShrink:0,
      textAlign:"center", fontFamily:MONO, fontSize: big?13:10,
      fontWeight: big?700:400, color,
      background:bg, borderRadius:3 }}>{has ? <TightDecimal text={label} /> : "–"}</span>
  );
}

/* one situational-trend box: filled solid with its color when lit, dimmed
   neutral outline when not. `inner` draws a small marker on top (e.g. "!"
   for a team on a 10+ run back-to-back streak). */
function TrendBox({ present, color, title, inner, dark }) {
  return (
    <span title={title} style={{ position:"relative", width:BOX_W, height:BOX_H, borderRadius:2,
      flexShrink:0, background: present ? color : "transparent",
      boxShadow: present ? "none" : `inset 0 0 0 1.5px ${dark?C.darkOutline:C.inkSoft}`,
      opacity: present ? 1 : 0.45, display:"flex", alignItems:"center", justifyContent:"center" }}>
      {present && inner && <span style={{ fontFamily:MONO, fontSize:9, fontWeight:800,
        color:"#fff", lineHeight:1 }}>{inner}</span>}
    </span>
  );
}

function TeamLine({ abbr, score, hits, won, final, live, dark }) {
  const showScore = final || live;
  const ink = dark ? C.darkText : C.ink;
  const inkSoft = dark ? C.darkTextSoft : C.inkSoft;
  const ruleDark = dark ? C.darkTextSoft : C.ruleDark;
  return (
    <div style={{ display:"grid", gridTemplateColumns:"24px 16px 14px", alignItems:"center", gap:6 }}>
      <span style={{ fontFamily:MONO, fontSize:13,
        fontWeight: final ? (won?800:400) : 600,
        color: final ? (won?ink:inkSoft) : ink }}>{abbr}</span>
      <span style={{ fontFamily:MONO, fontSize:13, textAlign:"center",
        fontWeight: final && won ? 800 : 400,
        color: final ? (won?ink:inkSoft) : showScore ? ink : ruleDark }}>{showScore ? score : ""}</span>
      <span style={{ fontFamily:MONO, fontSize:10, textAlign:"center", color:ruleDark }}>
        {showScore && hits!=null ? hits : ""}</span>
    </div>
  );
}

/* series shading — two pairs, two waves:
   wave 0 (current/past series):  light gray  ↔  white
   wave 1 (today's-slate series): dark charcoal ↔ lighter slate grey (a
   real dark theme, not just a darker tint — text/outlines on these two
   switch to their light equivalents, see the `dark` prop threaded through
   below); kept clearly different in lightness so the two are easy to
   tell apart at a glance */
/* 0=light-gray (leftovers even), 1=white (leftovers odd),
   2=dark-charcoal (today-series even), 3=lighter-slate-grey (today-series odd) */
const SERIES_SHADE = ["#EDEFF2", "#FFFFFF", "#20232A", "#2F3239"];
const isDarkShade = (shade) => shade===2 || shade===3;

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
function LiveDiamond({ inningNum, inningState, outs, onFirst, onSecond, onThird, dark }) {
  if (inningNum == null) return null;
  const ink = dark ? C.darkText : C.ink;
  const arrow = inningState==="Bottom" || inningState==="End" ? "▼" : "▲";
  // diamonds as SVG polygons (not rotated CSS boxes) so all three bases are
  // drawn in one coordinate space — guarantees 2nd sits exactly centered
  // over 1st/3rd instead of relying on independently-positioned, separately
  // anti-aliased rotated elements to line up pixel-for-pixel.
  const diamond = (cx, cy, on) => {
    const r = 3.7;
    return <polygon points={`${cx},${cy-r} ${cx+r},${cy} ${cx},${cy+r} ${cx-r},${cy}`}
      fill={on ? ink : "none"} stroke={ink} strokeWidth="1.2" />;
  };
  return (
    <div style={{ flexShrink:0, width:BASES_W, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", gap:2 }}>
      <div style={{ fontFamily:MONO, fontSize:10, fontWeight:700, color:ink, whiteSpace:"nowrap" }}>
        {arrow}{inningNum}</div>
      <svg width="22" height="18" viewBox="0 0 22 18">
        {diamond(11, 4.5, onSecond)}
        {diamond(4.5, 12, onThird)}
        {diamond(17.5, 12, onFirst)}
      </svg>
      <div style={{ display:"flex", gap:1.5 }}>
        {[0,1,2].map(i=>(
          <span key={i} style={{ width:4, height:4, borderRadius:"50%",
            background: outs!=null && i<outs ? ink : "transparent",
            border:`1.1px solid ${ink}` }} />
        ))}
      </div>
    </div>
  );
}

/* this team's probable starter's ERA/rematch-verdict + last 3 games'
   quality-adjusted batting score, shown as the 4 pitcher/batter boxes. */
function pitcherBatterStats(t, tid) {
  const [h3, h2, h1] = t.hitsTrio(tid);
  return { era: t.pitcherEra(tid), verdict: t.rematchVerdict(tid), h3, h2, h1 };
}
/* last 3 games' batting score (oldest to most recent), then the pitcher's
   season ERA — no boxes, no header labels, just the numbers themselves. */
function PBBoxRow({ s, dark }) {
  return (
    <div style={{ display:"flex", alignItems:"baseline", gap:PB_GAP }}>
      <BatScoreNum score={s.h3} dark={dark} />
      <BatScoreNum score={s.h2} dark={dark} />
      <BatScoreNum score={s.h1} big dark={dark} />
      <span style={{ width:MID_GAP, flexShrink:0 }} />
      <EraNum era={s.era} verdict={s.verdict} dark={dark} />
    </div>
  );
}

/* column 1 — Game: the two team lines, with a fixed-width slot next to the
   score reserved for the live bases display so nothing shifts when a game
   goes live. */
function GameSection({ g, aw, hm, awWon, hmWon, final, live, dark }) {
  return (
    <div style={{ display:"grid", gridTemplateRows:`${MAIN_H}px ${MAIN_H}px` }}>
      <div style={{ gridRow:1, display:"flex", alignItems:"center" }}>
        <TeamLine abbr={aw} score={g.awayScore} hits={g.awayHits} won={awWon} final={final} live={live} dark={dark} />
      </div>
      <div style={{ gridRow:2, display:"flex", alignItems:"center" }}>
        <TeamLine abbr={hm} score={g.homeScore} hits={g.homeHits} won={hmWon} final={final} live={live} dark={dark} />
      </div>
    </div>
  );
}

/* "BAT"/"ERA" column labels, plus a blank slot reserved the exact width of
   the trend-box strip so the time/FINAL label (which fills that slot, see
   StatsHeaderRow) lines up with the trend boxes one row below. Uses the
   exact same gap as PBBoxRow so each label sits centered directly over its
   numbers, not just its own slot. */
function PBHeaderLabels({ dark }) {
  const label = (text, width) => (
    <div style={{ width, textAlign:"center", fontFamily:MONO, fontSize:7, fontWeight:700,
      letterSpacing:"0.05em", color: dark?C.darkTextSoft:C.inkSoft }}>{text}</div>
  );
  return (
    <div style={{ display:"flex", alignItems:"center", gap:PB_GAP }}>
      {label("BAT", PB_BOX_W*3+PB_GAP*2)}
      <span style={{ width:MID_GAP, flexShrink:0 }} />
      {label("ERA", ERA_BOX_W)}
    </div>
  );
}

/* the merged pitcher/batter + trend-indicator column, right-aligned as one
   unit. This column is the row's only "auto" (stretchy) track besides the
   game column — whatever leftover width the two of them split keeps
   growing on the *outside* of this unit (between the bases display and the
   BAT numbers) since the whole unit is anchored to the right, so the ERA
   box stays tight against the first trend box regardless of viewport, and
   the trend boxes stay flush against the card's actual right wall instead
   of trailing off with blank space after them (this matters most on
   mobile, where the card is narrowest relative to its fixed-width content
   and that leftover space is largest). Big Day gets a "!" marker when the
   team scored 10+ runs in each of its last two games, on top of the box
   simply being lit for the one-game version. */
function StatsRow({ tid, t, dark }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end" }}>
      <PBBoxRow s={pitcherBatterStats(t, tid)} dark={dark} />
      <span style={{ width:7, flexShrink:0 }} />
      <div style={{ display:"flex", alignItems:"center", gap:BOX_GAP }}>
        {TREND_SLOTS.map(slot=>{
          const present = t.keysFor(tid).has(slot.key);
          const inner = slot.key==="bigday" && t.bigDayStreak(tid) ? "!" : null;
          return <TrendBox key={slot.key} present={present} color={slot.color} inner={inner}
            title={present ? slot.label : undefined} dark={dark} />;
        })}
      </div>
    </div>
  );
}
function StatsAndTrends({ g, t, dark }) {
  return (
    <div style={{ display:"grid", gridTemplateRows:`${MAIN_H}px ${MAIN_H}px` }}>
      <StatsRow tid={g.awayId} t={t} dark={dark} />
      <StatsRow tid={g.homeId} t={t} dark={dark} />
    </div>
  );
}

/* header-row mirror of StatsRow: BAT/ERA labels, then a blank slot exactly
   TRENDS_W wide holding the time/FINAL/LIVE label right-aligned within it —
   same structure, same 7px gap, so this row's content lines up with the
   real numbers and trend boxes in the row below regardless of how wide
   this (also right-aligned, also "auto") column ends up being. */
function StatsHeaderRow({ dark, live, timeLabel }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end" }}>
      <PBHeaderLabels dark={dark} />
      <span style={{ width:7, flexShrink:0 }} />
      <div style={{ width:TRENDS_W, display:"flex", alignItems:"center", justifyContent:"flex-end",
        gap:3, fontFamily:MONO, fontSize:8, lineHeight:1.2,
        color: live ? "#E5142B" : (dark?C.darkTextSoft:C.ruleDark), fontWeight: live ? 700 : 400 }}>
        {live && <span style={{ width:6, height:6, borderRadius:"50%", background:"#E5142B",
          flexShrink:0 }} />}
        {timeLabel}
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
  const dark = isDarkShade(g.seriesShade);
  const bg = g.seriesShade!=null ? SERIES_SHADE[g.seriesShade] : "#fff";
  const tagInCorner = tag && showInd;        // indicators on → tag overlaps corner
  const tagInMarkers = tag && !showInd;      // indicators off → tag sits where markers were
  const bases = live && <LiveDiamond inningNum={g.inningNum} inningState={g.inningState} outs={g.outs}
    onFirst={g.onFirst} onSecond={g.onSecond} onThird={g.onThird} dark={dark} />;
  return (
    <div onClick={onOpen||undefined} className="ts-cell"
      role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e)=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();onOpen();} } : undefined}
      style={{ border:`1px solid ${dark?C.darkBorder:C.rule}`, borderRadius:2, boxSizing:"border-box",
      minHeight:CARD_H, padding:"4px 4px", background:bg, overflow:"visible", position:"relative",
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
      <div className="ts-card-grid" style={{ display:"grid",
        // the game column and the merged pitcher/batter+trends column are
        // both "auto" — CSS splits leftover row width EQUALLY between
        // tracks sharing that sizing function, and since the game column's
        // content is left-anchored while the merged column's content is
        // right-anchored (see StatsRow), that equal split lands as
        // matching growth on either side of the bases column, keeping it
        // centered — while every gap *inside* the merged column (ERA to
        // the trend boxes, trend boxes to the card's own right wall) stays
        // exactly fixed regardless of viewport, because that column's own
        // content doesn't shift internally, only its total width does.
        gridTemplateColumns: showInd ? `auto ${BASES_W}px auto` : `max-content ${BASES_W}px`,
        gridTemplateRows:"auto auto", columnGap:7, rowGap:2 }}>
        <div style={{ gridColumn:1, gridRow:1 }} />
        {/* the live bases display gets its own column spanning both rows —
            from the FINAL/time row all the way down — instead of being
            squeezed into just the two team rows below it. */}
        <div style={{ gridColumn:2, gridRow:"1 / span 2", display:"flex",
          alignItems:"center", justifyContent:"center" }}>{bases}</div>
        {showInd ? (
          <div style={{ gridColumn:3, gridRow:1 }}>
            <StatsHeaderRow dark={dark} live={live} timeLabel={final ? "FINAL" : live ? "LIVE" : time} />
          </div>
        ) : (
          <div style={{ gridColumn:1, gridRow:1, fontFamily:MONO, fontSize:8, lineHeight:1.2,
            display:"flex", alignItems:"center", justifyContent:"flex-end", gap:3,
            color: live ? "#E5142B" : (dark?C.darkTextSoft:C.ruleDark), fontWeight: live ? 700 : 400 }}>
            {live && <span style={{ width:6, height:6, borderRadius:"50%", background:"#E5142B",
              flexShrink:0 }} />}
            {final ? "FINAL" : live ? "LIVE" : time}
          </div>
        )}
        <div style={{ gridColumn:1, gridRow:2 }}>
          <GameSection g={g} aw={aw} hm={hm} awWon={awWon} hmWon={hmWon} final={final} live={live} dark={dark} />
        </div>
        {showInd && <div style={{ gridColumn:3, gridRow:2 }}><StatsAndTrends g={g} t={t} dark={dark} /></div>}
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
// laid out as a fixed equal-width column grid (not flowing text) so every
// stat sits in the same horizontal position on every row — a double-digit
// value never shifts the columns after it — and stretches to fill the row.
// 3 optional extra columns ("extra") hold the pitcher-vs-lineup quality
// score for this exact start, the opposing team's own batting score, and
// its raw hit count from the game right before this one — see PitcherBlock.
// every stat column (base 5, plus the 3 extra ones when present) gets an
// equal share of the row's width — only Date/Opp (sized by their callers)
// get special treatment; the stats themselves are all the same width.
const PLINE_COLS = "repeat(5, minmax(0,1fr))";
const PLINE_EXTRA_COLS = "repeat(3, minmax(0,1fr))";
// alternating column backgrounds (not row stripes) — each stat keeps the
// same faint tint in every row of the log, so your eye can track a single
// column (say, just K) straight down the list instead of losing it between
// rows. Continues from the header so the banding reads as one continuous
// column, not something that starts partway down.
const PLINE_COL_BG = [C.card, "transparent", C.card, "transparent", C.card, "transparent", C.card, "transparent"];
// Date and Opp (outside PLine's own grid, in PitcherSeasonModal) share this
// one flat tint — a distinct group from the alternating stat columns, not
// another entry in that alternation.
const PLINE_META_BG = "#EEF0F3";
// column labels for a PLine row, meant to be rendered ONCE above a list of
// PLine rows (values alone are ambiguous without a header in view).
function PLineHeader({ extra, leftBorder }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns: extra ? `${PLINE_COLS} ${PLINE_EXTRA_COLS}` : PLINE_COLS,
      width:"100%", fontFamily:MONO, fontSize:9, letterSpacing:"0.06em",
      textTransform:"uppercase", color:C.ruleDark, textAlign:"center" }}>
      {["IP","H","ER","BB","K"].map((l,i)=>(
        <span key={l} style={{ paddingTop:4, paddingBottom:4,
          background: PLINE_COL_BG[i], borderLeft: (i>0 || leftBorder) ? `1px solid ${C.rule}` : "none",
          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{l}</span>
      ))}
      {extra && [["PIT","Pitcher score vs this start's lineup"],
                  ["OPP","Opponent's own batting score in their game right before this start"],
                  ["HIT","Opponent's hits in their game right before this start"]].map(([l,tip],j)=>(
        <span key={l} title={tip} style={{ paddingTop:4, paddingBottom:4,
          background: PLINE_COL_BG[5+j], borderLeft:`1px solid ${C.rule}`,
          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{l}</span>
      ))}
    </div>
  );
}
function PLine({ s, season, extra, maxSize = 13, minSize = 7.5, leftBorder }) {
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
    // a ResizeObserver on the element itself (not window resize) avoids a
    // mobile-rotation race where the resize event can fire before the new
    // viewport width has actually settled, leaving the text stuck oversized
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [s, season, extra, maxSize, minSize]);
  const st = s.stat || {};
  // a start with no innings pitched yet (the synthetic "upcoming game" row —
  // see PitcherSeasonModal) has nothing real to color; show flat dashes
  // instead of running it through pitcherLineColors (which would read its
  // all-zero/undefined fields as real, unusually good numbers).
  const played = st.inningsPitched != null;
  const { ipCol, hCol, erCol, bbCol, kCol } = played
    ? pitcherLineColors(st, season)
    : { ipCol:C.ruleDark, hCol:C.ruleDark, erCol:C.ruleDark, bbCol:C.ruleDark, kCol:C.ruleDark };
  const v = (x) => x==null ? "–" : x;

  // bg left undefined means "use this column's own alternating tint"
  // (PLINE_COL_BG) — only the "similar situation" highlight below overrides
  // it with something else.
  const cells = [
    [played ? v(st.inningsPitched) : "–", ipCol],
    [played ? v(st.hits)           : "–", hCol],
    [played ? v(st.earnedRuns)     : "–", erCol],
    [played ? v(st.baseOnBalls)    : "–", bbCol],
    [played ? v(st.strikeOuts)     : "–", kCol],
  ];
  if (extra) {
    // "…" while that piece is still loading, "–" once loading finished but
    // found nothing (e.g. no prior game on record) — same convention used
    // everywhere else in the app. Whole-number scores (including the 0/10
    // clamp bounds) drop the trailing ".0" — "10" reads cleaner than "10.0".
    const fmtScore = (v) => { const r = Math.round(v*10)/10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };
    const num = (v) => v===undefined ? "…" : v==null ? "–" : fmtScore(v);
    const hits = extra.priorHits===undefined ? "…" : extra.priorHits==null ? "–" : String(extra.priorHits);
    const pColor = extra.pitcherScore==null ? (C.inkSoft)
      : extra.pitcherScore>=7 ? C.over : extra.pitcherScore<=3 ? C.under : C.ink;
    // "similar situation" softly highlights the opponent-score and
    // opponent-hits cells independently — either can light up on its own,
    // it doesn't take both matching the game being previewed. Never touches
    // the pitcher score cell or IP/H/ER/BB/K. See PitcherSeasonModal.
    cells.push([num(extra.pitcherScore), pColor]);
    cells.push([num(extra.priorScore), C.ink, extra.highlightScore ? C.softEven : undefined]);
    cells.push([hits, C.ink, extra.highlightHits ? C.softEven : undefined]);
  }
  return (
    <div ref={ref} style={{ display:"grid",
      gridTemplateColumns: extra ? `${PLINE_COLS} ${PLINE_EXTRA_COLS}` : PLINE_COLS,
      width:"100%", fontSize, textAlign:"center" }}>
      {cells.map(([txt,c,bg],i)=>{
        const background = bg ?? PLINE_COL_BG[i];
        return (
        <span key={i} style={{ display:"block", color:c, whiteSpace:"nowrap", overflow:"hidden",
          background, borderLeft: (i>0 || leftBorder) ? `1px solid ${C.rule}` : "none",
          paddingTop:5, paddingBottom:5, marginTop:-5, marginBottom:-5 }}>{txt}</span>
        );
      })}
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

function PitcherSeasonModal({ pid, name, onClose, upcoming }) {
  const [log, setLog] = useState(undefined);
  useEffect(() => {
    let alive = true;
    loadPitcherSeason(pid).then(r=>{ if(alive) setLog(r); });
    return () => { alive = false; };
  }, [pid]);

  // the game this pitcher is actually lined up for (from PitcherBlock, which
  // only exists for a not-yet-played game) tacked onto the front of the log
  // as a placeholder row — no line to show yet, but its "opponent's last
  // game" context can still be pulled just like any other start. Skipped if
  // the real gameLog already has an entry for that date (e.g. it's since
  // been played and posted).
  const displayLog = useMemo(() => {
    if (!log) return log;
    if (!upcoming?.teamId || !upcoming?.date) return log;
    if (log.some(s => s.date === upcoming.date)) return log;
    const placeholder = { date: upcoming.date, opponent: { id: upcoming.teamId }, stat: {}, isUpcoming: true };
    return [placeholder, ...log].sort((a,b) => b.date.localeCompare(a.date));
  }, [log, upcoming]);

  // per-opponent-team season hitting rates (the baseline each start's pitcher
  // score below is judged against) and, per start, how that opponent was
  // hitting in the game right before this one — same "hot or cold bats"
  // context PitcherBlock shows for a single opponent, generalized here across
  // every team this pitcher has faced all season (plus the upcoming game,
  // if any — see displayLog above).
  const [oppRatesMap, setOppRatesMap] = useState({});
  const [priorCtxMap, setPriorCtxMap] = useState({});
  useEffect(() => {
    if (!displayLog || !displayLog.length) return;
    let alive = true;
    const oppIds = Array.from(new Set(displayLog.map(s=>s.opponent?.id).filter(id=>id!=null)));
    mapPool(oppIds, 3, async (id) => [id, await loadTeamSeasonHitting(id)]).then(results => {
      if (!alive) return;
      const map = {};
      results.forEach(([id, rates]) => { map[id] = rates; });
      setOppRatesMap(map);
    });
    mapPool(displayLog, 3, async (s) => [s.date, s.opponent?.id!=null ? await loadPriorGameContext(s.opponent.id, s.date) : null])
      .then(results => {
        if (!alive) return;
        const map = {};
        results.forEach(([date, ctx]) => { map[date] = ctx || { score:null, hits:null }; });
        setPriorCtxMap(map);
      });
    return () => { alive = false; };
  }, [displayLog]);

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

  // count starts per opponent (including the upcoming one) so a repeat
  // matchup can be flagged in the log
  const oppCounts = useMemo(() => {
    const m = {};
    (displayLog||[]).forEach(s=>{ const id = s.opponent?.id; if (id!=null) m[id] = (m[id]||0)+1; });
    return m;
  }, [displayLog]);

  // the situation this pitcher is actually walking into today: the upcoming
  // opponent's own batting score + hits in their game right before this one.
  // Any past start whose own opponent-score lands within ±1 of that gets its
  // score cell highlighted; independently, any start whose own opponent-hits
  // lands within ±1 gets its hits cell highlighted — one can light up
  // without the other, they're graded separately, not as a pair.
  const refCtx = upcoming?.date ? priorCtxMap[upcoming.date] : null;
  const scoreSimilar = (ctx) => refCtx?.score!=null && ctx?.score!=null && Math.abs(ctx.score-refCtx.score)<=1;
  const hitsSimilar = (ctx) => refCtx?.hits!=null && ctx?.hits!=null && Math.abs(ctx.hits-refCtx.hits)<=1;

  return (
    <div onClick={e=>{ e.stopPropagation(); onClose(); }} style={{ position:"fixed", inset:0, zIndex:60,
      background:"rgba(20,24,31,0.55)", display:"flex", alignItems:"flex-start",
      justifyContent:"center", padding:"max(12px, env(safe-area-inset-top)) 12px 12px", overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.paper,
        border:`1px solid ${C.ink}`, borderRadius:6, maxWidth:680, width:"100%",
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
            padding:"4px 12px", alignItems:"baseline" }}>
            <span style={{ fontFamily:MONO, fontSize:9, letterSpacing:"0.06em",
              textTransform:"uppercase", color:C.ruleDark, background:PLINE_META_BG,
              paddingTop:4, paddingBottom:4 }}>Date</span>
            <span style={{ fontFamily:MONO, fontSize:9, letterSpacing:"0.06em",
              textTransform:"uppercase", color:C.ruleDark, background:PLINE_META_BG,
              borderLeft:`1px solid ${C.rule}`, paddingLeft:6, paddingTop:4, paddingBottom:4 }}>Opp</span>
            <PLineHeader extra leftBorder />
          </div>
          {log===undefined && <div style={{ padding:"10px 16px", fontFamily:MONO, fontSize:12, color:C.inkSoft }}>Loading…</div>}
          {log && log.length===0 && !displayLog?.length && <div style={{ padding:"10px 16px", fontFamily:SANS, fontSize:13, color:C.inkSoft }}>No {SEASON} starts found.</div>}
          {displayLog && displayLog.map((s,i)=>{
            const repeatOpp = s.opponent?.id!=null && oppCounts[s.opponent.id] > 1;
            const oppId = s.opponent?.id;
            const oppRates = oppId!=null ? oppRatesMap[oppId] : null;
            const pitcherScore = s.isUpcoming ? null
              : oppRates===undefined ? undefined : pitcherScoreForStart(s.stat, oppRates);
            const ctx = priorCtxMap[s.date];
            const highlightScore = !s.isUpcoming && scoreSimilar(ctx);
            const highlightHits = !s.isUpcoming && hitsSimilar(ctx);
            const metaBg = s.isUpcoming ? "rgba(22,162,223,0.14)" : PLINE_META_BG;
            return (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"38px 32px minmax(0,1fr)",
              padding:"5px 12px", borderTop:`1px solid #EEF0F2`, alignItems:"baseline" }}>
              <span title={s.isUpcoming ? "Upcoming — not played yet" : undefined} style={{ fontFamily:MONO, fontSize:11,
                color: s.isUpcoming ? C.rematch : C.inkSoft, fontWeight: s.isUpcoming ? 700 : 400,
                background: metaBg, paddingTop:5, paddingBottom:5, marginTop:-5, marginBottom:-5 }}>{calDay(s.date).md}</span>
              <span style={{ fontFamily:MONO, fontSize:11,
                background: metaBg, borderLeft:`1px solid ${C.rule}`, paddingLeft:6,
                paddingTop:5, paddingBottom:5, marginTop:-5, marginBottom:-5 }}>
                <span style={{ display:"inline-block", width:"fit-content",
                  color: repeatOpp ? C.rematch : C.inkSoft,
                  fontWeight: repeatOpp ? 800 : 400,
                  background: repeatOpp ? "rgba(22,162,223,0.20)" : "transparent",
                  border: repeatOpp ? `1px solid ${C.rematch}` : "1px solid transparent",
                  borderRadius: repeatOpp ? 3 : 0, padding: repeatOpp ? "1px 4px" : 0 }}>{
                  TEAM_ABBR[s.opponent?.id] || s.opponent?.abbreviation
                  || s.opponent?.name?.split(" ").slice(-1)[0] || "—"}</span>
              </span>
              <span style={{ fontFamily:MONO, minWidth:0 }}><PLine s={s} season={seasonAvg} maxSize={12.5} leftBorder extra={{
                pitcherScore, priorScore: ctx?.score, priorHits: ctx?.hits, highlightScore, highlightHits }} /></span>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function PitcherBlock({ name, pid, vsName, info, oppTeamId, date, bare }) {
  const [showLog, setShowLog] = useState(false);
  // the opposing lineup's own season hitting rates — the baseline each row's
  // pitcher score below is judged against — plus, per start, how that
  // lineup was hitting (their own quality-adjusted score and raw hits) in
  // the game right before this one, for "hot or cold bats" context.
  const [oppRates, setOppRates] = useState(undefined);
  const [priorCtx, setPriorCtx] = useState({});   // start date -> {score, hits}
  useEffect(() => {
    if (!oppTeamId || !info?.vs?.length) return;
    let alive = true;
    loadTeamSeasonHitting(oppTeamId).then(r => { if (alive) setOppRates(r); });
    (async () => {
      const results = await mapPool(info.vs, 3, async (s) => [s.date, await loadPriorGameContext(oppTeamId, s.date)]);
      if (!alive) return;
      const map = {};
      results.forEach(([date, ctx]) => { map[date] = ctx || { score:null, hits:null }; });
      setPriorCtx(map);
    })();
    return () => { alive = false; };
  }, [oppTeamId, info]);
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
              <div style={{ display:"flex", gap:10, alignItems:"baseline" }}>
                <span style={{ minWidth:34, flexShrink:0 }} />
                <span style={{ flex:"1 1 auto", minWidth:0 }}><PLineHeader extra /></span>
              </div>
              {info.vs.map((s,i)=>{
                const pitcherScore = oppRates===undefined ? undefined : pitcherScoreForStart(s.stat, oppRates);
                const ctx = priorCtx[s.date];
                return (
                <div key={i} style={{ display:"flex", justifyContent:"space-between",
                  gap:10, alignItems:"baseline", borderBottom:`1px solid #EEF0F2`, paddingBottom:4 }}>
                  <span style={{ fontFamily:MONO, fontSize:11, color:C.inkSoft, minWidth:34, flexShrink:0 }}>{calDay(s.date).md}</span>
                  <span style={{ fontFamily:MONO, flex:"1 1 auto", minWidth:0 }}>
                    <PLine s={s} season={info.season} maxSize={13} extra={{
                      pitcherScore, priorScore: ctx?.score, priorHits: ctx?.hits }} /></span>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {showLog && <PitcherSeasonModal pid={pid} name={name} onClose={()=>setShowLog(false)}
        upcoming={oppTeamId && date ? { teamId:oppTeamId, date } : null} />}
    </div>
  );
}

// one pitcher's line in the game's box score — name opens the same season
// game-log modal as everywhere else.
function PitcherStatLine({ p }) {
  const [showLog, setShowLog] = useState(false);
  // same season-average context the season game-log modal colors its rows
  // against, so this game's line and that modal agree on what's good/bad.
  const [season, setSeason] = useState(null);
  useEffect(() => {
    let alive = true;
    loadPitcherSeason(p.pid).then(log => { if (alive) setSeason(pitcherSeasonAverages(log)); });
    return () => { alive = false; };
  }, [p.pid]);
  return (
    <div>
      <button onClick={()=>setShowLog(true)} title={`${p.name} — ${SEASON} game log`}
        style={{ font:"inherit", fontFamily:SANS, fontSize:13, fontWeight:700, color:C.blue,
          cursor:"pointer", border:"none", background:"transparent", padding:0,
          textDecoration:"underline", textDecorationColor:C.blue, textUnderlineOffset:2,
          display:"block", maxWidth:"100%", textAlign:"left", whiteSpace:"nowrap",
          overflow:"hidden", textOverflow:"ellipsis" }}>{p.name}</button>
      <div style={{ marginTop:2 }}>
        <PLine s={{ stat:p.stat }} season={season} maxSize={13} />
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
    // live/finished games can list the same player twice (mid-game
    // substitution bookkeeping) — keep only each player's first appearance
    // so the lineup never shows duplicate rows.
    const seen = new Set();
    const unique = lp.filter(p => seen.has(p.id) ? false : (seen.add(p.id), true));
    return { source:"confirmed",
      players: unique.slice(0,9).map((p,i)=>({ id:p.id, name:p.fullName, order:i+1 })) };
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
    // Number(...) on both sides — the opponent id can come back as a string
    // in some API responses, which would silently fail a strict === match
    // and make a real rematch look like it never happened
    return { vs: prior.filter(s=>Number(s.opponent?.id)===Number(oppId)), season: pitcherSeasonAverages(prior) };
  } catch { return null; }
}

// a team's season-long hitting output, converted to a "per team-game" rate
// — used the same way a pitcher's own season H9/BB9/HR9 rates judge a
// batting performance, just flipped to judge a PITCHER's start against the
// lineup he faced instead of a team's game against the pitcher it faced.
async function loadTeamSeasonHitting(teamId) {
  if (!teamId) return null;
  try {
    const r = await fetch(`${API}/teams/${teamId}/stats?stats=season&group=hitting&season=${SEASON}`);
    if (!r.ok) return null;
    const j = await r.json();
    const stat = j.stats?.[0]?.splits?.[0]?.stat;
    const gp = Number(stat?.gamesPlayed)||0;
    if (!stat || !gp) return null;
    return {
      h9: Number(stat.hits||0)/gp,
      bb9: Number(stat.baseOnBalls||0)/gp,
      hr9: Number(stat.homeRuns||0)/gp,
      doubles9: Number(stat.doubles||0)/gp,
      triples9: Number(stat.triples||0)/gp,
    };
  } catch { return null; }
}
// a pitcher's own season per-9 rates — same fetch the calendar's batting
// score already does per box score to judge a hitting performance against
// that specific pitcher's real quality, not just a flat league-average
// stand-in. Cached at module scope (a pitcher's season line doesn't change
// mid-session) since loadPriorGameContext calls this once per pitcher who
// appeared in every prior game across a whole season log.
const pitcherSeasonRateCache = {};   // pid -> { h9, bb9, hr9, doubles9, triples9 } | null
async function loadPitcherSeasonRates(pid) {
  if (!pid) return null;
  if (pid in pitcherSeasonRateCache) return pitcherSeasonRateCache[pid];
  try {
    const r = await fetch(`${API}/people/${pid}/stats?stats=season&group=pitching&season=${SEASON}`);
    if (!r.ok) return (pitcherSeasonRateCache[pid] = null);
    const j = await r.json();
    const stat = j.stats?.[0]?.splits?.[0]?.stat;
    const outs = ipToOuts(stat?.inningsPitched);
    if (!stat || !outs) return (pitcherSeasonRateCache[pid] = null);   // e.g. a rookie with no innings logged yet
    return (pitcherSeasonRateCache[pid] = {
      h9: Number(stat.hits||0)*27/outs,
      bb9: Number(stat.baseOnBalls||0)*27/outs,
      hr9: Number(stat.homeRuns||0)*27/outs,
      doubles9: Number(stat.doubles||0)*27/outs,
      triples9: Number(stat.triples||0)*27/outs,
    });
  } catch { return null; }
}
// how a single start graded against the lineup a pitcher actually faced —
// the mirror image of the batting score: 5.0 is exactly what that lineup's
// own season rates predict a league-average pitcher allows them; higher is
// a pitcher who allowed LESS than that (invert:true — see qualityScore).
function pitcherScoreForStart(stat, oppRates) {
  const trueIP = ipToOuts(stat?.inningsPitched)/3;
  if (!trueIP) return null;
  return qualityScore(combinedProduction(stat),
    combinedProduction9(oppRates || LEAGUE_AVG_RATES)/9*trueIP, true);
}
// this team's most recent completed game before `beforeDate` — its own
// quality-adjusted batting score (a plain league-average baseline here,
// since digging up THAT game's own opposing pitchers' season rates would
// mean yet another round of fetches) and raw hits, giving "how hot or cold
// were the bats coming into this start" context next to a pitcher's game log.
async function loadPriorGameContext(teamId, beforeDate) {
  try {
    // 25 days back — comfortably covers the ~4-day All-Star break and any
    // rare rainout pileup, so a real prior game isn't missed just because
    // the search window was too tight
    const back = addDays(beforeDate, -25);
    const sr = await fetch(`${API}/schedule?sportId=1&teamId=${teamId}&startDate=${back}` +
      `&endDate=${addDays(beforeDate,-1)}&gameType=R&hydrate=linescore`);
    if (!sr.ok) return null;
    const sj = await sr.json();
    const prev = (sj.dates||[]).flatMap(d=>d.games||[])
      .filter(g=>g.status?.abstractGameState==="Final")
      .sort((a,b)=>a.gameDate.localeCompare(b.gameDate));
    const last = prev[prev.length-1];
    if (!last) return null;
    // Number(...) on both sides — teamId can come in as a string when this
    // is called with a gameLog entry's opponent.id (PitcherSeasonModal's
    // historical rows), which would otherwise silently fail this match and
    // read the wrong side's hits/pitchers on every single one of them
    const side = Number(last.teams.home.team.id)===Number(teamId) ? "home" : "away";
    const hits = Number(last.linescore?.teams?.[side]?.hits);
    const bx = await loadBoxscorePitchers(last.gamePk);
    const pitchers = bx?.[side==="home"?"away":"home"];
    let score = null;
    if (pitchers && pitchers.length) {
      // each pitcher's own season rates, same baseline the calendar's own
      // batting score judges against — not just a flat league-average
      // stand-in, so this number means the same thing in both places
      const rates = await Promise.all(pitchers.map(p=>loadPitcherSeasonRates(p.pid)));
      let actual = 0, expected = 0;
      pitchers.forEach((p,i)=>{
        const trueIP = ipToOuts(p.stat?.inningsPitched)/3;
        if (!trueIP) return;
        actual += combinedProduction(p.stat);
        expected += combinedProduction9(rates[i] || LEAGUE_AVG_RATES)/9*trueIP;
      });
      score = qualityScore(actual, expected);
    }
    return { hits: isNaN(hits)?null:hits, score };
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
    // the box score's own pitchers list can repeat an id (e.g. a pitcher
    // tracked across multiple mid-inning defensive shuffles) — dedupe so
    // each pitcher gets exactly one line.
    const side = (teamObj) => {
      const seen = new Set();
      return (teamObj?.pitchers || []).filter(pid => seen.has(pid) ? false : (seen.add(pid), true)).map(pid => {
        const p = teamObj.players?.[`ID${pid}`];
        const stat = p?.stats?.pitching;
        if (!p || !stat || stat.inningsPitched == null) return null;
        return { pid, name: p.person?.fullName, stat };
      }).filter(Boolean);
    };
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
function TeamPanel({ teamName, lineup, oppName, pitcherName, pitcherId, pitcherInfo, onStat, oppPitcherName, oppPitcherId, oppTeamId, date, showBoxPitching, boxPitchers }) {
  const canVs = !!oppPitcherId && !!oppPitcherName;
  // null = neither tab open, nothing shown yet — tapping a tab opens it,
  // tapping the already-open tab closes it again (accordion, not a toggle
  // between two always-visible views). Only the batting lineup collapses
  // like this; the starting-pitcher/box-score pitching block below is
  // always shown regardless of `view`.
  const [view, setView] = useState(null);         // null | "last5" | "vssp"
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
    <button onClick={()=>enabled&&setView(v=>v===id?null:id)} disabled={!enabled}
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
        {/* nothing renders here until a tab is tapped open */}
        {view && (view==="last5" ? (
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
        ))}

        {view && !lineup && <div style={{ padding:"10px 12px", fontFamily:MONO, fontSize:12, color:C.inkSoft }}>Loading lineup…</div>}
        {view && lineup && lineup.players.length===0 &&
          <div style={{ padding:"8px 12px", fontFamily:SANS, fontSize:12, color:C.inkSoft }}>—</div>}

        {view && lineup && lineup.players.map(p=>{
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
                <PLineHeader />
                {boxPitchers.map(p => <PitcherStatLine key={p.pid} p={p} />)}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontFamily:MONO, fontSize:9, letterSpacing:"0.12em", textTransform:"uppercase",
              color:C.ruleDark, marginBottom:4 }}>Starting pitcher</div>
            <PitcherBlock name={pitcherName} pid={pitcherId} vsName={oppName} info={pitcherInfo} oppTeamId={oppTeamId} date={date} bare />
            {/* the probable "starter" is sometimes just a 1-2 inning opener —
                let the viewer look up the actual bulk pitcher alongside them */}
            <AddPitcherBlock oppName={oppName} oppTeamId={oppTeamId} date={date} />
          </>
        )}
      </div>
    </div>
  );
}

/* lets the viewer manually add a second pitcher's info next to the
   probable starter — for when the listed "starter" is really just an
   opener going 1-2 innings and the actual bulk pitcher is someone else. */
function AddPitcherBlock({ oppName, oppTeamId, date }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [added, setAdded] = useState(null);      // { id, name }
  const [info, setInfo] = useState(undefined);   // same shape as pitcherInfo

  useEffect(() => {
    if (!added) return;
    let alive = true;
    loadPitcherVs(added.id, oppTeamId, date).then(r => { if (alive) setInfo(r); });
    return () => { alive = false; };
  }, [added, oppTeamId, date]);

  const resolve = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/sports/1/players?season=${SEASON}`);
      if (!r.ok) throw new Error(`roster ${r.status}`);
      const j = await r.json();
      const people = j.people || [];
      const ql = q.toLowerCase();
      const hit = people.find(p => (p.fullName||"").toLowerCase().includes(ql));
      if (!hit) throw new Error(`No ${SEASON} MLB player matched "${q}".`);
      setAdded({ id: hit.id, name: hit.fullName });
      setOpen(false); setQuery("");
    } catch (e) {
      setErr(isNet(e.message) ? "Couldn't reach the MLB data service." : e.message);
    } finally { setBusy(false); }
  };

  if (added) {
    return (
      <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.rule}`, position:"relative" }}>
        <button onClick={()=>{ setAdded(null); setInfo(undefined); }} title="Remove this pitcher"
          aria-label="Remove this pitcher"
          style={{ position:"absolute", top:8, right:0, border:"none", background:"transparent",
            color:C.inkSoft, cursor:"pointer", fontFamily:MONO, fontSize:13, padding:4, lineHeight:1 }}>✕</button>
        <PitcherBlock name={added.name} pid={added.id} vsName={oppName} info={info} oppTeamId={oppTeamId} date={date} bare />
      </div>
    );
  }

  if (open) {
    return (
      <div style={{ marginTop:8 }}>
        <div style={{ display:"flex", gap:6 }}>
          <input autoFocus value={query} onChange={e=>setQuery(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter") resolve(); if(e.key==="Escape") setOpen(false); }}
            placeholder="Bulk pitcher's name" style={{ ...inputStyle, flex:1, fontSize:13 }} />
          <button onClick={resolve} disabled={busy} style={{ border:`1px solid ${C.ink}`,
            background:busy?C.rule:C.ink, color:"#fff", borderRadius:2, fontFamily:MONO, fontSize:11,
            padding:"6px 12px", cursor:busy?"default":"pointer" }}>{busy?"…":"Add"}</button>
          <button onClick={()=>{ setOpen(false); setErr(""); }} style={{ border:`1px solid ${C.rule}`,
            background:"#fff", color:C.ink, borderRadius:2, fontFamily:MONO, fontSize:11,
            padding:"6px 10px", cursor:"pointer" }}>Cancel</button>
        </div>
        {err && <div style={{ marginTop:6, fontFamily:SANS, fontSize:12, color:C.under }}>{err}</div>}
      </div>
    );
  }

  return (
    <button onClick={()=>setOpen(true)} style={{ marginTop:8, border:`1px dashed ${C.rule}`,
      background:"transparent", color:C.inkSoft, borderRadius:3, fontFamily:MONO, fontSize:11,
      padding:"5px 10px", cursor:"pointer" }}>+ Add a pitcher to check</button>
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
    // same rotation-race fix as PLine — observe the element, not the window
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, maxSize, minSize]);
  return <div ref={ref} style={{ whiteSpace:"nowrap", overflow:"hidden", fontSize, ...style }}>{text}</div>;
}

function GameModal({ m, tags, setTag, now, onClose }) {
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
  // live/finished games show the game's actual box score (line score by
  // inning, and the actual pitching line) instead of pre-game previews. MLB's
  // API sometimes flips a game to "Live" a little ahead of its listed start
  // time (and even then, the box score can list the probable starter with an
  // all-zero line the instant they take the mound) — hold off on treating the
  // game as live until that start time has actually passed, same as the
  // calendar card's own LIVE badge/bases-display gating.
  const final = g.isFinal && g.awayScore!=null && g.homeScore!=null;
  const live = g.isLive && !final && now.getTime() >= new Date(g.time).getTime();
  const showBoxPitching = final || live;
  const showLineScore = showBoxPitching;
  const [ls,     setLs]     = useState(showLineScore ? undefined : null);  // line score (live/finished only)
  const [boxPitching, setBoxPitching] = useState(showBoxPitching ? undefined : null);
  const [tagEditing, setTagEditing] = useState(false);
  const [copied, setCopied] = useState(null);   // ok|dl|err feedback for Export
  const tagVal = tagText(tags?.[g.gamePk]);

  // export a clean PNG of this game's calendar card, styled like today's
  // slate's dark charcoal card (light text) regardless of which day it's
  // actually from, with the tagged play as green monospace "code" on the right
  const exportCard = () => {
    try {
      const scale = 3, W = 300, H = 96;                // logical size, upscaled for crispness
      const cv = document.createElement("canvas");
      cv.width = W*scale; cv.height = H*scale;
      const x = cv.getContext("2d"); x.scale(scale, scale);
      const resultTint = tagResultBg(tags?.[g.gamePk]);
      const final = g.isFinal && g.awayScore!=null && g.homeScore!=null;
      const aw = TEAM_ABBR[g.awayId]||"?", hm = TEAM_ABBR[g.homeId]||"?";
      const time = new Date(g.time).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
      // paper margin — matches the app's own light page background
      x.fillStyle = "#E2E5EA"; x.fillRect(0,0,W,H);
      const pad = 10, cx = pad, cy = pad, cw = W-pad*2, ch = H-pad*2;
      const rr = 4;
      roundedRectPath(x, cx, cy, cw, ch, rr);
      // card — dark charcoal like today's slate, with an optional soft
      // win/loss tint layered on top
      x.fillStyle = "#20232A"; x.fill();
      if (resultTint) { x.fillStyle = resultTint; x.fill(); }
      x.strokeStyle = "#3A4250"; x.lineWidth = 1; x.stroke();
      // time / FINAL, top-right
      x.fillStyle = "#AEB7C4"; x.font = "9px ui-monospace, Menlo, monospace";
      x.textAlign = "right"; x.fillText(final?"FINAL":time, cx+cw-8, cy+14);
      // teams + scores
      x.textAlign = "left"; x.fillStyle = "#F2F4F7";
      x.font = "700 15px system-ui, sans-serif";
      x.fillText(aw, cx+12, cy+34);
      x.fillText(hm, cx+12, cy+56);
      if (final) {
        x.textAlign = "right"; x.font = "700 15px ui-monospace, Menlo, monospace";
        x.fillStyle = g.awayScore>g.homeScore ? "#F2F4F7" : "#AEB7C4";
        x.fillText(String(g.awayScore), cx+cw-14, cy+34);
        x.fillStyle = g.homeScore>g.awayScore ? "#F2F4F7" : "#AEB7C4";
        x.fillText(String(g.homeScore), cx+cw-14, cy+56);
      }
      // logo icon in the gap between the team names and the play — same
      // spot on every card, whether or not this one has a tagged play
      drawLogoIcon(x, cx + cw*0.27, cy + ch/2, 26);
      // the play: grade indicator box + green monospace "code" text, both
      // anchored at a fixed indent in the middle of the card
      if (tagVal) {
        const entry = tags?.[g.gamePk];
        const gradeResult = entry && typeof entry === "object" ? entry.result : null;
        const indentX = cx + cw*0.39, midY = cy + ch/2;
        drawPlayIndicator(x, gradeResult, indentX, midY-7, 14);
        const rightLimit = final ? cx+cw-40 : cx+cw-10;
        drawGreenTag(x, stripPlayPrefix(tagVal), indentX+20, midY, rightLimit-(indentX+20), 14);
      }
      copyCanvas(cv, `${aw}-${hm}-${(g.time||"").slice(0,10)}.png`, setCopied);
    } catch (e) {
      console.error("exportCard failed:", e);
      setCopied("err"); setTimeout(()=>setCopied(null), 2000);
    }
  };

  useEffect(() => {
    let alive = true;
    // box score by inning + full game pitching line — live/finished games
    // only, re-checked as `live` itself flips once real game time passes
    // (see the `live` gating above) so a modal left open through first pitch
    // picks up the actual in-progress stats without needing to be reopened.
    if (final || live) {
      loadLineScore(g.gamePk).then(r=>{ if(alive) setLs(r); });
      loadBoxscorePitchers(g.gamePk).then(r=>{ if(alive) setBoxPitching(r); });
    }
    return () => { alive = false; };
  }, [g.gamePk, final, live]);

  useEffect(() => {
    let alive = true;
    (async () => {
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

  // lock background scroll while open. Just setting overflow:hidden isn't
  // enough — if the page was already scrolled down, some browsers still
  // paint this fixed overlay against the stale scroll offset, so it opens
  // looking cut off until you scroll the (frozen) background to "catch up".
  // Actually pinning the body in place with a negative offset removes it
  // from the scrolling flow entirely, so the fixed overlay always lines up
  // with the real viewport no matter how far down the page was scrolled.
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = { position: body.style.position, top: body.style.top,
      width: body.style.width, overflow: body.style.overflow };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  const aAbbr = TEAM_ABBR[g.awayId]||"?", hAbbr = TEAM_ABBR[g.homeId]||"?";
  const time = new Date(g.time).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:50,
      background:"rgba(20,24,31,0.55)", display:"flex", alignItems:"center",
      justifyContent:"center", padding:"max(12px, env(safe-area-inset-top)) 12px 12px" }}>

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
        maxHeight:"100%", overflowY:"auto", overflowX:"hidden",
        boxShadow:"0 20px 60px rgba(0,0,0,0.35)" }}>

        {/* sticky region: header + tag editor scroll together. the card
            itself is now the scrolling element (not the full-screen overlay
            behind it), so content scrolling up passes behind this sticky
            block and disappears cleanly into it instead of just scrolling
            off the top of the screen. */}
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

        {/* ── BOX SCORE BY INNING (live/finished games, above H2H) — always
             shows a full 9-inning grid, padding in blank columns for
             innings not reached yet so a live game's box score doesn't
             visually resize as it goes. ── */}
        {showLineScore && ls !== null && (
          <div style={{ padding:"12px 18px", borderBottom:`1px solid ${C.rule}` }}>
            <div style={{ fontFamily:MONO, fontSize:9.5, letterSpacing:"0.12em", textTransform:"uppercase",
              color:C.inkSoft, marginBottom:6 }}>{final ? "Final" : "Live"} · line score</div>
            {ls === undefined ? (
              <div style={{ fontFamily:MONO, fontSize:12, color:C.inkSoft }}>Loading…</div>
            ) : (() => {
              const played = ls.innings || [];
              const innings = Array.from({ length: Math.max(9, played.length) },
                (_, i) => played[i] || { num: i+1 });
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
            {t.bigday.map((b,i)=><Pill key={i} color={C.bigday} title="Scored 10+ runs in their last game">{b.team.split(" ").slice(-1)[0]} {b.runs} runs last game</Pill>)}
            {t.gauntlet.map((x,i)=><Pill key={i} color={C.gauntlet} title="Just faced 2-3 straight starters with a sub-3.00 ERA">the gauntlet ({x.len})</Pill>)}
            {t.formerTeam.map((x,i)=><Pill key={i} color={C.boom} title="Used to play for the team he's facing today">revenge game vs {x.opp.split(" ").slice(-1)[0]}</Pill>)}
          </div>
        )}

        {/* ── lineups: away left, home right (stack on mobile) ── */}
        <div className="ts-lineups" style={{ gap:0 }}>
          <TeamPanel teamName={g.awayName} oppName={g.homeName}
            lineup={awayLU} pitcherName={g.awayPname} pitcherId={g.awayPid} pitcherInfo={awayP}
            oppPitcherName={g.homePname} oppPitcherId={g.homePid}
            oppTeamId={g.homeId} date={date}
            showBoxPitching={showBoxPitching} boxPitchers={boxPitching?.away}
            onStat={(name,stat)=>setPick({ name, stat, ts:Date.now() })} />
          <div style={{ borderLeft:`1px solid ${C.rule}` }} className="ts-h2h-divider">
            <TeamPanel teamName={g.homeName} oppName={g.awayName}
              lineup={homeLU} pitcherName={g.homePname} pitcherId={g.homePid} pitcherInfo={homeP}
              oppPitcherName={g.awayPname} oppPitcherId={g.awayPid}
              oppTeamId={g.awayId} date={date}
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
@keyframes ts-spin { to { transform: rotate(360deg); } }
.ts-cal { display:grid; grid-template-columns: repeat(7, minmax(340px,1fr)); overflow-x:auto; }
.ts-cal-col { min-width:340px; }
.ts-lineups { display:grid; grid-template-columns:1fr 1fr; }
.ts-app { padding:calc(28px + env(safe-area-inset-top)) calc(18px + env(safe-area-inset-right))
  calc(60px + env(safe-area-inset-bottom)) calc(18px + env(safe-area-inset-left)); }
.ts-cell { box-sizing:border-box; }
@media (max-width:760px){
  .ts-cal { grid-auto-flow:column; grid-auto-columns:89%; grid-template-columns:none;
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

// empty/fillable box on a play's row, left of its name — click to pick it
// as a standout play; fills with the hot nut logo once picked.
function PlayStarBox({ starred, onToggle, size = 22 }) {
  return (
    <button onClick={onToggle} title={starred ? "Unpick this play" : "Pick this play"}
      aria-label={starred ? "Unpick this play" : "Pick this play"}
      style={{ width:size, height:size, borderRadius:3, cursor:"pointer", flexShrink:0,
        border:`1px solid ${starred ? C.ink : C.rule}`,
        background: starred ? C.ink : "#fff",
        display:"flex", alignItems:"center", justifyContent:"center",
        overflow:"hidden", padding:0 }}>
      {starred && <img src={hotNutLogo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />}
    </button>
  );
}

/* ════════════════════════ TAGS VIEW ════════════════════════ */
function TagsView({ tags, setResult, setStarred }) {
  const [range, setRange] = useState("all");   // all|month|lastmonth|7d|30d
  // defaults to showing only starred plays when the tab is first opened
  const [onlyStarred, setOnlyStarred] = useState(true);

  // build a list of tagged games: newest DAY first, earliest game-time first within a day
  const allRows = useMemo(() => {
    return Object.entries(tags || {})
      .map(([gamePk, entry]) => {
        if (typeof entry === "string") return { gamePk, text:entry, date:"", time:"", away:"", home:"", result:null, starred:false };
        return { gamePk, text:entry.text||"", date:entry.date||"", time:entry.time||"",
          away:entry.away||"", home:entry.home||"",
          awayId:entry.awayId, homeId:entry.homeId, result:entry.result||null, starred:!!entry.starred };
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
      if (onlyStarred && !r.starred) return false;
      if (!r.date) return range === "all";      // undated tags only show in All time
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      return true;
    });
    return { rows: filtered, rangeLabel: label };
  }, [allRows, range, onlyStarred]);

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
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            <button onClick={()=>setOnlyStarred(v=>!v)}
              aria-label={onlyStarred ? "Showing only picked plays — click to show all" : "Show only picked plays"}
              title={onlyStarred ? "Showing only picked plays" : "Show only picked plays"}
              style={{ width:26, height:26, borderRadius:"50%", cursor:"pointer", flexShrink:0,
                border:`1px solid ${onlyStarred?"#fff":"rgba(255,255,255,0.25)"}`,
                background: onlyStarred?"#fff":"transparent", opacity: onlyStarred?1:0.55,
                display:"flex", alignItems:"center", justifyContent:"center",
                overflow:"hidden", padding: onlyStarred?2:0 }}>
              <img src={hotNutLogo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", borderRadius:"50%" }} />
            </button>
            <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
              {FILTERS.map(([id,lbl])=>(
                <button key={id} onClick={()=>setRange(id)} style={{ padding:"4px 9px",
                  border:`1px solid ${range===id?"#fff":"rgba(255,255,255,0.25)"}`, borderRadius:2,
                  background:range===id?"#fff":"transparent", color:range===id?C.ink:"rgba(255,255,255,0.75)",
                  fontFamily:MONO, fontSize:10, letterSpacing:"0.04em", textTransform:"uppercase",
                  cursor:"pointer" }}>{lbl}</button>))}
            </div>
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
          {onlyStarred && allRows.some(r=>!r.starred)
            ? <>No 🌰 plays in this range. <button onClick={()=>setOnlyStarred(false)}
                style={{ font:"inherit", color:C.blue, textDecoration:"underline", cursor:"pointer",
                  border:"none", background:"transparent", padding:0 }}>Show all plays</button></>
            : "No plays in this range."}</div>
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
                background:tint, padding:"5px 12px" }}>
                <PlayStarBox starred={r.starred} onToggle={()=>setStarred(r.gamePk, !r.starred)} size={20} />
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
              <PlayStarBox starred={r.starred} onToggle={()=>setStarred(r.gamePk, !r.starred)} />
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

// small month-grid date picker that drops down from the CALENDAR tab button
// once it's already the active tab — lets you re-anchor the whole calendar
// view to any day instead of always sitting on today.
function MiniDatePicker({ value, onSelect, onClose }) {
  const [viewDate, setViewDate] = useState(() => new Date(value+"T00:00:00"));
  const ref = useRef(null);
  useEffect(() => {
    const onDocMouseDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocMouseDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const year = viewDate.getFullYear(), month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();          // 0=Sun
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayIso = todayISO();
  const isoFor = (d) => `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  const cells = [];
  for (let i=0;i<startWeekday;i++) cells.push(null);
  for (let d=1; d<=daysInMonth; d++) cells.push(d);

  const navBtn = { width:24, height:24, border:`1px solid ${C.rule}`, borderRadius:3, background:"#fff",
    color:C.ink, cursor:"pointer", fontFamily:MONO, fontSize:13, lineHeight:1,
    display:"flex", alignItems:"center", justifyContent:"center", padding:0 };

  return (
    <div ref={ref} onClick={e=>e.stopPropagation()} style={{ position:"absolute", top:"calc(100% + 6px)", right:0,
      zIndex:80, background:"#fff", border:`1px solid ${C.ink}`, borderRadius:6,
      boxShadow:"0 12px 32px rgba(0,0,0,0.25)", padding:10, width:240, maxWidth:"calc(100vw - 24px)" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <button onClick={()=>setViewDate(new Date(year, month-1, 1))} style={navBtn} aria-label="Previous month">‹</button>
        <div style={{ fontFamily:MONO, fontSize:12, fontWeight:700, letterSpacing:"0.02em" }}>
          {firstOfMonth.toLocaleDateString(undefined,{month:"long", year:"numeric"})}
        </div>
        <button onClick={()=>setViewDate(new Date(year, month+1, 1))} style={navBtn} aria-label="Next month">›</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:4 }}>
        {["S","M","T","W","T","F","S"].map((d,i)=>(
          <div key={i} style={{ textAlign:"center", fontFamily:MONO, fontSize:9,
            color:C.ruleDark, textTransform:"uppercase" }}>{d}</div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2 }}>
        {cells.map((d,i) => {
          if (d==null) return <div key={i} />;
          const iso = isoFor(d);
          const isSelected = iso===value, isToday = iso===todayIso;
          return (
            <button key={i} onClick={()=>onSelect(iso)} title={iso}
              style={{ aspectRatio:"1", border: isSelected ? `1px solid ${C.ink}` : isToday ? `1px solid ${C.rematch}` : "1px solid transparent",
                borderRadius:4, background: isSelected ? C.ink : "transparent",
                color: isSelected ? "#fff" : isToday ? C.rematch : C.ink,
                fontFamily:MONO, fontSize:11, fontWeight: (isToday||isSelected) ? 700 : 400,
                cursor:"pointer" }}>{d}</button>
          );
        })}
      </div>
      <button onClick={()=>onSelect(todayIso)} style={{ marginTop:8, width:"100%", padding:"5px 0",
        border:`1px solid ${C.rule}`, borderRadius:3, background:"#fff", color:C.ink,
        fontFamily:MONO, fontSize:10, letterSpacing:"0.06em", textTransform:"uppercase", cursor:"pointer" }}>
        Jump to today
      </button>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("calendar");
  const { tags, tagStatus, setTag, setResult, setStarred } = useTags();
  const [cal, setCal] = useState(null);   // { load, busy } from TravelTrends
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    document.title = "MLB";
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
              {tab==="calendar" && cal && cal.setShowIndicators && (
                <button onClick={()=>cal.setShowIndicators(v=>!v)}
                  aria-label={cal.showIndicators ? "Hide indicators" : "Show indicators"}
                  title={cal.showIndicators ? "Hide indicators" : "Show indicators"}
                  style={{ width:30, height:30, borderRadius:5,
                    border:`1px solid ${C.ink}`,
                    background: cal.showIndicators ? "#fff" : C.ink,
                    color: cal.showIndicators ? C.ink : "#fff", cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
                    padding:0 }}>
                  {cal.showIndicators ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="2"/>
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="2"/>
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                      <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  )}
                </button>
              )}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <div style={{ position:"relative" }}>
                <button onClick={()=>{
                    if (tab!=="calendar") { setTab("calendar"); setShowDatePicker(false); return; }
                    setShowDatePicker(v=>!v);
                  }}
                  title={tab==="calendar" ? "Click again to jump to a different day" : "Calendar"}
                  style={{ padding:"7px 15px",
                    border:`1px solid ${tab==="calendar"?C.ink:C.rule}`, borderRadius:2,
                    background:tab==="calendar"?C.ink:"transparent", color:tab==="calendar"?"#fff":C.inkSoft,
                    fontFamily:MONO, fontSize:12, letterSpacing:"0.08em", textTransform:"uppercase",
                    cursor:"pointer" }}>
                  {cal && cal.anchor
                    ? new Date(cal.anchor+"T00:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"}).toUpperCase()
                    : "CALENDAR"}
                </button>
                {showDatePicker && tab==="calendar" && cal && cal.setAnchor && (
                  <MiniDatePicker value={cal.anchor}
                    onSelect={(iso)=>{ cal.setAnchor(iso); setShowDatePicker(false); }}
                    onClose={()=>setShowDatePicker(false)} />
                )}
              </div>
              <button onClick={()=>{ setTab("tags"); setShowDatePicker(false); }} style={{ padding:"7px 15px",
                border:`1px solid ${tab==="tags"?C.ink:C.rule}`, borderRadius:2,
                background:tab==="tags"?C.ink:"transparent", color:tab==="tags"?"#fff":C.inkSoft,
                fontFamily:MONO, fontSize:12, letterSpacing:"0.08em", textTransform:"uppercase",
                cursor:"pointer" }}>PLAYS</button>
            </div>
          </div>
        </header>
        <div style={{ height:6, borderBottom:`1px solid ${C.rule}`, marginBottom:18 }} />

        {/* both views stay mounted always — hidden with CSS rather than
            unmounted — so switching tabs never throws away the calendar's
            already-loaded schedule/stats and forces a refetch */}
        <div style={{ display: tab==="tags" ? "block" : "none" }}>
          <TagsView tags={tags} setResult={setResult} setStarred={setStarred} />
        </div>
        <div style={{ display: tab==="calendar" ? "block" : "none" }}>
          <TravelTrends tags={tags} setTag={setTag} onReady={setCal} />
        </div>

        <footer style={{ marginTop:40, paddingTop:14, borderTop:`1px solid ${C.rule}`,
          fontFamily:MONO, fontSize:10.5, color:C.ruleDark, lineHeight:1.7 }}>
          Stats & schedule: MLB Stats API (free, no key). Click any game for lineups, the
          probable starters’ history vs the opponent, and the season head-to-head. Lineups are
          confirmed only a few hours pre-game; before that they’re projected from each team’s
          last batting order.
        </footer>
      </div>
      {tab==="calendar" && cal && !cal.modalOpen && (
        <button onClick={()=>cal.load && cal.load()} disabled={cal.busy}
          aria-label="Refresh" title="Refresh schedule & stats"
          style={{ position:"fixed", bottom:20, right:20, zIndex:40,
            width:44, height:44, borderRadius:"50%", border:`1px solid ${C.ink}`,
            background:C.ink, color:"#fff", cursor:cal.busy?"default":"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
            padding:0, boxShadow:"0 4px 14px rgba(0,0,0,0.3)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            style={{ animation: cal.busy ? "ts-spin 0.8s linear infinite" : "none" }}>
            <path d="M4 6.5A8 8 0 0 1 19 8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M20 3.5V8h-4.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M20 17.5A8 8 0 0 1 5 16" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M4 20.5V16h4.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
    </div>
  );
}
