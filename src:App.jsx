import { useState } from "react";

// ─── FIELD DATA ───────────────────────────────────────────────────────────────
const FIELDS = {
  Lagos: {
    holes: [
      { par: 4, strokeIndex: 3  }, { par: 5, strokeIndex: 9  }, { par: 4, strokeIndex: 17 },
      { par: 4, strokeIndex: 15 }, { par: 3, strokeIndex: 7  }, { par: 4, strokeIndex: 5  },
      { par: 3, strokeIndex: 13 }, { par: 5, strokeIndex: 11 }, { par: 4, strokeIndex: 1  },
      { par: 5, strokeIndex: 10 }, { par: 4, strokeIndex: 2  }, { par: 3, strokeIndex: 4  },
      { par: 4, strokeIndex: 6  }, { par: 4, strokeIndex: 16 }, { par: 3, strokeIndex: 18 },
      { par: 4, strokeIndex: 14 }, { par: 4, strokeIndex: 8  }, { par: 5, strokeIndex: 12 },
    ],
  },
  Pacos: {
    holes: [
      { par: 4, strokeIndex: 3  }, { par: 3, strokeIndex: 17 }, { par: 5, strokeIndex: 9  },
      { par: 4, strokeIndex: 7  }, { par: 4, strokeIndex: 1  }, { par: 4, strokeIndex: 13 },
      { par: 3, strokeIndex: 15 }, { par: 5, strokeIndex: 5  }, { par: 4, strokeIndex: 11 },
      { par: 4, strokeIndex: 4  }, { par: 4, strokeIndex: 14 }, { par: 5, strokeIndex: 2  },
      { par: 3, strokeIndex: 16 }, { par: 4, strokeIndex: 8  }, { par: 4, strokeIndex: 6  },
      { par: 3, strokeIndex: 18 }, { par: 5, strokeIndex: 10 }, { par: 4, strokeIndex: 12 },
    ],
  },
};

// ─── HANDICAP ENGINE ──────────────────────────────────────────────────────────
function strokesGranted(handicap, strokeIndex) {
  const base = Math.floor(handicap / 18);
  const extra = handicap % 18;
  return base + (strokeIndex <= extra ? 1 : 0);
}
function netScoreHole(gross, handicap, strokeIndex) {
  return gross - strokesGranted(handicap, strokeIndex);
}
function matchPlayDiff(scoresA, scoresB) {
  let diff = 0;
  for (let i = 0; i < scoresA.length; i++) {
    if (scoresA[i] < scoresB[i]) diff++;
    else if (scoresA[i] > scoresB[i]) diff--;
  }
  return diff;
}
function pairs(arr) {
  const result = [];
  for (let i = 0; i < arr.length; i++)
    for (let j = i + 1; j < arr.length; j++)
      result.push([arr[i], arr[j]]);
  return result;
}

