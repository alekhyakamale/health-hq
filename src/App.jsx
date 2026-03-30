import { useState, useEffect, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const USDA_KEY = "DEMO_KEY";

const THEME = {
  bg: "#0f0e1a", card: "#18152e", card2: "#201c38", border: "#2a2448",
  text: "#e8e0f5", muted: "#7c6fa0", dim: "#4a4270",
  purple: "#c084fc", blue: "#38bdf8", green: "#4ade80",
  orange: "#f97316", yellow: "#fbbf24", pink: "#f472b6", red: "#f87171",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getTodayKey = () => new Date().toISOString().slice(0, 10);
const getWeekKey = () => {
  const d = new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const y = new Date(d.getFullYear(), 0, 4);
  return `${d.getFullYear()}-W${String(1 + Math.round(((d-y)/864e5 - 3 + (y.getDay()+6)%7)/7)).padStart(2,"0")}`;
};

const store = {
  async get(key) {
    try { const r = await window.storage.get(key); return r?.value ? JSON.parse(r.value) : null; }
    catch { return null; }
  },
  async set(key, val) {
    try { await window.storage.set(key, JSON.stringify(val)); return true; }
    catch { return false; }
  },
};

async function callClaude(prompt, system = "") {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const d = await res.json();
  return d.content?.find(b => b.type === "text")?.text || "";
}

async function searchFood(query) {
  // USDA first
  try {
    const r = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&api_key=${USDA_KEY}&pageSize=6`
    );
    const d = await r.json();
    const foods = (d.foods || []).map(f => {
      const get = name => (f.foodNutrients||[]).find(n => n.nutrientName?.toLowerCase().includes(name))?.value || 0;
      return { name: f.description, cal: Math.round(get("energy")), protein: +get("protein").toFixed(1), fiber: +get("fiber").toFixed(1) };
    }).filter(f => f.cal > 0).slice(0, 5);
    if (foods.length) return { source: "usda", foods };
  } catch {}
  // Claude fallback
  try {
    const text = await callClaude(
      `Nutrition per 100g for "${query}". Reply ONLY with a JSON array, max 3 items: [{"name":"...","cal":number,"protein":number,"fiber":number}]. No markdown, no explanation.`
    );
    const clean = text.replace(/```json|```/g, "").trim();
    return { source: "claude", foods: JSON.parse(clean) };
  } catch {}
  return { source: "none", foods: [] };
}

// ─── Calculations ─────────────────────────────────────────────────────────────
function calcTargets(p) {
  const bmr = p.sex === "male"
    ? 10*p.weightKg + 6.25*p.heightCm - 5*p.age + 5
    : 10*p.weightKg + 6.25*p.heightCm - 5*p.age - 161;
  const mult = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725 }[p.lifestyle] || 1.2;
  const tdee = Math.round(bmr * mult);
  const diff = p.weightKg - (p.targetWeightKg || p.weightKg);
  const deficit = diff <= 0 ? 0 : diff <= 5 ? 300 : 500;
  const calories = Math.max(1200, Math.round(tdee - deficit));
  const protein = Math.round(p.weightKg * (p.goalType === "build" ? 2.0 : 1.8));
  const fiber = p.sex === "female" ? 25 : 30;
  const waterGlasses = Math.round(p.weightKg * 0.033 / 0.25);
  return { bmr: Math.round(bmr), tdee, calories, protein, fiber, waterGlasses };
}

// ─── Workout Builder ──────────────────────────────────────────────────────────
function buildPlan(p) {
  const { facilities=[], strengthDays=3, sex } = p;
  const gym = facilities.includes("gym");
  const pool = facilities.includes("pool");
  const badminton = facilities.includes("badminton");

  const slots = { 2:["Monday","Thursday"], 3:["Monday","Wednesday","Friday"],
    4:["Monday","Tuesday","Thursday","Friday"], 5:["Monday","Tuesday","Wednesday","Friday","Saturday"] }[strengthDays] || ["Monday","Wednesday","Friday"];

  const templates = [
    { label:"Gym — Lower Body", icon:"🏋️", tag:"Strength", color:THEME.purple, duration:"55–60 min",
      warmup:["March in place — 2 min","Leg swings front-back — 10 each leg","Hip circles — 10 each direction","Bodyweight squats — 10 reps","Glute bridge bodyweight — 10 reps"],
      exercises:[
        {name:"Leg Press — 3×12",weight:30,unit:"kg"},{name:"Leg Curl Machine — 3×12",weight:15,unit:"kg"},
        {name:"Hip Abductor Machine — 3×15",weight:15,unit:"kg"},{name:"Calf Raises — 3×15",weight:20,unit:"kg"},
        {name:"Glute Bridge weighted — 3×15",weight:10,unit:"kg"},{name:"Plank — 3×20 sec",weight:null,unit:null},
      ],
      cooldown:["Quad stretch standing — 30 sec each leg","Hamstring stretch seated — 30 sec each leg","Hip flexor lunge — 30 sec each side","Calf stretch wall — 30 sec each leg","Glute figure-4 — 30 sec each side"],
      notes:"Biggest muscle group = biggest calorie burn. Rest 90s between sets. Keep gym cool." },
    { label:"Gym — Upper Body", icon:"💪", tag:"Strength", color:THEME.purple, duration:"55–60 min",
      warmup:["Arm circles — 10 each direction","Shoulder rolls — 10 each direction","Cat-cow stretch — 8 reps","Chest opener hands clasped behind back — 20 sec × 2","Band pull-apart or bodyweight — 12 reps"],
      exercises:[
        {name:"Lat Pulldown — 3×12",weight:15,unit:"kg"},{name:"Seated Cable Row — 3×12",weight:15,unit:"kg"},
        {name:"Chest Press Machine — 3×12",weight:10,unit:"kg"},{name:"Shoulder Press Machine — 3×10",weight:8,unit:"kg"},
        {name:"Bicep Curl DB — 3×12",weight:4,unit:"kg"},{name:"Tricep Pushdown — 3×12",weight:8,unit:"kg"},
      ],
      cooldown:["Cross-body shoulder stretch — 30 sec each","Tricep overhead stretch — 30 sec each","Doorway chest stretch — 30 sec","Child's pose — 45 sec","Neck side tilt — 20 sec each"],
      notes:"Form over weight. Squeeze at the top of every rep." },
    { label:"Gym — Full Body + Core", icon:"🔥", tag:"Strength", color:THEME.purple, duration:"55 min",
      warmup:["March in place — 2 min","Leg swings — 10 each leg","Arm circles — 10 each direction","Cat-cow — 8 reps","Hip rotations — 10 each direction"],
      exercises:[
        {name:"Leg Press — 2×12",weight:30,unit:"kg"},{name:"Lat Pulldown — 2×12",weight:15,unit:"kg"},
        {name:"Chest Press Machine — 2×12",weight:10,unit:"kg"},{name:"Seated Row — 2×12",weight:15,unit:"kg"},
        {name:"Dead Bug — 3×8 each side",weight:null,unit:null},{name:"Bird Dog — 3×8 each side",weight:null,unit:null},
        {name:"Side Plank — 2×20 sec each side",weight:null,unit:null},
      ],
      cooldown:["Child's pose — 45 sec","Supine twist lying — 30 sec each side","Quad stretch — 30 sec each","Hamstring stretch — 30 sec each","Chest opener — 30 sec"],
      notes:"Lower volume ties the week together. Core work is essential for stability." },
    { label:"Gym — Push Day", icon:"🏋️", tag:"Strength", color:THEME.purple, duration:"55 min",
      warmup:["Arm circles — 10 each","Shoulder rotations — 10 each","Band pull-apart — 12 reps","Cat-cow — 8 reps"],
      exercises:[
        {name:"Chest Press Machine — 4×10",weight:12,unit:"kg"},{name:"Shoulder Press Machine — 4×10",weight:10,unit:"kg"},
        {name:"Chest Fly Machine — 3×12",weight:8,unit:"kg"},{name:"Lateral Raise DB — 3×12",weight:3,unit:"kg"},
        {name:"Tricep Pushdown — 3×12",weight:8,unit:"kg"},{name:"Overhead Tricep Extension — 3×12",weight:6,unit:"kg"},
      ],
      cooldown:["Chest stretch doorway — 30 sec","Tricep stretch — 30 sec each","Shoulder cross-body — 30 sec each","Child's pose — 45 sec"],
      notes:"Push days build chest, shoulders, triceps. Don't skip the chest stretch after." },
    { label:"Gym — Pull Day", icon:"💪", tag:"Strength", color:THEME.purple, duration:"55 min",
      warmup:["Arm circles — 10 each","Cat-cow — 8 reps","Shoulder rolls — 10 each","Light row warm-up — 12 reps"],
      exercises:[
        {name:"Lat Pulldown — 4×10",weight:17,unit:"kg"},{name:"Seated Cable Row — 4×10",weight:17,unit:"kg"},
        {name:"Face Pull — 3×15",weight:8,unit:"kg"},{name:"Bicep Curl DB — 3×12",weight:5,unit:"kg"},
        {name:"Hammer Curl — 3×12",weight:4,unit:"kg"},
      ],
      cooldown:["Lat stretch overhead — 30 sec each","Bicep wall stretch — 30 sec each","Upper back child's pose — 45 sec","Neck side tilt — 20 sec each"],
      notes:"Pull days build back and biceps. Focus on squeezing shoulder blades together." },
  ];

  const strengthTemplates = templates.slice(0, Math.min(strengthDays, 3));

  const poolDay = {
    label:"Pool Session", icon:"🏊", tag:"Low Impact", color:THEME.blue, duration:"40 min",
    warmup:["Arm circles dry land — 10 each","Shoulder rolls — 10 each","Ankle rotations — 10 each","Slow acclimatisation walk into pool — 2 min"],
    exercises:[
      {name:"Water walking — 10 min",weight:null,unit:null},{name:"Freestyle swim — 15 min",weight:null,unit:null},
      {name:"Kickboard drill legs — 5 min",weight:null,unit:null},{name:"Pull buoy drill arms — 5 min",weight:null,unit:null},
    ],
    cooldown:["Slow float on back — 2 min","Poolside chest stretch — 30 sec","Cross-body shoulder stretch — 30 sec each","Hip flexor stretch — 30 sec each"],
    notes:"Zero joint impact. Cool water reduces fatigue and inflammation. Great for recovery.",
  };

  const cardioDay = {
    label: badminton ? "Walk + Badminton" : "Walk + Light Jog",
    icon: badminton ? "🏸" : "🚶", tag:"Cardio", color:THEME.yellow, duration:"50 min",
    warmup:["Slow walk building pace — 5 min","Ankle rolls — 10 each","Hip circles — 10 each","Arm swings — 10 reps"],
    exercises:[
      {name:"Brisk walk — 20 min",weight:null,unit:null},
      {name: badminton ? "Casual badminton — 25 min" : "Light jog / walk — 25 min",weight:null,unit:null},
    ],
    cooldown:["Slow walk cool-down — 3 min","Quad stretch — 30 sec each","Calf stretch — 30 sec each","Shoulder stretch cross-body — 30 sec each"],
    notes:"Active recovery. Builds cardiovascular fitness without taxing your muscles.",
  };

  const activeRecovery = {
    label: pool ? "Pool or Long Walk" : "Active Recovery Walk",
    icon:"🌊", tag:"Active Recovery", color:THEME.blue, duration:"35–40 min",
    warmup:["Gentle shoulder rolls — 10 each","Hip circles — 10 each","Slow walk in — 3 min"],
    exercises:[
      {name: pool ? "Pool session — 25 min OR" : "Long walk — 35 min",weight:null,unit:null},
      {name:"Long walk — 35–40 min",weight:null,unit:null},
    ],
    cooldown:["Full body gentle stretch — 10 min","Hip flexor stretch — 30 sec each","Calf stretch — 30 sec each"],
    notes:"Low intensity. Let your body recover and rebuild from the week.",
  };

  const restDay = {
    label:"Full Rest", icon:"🛋️", tag:"Rest", color:THEME.pink, duration:"0 min",
    warmup:[], exercises:[{name:"Complete rest",weight:null,unit:null},{name:"Light stretching if desired",weight:null,unit:null}], cooldown:[],
    notes:"Recovery is where muscle is actually built. This day is not optional.",
  };

  return DAYS.map(day => {
    const sIdx = slots.indexOf(day);
    if (sIdx !== -1) return { day, ...strengthTemplates[sIdx % strengthTemplates.length] };
    if (day === "Sunday") return { day, ...restDay };
    if (pool && (day === "Tuesday" || day === "Saturday")) return { day, ...poolDay };
    if (day === "Saturday") return { day, ...activeRecovery };
    return { day, ...cardioDay };
  });
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
function ProgressRing({ value, max, color, size=56 }) {
  const r = (size-8)/2, circ = 2*Math.PI*r;
  const pct = Math.min(value/max, 1);
  return (
    <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#2a2448" strokeWidth={5} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={circ} strokeDashoffset={circ*(1-pct)} strokeLinecap="round"
        style={{ transition:"stroke-dashoffset 0.5s ease" }} />
    </svg>
  );
}

function Bar({ value, max, color }) {
  return (
    <div style={{ background:"#1e1a2e", borderRadius:999, height:7, overflow:"hidden" }}>
      <div style={{ width:`${Math.min((value/max)*100,100)}%`, height:"100%", background:color, borderRadius:999, transition:"width 0.4s" }} />
    </div>
  );
}

function MacroRing({ label, value, target, unit, color, icon }) {
  const pct = Math.min(Math.round((value/target)*100),100);
  return (
    <div style={{ background:THEME.card, borderRadius:16, padding:"14px 12px", border:`1px solid ${color}25`, display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
      <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <ProgressRing value={value} max={target} color={color} size={60} />
        <div style={{ position:"absolute", fontSize:11, fontWeight:800, color, fontFamily:"monospace" }}>{pct}%</div>
      </div>
      <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"monospace", lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:10, color:THEME.muted }}>/{target}{unit}</div>
      <div style={{ fontSize:11, color:THEME.muted }}>{icon} {label}</div>
    </div>
  );
}

function Inp({ label, value, onChange, placeholder, type="text", style={} }) {
  return (
    <div style={style}>
      {label && <div style={{ fontSize:12, color:THEME.muted, marginBottom:6, fontWeight:600 }}>{label}</div>}
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{ width:"100%", boxSizing:"border-box", background:THEME.bg, border:`1px solid ${THEME.border}`, borderRadius:10, padding:"11px 14px", color:THEME.text, fontSize:14, outline:"none", fontFamily:"inherit" }} />
    </div>
  );
}

function Chip({ label, selected, onClick, color=THEME.purple }) {
  return (
    <button onClick={onClick} style={{ padding:"8px 14px", borderRadius:999, border:`1px solid ${selected?color:THEME.border}`, background:selected?`${color}22`:THEME.bg, color:selected?color:THEME.muted, fontWeight:selected?700:400, fontSize:13, cursor:"pointer", transition:"all 0.2s", fontFamily:"inherit" }}>
      {label}
    </button>
  );
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState({
    name:"", sex:"", age:"", heightFt:"", heightIn:"", heightCm:"",
    weightKg:"", targetWeightKg:"", lifestyle:"", goalType:"",
    strengthDays:3, facilities:[], conditions:[], celeb:"",
  });
  const up = (k,v) => setD(x=>({...x,[k]:v}));
  const tog = (k,v) => setD(x=>({...x,[k]:x[k].includes(v)?x[k].filter(i=>i!==v):[...x[k],v]}));

  const steps = [
    {
      title:"Let's get started 👋",
      sub:"We'll build a personalised plan just for you",
      valid: d.name && d.sex && d.age,
      body:(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <Inp label="Your name" value={d.name} onChange={v=>up("name",v)} placeholder="e.g. Rahul" />
          <div>
            <div style={{fontSize:12,color:THEME.muted,marginBottom:8,fontWeight:600}}>Biological sex</div>
            <div style={{display:"flex",gap:8}}>
              {["female","male"].map(s=>(
                <button key={s} onClick={()=>up("sex",s)} style={{flex:1,padding:12,borderRadius:12,border:`1.5px solid ${d.sex===s?THEME.purple:THEME.border}`,background:d.sex===s?`${THEME.purple}18`:THEME.bg,color:d.sex===s?THEME.purple:THEME.muted,fontWeight:d.sex===s?700:400,cursor:"pointer",fontSize:14,textTransform:"capitalize",transition:"all 0.2s",fontFamily:"inherit"}}>{s==="female"?"♀ Female":"♂ Male"}</button>
              ))}
            </div>
          </div>
          <Inp label="Age" value={d.age} onChange={v=>up("age",v)} placeholder="e.g. 28" type="number" />
        </div>
      ),
    },
    {
      title:"Body metrics 📏",
      sub:"Used to calculate your personalised calorie & protein targets",
      valid: (d.heightFt||d.heightCm) && d.weightKg && d.targetWeightKg,
      body:(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div>
            <div style={{fontSize:12,color:THEME.muted,marginBottom:8,fontWeight:600}}>Height</div>
            <div style={{display:"flex",gap:8,marginBottom:6}}>
              <Inp label="Feet" value={d.heightFt} onChange={v=>up("heightFt",v)} placeholder="5" type="number" style={{flex:1}} />
              <Inp label="Inches" value={d.heightIn} onChange={v=>up("heightIn",v)} placeholder="4" type="number" style={{flex:1}} />
            </div>
            <div style={{fontSize:11,color:THEME.dim,marginBottom:6}}>— or enter in centimetres —</div>
            <Inp label="" value={d.heightCm} onChange={v=>up("heightCm",v)} placeholder="162 cm" type="number" />
          </div>
          <Inp label="Current weight (kg)" value={d.weightKg} onChange={v=>up("weightKg",v)} placeholder="e.g. 70" type="number" />
          <Inp label="Target weight (kg)" value={d.targetWeightKg} onChange={v=>up("targetWeightKg",v)} placeholder="e.g. 63" type="number" />
        </div>
      ),
    },
    {
      title:"Your lifestyle 🧘",
      sub:"This determines your daily calorie burn",
      valid: d.lifestyle,
      body:(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[
            ["sedentary","🪑 Sedentary","Desk job, minimal movement outside exercise"],
            ["light","🚶 Lightly Active","Walk occasionally, some daily activity"],
            ["moderate","🚴 Moderately Active","Exercise 3–4x per week"],
            ["active","🏃 Very Active","Daily intense exercise or physical job"],
          ].map(([val,label,desc])=>(
            <button key={val} onClick={()=>up("lifestyle",val)} style={{padding:"13px 14px",borderRadius:12,border:`1.5px solid ${d.lifestyle===val?THEME.purple:THEME.border}`,background:d.lifestyle===val?`${THEME.purple}15`:THEME.bg,cursor:"pointer",textAlign:"left",transition:"all 0.2s",fontFamily:"inherit"}}>
              <div style={{fontWeight:d.lifestyle===val?700:500,fontSize:14,color:d.lifestyle===val?THEME.purple:THEME.text}}>{label}</div>
              <div style={{fontSize:12,color:THEME.muted,marginTop:3}}>{desc}</div>
            </button>
          ))}
        </div>
      ),
    },
    {
      title:"Your goal 🎯",
      sub:"What are you primarily working towards?",
      valid: d.goalType,
      body:(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[
            ["lose","📉 Lose weight","Calorie deficit — scale goes down"],
            ["build","💪 Build muscle","Strength & protein focus — scale may not move much"],
            ["recomp","⚖️ Recomposition","Lose fat AND build muscle simultaneously — takes longer but very rewarding"],
          ].map(([val,label,desc])=>(
            <button key={val} onClick={()=>up("goalType",val)} style={{padding:"13px 14px",borderRadius:12,border:`1.5px solid ${d.goalType===val?THEME.purple:THEME.border}`,background:d.goalType===val?`${THEME.purple}15`:THEME.bg,cursor:"pointer",textAlign:"left",transition:"all 0.2s",fontFamily:"inherit"}}>
              <div style={{fontWeight:d.goalType===val?700:500,fontSize:14,color:d.goalType===val?THEME.purple:THEME.text}}>{label}</div>
              <div style={{fontSize:12,color:THEME.muted,marginTop:3}}>{desc}</div>
            </button>
          ))}
        </div>
      ),
    },
    {
      title:"Available facilities 🏗",
      sub:"Select everything you have access to — we'll tailor workouts to match",
      valid: d.facilities.length > 0,
      body:(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[
            ["gym","🏋️ Gym","Machines, dumbbells, cables"],
            ["pool","🏊 Swimming pool","Lap swimming available"],
            ["badminton","🏸 Badminton court","Racquet sport access"],
            ["walking","🚶 Walking / running area","Outdoor paths or track"],
          ].map(([val,label,desc])=>{
            const sel = d.facilities.includes(val);
            return (
              <button key={val} onClick={()=>tog("facilities",val)} style={{padding:"13px 14px",borderRadius:12,border:`1.5px solid ${sel?THEME.purple:THEME.border}`,background:sel?`${THEME.purple}15`:THEME.bg,cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center",transition:"all 0.2s",fontFamily:"inherit"}}>
                <div>
                  <div style={{fontWeight:sel?700:500,fontSize:14,color:sel?THEME.purple:THEME.text}}>{label}</div>
                  <div style={{fontSize:12,color:THEME.muted,marginTop:3}}>{desc}</div>
                </div>
                <div style={{width:20,height:20,borderRadius:6,border:`2px solid ${sel?THEME.purple:THEME.dim}`,background:sel?THEME.purple:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.2s"}}>
                  {sel&&<span style={{fontSize:11,color:"#1a0d2e",fontWeight:900}}>✓</span>}
                </div>
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title:"Strength training 💪",
      sub:"How many gym strength sessions per week?",
      valid: true,
      body:(
        <div>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            {[2,3,4,5].map(n=>(
              <button key={n} onClick={()=>up("strengthDays",n)} style={{flex:1,padding:"16px 0",borderRadius:14,border:`1.5px solid ${d.strengthDays===n?THEME.purple:THEME.border}`,background:d.strengthDays===n?`${THEME.purple}22`:THEME.bg,color:d.strengthDays===n?THEME.purple:THEME.muted,fontWeight:800,fontSize:22,cursor:"pointer",transition:"all 0.2s"}}>
                {n}
              </button>
            ))}
          </div>
          <div style={{background:THEME.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${THEME.border}`}}>
            <div style={{fontSize:13,color:THEME.text,fontWeight:600,marginBottom:4}}>
              {d.strengthDays===2?"2 days — Perfect for beginners":d.strengthDays===3?"3 days — The sweet spot for most people":d.strengthDays===4?"4 days — Intermediate level":d.strengthDays===5?"5 days — Advanced, ensure proper recovery":null}
            </div>
            <div style={{fontSize:12,color:THEME.muted}}>
              {d.strengthDays<=2?"Great foundation. Your tendons need time to adapt before you increase.":d.strengthDays===3?"Mon/Wed/Fri split. Enough stimulus with enough recovery.":d.strengthDays===4?"Push/pull or upper/lower split. Make sure you're eating enough protein.":"Only sustainable if you've been training consistently for 3+ months."}
            </div>
          </div>
        </div>
      ),
    },
    {
      title:"Any health conditions? 🏥",
      sub:"Optional but important — helps us give safer, smarter advice",
      valid: true,
      body:(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[
            ["ms","Multiple Sclerosis"],["rls","Restless Legs Syndrome"],
            ["diabetes","Diabetes / Pre-diabetes"],["hypertension","High Blood Pressure"],
            ["thyroid","Thyroid condition"],["pcos","PCOS"],
            ["arthritis","Arthritis / Joint issues"],["asthma","Asthma"],
            ["heartcondition","Heart condition"],["other","Other chronic condition"],
          ].map(([val,label])=>{
            const sel = d.conditions.includes(val);
            return (
              <button key={val} onClick={()=>tog("conditions",val)} style={{padding:"11px 14px",borderRadius:10,border:`1.5px solid ${sel?THEME.yellow:THEME.border}`,background:sel?`${THEME.yellow}12`:THEME.bg,cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",transition:"all 0.2s",fontFamily:"inherit"}}>
                <span style={{fontSize:13,color:sel?THEME.yellow:THEME.text,fontWeight:sel?700:400}}>{label}</span>
                {sel&&<span style={{color:THEME.yellow,fontWeight:700}}>✓</span>}
              </button>
            );
          })}
          <div style={{fontSize:11,color:THEME.dim,textAlign:"center",marginTop:4}}>Select all that apply, or tap Continue to skip</div>
        </div>
      ),
    },
    {
      title:"Celebrity body goal ⭐",
      sub:"Optional — name someone whose physique you admire and we'll tailor the approach",
      valid: true,
      body:(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <Inp label="Celebrity or athlete" value={d.celeb} onChange={v=>up("celeb",v)} placeholder="e.g. Hrithik Roshan, Deepika Padukone..." />
          <div style={{background:THEME.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${THEME.border}`}}>
            <div style={{fontSize:12,color:THEME.muted,lineHeight:1.6}}>
              We'll interpret their known fitness approach — e.g. "Hrithik Roshan" → lean muscular, high protein, functional training emphasis. Your plan targets and tips will adjust accordingly.
            </div>
          </div>
          <div style={{background:`${THEME.purple}12`,borderRadius:12,padding:"12px 14px",border:`1px solid ${THEME.purple}30`}}>
            <div style={{fontSize:12,color:THEME.muted}}>🎉 You're almost done! Hit "Generate My Plan" to get your personalised workout schedule, calorie targets, and tips.</div>
          </div>
        </div>
      ),
    },
  ];

  const cur = steps[step];

  return (
    <div style={{minHeight:"100vh",background:THEME.bg,color:THEME.text,fontFamily:"system-ui,sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Lora:wght@600;700&display=swap" rel="stylesheet" />
      {/* Progress */}
      <div style={{height:3,background:THEME.border}}>
        <div style={{height:"100%",background:THEME.purple,width:`${((step+1)/steps.length)*100}%`,transition:"width 0.3s ease"}} />
      </div>
      <div style={{padding:"28px 20px 110px",maxWidth:480,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <div style={{fontSize:11,color:THEME.muted,fontWeight:600}}>Step {step+1} of {steps.length}</div>
          <div style={{display:"flex",gap:4}}>
            {steps.map((_,i)=>(
              <div key={i} style={{width:i===step?20:6,height:6,borderRadius:999,background:i<=step?THEME.purple:THEME.border,transition:"all 0.3s"}} />
            ))}
          </div>
        </div>
        <h2 style={{margin:"0 0 6px",fontSize:22,fontFamily:"Lora,serif",fontWeight:700,color:"#fff",lineHeight:1.2}}>{cur.title}</h2>
        <p style={{margin:"0 0 24px",fontSize:13,color:THEME.muted,lineHeight:1.5}}>{cur.sub}</p>
        {cur.body}
      </div>
      <div style={{position:"fixed",bottom:0,left:0,right:0,padding:"12px 20px 24px",background:`${THEME.bg}ee`,backdropFilter:"blur(8px)",borderTop:`1px solid ${THEME.border}`,display:"flex",gap:10}}>
        {step>0&&<button onClick={()=>setStep(s=>s-1)} style={{flex:1,padding:14,background:THEME.card,border:`1px solid ${THEME.border}`,color:THEME.text,borderRadius:14,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>}
        <button onClick={()=>{
          if(step===steps.length-1){
            const hCm = d.heightCm ? Number(d.heightCm) : Math.round(Number(d.heightFt)*30.48 + Number(d.heightIn||0)*2.54);
            onComplete({...d,heightCm:hCm,weightKg:Number(d.weightKg),targetWeightKg:Number(d.targetWeightKg),age:Number(d.age),strengthDays:Number(d.strengthDays)});
          } else { setStep(s=>s+1); }
        }} disabled={!cur.valid} style={{flex:2,padding:14,background:cur.valid?THEME.purple:THEME.border,border:"none",color:cur.valid?"#1a0d2e":THEME.dim,borderRadius:14,fontSize:15,fontWeight:700,cursor:cur.valid?"pointer":"default",transition:"all 0.2s",fontFamily:"inherit"}}>
          {step===steps.length-1?"✨ Generate My Plan →":"Continue →"}
        </button>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("loading");
  const [profile, setProfile] = useState(null);
  const [plan, setPlan] = useState(null);
  const [targets, setTargets] = useState(null);
  const [aiTips, setAiTips] = useState("");
  const [tab, setTab] = useState("today");
  const [meals, setMeals] = useState([]);
  const [water, setWater] = useState(0);
  const [checked, setChecked] = useState({});
  const [weights, setWeights] = useState({});
  const [selectedDay, setSelectedDay] = useState(DAYS[new Date().getDay()===0?6:new Date().getDay()-1]);
  const [foodQuery, setFoodQuery] = useState("");
  const [foodResults, setFoodResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selFood, setSelFood] = useState(null);
  const [grams, setGrams] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [genMsg, setGenMsg] = useState("Building your plan...");

  const todayKey = getTodayKey();
  const weekKey = getWeekKey();

  // Load
  useEffect(()=>{
    async function init() {
      const [prof,pl,tgt,tips,ms,wt,chk,wgs] = await Promise.all([
        store.get("profile"),store.get("plan"),store.get("targets"),store.get("aiTips"),
        store.get(`meals:${todayKey}`),store.get(`water:${todayKey}`),
        store.get(`checked:${weekKey}`),store.get("weights"),
      ]);
      if(prof){ setProfile(prof); if(pl)setPlan(pl); if(tgt)setTargets(tgt); if(tips)setAiTips(tips);
        if(ms)setMeals(ms); if(wt)setWater(wt); if(chk)setChecked(chk); if(wgs)setWeights(wgs);
        setScreen("dashboard");
      } else { setScreen("onboarding"); }
    }
    init();
  },[]);

  // Persist
  useEffect(()=>{ if(screen!=="dashboard")return; store.set(`meals:${todayKey}`,meals).then(ok=>{ setSaveStatus(ok?"✓":"⚠"); setTimeout(()=>setSaveStatus(""),1500); }); },[meals]);
  useEffect(()=>{ if(screen==="dashboard")store.set(`water:${todayKey}`,water); },[water]);
  useEffect(()=>{ if(screen==="dashboard")store.set(`checked:${weekKey}`,checked); },[checked]);
  useEffect(()=>{ if(screen==="dashboard")store.set("weights",weights); },[weights]);

  const onboard = async (prof) => {
    setScreen("generating");
    const msgs = ["Calculating your calorie targets...","Building your workout schedule...","Fetching personalised tips...","Almost ready..."];
    let i=0; const iv = setInterval(()=>{ setGenMsg(msgs[Math.min(++i,msgs.length-1)]); },1800);
    try {
      const t = calcTargets(prof);
      const workoutPlan = buildPlan(prof);
      const defWeights = {};
      workoutPlan.forEach(day=>day.exercises.forEach((ex,i)=>{ if(ex.weight!==null) defWeights[`${day.day}-e-${i}`]=ex.weight; }));
      // Claude tips
      let tips = "";
      try {
        const condStr = prof.conditions?.length ? prof.conditions.join(", ") : "none";
        const celebStr = prof.celeb ? `Their celebrity physique goal is ${prof.celeb}.` : "";
        tips = await callClaude(
          `Person: ${prof.sex}, ${prof.age}yo, ${prof.weightKg}kg → target ${prof.targetWeightKg}kg. Goal: ${prof.goalType}. Conditions: ${condStr}. ${celebStr} Facilities: ${prof.facilities?.join(", ")}. Give exactly 3 numbered personalised tips (1-2 sentences each). Be specific, practical, direct. No fluff.`,
          "You are an expert personal trainer and nutritionist. Be direct, specific, and practical."
        );
      } catch{}
      clearInterval(iv);
      await Promise.all([store.set("profile",prof),store.set("plan",workoutPlan),store.set("targets",t),store.set("aiTips",tips),store.set("weights",defWeights)]);
      setProfile(prof); setPlan(workoutPlan); setTargets(t); setAiTips(tips); setWeights(defWeights);
      setScreen("dashboard");
    } catch(e){ clearInterval(iv); setScreen("onboarding"); }
  };

  const toggleCheck = (day,key) => setChecked(p=>({...p,[weekKey]:{...(p[weekKey]||{}),[day]:{...((p[weekKey]||{})[day]||{}),[key]:!((p[weekKey]||{})[day]||{})[key]}}}));
  const isDone = (day,key) => !!((checked[weekKey]||{})[day]||{})[key];
  const totals = meals.reduce((a,m)=>({cal:a.cal+m.cal,protein:a.protein+m.protein,fiber:a.fiber+m.fiber}),{cal:0,protein:0,fiber:0});

  // Food search debounce
  const doSearch = useCallback(async(q)=>{
    if(q.length<2){setFoodResults([]);return;}
    setSearching(true);
    const {foods}=await searchFood(q);
    setFoodResults(foods);
    setSearching(false);
  },[]);
  useEffect(()=>{ const t=setTimeout(()=>doSearch(foodQuery),600); return()=>clearTimeout(t); },[foodQuery]);

  const logMeal = () => {
    if(!selFood||!grams||Number(grams)<=0)return;
    const g=Number(grams);
    setMeals(p=>[...p,{id:Date.now(),name:`${selFood.name.slice(0,40)}${selFood.name.length>40?"…":""} (${g}g)`,cal:Math.round(selFood.cal*g/100),protein:+(selFood.protein*g/100).toFixed(1),fiber:+(selFood.fiber*g/100).toFixed(1),time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}]);
    setFoodQuery(""); setSelFood(null); setGrams(""); setFoodResults([]); setShowAdd(false);
  };

  // ── Screen: Loading
  if(screen==="loading") return (
    <div style={{minHeight:"100vh",background:THEME.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{color:THEME.purple,fontSize:14}}>Loading...</div>
    </div>
  );

  // ── Screen: Onboarding
  if(screen==="onboarding") return <Onboarding onComplete={onboard} />;

  // ── Screen: Generating
  if(screen==="generating") return (
    <div style={{minHeight:"100vh",background:THEME.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20,padding:24,fontFamily:"system-ui,sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Lora:wght@700&display=swap" rel="stylesheet" />
      <div style={{fontSize:52}}>🧬</div>
      <div style={{fontSize:20,fontFamily:"Lora,serif",fontWeight:700,color:"#fff",textAlign:"center"}}>Building your plan</div>
      <div style={{fontSize:13,color:THEME.muted,textAlign:"center",minHeight:20}}>{genMsg}</div>
      <div style={{width:36,height:36,border:`3px solid ${THEME.border}`,borderTop:`3px solid ${THEME.purple}`,borderRadius:"50%",animation:"spin 0.9s linear infinite"}} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // ── Screen: Dashboard
  const todayWorkout = plan?.find(w=>w.day===selectedDay);
  const cLeft = (targets?.calories||1450) - totals.cal;
  const T = targets || { calories:1450, protein:110, fiber:25, waterGlasses:10 };

  return (
    <div style={{minHeight:"100vh",background:THEME.bg,color:THEME.text,fontFamily:"system-ui,sans-serif",paddingBottom:50}}>
      <link href="https://fonts.googleapis.com/css2?family=Lora:wght@600;700&family=Space+Mono:wght@700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#18152e,#201c38)",padding:"22px 18px 16px",borderBottom:`1px solid ${THEME.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <h1 style={{margin:0,fontSize:20,fontFamily:"Lora,serif",fontWeight:700,color:"#fff"}}>
              🌿 {profile?.name ? `${profile.name}'s` : "My"} Health HQ
            </h1>
            <div style={{fontSize:10,color:THEME.muted,marginTop:3,letterSpacing:1,textTransform:"uppercase"}}>
              {T.calories} kcal · {T.protein}g protein · {T.fiber}g fiber
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
            <div style={{background:cLeft>=0?"#1c3a2b":"#3a1c1c",border:`1px solid ${cLeft>=0?THEME.green:THEME.red}40`,borderRadius:999,padding:"5px 12px",fontSize:13,fontWeight:800,color:cLeft>=0?THEME.green:THEME.red,fontFamily:"Space Mono,monospace"}}>
              {cLeft>=0?"+":""}{cLeft}
            </div>
            <div style={{fontSize:9,color:THEME.dim}}>kcal remaining</div>
            {saveStatus&&<div style={{fontSize:9,color:saveStatus==="✓"?THEME.green:THEME.red,fontWeight:700}}>{saveStatus==="✓"?"✓ saved":"⚠ save failed"}</div>}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{display:"flex",background:THEME.card,borderBottom:`1px solid ${THEME.border}`,position:"sticky",top:0,zIndex:10}}>
        {[["today","🍽","Today"],["workout","🏋️","Workout"],["plan","📋","Plan"],["profile","👤","Me"]].map(([key,ico,label])=>(
          <button key={key} onClick={()=>setTab(key)} style={{flex:1,padding:"12px 4px 10px",border:"none",background:"none",color:tab===key?THEME.purple:THEME.dim,fontSize:11,fontWeight:tab===key?700:500,cursor:"pointer",borderBottom:`2px solid ${tab===key?THEME.purple:"transparent"}`,display:"flex",flexDirection:"column",alignItems:"center",gap:2,transition:"all 0.2s",fontFamily:"inherit"}}>
            <span style={{fontSize:16}}>{ico}</span>{label}
          </button>
        ))}
      </div>

      {/* ─── TODAY ─── */}
      {tab==="today"&&(
        <div style={{padding:"16px 16px 0"}}>
          <div style={{fontSize:10,color:THEME.muted,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Today's Macros</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:20}}>
            <MacroRing label="Calories" value={totals.cal} target={T.calories} unit=" kcal" color={THEME.orange} icon="🔥" />
            <MacroRing label="Protein" value={totals.protein} target={T.protein} unit="g" color={THEME.purple} icon="💪" />
            <MacroRing label="Fiber" value={totals.fiber} target={T.fiber} unit="g" color={THEME.green} icon="🌾" />
            <div style={{background:THEME.card,borderRadius:16,padding:"14px 12px",border:`1px solid ${THEME.blue}25`,display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
              <ProgressRing value={water} max={T.waterGlasses} color={THEME.blue} size={60} />
              <div style={{fontSize:18,fontWeight:800,color:"#fff",fontFamily:"monospace"}}>{water}</div>
              <div style={{fontSize:10,color:THEME.muted}}>/{T.waterGlasses} glasses</div>
              <div style={{display:"flex",gap:4,width:"100%"}}>
                <button onClick={()=>setWater(w=>Math.max(0,w-1))} style={{flex:1,background:THEME.border,border:"none",color:"#fff",borderRadius:7,padding:"5px",cursor:"pointer",fontSize:14}}>−</button>
                <button onClick={()=>setWater(w=>Math.min(T.waterGlasses+2,w+1))} style={{flex:2,background:THEME.blue,border:"none",color:"#0c1a24",borderRadius:7,padding:"5px",cursor:"pointer",fontWeight:700,fontSize:11}}>💧 Add</button>
              </div>
            </div>
          </div>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:10,color:THEME.muted,fontWeight:700,letterSpacing:2,textTransform:"uppercase"}}>Meal Log</div>
            <button onClick={()=>setShowAdd(v=>!v)} style={{background:THEME.purple,border:"none",color:"#1a0d2e",borderRadius:999,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Add Food</button>
          </div>

          {showAdd&&(
            <div style={{background:THEME.card,borderRadius:14,padding:16,marginBottom:14,border:`1px solid ${THEME.border}`}}>
              <div style={{position:"relative",marginBottom:10}}>
                <input placeholder="Search any food — rice, chicken, dal, oats..." value={foodQuery}
                  onChange={e=>{setFoodQuery(e.target.value);setSelFood(null);}}
                  style={{width:"100%",boxSizing:"border-box",background:THEME.bg,border:`1.5px solid ${selFood?THEME.purple:THEME.border}`,borderRadius:10,padding:"10px 14px",color:THEME.text,fontSize:14,outline:"none",fontFamily:"inherit"}} />
                {searching&&<div style={{position:"absolute",right:12,top:13,fontSize:10,color:THEME.muted}}>searching...</div>}
                {foodResults.length>0&&!selFood&&(
                  <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:THEME.card2,border:`1px solid ${THEME.border}`,borderRadius:12,marginTop:4,overflow:"hidden",boxShadow:"0 8px 24px #00000060"}}>
                    {foodResults.map((f,i)=>(
                      <div key={i} onClick={()=>{setSelFood(f);setFoodQuery(f.name.slice(0,60));setFoodResults([]);}}
                        style={{padding:"10px 14px",cursor:"pointer",borderBottom:`1px solid ${THEME.border}20`,transition:"background 0.15s"}}
                        onMouseEnter={e=>e.currentTarget.style.background=THEME.border}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <div style={{fontSize:12,fontWeight:600,color:THEME.text,marginBottom:2}}>{f.name.length>55?f.name.slice(0,55)+"…":f.name}</div>
                        <div style={{fontSize:11,color:THEME.muted}}>🔥 {f.cal} kcal &nbsp;·&nbsp; 💪 {f.protein}g &nbsp;·&nbsp; 🌾 {f.fiber}g <span style={{color:THEME.dim}}>per 100g</span></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <input type="number" placeholder="How many grams? (e.g. 150)" value={grams} onChange={e=>setGrams(e.target.value)}
                style={{width:"100%",boxSizing:"border-box",background:THEME.bg,border:`1px solid ${THEME.border}`,borderRadius:10,padding:"10px 14px",color:THEME.text,fontSize:14,outline:"none",fontFamily:"inherit",marginBottom:10}} />
              {selFood&&grams&&Number(grams)>0&&(
                <div style={{background:THEME.bg,borderRadius:10,padding:"10px 14px",marginBottom:10,border:`1px solid ${THEME.purple}30`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:11,color:THEME.muted}}>Preview</span>
                  <div style={{display:"flex",gap:12}}>
                    <span style={{fontSize:12,color:THEME.orange,fontWeight:700}}>🔥 {Math.round(selFood.cal*Number(grams)/100)}</span>
                    <span style={{fontSize:12,color:THEME.purple,fontWeight:700}}>💪 {(selFood.protein*Number(grams)/100).toFixed(1)}g</span>
                    <span style={{fontSize:12,color:THEME.green,fontWeight:700}}>🌾 {(selFood.fiber*Number(grams)/100).toFixed(1)}g</span>
                  </div>
                </div>
              )}
              <button onClick={logMeal} style={{width:"100%",background:selFood&&grams?THEME.purple:THEME.border,border:"none",color:selFood&&grams?"#1a0d2e":THEME.dim,borderRadius:10,padding:11,fontSize:14,fontWeight:700,cursor:selFood&&grams?"pointer":"default",fontFamily:"inherit"}}>Log Meal</button>
            </div>
          )}

          {meals.length===0
            ?<div style={{textAlign:"center",padding:"30px 0",color:THEME.dim,fontSize:13}}>No meals logged yet. Tap + Add Food to start 🍱</div>
            :<div style={{display:"flex",flexDirection:"column",gap:8}}>
              {meals.map(m=>(
                <div key={m.id} style={{background:THEME.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${THEME.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name}</div>
                    <div style={{fontSize:11,color:THEME.muted,marginTop:3}}>🔥 {m.cal} kcal &nbsp;·&nbsp; 💪 {m.protein}g &nbsp;·&nbsp; 🌾 {m.fiber}g &nbsp;·&nbsp; {m.time}</div>
                  </div>
                  <button onClick={()=>setMeals(ms=>ms.filter(x=>x.id!==m.id))} style={{background:"none",border:"none",color:THEME.dim,cursor:"pointer",fontSize:20,padding:"0 0 0 10px",flexShrink:0}}>×</button>
                </div>
              ))}
            </div>
          }
        </div>
      )}

      {/* ─── WORKOUT ─── */}
      {tab==="workout"&&(
        <div style={{padding:"16px 16px 0"}}>
          <div style={{fontSize:10,color:THEME.muted,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:3}}>Weekly Plan</div>
          <div style={{fontSize:10,color:THEME.dim,marginBottom:12,fontStyle:"italic"}}>✦ Checkboxes reset every Monday</div>
          <div style={{display:"flex",gap:5,overflowX:"auto",marginBottom:16,paddingBottom:4}}>
            {DAYS.map(d=>{
              const w = plan?.find(x=>x.day===d);
              const allKeys=[...(w?.warmup||[]).map((_,i)=>`w-${i}`),...(w?.exercises||[]).map((_,i)=>`e-${i}`),...(w?.cooldown||[]).map((_,i)=>`c-${i}`)];
              const done=allKeys.filter(k=>isDone(d,k)).length;
              const pct=allKeys.length?Math.round(done/allKeys.length*100):0;
              return (
                <button key={d} onClick={()=>setSelectedDay(d)} style={{background:selectedDay===d?THEME.purple:THEME.card,border:`1px solid ${selectedDay===d?"transparent":THEME.border}`,color:selectedDay===d?"#1a0d2e":THEME.muted,borderRadius:10,padding:"8px 10px",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:2,minWidth:44}}>
                  {d.slice(0,3)}
                  {pct>0&&<div style={{fontSize:9,opacity:0.8}}>{pct}%</div>}
                </button>
              );
            })}
          </div>
          {todayWorkout&&(()=>{
            const allKeys=[...todayWorkout.warmup.map((_,i)=>`w-${i}`),...todayWorkout.exercises.map((_,i)=>`e-${i}`),...todayWorkout.cooldown.map((_,i)=>`c-${i}`)];
            const total=allKeys.length, done=allKeys.filter(k=>isDone(selectedDay,k)).length;
            return (
              <div style={{background:THEME.card,borderRadius:20,padding:18,border:`1px solid ${todayWorkout.color}30`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:28}}>{todayWorkout.icon}</div>
                    <div style={{fontSize:17,fontWeight:700,fontFamily:"Lora,serif",color:"#fff",marginTop:4}}>{todayWorkout.label}</div>
                    <div style={{fontSize:11,color:THEME.muted,marginTop:2}}>⏱ {todayWorkout.duration}</div>
                  </div>
                  <span style={{background:`${todayWorkout.color}20`,color:todayWorkout.color,border:`1px solid ${todayWorkout.color}40`,borderRadius:999,padding:"3px 10px",fontSize:11,fontWeight:700}}>{todayWorkout.tag}</span>
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                    <span style={{fontSize:11,color:THEME.muted}}>{done===total&&total>0?"🎉 Session complete!":`${done}/${total} steps done`}</span>
                    <span style={{fontSize:11,color:todayWorkout.color,fontWeight:700}}>{total?Math.round(done/total*100):0}%</span>
                  </div>
                  <Bar value={done} max={total||1} color={todayWorkout.color} />
                </div>
                {[
                  {label:"🔥 Warm-Up",items:todayWorkout.warmup,prefix:"w",col:THEME.yellow},
                  {label:"💪 Main Workout",items:todayWorkout.exercises,prefix:"e",col:todayWorkout.color},
                  {label:"🧘 Cool-Down",items:todayWorkout.cooldown,prefix:"c",col:THEME.green},
                ].map(({label,items,prefix,col})=>items.length>0&&(
                  <div key={prefix} style={{marginBottom:14}}>
                    <div style={{fontSize:10,fontWeight:700,color:col,letterSpacing:1.5,textTransform:"uppercase",marginBottom:7}}>{label}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {items.map((ex,i)=>{
                        const key=`${prefix}-${i}`, done=isDone(selectedDay,key);
                        const exObj=typeof ex==="object"?ex:{name:ex,weight:null,unit:null};
                        const wKey=`${selectedDay}-${key}`;
                        const curW=weights[wKey]!==undefined?weights[wKey]:exObj.weight;
                        const hasW=prefix==="e"&&exObj.weight!==null;
                        return (
                          <div key={key} style={{background:done?`${col}12`:THEME.bg,borderRadius:10,border:`1px solid ${done?col+"40":"transparent"}`,overflow:"hidden",transition:"all 0.2s"}}>
                            <div onClick={()=>toggleCheck(selectedDay,key)} style={{display:"flex",alignItems:"center",gap:10,padding:hasW?"9px 12px 5px":"9px 12px",cursor:"pointer"}}>
                              <div style={{width:18,height:18,borderRadius:5,flexShrink:0,border:`2px solid ${done?col:THEME.dim}`,background:done?col:"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s"}}>
                                {done&&<span style={{fontSize:10,color:"#1a0d2e",fontWeight:900}}>✓</span>}
                              </div>
                              <span style={{fontSize:13,color:done?THEME.dim:THEME.text,textDecoration:done?"line-through":"none",flex:1,transition:"all 0.2s"}}>{exObj.name}</span>
                            </div>
                            {hasW&&(
                              <div style={{display:"flex",alignItems:"center",gap:6,padding:"0 12px 8px 40px"}} onClick={e=>e.stopPropagation()}>
                                <span style={{fontSize:10,color:THEME.dim}}>🏋️</span>
                                <button onClick={()=>setWeights(w=>({...w,[wKey]:Math.max(0.5,(curW||0)-(curW<=5?0.5:2.5))}))} style={{background:THEME.border,border:"none",color:THEME.text,borderRadius:5,width:22,height:22,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                                <span style={{fontSize:12,fontWeight:700,color:col,minWidth:48,textAlign:"center",fontFamily:"Space Mono,monospace"}}>{curW} {exObj.unit}</span>
                                <button onClick={()=>setWeights(w=>({...w,[wKey]:(curW||0)+(curW<5?0.5:2.5)}))} style={{background:THEME.border,border:"none",color:THEME.text,borderRadius:5,width:22,height:22,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div style={{background:`${todayWorkout.color}10`,border:`1px solid ${todayWorkout.color}25`,borderRadius:10,padding:"10px 14px"}}>
                  <div style={{fontSize:10,color:THEME.muted,marginBottom:3,fontWeight:700}}>💡 Coach Note</div>
                  <div style={{fontSize:12,color:"#c8bfe8",lineHeight:1.5}}>{todayWorkout.notes}</div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ─── PLAN ─── */}
      {tab==="plan"&&(
        <div style={{padding:"16px 16px 0"}}>
          <div style={{fontSize:10,color:THEME.muted,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>Your Plan</div>
          {[
            {title:"🎯 Daily Targets",color:THEME.orange,rows:[["Calories",`${T.calories} kcal`],["Protein",`${T.protein}g (${(T.protein/profile?.weightKg).toFixed(1)}g per kg)`],["Fiber",`${T.fiber}g`],["Water",`${T.waterGlasses} glasses (${(T.waterGlasses*0.25).toFixed(1)}L)`]]},
            {title:"📊 Your Numbers",color:THEME.purple,rows:[["BMR",`${targets?.bmr} kcal`],["TDEE",`${targets?.tdee} kcal`],["Daily target",`${T.calories} kcal`],["Deficit",`~${targets?.tdee-T.calories} kcal/day`],["Timeline",`${Math.max(1,Math.round((profile?.weightKg-(profile?.targetWeightKg||profile?.weightKg))/0.4))} weeks est.`]]},
          ].map(card=>(
            <div key={card.title} style={{background:THEME.card,borderRadius:16,padding:18,marginBottom:12,border:`1px solid ${card.color}20`}}>
              <div style={{fontSize:15,fontWeight:700,fontFamily:"Lora,serif",color:card.color,marginBottom:12}}>{card.title}</div>
              {card.rows.map(([k,v])=>v&&(
                <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${THEME.border}`}}>
                  <span style={{fontSize:13,color:THEME.muted}}>{k}</span>
                  <span style={{fontSize:13,color:THEME.text,fontWeight:600,textAlign:"right",maxWidth:"55%"}}>{v}</span>
                </div>
              ))}
            </div>
          ))}
          {aiTips&&(
            <div style={{background:THEME.card,borderRadius:16,padding:18,marginBottom:12,border:`1px solid ${THEME.green}20`}}>
              <div style={{fontSize:15,fontWeight:700,fontFamily:"Lora,serif",color:THEME.green,marginBottom:12}}>✨ Your Personalised Tips</div>
              <div style={{fontSize:13,color:"#c8bfe8",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{aiTips}</div>
            </div>
          )}
          {profile?.conditions?.length>0&&(
            <div style={{background:THEME.card,borderRadius:16,padding:18,marginBottom:12,border:`1px solid ${THEME.yellow}20`}}>
              <div style={{fontSize:15,fontWeight:700,fontFamily:"Lora,serif",color:THEME.yellow,marginBottom:12}}>⚕️ Condition Notes</div>
              {profile.conditions.map(c=>(
                <div key={c} style={{fontSize:13,color:"#c8bfe8",lineHeight:1.6,padding:"6px 0",borderBottom:`1px solid ${THEME.border}`}}>
                  {c==="ms"&&"🧠 MS: Exercise in cool environments. Pool is your best option. Stop if symptoms worsen."}
                  {c==="rls"&&"🦵 RLS: Evening walks help. Magnesium-rich foods (pumpkin seeds, spinach). No caffeine after 4pm."}
                  {c==="diabetes"&&"🩸 Diabetes: Eat protein with every meal. Avoid large carb spikes. Walk after meals."}
                  {c==="hypertension"&&"❤️ BP: Low-sodium foods. Avoid heavy lifting breath-holds. Cardio is very beneficial."}
                  {c==="thyroid"&&"🦋 Thyroid: Strength training helps metabolism. Consistent meal timing matters."}
                  {c==="pcos"&&"🔄 PCOS: Resistance training + low GI foods. Prioritise sleep. Manage stress."}
                  {c==="arthritis"&&"🦴 Arthritis: Low impact preferred (pool, bike). Warm up thoroughly every session."}
                  {c==="asthma"&&"💨 Asthma: Keep inhaler nearby. Warm up slowly. Pool humidity often helps."}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── PROFILE ─── */}
      {tab==="profile"&&(
        <div style={{padding:"16px 16px 0"}}>
          <div style={{fontSize:10,color:THEME.muted,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>Your Profile</div>
          <div style={{background:THEME.card,borderRadius:16,padding:18,marginBottom:14,border:`1px solid ${THEME.border}`}}>
            {[
              ["Name",profile?.name],["Sex",profile?.sex==="female"?"♀ Female":"♂ Male"],["Age",`${profile?.age} years`],
              ["Height",`${profile?.heightCm} cm`],["Weight",`${profile?.weightKg} kg`],["Target",`${profile?.targetWeightKg} kg`],
              ["Lifestyle",profile?.lifestyle],["Goal",profile?.goalType],["Strength days",`${profile?.strengthDays} per week`],
              ["Facilities",profile?.facilities?.join(", ")],
              ["Conditions",profile?.conditions?.length?profile.conditions.join(", "):"None"],
              ["Celeb goal",profile?.celeb||"None"],
            ].map(([k,v])=>v&&(
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${THEME.border}`}}>
                <span style={{fontSize:13,color:THEME.muted}}>{k}</span>
                <span style={{fontSize:13,color:THEME.text,fontWeight:600,textAlign:"right",maxWidth:"55%",textTransform:"capitalize"}}>{v}</span>
              </div>
            ))}
          </div>
          <button onClick={async()=>{
            await Promise.all(["profile","plan","targets","aiTips","weights"].map(k=>store.set(k,[])));
            setProfile(null);setPlan(null);setTargets(null);setAiTips("");setMeals([]);setWater(0);setChecked({});setWeights({});
            setScreen("onboarding");
          }} style={{width:"100%",background:"#3a1c1c",border:`1px solid ${THEME.red}40`,color:THEME.red,borderRadius:12,padding:13,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            🔄 Reset & Onboard Again
          </button>
          <div style={{fontSize:11,color:THEME.dim,textAlign:"center",marginTop:10}}>Use this if your weight, goal, or conditions have changed significantly</div>
        </div>
      )}
    </div>
  );
}