// ─── CORE CALCULATION ENGINE ──────────────────────────────────────────────────
function runBets(config) {
  const { field, groups: rawGroups, bets, retencion } = config;
  const holes = FIELDS[field].holes;
  const ret = retencion / 100;
  const groups = rawGroups.map((g) => ({ ...g, players: g.players.filter((p) => p.name.trim()) }));
  const maxGroupSize = Math.max(...groups.map((g) => g.players.length));

  function paddedGroups() {
    return groups.map((g) => {
      const needed = maxGroupSize - g.players.length;
      if (needed === 0) return g;
      const artificials = Array(needed).fill(null).map((_, i) => ({
        name: `__art_${g.players[0]?.name}_${i}`, handicap: 0,
        strokes: holes.map((h) => h.par), putts: 0,
      }));
      return { ...g, players: [...g.players, ...artificials] };
    });
  }

  const allPlayers = groups.flatMap((g) => g.players);
  const oblResults = {}, optResults = {};
  allPlayers.forEach((p) => { oblResults[p.name] = 0; optResults[p.name] = 0; });

  const netsByName = {};
  allPlayers.forEach((p) => {
    netsByName[p.name] = holes.map((h, i) => netScoreHole(p.strokes[i], p.handicap, h.strokeIndex));
  });
  function netForPlayer(p, hi) {
    return netsByName[p.name] !== undefined ? netsByName[p.name][hi] : p.strokes[hi];
  }
  function h2h(ledger, wName, lName, amt) { ledger[wName] += amt; ledger[lName] -= amt; }
  function potWinnersOnly(ledger, winners, losers, amt) {
    const pot = amt * losers.length;
    losers.forEach((l) => (ledger[l] -= amt));
    winners.forEach((w) => (ledger[w] += pot / winners.length));
  }
  function segAmts(b) { return [b.amountF9 ?? b.amount, b.amountB9 ?? b.amount, b.amount18 ?? b.amount]; }

  const FRONT = [...Array(9).keys()];
  const BACK  = [...Array(9).keys()].map((i) => i + 9);
  const FULL  = [...Array(18).keys()];

  // 1. MATCH PLAY
  if (bets.matchPlay?.enabled) {
    const [aF, aB, a18] = segAmts(bets.matchPlay);
    pairs(allPlayers).forEach(([pA, pB]) => {
      [[FRONT,aF],[BACK,aB],[FULL,a18]].forEach(([seg,amt]) => {
        const diff = matchPlayDiff(seg.map((i)=>netsByName[pA.name][i]), seg.map((i)=>netsByName[pB.name][i]));
        if (diff > 0) h2h(oblResults, pA.name, pB.name, amt);
        else if (diff < 0) h2h(oblResults, pB.name, pA.name, amt);
      });
    });
  }
  // 2. MEDAL PLAY
  if (bets.medalPlay?.enabled) {
    const [aF, aB, a18] = segAmts(bets.medalPlay);
    pairs(allPlayers).forEach(([pA, pB]) => {
      [[FRONT,aF],[BACK,aB],[FULL,a18]].forEach(([seg,amt]) => {
        const tA = seg.reduce((s,i)=>s+netsByName[pA.name][i],0);
        const tB = seg.reduce((s,i)=>s+netsByName[pB.name][i],0);
        if (tA < tB) h2h(oblResults, pA.name, pB.name, amt);
        else if (tB < tA) h2h(oblResults, pB.name, pA.name, amt);
      });
    });
  }
  // 3. NET SCORE
  if (bets.netScore?.enabled) {
    const amt = bets.netScore.amount, pct1 = (bets.netScore.pct1 ?? 70) / 100;
    const totals = allPlayers.map((p)=>({ name:p.name, total:FULL.reduce((s,i)=>s+netsByName[p.name][i],0) })).sort((a,b)=>a.total-b.total);
    const pot = amt * allPlayers.length;
    allPlayers.forEach((p)=>(oblResults[p.name] -= amt));
    const fv = totals[0].total, fp = totals.filter((t)=>t.total===fv);
    if (fp.length > 1) { fp.forEach((w)=>(oblResults[w.name] += pot/fp.length)); }
    else {
      oblResults[totals[0].name] += pot * pct1;
      const sv = totals[1].total, sp = totals.filter((t)=>t.total===sv);
      sp.forEach((w)=>(oblResults[w.name] += (pot*(1-pct1))/sp.length));
    }
  }
  // 4. BEST BALL
  if (bets.bestBall?.enabled) {
    const [aF,aB,a18] = segAmts(bets.bestBall);
    const pg = paddedGroups();
    pairs(pg.map((_,i)=>i)).forEach(([iA,iB]) => {
      const gA=pg[iA], gB=pg[iB], n=Math.max(gA.players.length,gB.players.length);
      const rA=groups[iA].players, rB=groups[iB].players;
      [[FRONT,aF],[BACK,aB],[FULL,a18]].forEach(([seg,amt]) => {
        const pot=amt*n;
        const bbA=seg.map((hi)=>Math.min(...gA.players.map((p)=>netForPlayer(p,hi))));
        const bbB=seg.map((hi)=>Math.min(...gB.players.map((p)=>netForPlayer(p,hi))));
        const diff=matchPlayDiff(bbA,bbB);
        if (diff>0) { rA.forEach((w)=>(oblResults[w.name]+=pot/rA.length)); rB.forEach((l)=>(oblResults[l.name]-=pot/rB.length)); }
        else if (diff<0) { rB.forEach((w)=>(oblResults[w.name]+=pot/rB.length)); rA.forEach((l)=>(oblResults[l.name]-=pot/rA.length)); }
      });
    });
  }
  // 5. SUM OF 3
  if (bets.sumOf3?.enabled) {
    const [aF,aB,a18] = segAmts(bets.sumOf3);
    const pg = paddedGroups();
    function s3(g,seg) { return seg.map((hi)=>{ const s=g.players.map((p)=>netForPlayer(p,hi)).sort((a,b)=>a-b); return s.slice(0,s.length-1).reduce((a,b)=>a+b,0); }); }
    pairs(pg.map((_,i)=>i)).forEach(([iA,iB]) => {
      const gA=pg[iA], gB=pg[iB], n=Math.max(gA.players.length,gB.players.length);
      const rA=groups[iA].players, rB=groups[iB].players;
      [[FRONT,aF],[BACK,aB],[FULL,a18]].forEach(([seg,amt]) => {
        const pot=amt*n, diff=matchPlayDiff(s3(gA,seg),s3(gB,seg));
        if (diff>0) { rA.forEach((w)=>(oblResults[w.name]+=pot/rA.length)); rB.forEach((l)=>(oblResults[l.name]-=pot/rB.length)); }
        else if (diff<0) { rB.forEach((w)=>(oblResults[w.name]+=pot/rB.length)); rA.forEach((l)=>(oblResults[l.name]-=pot/rA.length)); }
      });
    });
  }
  // 6–8. BIRDIE / EAGLE / ALBATROSS
  [{ key:"birdie",t:-1 },{ key:"eagle",t:-2 },{ key:"albatross",t:-3 }].forEach(({ key,t }) => {
    if (!bets[key]?.enabled) return;
    const amt=bets[key].amount, pot=amt*maxGroupSize;
    groups.forEach((sg,si) => {
      const occ=sg.players.reduce((sum,p)=>sum+holes.reduce((s,h,i)=>s+(p.strokes[i]<=h.par+t?1:0),0),0);
      if (occ===0) return;
      groups.forEach((pg,pi) => {
        if (pi===si) return;
        const owed=pot*occ;
        sg.players.forEach((w)=>(oblResults[w.name]+=owed/sg.players.length));
        pg.players.forEach((l)=>(oblResults[l.name]-=owed/pg.players.length));
      });
    });
  });
  // 9. HOLE IN ONE
  if (bets.holeInOne?.enabled) {
    const amt=bets.holeInOne.amount;
    allPlayers.forEach((scorer) => {
      const occ=scorer.strokes.filter((s)=>s===1).length;
      if (occ===0) return;
      allPlayers.forEach((payer) => {
        if (payer.name===scorer.name) return;
        oblResults[scorer.name]+=amt*occ;
        oblResults[payer.name]-=amt*occ;
      });
    });
  }
  // 10. PUTTS
  if (bets.putts?.enabled) {
    const amt=bets.putts.amount, min=Math.min(...allPlayers.map((p)=>p.putts));
    const winners=allPlayers.filter((p)=>p.putts===min).map((p)=>p.name);
    const losers=allPlayers.filter((p)=>p.putts!==min).map((p)=>p.name);
    potWinnersOnly(oblResults,winners,losers,amt);
  }
  // 11. SANDIES
  if (bets.sandies?.enabled) {
    const amt=bets.sandies.amount;
    pairs(groups.map((_,i)=>i)).forEach(([iA,iB]) => {
      const pot=amt*Math.max(groups[iA].players.length,groups[iB].players.length);
      const sA=groups[iA].sandies, sB=groups[iB].sandies;
      if (sA>sB) { groups[iA].players.forEach((w)=>(oblResults[w.name]+=pot/groups[iA].players.length)); groups[iB].players.forEach((l)=>(oblResults[l.name]-=pot/groups[iB].players.length)); }
      else if (sB>sA) { groups[iB].players.forEach((w)=>(oblResults[w.name]+=pot/groups[iB].players.length)); groups[iA].players.forEach((l)=>(oblResults[l.name]-=pot/groups[iA].players.length)); }
    });
  }
  // 12. OPT MATCH PLAY
  if (bets.optMatchPlay?.amountF9>0||bets.optMatchPlay?.amountB9>0||bets.optMatchPlay?.amount18>0) {
    const [aF,aB,a18]=[bets.optMatchPlay.amountF9,bets.optMatchPlay.amountB9,bets.optMatchPlay.amount18];
    const oi=allPlayers.filter((p)=>p.optIn);
    pairs(oi).forEach(([pA,pB]) => {
      [[FRONT,aF],[BACK,aB],[FULL,a18]].forEach(([seg,amt]) => {
        if (!amt) return;
        const nA=seg.map((i)=>netsByName[pA.name][i]), nB=seg.map((i)=>netsByName[pB.name][i]);
        let sm=[{diff:0}], eA=0, eB=0;
        for (let idx=0;idx<seg.length;idx++) {
          const delta=nA[idx]<nB[idx]?1:nA[idx]>nB[idx]?-1:0, nc=[];
          sm=sm.map((s)=>{ const nd=s.diff+delta; if(Math.abs(nd)===2) nc.push({diff:0}); return {diff:nd}; });
          sm=[...sm,...nc];
        }
        sm.forEach((s)=>{ if(s.diff>0){eA+=amt;eB-=amt;} else if(s.diff<0){eB+=amt;eA-=amt;} });
        optResults[pA.name]+=eA; optResults[pB.name]+=eB;
      });
    });
  }
  // 13. OPT MEDAL PLAY
  if (bets.optMedalPlay?.amountF9>0||bets.optMedalPlay?.amountB9>0||bets.optMedalPlay?.amount18>0) {
    const [aF,aB,a18]=[bets.optMedalPlay.amountF9,bets.optMedalPlay.amountB9,bets.optMedalPlay.amount18];
    const oi=allPlayers.filter((p)=>p.optIn);
    pairs(oi).forEach(([pA,pB]) => {
      [[FRONT,aF],[BACK,aB],[FULL,a18]].forEach(([seg,amt]) => {
        if (!amt) return;
        const tA=seg.reduce((s,i)=>s+netsByName[pA.name][i],0), tB=seg.reduce((s,i)=>s+netsByName[pB.name][i],0);
        if (tA<tB) h2h(optResults,pA.name,pB.name,amt); else if (tB<tA) h2h(optResults,pB.name,pA.name,amt);
      });
    });
  }
  // 14. OPT BIRDIES
  if (bets.optBirdies?.amountF9>0||bets.optBirdies?.amountB9>0||bets.optBirdies?.amount18>0) {
    const [aF,aB,a18]=[bets.optBirdies.amountF9,bets.optBirdies.amountB9,bets.optBirdies.amount18];
    const oi=allPlayers.filter((p)=>p.optIn);
    pairs(oi).forEach(([pA,pB]) => {
      [[0,9,aF],[9,18,aB],[0,18,a18]].forEach(([from,to,amt]) => {
        if (!amt) return;
        const cA=holes.slice(from,to).filter((h,i)=>pA.strokes[from+i]<=h.par-1).length;
        const cB=holes.slice(from,to).filter((h,i)=>pB.strokes[from+i]<=h.par-1).length;
        if (cA>cB) h2h(optResults,pA.name,pB.name,amt); else if (cB>cA) h2h(optResults,pB.name,pA.name,amt);
      });
    });
  }
  // TIP
  let tipPool=0;
  const finalResults={}, oblFinal={}, optFinal={};
  allPlayers.forEach(({name}) => {
    const obl=oblResults[name], opt=optResults[name], tip=obl>0?obl*ret:0;
    tipPool+=tip;
    oblFinal[name]=obl-tip; optFinal[name]=opt;
    finalResults[name]=(obl-tip)+opt;
  });
  return { results:finalResults, oblFinal, optFinal, tipPool };
}

// ─── DEFAULTS ─────────────────────────────────────────────────────────────────
function defaultBets() {
  return {
    matchPlay:   { enabled:true,  amountF9:5, amountB9:5, amount18:5 },
    medalPlay:   { enabled:true,  amountF9:5, amountB9:5, amount18:5 },
    netScore:    { enabled:true,  amount:10, pct1:70 },
    bestBall:    { enabled:true,  amountF9:5, amountB9:5, amount18:5 },
    sumOf3:      { enabled:true,  amountF9:5, amountB9:5, amount18:5 },
    birdie:      { enabled:true,  amount:3 },
    eagle:       { enabled:true,  amount:5 },
    albatross:   { enabled:true,  amount:10 },
    holeInOne:   { enabled:true,  amount:10 },
    putts:       { enabled:true,  amount:5 },
    sandies:     { enabled:true,  amount:3 },
    optMatchPlay:  { amountF9:5, amountB9:5, amount18:5 },
    optMedalPlay:  { amountF9:5, amountB9:5, amount18:5 },
    optBirdies:    { amountF9:3, amountB9:3, amount18:3 },
  };
}
function makePlayer(name, handicap, strokes) {
  return { name, handicap, strokes, putts:0, optIn:false };
}
function emptyPlayer() { return makePlayer("", 0, Array(18).fill(4)); }
function emptyGroup(size=4) { return { players:Array(size).fill(null).map(()=>emptyPlayer()), sandies:0 }; }
function testGroups() {
  return [
    { sandies:0, players:[
      makePlayer("a",10,[4,10,3,3,3,7,3,4,5,7,3,2,4,3,3,3,4,4]),
      makePlayer("b",10,[4,8,7,2,3,5,1,5,3,6,2,2,6,6,2,5,4,4]),
      makePlayer("c",10,[6,3,5,4,5,3,6,7,4,4,3,3,5,4,6,5,3,7]),
      makePlayer("d",10,[6,7,4,3,2,4,3,5,3,6,5,3,4,6,3,6,4,3]),
    ]},
    { sandies:0, players:[
      makePlayer("e",13,[5,8,7,4,3,6,3,4,4,5,3,3,3,6,5,7,5,6]),
      makePlayer("f",13,[5,5,6,5,4,5,5,4,4,8,5,4,5,3,5,3,3,4]),
      makePlayer("g",13,[8,8,6,4,6,4,3,8,5,5,6,2,3,3,2,3,6,7]),
    ]},
  ];
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SEGMENTED_BETS = new Set(["matchPlay","medalPlay","bestBall","sumOf3","optMatchPlay","optMedalPlay","optBirdies"]);
const OBL_BETS = [
  { key:"matchPlay",  label:"Match Play" },
  { key:"medalPlay",  label:"Medal Play" },
  { key:"netScore",   label:"Neto" },
  { key:"bestBall",   label:"Mejor Bola" },
  { key:"sumOf3",     label:"Suma de 3" },
  { key:"birdie",     label:"Birdie" },
  { key:"eagle",      label:"Águila" },
  { key:"albatross",  label:"Albatros" },
  { key:"holeInOne",  label:"Hoyo en 1" },
  { key:"putts",      label:"Putts" },
  { key:"sandies",    label:"Sandy Par" },
];
const OPT_BETS = [
  { key:"optMatchPlay", label:"Match Play (con cascada)" },
  { key:"optMedalPlay", label:"Medal Play" },
  { key:"optBirdies",   label:"Birdies o mejor" },
];

// ─── DEFAULT SETTINGS ─────────────────────────────────────────────────────────
function defaultSettings() {
  return {
    retencion: 10,
    bets: defaultBets(),
    fieldHoles: {
      Lagos: FIELDS["Lagos"].holes.map(h=>({...h})),
      Pacos: FIELDS["Pacos"].holes.map(h=>({...h})),
    },
  };
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function GolfBetApp() {
  const [step, setStep]               = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings]       = useState(defaultSettings);
  const [field, setField]             = useState("Lagos");
  const [numGroups, setNumGroups]     = useState(2);
  const [ppg, setPpg]                 = useState(4);
  const [groups, setGroups]           = useState(testGroups);
  const [bets, setBets]               = useState(() => defaultBets());
  const [retencion, setRetencion]     = useState(10);
  const [results, setResults]         = useState(null);
  const [errors, setErrors]           = useState([]);
  const [activeGroup, setActiveGroup] = useState(0);
  const [activePlayer, setActivePlayer] = useState(0);
  const [activeHole, setActiveHole]   = useState(0);
  const [openResult, setOpenResult]   = useState(null);
  const [settingsField, setSettingsField] = useState("Lagos");

  // Active holes come from settings
  const holes = settings.fieldHoles[field];

  function handleFieldChange(f) { setField(f); }

  // When entering a new round, apply settings defaults
  function applySetup() {
    setBets(JSON.parse(JSON.stringify(settings.bets)));
    setRetencion(settings.retencion);
    const newGroups = Array(numGroups).fill(null).map((_, i) => {
      const existing = groups[i];
      const size = existing ? existing.players.length : ppg;
      return { sandies: existing?.sandies ?? 0, players: Array(size).fill(null).map((_,j) => existing?.players[j] || emptyPlayer()) };
    });
    setGroups(newGroups); setActiveGroup(0); setActivePlayer(0); setActiveHole(0); setStep(1);
  }

  // Settings updaters
  function setSettingHole(f, hi, par) {
    setSettings(prev => {
      const fh = { ...prev.fieldHoles, [f]: prev.fieldHoles[f].map((h,i) => i===hi ? {...h, par} : h) };
      return { ...prev, fieldHoles: fh };
    });
  }
  function resetSettingHoles(f) {
    setSettings(prev => ({ ...prev, fieldHoles: { ...prev.fieldHoles, [f]: FIELDS[f].holes.map(h=>({...h})) } }));
  }
  function setSettingRetencion(v) { setSettings(prev => ({ ...prev, retencion: v })); }
  function setSettingBet(key, field, val) {
    setSettings(prev => ({ ...prev, bets: { ...prev.bets, [key]: { ...prev.bets[key], [field]: val } } }));
  }

  function updPlayer(gi, pi, fn) {
    setGroups((prev) => {
      const g = prev.map((gr) => ({ ...gr, players: [...gr.players] }));
      g[gi].players[pi] = fn(g[gi].players[pi]);
      return g;
    });
  }

  function validate() {
    const errs = [];
    if (retencion < 0) errs.push("La retención debe ser ≥ 0.");
    groups.forEach((g, gi) => {
      const real = g.players.filter((p) => p.name.trim());
      if (real.length === 0) errs.push(`Grupo ${gi+1}: se requiere al menos un jugador.`);
      real.forEach((p) => {
        if (p.handicap < 0) errs.push(`Grupo ${gi+1} ${p.name}: el handicap debe ser ≥ 0.`);
        p.strokes.forEach((s,hi) => { if (s < 1) errs.push(`Grupo ${gi+1} ${p.name} hoyo ${hi+1}: el golpe debe ser ≥ 1.`); });
      });
    });
    return errs;
  }

  function calculate() {
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    setResults(runBets({ field, groups, bets, retencion }));
    setStep(2);
  }

  // ── Score entry helpers ──
  const curGroup = groups[activeGroup] || groups[0];
  const curPlayer = curGroup?.players[activePlayer] || curGroup?.players[0];
  const curHole = holes[activeHole];
  const curGranted = curPlayer ? strokesGranted(curPlayer.handicap, curHole.strokeIndex) : 0;
  const curNet = curPlayer ? curPlayer.strokes[activeHole] - curGranted : 0;
  const realPlayers = curGroup?.players.filter((p) => p.name.trim()) || [];

  function changeStroke(delta) {
    if (!curPlayer) return;
    updPlayer(activeGroup, activePlayer, (p) => {
      const s = [...p.strokes];
      s[activeHole] = Math.max(1, s[activeHole] + delta);
      return { ...p, strokes: s };
    });
  }

  function fmt(n) { return (n >= 0 ? "+" : "") + n.toFixed(2); }

  return (
    <div style={S.app}>
      {/* ── TOP BAR ── */}
      <div style={S.topBar}>
        <span style={S.topLogo}>⛳ Grupo Primavera</span>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={S.topSteps}>
            {["Config","Scores","Resultados"].map((l,i) => (
              <div key={i} style={{ ...S.topStep, ...(i===step&&!showSettings?S.topStepActive:i<step&&!showSettings?S.topStepDone:{}) }}
                onClick={() => { if(i < step){ setShowSettings(false); setStep(i); } }}>{i+1}</div>
            ))}
          </div>
          <button style={{ ...S.gearBtn, ...(showSettings?S.gearBtnActive:{}) }}
            onClick={() => setShowSettings(s=>!s)}>⚙</button>
        </div>
      </div>

      <div style={S.page}>

        {/* ══════════════ SETTINGS PAGE ══════════════ */}
        {showSettings && (
          <div>
            <div style={S.pageTitle}>Configuración</div>

            {/* Retención */}
            <div style={S.section}>
              <div style={S.sectionLabel}>Retención (%)</div>
              <div style={S.stepper}>
                <button style={S.stepBtn} onClick={() => setSettingRetencion(Math.max(0,settings.retencion-1))}>−</button>
                <span style={S.stepVal}>{settings.retencion}%</span>
                <button style={S.stepBtn} onClick={() => setSettingRetencion(settings.retencion+1)}>+</button>
              </div>
            </div>

            {/* Field hole pars */}
            <div style={S.section}>
              <div style={S.sectionLabel}>Pares por Hoyo</div>
              <div style={S.pills}>
                {["Lagos","Pacos"].map((f) => (
                  <button key={f} style={{ ...S.pill, ...(settingsField===f?S.pillActive:{}) }}
                    onClick={() => setSettingsField(f)}>{f}</button>
                ))}
              </div>
            </div>
            <div style={S.courseEditorGrid}>
              {settings.fieldHoles[settingsField].map((h,hi) => (
                <div key={hi} style={S.courseHoleCell}>
                  <div style={S.courseHoleNum}>Hoyo {hi+1}</div>
                  <div style={S.miniStepper}>
                    <button style={S.miniBtn} onClick={() => setSettingHole(settingsField,hi,Math.max(3,h.par-1))}>−</button>
                    <span style={S.miniVal}>{h.par}</span>
                    <button style={S.miniBtn} onClick={() => setSettingHole(settingsField,hi,Math.min(5,h.par+1))}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <button style={{ ...S.resetBtn, marginBottom:24 }} onClick={() => resetSettingHoles(settingsField)}>
              Restablecer pares de {settingsField}
            </button>

            {/* Default bet amounts */}
            <div style={S.section}>
              <div style={S.sectionLabel}>Montos por Defecto — Apuestas Obligatorias</div>
            </div>
            {OBL_BETS.map(({ key, label }) => (
              <div key={key} style={S.betCard}>
                <div style={S.betCardHeader}>
                  <span style={S.betCardLabel}>{label}</span>
                  {key==="netScore" && (
                    <div style={S.netPctRow}>
                      <span style={S.betMeta}>1°</span>
                      <div style={S.miniStepper}>
                        <button style={S.miniBtn} onClick={() => setSettingBet("netScore","pct1",Math.max(0,settings.bets.netScore.pct1-5))}>−</button>
                        <span style={S.miniVal}>{settings.bets.netScore.pct1}%</span>
                        <button style={S.miniBtn} onClick={() => setSettingBet("netScore","pct1",Math.min(100,settings.bets.netScore.pct1+5))}>+</button>
                      </div>
                    </div>
                  )}
                </div>
                {SEGMENTED_BETS.has(key) ? (
                  <div style={S.segAmts}>
                    {[["F9","amountF9"],["B9","amountB9"],["18","amount18"]].map(([lbl,f]) => (
                      <div key={f} style={S.segAmt}>
                        <div style={S.betMeta}>{lbl}</div>
                        <div style={S.miniStepper}>
                          <button style={S.miniBtn} onClick={() => setSettingBet(key,f,Math.max(0,settings.bets[key][f]-1))}>−</button>
                          <span style={S.miniVal}>${settings.bets[key][f]}</span>
                          <button style={S.miniBtn} onClick={() => setSettingBet(key,f,settings.bets[key][f]+1)}>+</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={S.segAmts}>
                    <div style={S.segAmt}>
                      <div style={S.betMeta}>Apuesta</div>
                      <div style={S.miniStepper}>
                        <button style={S.miniBtn} onClick={() => setSettingBet(key,"amount",Math.max(0,settings.bets[key].amount-1))}>−</button>
                        <span style={S.miniVal}>${settings.bets[key].amount}</span>
                        <button style={S.miniBtn} onClick={() => setSettingBet(key,"amount",settings.bets[key].amount+1)}>+</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <div style={{ ...S.section, marginTop:24 }}>
              <div style={S.sectionLabel}>Montos por Defecto — Apuestas Opcionales</div>
            </div>
            {OPT_BETS.map(({ key, label }) => (
              <div key={key} style={S.betCard}>
                <div style={S.betCardHeader}><span style={S.betCardLabel}>{label}</span></div>
                <div style={S.segAmts}>
                  {[["F9","amountF9"],["B9","amountB9"],["18","amount18"]].map(([lbl,f]) => (
                    <div key={f} style={S.segAmt}>
                      <div style={S.betMeta}>{lbl}</div>
                      <div style={S.miniStepper}>
                        <button style={S.miniBtn} onClick={() => setSettingBet(key,f,Math.max(0,settings.bets[key][f]-1))}>−</button>
                        <span style={S.miniVal}>${settings.bets[key][f]}</span>
                        <button style={S.miniBtn} onClick={() => setSettingBet(key,f,settings.bets[key][f]+1)}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <button style={S.resetBtn} onClick={() => setSettings(defaultSettings())}>
              Restablecer toda la configuración
            </button>
          </div>
        )}

        {!showSettings && (
        <div>

        {/* ══════════════ STEP 0: CONFIG ══════════════ */}
        {step === 0 && (
          <div>
            <div style={S.pageTitle}>Configuración de Ronda</div>
            <div style={S.testBanner}>✓ Datos de prueba precargados — 2 grupos en Lagos</div>

            <div style={S.section}>
              <div style={S.sectionLabel}>Campo</div>
              <div style={S.pills}>
                {["Lagos","Pacos"].map((f) => (
                  <button key={f} style={{ ...S.pill, ...(field===f?S.pillActive:{}) }} onClick={() => handleFieldChange(f)}>{f}</button>
                ))}
              </div>
            </div>

            <div style={S.section}>
              <div style={S.sectionLabel}>Número de Grupos</div>
              <div style={S.stepper}>
                <button style={S.stepBtn} onClick={() => setNumGroups(Math.max(1,numGroups-1))}>−</button>
                <span style={S.stepVal}>{numGroups}</span>
                <button style={S.stepBtn} onClick={() => setNumGroups(Math.min(8,numGroups+1))}>+</button>
              </div>
            </div>

            <div style={S.section}>
              <div style={S.sectionLabel}>Jugadores por Grupo</div>
              <div style={S.stepper}>
                <button style={S.stepBtn} onClick={() => setPpg(Math.max(1,ppg-1))}>−</button>
                <span style={S.stepVal}>{ppg}</span>
                <button style={S.stepBtn} onClick={() => setPpg(Math.min(4,ppg+1))}>+</button>
              </div>
            </div>

            <button style={S.primaryBtn} onClick={applySetup}>Continuar →</button>
          </div>
        )}

        {/* ══════════════ STEP 1: SCORES ══════════════ */}
        {step === 1 && (
          <div>
            <div style={S.pageTitle}>Ingreso de Scores</div>

            {/* Group selector */}
            <div style={S.sectionLabel}>Grupo</div>
            <div style={S.pills} style={{ marginBottom:16 }}>
              {groups.map((_,gi) => (
                <button key={gi} style={{ ...S.pill, ...(activeGroup===gi?S.pillActive:{}) }}
                  onClick={() => { setActiveGroup(gi); setActivePlayer(0); setActiveHole(0); }}>
                  G{gi+1}
                </button>
              ))}
            </div>

            {/* Sandy par for group */}
            <div style={S.section}>
              <div style={S.sectionLabel}>Sandy Par — Grupo {activeGroup+1}</div>
              <div style={S.stepper}>
                <button style={S.stepBtn} onClick={() => setGroups((prev) => { const g=[...prev]; g[activeGroup]={...g[activeGroup],sandies:Math.max(0,g[activeGroup].sandies-1)}; return g; })}>−</button>
                <span style={S.stepVal}>{curGroup.sandies}</span>
                <button style={S.stepBtn} onClick={() => setGroups((prev) => { const g=[...prev]; g[activeGroup]={...g[activeGroup],sandies:g[activeGroup].sandies+1}; return g; })}>+</button>
              </div>
            </div>

            {/* Player selector */}
            <div style={S.sectionLabel}>Jugador</div>
            <div style={S.pills} style={{ marginBottom:16 }}>
              {curGroup.players.map((p,pi) => (
                <button key={pi} style={{ ...S.pill, ...(activePlayer===pi?S.pillActive:{}) }}
                  onClick={() => { setActivePlayer(pi); setActiveHole(0); }}>
                  {p.name || `J${pi+1}`}
                </button>
              ))}
            </div>

            {curPlayer && (
              <div>
                {/* Player name & handicap */}
                <div style={S.playerCard}>
                  <div style={S.playerCardRow}>
                    <div style={S.playerCardField}>
                      <div style={S.sectionLabel}>Nombre</div>
                      <input style={S.textInput} placeholder="Nombre del jugador"
                        value={curPlayer.name}
                        onChange={(e) => updPlayer(activeGroup, activePlayer, (p) => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div style={S.playerCardField}>
                      <div style={S.sectionLabel}>Handicap</div>
                      <div style={S.stepper}>
                        <button style={S.stepBtn} onClick={() => updPlayer(activeGroup,activePlayer,(p)=>({...p,handicap:Math.max(0,p.handicap-1)}))}>−</button>
                        <span style={S.stepVal}>{curPlayer.handicap}</span>
                        <button style={S.stepBtn} onClick={() => updPlayer(activeGroup,activePlayer,(p)=>({...p,handicap:p.handicap+1}))}>+</button>
                      </div>
                    </div>
                  </div>
                  <div style={S.playerCardRow}>
                    <div style={S.playerCardField}>
                      <div style={S.sectionLabel}>Putts totales</div>
                      <div style={S.stepper}>
                        <button style={S.stepBtn} onClick={() => updPlayer(activeGroup,activePlayer,(p)=>({...p,putts:Math.max(0,p.putts-1)}))}>−</button>
                        <span style={S.stepVal}>{curPlayer.putts}</span>
                        <button style={S.stepBtn} onClick={() => updPlayer(activeGroup,activePlayer,(p)=>({...p,putts:p.putts+1}))}>+</button>
                      </div>
                    </div>
                    <div style={S.playerCardField}>
                      <div style={S.sectionLabel}>Apuestas opcionales</div>
                      <button style={{ ...S.optChip, ...(curPlayer.optIn?S.optChipOn:{}) }}
                        onClick={() => updPlayer(activeGroup,activePlayer,(p)=>({...p,optIn:!p.optIn}))}>
                        {curPlayer.optIn ? "✓ Participa" : "No participa"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Hole navigator */}
                <div style={S.holeNav}>
                  <div style={S.holeNavRow}>
                    <button style={S.holeNavBtn} onClick={() => setActiveHole(Math.max(0,activeHole-1))}>‹</button>
                    <div style={S.holeNavCenter}>
                      <div style={S.holeNavTitle}>Hoyo {activeHole+1}</div>
                      <div style={S.holeNavMeta}>Par {curHole.par}</div>
                    </div>
                    <button style={S.holeNavBtn} onClick={() => setActiveHole(Math.min(17,activeHole+1))}>›</button>
                  </div>

                  {/* Stroke stepper */}
                  <div style={S.bigStepper}>
                    <button style={S.bigStepBtn} onClick={() => changeStroke(-1)}>−</button>
                    <div style={S.bigStepCenter}>
                      <div style={S.bigStepVal}>{curPlayer.strokes[activeHole]}</div>
                      <div style={S.bigStepLabel}>golpes</div>
                    </div>
                    <button style={S.bigStepBtn} onClick={() => changeStroke(1)}>+</button>
                  </div>

                  {/* Net display */}
                  <div style={{ ...S.netBadge, background: curNet < curHole.par ? "rgba(74,222,128,.15)" : curNet > curHole.par ? "rgba(248,113,113,.15)" : "rgba(255,255,255,.06)" }}>
                    <span style={{ color: curNet < curHole.par ? "#4ade80" : curNet > curHole.par ? "#f87171" : "#94a3b8" }}>
                      Neto: {curNet} {curNet < curHole.par ? "▼" : curNet > curHole.par ? "▲" : "—"}
                    </span>
                  </div>

                  {/* Hole dots */}
                  <div style={S.holeDots}>
                    {holes.map((_,hi) => {
                      const g=strokesGranted(curPlayer.handicap,holes[hi].strokeIndex);
                      const n=curPlayer.strokes[hi]-g;
                      const col = n < holes[hi].par ? "#4ade80" : n > holes[hi].par ? "#f87171" : "#94a3b8";
                      return (
                        <button key={hi} style={{ ...S.holeDot, background: activeHole===hi ? col : "rgba(255,255,255,.08)", border: activeHole===hi ? `2px solid ${col}` : "2px solid transparent" }}
                          onClick={() => setActiveHole(hi)} />
                      );
                    })}
                  </div>
                </div>

                {/* Scorecard summary */}
                <div style={S.scoreSummary}>
                  {[["Ida",   curPlayer.strokes.slice(0,9).reduce((a,b)=>a+b,0)],
                    ["Vuelta", curPlayer.strokes.slice(9).reduce((a,b)=>a+b,0)],
                    ["Total",  curPlayer.strokes.reduce((a,b)=>a+b,0)],
                    ["Neto",   holes.reduce((s,h,i)=>s+netScoreHole(curPlayer.strokes[i],curPlayer.handicap,h.strokeIndex),0)],
                  ].map(([lbl,val]) => (
                    <div key={lbl} style={S.scoreChip}>
                      <div style={S.scoreChipLabel}>{lbl}</div>
                      <div style={S.scoreChipVal}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {errors.length > 0 && (
              <div style={S.errorBox}>{errors.map((e,i) => <div key={i}>⚠ {e}</div>)}</div>
            )}
            <div style={S.navRow}>
              <button style={S.ghostBtn} onClick={() => setStep(0)}>← Config</button>
              <button style={S.primaryBtn} onClick={calculate}>⛳ Calcular →</button>
            </div>
          </div>
        )}

        {/* ══════════════ STEP 2: RESULTS ══════════════ */}
        {step === 2 && results && (
          <div>
            <div style={S.pageTitle}>Resultados</div>

            {Object.entries(results.results)
              .sort((a,b) => b[1]-a[1])
              .map(([name, total]) => {
                const obl = results.oblFinal[name];
                const opt = results.optFinal[name];
                const isOpen = openResult === name;
                return (
                  <div key={name} style={{ ...S.resultCard, ...(total>=0?S.resultWin:S.resultLoss) }}
                    onClick={() => setOpenResult(isOpen ? null : name)}>
                    <div style={S.resultMain}>
                      <span style={S.resultName}>{name}</span>
                      <div style={S.resultRight}>
                        <span style={{ ...S.resultTotal, color: total>=0?"#4ade80":"#f87171" }}>
                          {total>=0?"+":""}{total.toFixed(2)}
                        </span>
                        <span style={S.resultChevron}>{isOpen?"▲":"▼"}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={S.resultBreakdown}>
                        <div style={S.resultBreakdownRow}>
                          <span style={S.bdLabel}>Apuestas obligatorias</span>
                          <span style={{ ...S.bdVal, color: obl>=0?"#4ade80":"#f87171" }}>{fmt(obl)}</span>
                        </div>
                        <div style={S.resultBreakdownRow}>
                          <span style={S.bdLabel}>Apuestas opcionales</span>
                          <span style={{ ...S.bdVal, color: opt>=0?"#4ade80":"#f87171" }}>{fmt(opt)}</span>
                        </div>
                        <div style={{ ...S.resultBreakdownRow, borderTop:"1px solid rgba(255,255,255,.1)", marginTop:6, paddingTop:6 }}>
                          <span style={S.bdLabel}>Total neto</span>
                          <span style={{ ...S.bdVal, color: total>=0?"#4ade80":"#f87171" }}>{fmt(total)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

            <div style={S.tipCard}>
              <span style={S.tipLabel}>🏌 Propina del staff</span>
              <span style={S.tipAmt}>${results.tipPool.toFixed(2)}</span>
            </div>

            <button style={S.ghostBtn} onClick={() => { setStep(0); setResults(null); setErrors([]); }}>← Nueva Ronda</button>
          </div>
        )}

        </div>
        )} {/* end !showSettings */}

      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  app: { minHeight:"100vh", background:"linear-gradient(160deg,#0a1f13 0%,#0d2b1a 60%,#0a1a10 100%)", fontFamily:"'Georgia',serif", color:"#e8f5e9", userSelect:"none" },
  topBar: { position:"sticky", top:0, zIndex:10, background:"rgba(0,0,0,.6)", backdropFilter:"blur(12px)", borderBottom:"1px solid rgba(74,222,128,.15)", padding:"12px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" },
  topLogo: { fontSize:15, fontWeight:"bold", color:"#4ade80", letterSpacing:1 },
  topSteps: { display:"flex", gap:6 },
  topStep: { width:28, height:28, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:"bold", background:"rgba(255,255,255,.07)", color:"#64748b", cursor:"default", border:"2px solid transparent" },
  topStepActive: { background:"rgba(74,222,128,.15)", color:"#4ade80", border:"2px solid #4ade80" },
  topStepDone: { background:"rgba(74,222,128,.25)", color:"#4ade80", cursor:"pointer", border:"2px solid rgba(74,222,128,.4)" },
  page: { padding:"20px 16px 40px", maxWidth:480, margin:"0 auto" },
  pageTitle: { fontSize:22, fontWeight:"bold", color:"#4ade80", marginBottom:20, letterSpacing:.5 },
  testBanner: { background:"rgba(74,222,128,.08)", border:"1px solid rgba(74,222,128,.25)", borderRadius:10, padding:"10px 14px", marginBottom:20, fontSize:13, color:"#4ade80" },
  section: { marginBottom:20 },
  sectionLabel: { fontSize:11, color:"#64748b", textTransform:"uppercase", letterSpacing:1.5, marginBottom:8, fontFamily:"sans-serif" },
  pills: { display:"flex", flexWrap:"wrap", gap:8 },
  pill: { padding:"10px 18px", borderRadius:24, border:"1px solid rgba(255,255,255,.12)", background:"rgba(255,255,255,.05)", color:"#94a3b8", fontSize:15, cursor:"pointer", fontFamily:"'Georgia',serif" },
  pillActive: { background:"#4ade80", color:"#0a1f13", border:"1px solid #4ade80", fontWeight:"bold" },
  stepper: { display:"flex", alignItems:"center", gap:0, background:"rgba(255,255,255,.06)", borderRadius:12, border:"1px solid rgba(255,255,255,.1)", overflow:"hidden", alignSelf:"flex-start", width:"fit-content" },
  stepBtn: { width:48, height:48, background:"transparent", border:"none", color:"#4ade80", fontSize:22, cursor:"pointer", fontWeight:"bold" },
  stepVal: { minWidth:48, textAlign:"center", fontSize:18, fontWeight:"bold", color:"#e8f5e9" },
  primaryBtn: { width:"100%", padding:"16px", background:"#4ade80", color:"#0a1f13", border:"none", borderRadius:14, fontSize:17, fontWeight:"bold", cursor:"pointer", letterSpacing:.5, marginTop:8 },
  ghostBtn: { padding:"14px 24px", background:"transparent", color:"#4ade80", border:"1px solid rgba(74,222,128,.4)", borderRadius:14, fontSize:15, cursor:"pointer" },
  navRow: { display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:24, gap:12 },
  playerCard: { background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:14, padding:16, marginBottom:16 },
  playerCardRow: { display:"flex", gap:16, marginBottom:12 },
  playerCardField: { flex:1 },
  textInput: { width:"100%", background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.15)", borderRadius:10, padding:"10px 14px", color:"#e8f5e9", fontSize:16, outline:"none", boxSizing:"border-box", fontFamily:"'Georgia',serif" },
  optChip: { padding:"6px 12px", borderRadius:20, border:"1px solid rgba(255,255,255,.15)", background:"transparent", color:"#64748b", fontSize:12, cursor:"pointer", fontFamily:"sans-serif", fontWeight:"bold" },
  optChipOn: { background:"rgba(251,191,36,.15)", color:"#fbbf24", border:"1px solid rgba(251,191,36,.5)" },
  holeNav: { background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:16, padding:20, marginBottom:16 },
  holeNavRow: { display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 },
  holeNavBtn: { width:44, height:44, borderRadius:"50%", border:"1px solid rgba(74,222,128,.3)", background:"rgba(74,222,128,.08)", color:"#4ade80", fontSize:22, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" },
  holeNavCenter: { textAlign:"center" },
  holeNavTitle: { fontSize:20, fontWeight:"bold", color:"#e8f5e9" },
  holeNavMeta: { fontSize:13, color:"#64748b", fontFamily:"sans-serif" },
  holeGranted: { textAlign:"center", color:"#fbbf24", fontSize:13, fontWeight:"bold", marginBottom:12, fontFamily:"sans-serif" },
  bigStepper: { display:"flex", alignItems:"center", justifyContent:"space-between", margin:"16px 0" },
  bigStepBtn: { width:72, height:72, borderRadius:16, border:"1px solid rgba(74,222,128,.3)", background:"rgba(74,222,128,.08)", color:"#4ade80", fontSize:36, cursor:"pointer", fontWeight:"bold", display:"flex", alignItems:"center", justifyContent:"center" },
  bigStepCenter: { textAlign:"center" },
  bigStepVal: { fontSize:52, fontWeight:"bold", color:"#e8f5e9", lineHeight:1 },
  bigStepLabel: { fontSize:12, color:"#64748b", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1 },
  netBadge: { borderRadius:10, padding:"10px 0", textAlign:"center", fontSize:16, fontWeight:"bold", marginBottom:16, fontFamily:"sans-serif" },
  holeDots: { display:"flex", gap:5, justifyContent:"center", flexWrap:"wrap" },
  holeDot: { width:14, height:14, borderRadius:"50%", cursor:"pointer", transition:"all .1s" },
  scoreSummary: { display:"flex", flexWrap:"wrap", gap:8, marginBottom:16 },
  scoreChip: { flex:"1 0 28%", background:"rgba(0,0,0,.3)", borderRadius:10, padding:"8px 10px", textAlign:"center", border:"1px solid rgba(255,255,255,.06)" },
  scoreChipLabel: { fontSize:9, color:"#64748b", textTransform:"uppercase", letterSpacing:1, fontFamily:"sans-serif" },
  scoreChipVal: { fontSize:18, fontWeight:"bold", color:"#e8f5e9" },
  betCard: { background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:14, padding:"14px 16px", marginBottom:10 },
  betCardHeader: { display:"flex", alignItems:"center", gap:10, marginBottom:10, flexWrap:"wrap" },
  betCardLabel: { flex:1, fontSize:15, color:"#e8f5e9", fontWeight:"bold" },
  toggleBtn: { padding:"4px 12px", borderRadius:20, border:"1px solid rgba(255,255,255,.2)", background:"transparent", color:"#64748b", fontSize:12, fontWeight:"bold", cursor:"pointer", fontFamily:"sans-serif" },
  toggleOn: { background:"rgba(74,222,128,.15)", color:"#4ade80", border:"1px solid rgba(74,222,128,.5)" },
  netPctRow: { display:"flex", alignItems:"center", gap:6 },
  betMeta: { fontSize:11, color:"#64748b", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1 },
  segAmts: { display:"flex", gap:12, flexWrap:"wrap" },
  segAmt: { display:"flex", flexDirection:"column", gap:4 },
  miniStepper: { display:"flex", alignItems:"center", background:"rgba(0,0,0,.3)", borderRadius:8, overflow:"hidden", border:"1px solid rgba(255,255,255,.08)" },
  miniBtn: { width:32, height:32, background:"transparent", border:"none", color:"#4ade80", fontSize:16, cursor:"pointer", fontWeight:"bold", fontFamily:"sans-serif" },
  miniVal: { minWidth:36, textAlign:"center", fontSize:13, fontWeight:"bold", color:"#e8f5e9", fontFamily:"sans-serif" },
  betNote: { fontSize:12, color:"#64748b", marginBottom:12, fontFamily:"sans-serif", lineHeight:1.5 },
  errorBox: { background:"rgba(248,113,113,.1)", border:"1px solid rgba(248,113,113,.3)", borderRadius:10, padding:14, marginBottom:16, fontSize:13, color:"#f87171", lineHeight:1.8, fontFamily:"sans-serif" },
  resultCard: { borderRadius:14, padding:16, marginBottom:10, cursor:"pointer", border:"1px solid transparent" },
  resultWin: { background:"rgba(74,222,128,.07)", border:"1px solid rgba(74,222,128,.2)" },
  resultLoss: { background:"rgba(248,113,113,.06)", border:"1px solid rgba(248,113,113,.15)" },
  resultMain: { display:"flex", alignItems:"center", justifyContent:"space-between" },
  resultName: { fontSize:17, fontWeight:"bold", color:"#e8f5e9" },
  resultRight: { display:"flex", alignItems:"center", gap:10 },
  resultTotal: { fontSize:22, fontWeight:"bold" },
  resultChevron: { fontSize:12, color:"#64748b" },
  resultBreakdown: { marginTop:14, paddingTop:14, borderTop:"1px solid rgba(255,255,255,.07)" },
  resultBreakdownRow: { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 },
  bdLabel: { fontSize:13, color:"#94a3b8", fontFamily:"sans-serif" },
  bdVal: { fontSize:15, fontWeight:"bold", fontFamily:"sans-serif" },
  tipCard: { background:"rgba(251,191,36,.08)", border:"1px solid rgba(251,191,36,.25)", borderRadius:14, padding:"16px 20px", marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"center" },
  tipLabel: { fontSize:15, color:"#fbbf24" },
  tipAmt: { fontSize:22, fontWeight:"bold", color:"#fbbf24" },
  gearBtn: { width:36, height:36, borderRadius:"50%", border:"1px solid rgba(255,255,255,.15)", background:"rgba(255,255,255,.06)", color:"#94a3b8", fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" },
  gearBtnActive: { background:"rgba(74,222,128,.15)", color:"#4ade80", border:"1px solid rgba(74,222,128,.5)" },
  expandBtn: { width:"100%", padding:"12px 16px", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.1)", borderRadius:12, color:"#94a3b8", fontSize:14, cursor:"pointer", textAlign:"left", fontFamily:"'Georgia',serif" },
  courseEditor: { marginTop:10, background:"rgba(0,0,0,.2)", borderRadius:12, padding:16, border:"1px solid rgba(255,255,255,.06)" },
  courseEditorGrid: { display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14 },
  courseHoleCell: { display:"flex", flexDirection:"column", alignItems:"center", gap:6 },
  courseHoleNum: { fontSize:11, color:"#64748b", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1 },
  resetBtn: { width:"100%", padding:"10px", background:"transparent", border:"1px solid rgba(248,113,113,.3)", borderRadius:10, color:"#f87171", fontSize:13, cursor:"pointer", fontFamily:"'Georgia',serif" },
};
