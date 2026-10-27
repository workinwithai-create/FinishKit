// FinishKit — WorkinWithAI. One "finish my song" desk that replaces the 4- and 8-bar arrangement desks.
// Your BPM, key and chords come first. Pick where you're stuck, audition recommended moves (parts, sections,
// transitions, endings, feel), stack, edit and lock them on an arrangement timeline, then export a grid-locked
// 48 kHz / 24-bit WAV + multitrack MIDI. Engine rules: audio-clock lookahead scheduler, live state read every step,
// OfflineAudioContext exports at the exact bar length, samples pinned to a commit SHA, pitch shift <= 2 semitones.
const APP = "finishkit", BRAND = "FinishKit";
const SR = 48000, STEPS = 16, TAIL_S = 3, FAST_RELEASE = 0.006, MAX_SHIFT = 4;
const LOOKAHEAD_MS = 25;      // how often the scheduler wakes
const SCHEDULE_AHEAD = 0.12;  // seconds of audio scheduled in advance
const SF_SHA = "044fab8e1456bfafc5776e86dfd6bb8697149aef"; // pinned commit, never a branch
const SF = `https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@${SF_SHA}/FluidR3_GM`;
const SF_MIRROR = `https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/${SF_SHA}/FluidR3_GM`; // same commit, used if jsDelivr refuses a file
const KIT_DIR = "samples/drums";
const NAMES = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];
const pc = x => ((x % 12) + 12) % 12;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (...xs) => xs.reduce((h, x) => Math.imul(h ^ (typeof x === "string" ? [...x].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7) : x), 2654435761) >>> 0, 2166136261);

// ---------- instruments: every voice is the FluidR3 GM sample it is named after ----------
// dir = folder in gleitz/midi-js-soundfonts FluidR3_GM (pinned commit). Samples every 4 semitones => max shift 2 st.
const INST = {
  piano:   { label: "Piano (FluidR3 acoustic grand)", dir: "acoustic_grand_piano", gm: 0, lo: 36, hi: 88, gain: 0.9 },
  epiano:  { label: "Electric piano (FluidR3 EP 1)", dir: "electric_piano_1", gm: 4, lo: 36, hi: 84, gain: 1.0 },
  organ:   { label: "Drawbar organ (FluidR3)", dir: "drawbar_organ", gm: 16, lo: 36, hi: 84, gain: 0.55, sus: true },
  nylon:   { label: "Nylon guitar (FluidR3)", dir: "acoustic_guitar_nylon", gm: 24, lo: 40, hi: 76, gain: 1.0 },
  steel:   { label: "Steel-string acoustic (FluidR3)", dir: "acoustic_guitar_steel", gm: 25, lo: 40, hi: 76, gain: 0.9 },
  muted:   { label: "Muted electric guitar (FluidR3)", dir: "electric_guitar_muted", gm: 28, lo: 40, hi: 76, gain: 1.0 },
  drive:   { label: "Overdriven guitar (FluidR3)", dir: "overdriven_guitar", gm: 29, lo: 40, hi: 76, gain: 0.55, sus: true },
  upright: { label: "Upright bass (FluidR3 acoustic bass)", dir: "acoustic_bass", gm: 32, lo: 28, hi: 56, gain: 1.25 },
  finger:  { label: "Finger bass (FluidR3 electric bass)", dir: "electric_bass_finger", gm: 33, lo: 28, hi: 56, gain: 1.15 },
  strings: { label: "String ensemble (FluidR3)", dir: "string_ensemble_1", gm: 48, lo: 40, hi: 84, gain: 0.6, sus: true },
  choir:   { label: "Choir aahs (FluidR3)", dir: "choir_aahs", gm: 52, lo: 48, hi: 80, gain: 0.6, sus: true },
  violin:  { label: "Violin (FluidR3)", dir: "violin", gm: 40, lo: 56, hi: 92, gain: 0.7, sus: true },
  cello:   { label: "Cello (FluidR3)", dir: "cello", gm: 42, lo: 36, hi: 68, gain: 0.75, sus: true },
  trumpet: { label: "Trumpet (FluidR3)", dir: "trumpet", gm: 56, lo: 56, hi: 84, gain: 0.6, sus: true },
  sax:     { label: "Alto sax (FluidR3)", dir: "alto_sax", gm: 65, lo: 52, hi: 80, gain: 0.65, sus: true },
  flute:   { label: "Flute (FluidR3)", dir: "flute", gm: 73, lo: 60, hi: 92, gain: 0.7, sus: true },
  harmonica:{ label: "Harmonica (FluidR3)", dir: "harmonica", gm: 22, lo: 60, hi: 84, gain: 0.55, sus: true },
  horn:    { label: "French horn (FluidR3)", dir: "french_horn", gm: 60, lo: 44, hi: 76, gain: 0.7, sus: true },
  marimba: { label: "Marimba (FluidR3)", dir: "marimba", gm: 12, lo: 52, hi: 88, gain: 1.0 },
  glock:   { label: "Glockenspiel (FluidR3)", dir: "glockenspiel", gm: 9, lo: 72, hi: 100, gain: 0.6 },
  vibes:   { label: "Vibraphone (FluidR3)", dir: "vibraphone", gm: 11, lo: 52, hi: 88, gain: 0.8 },
  harp:    { label: "Concert harp (FluidR3 orchestral harp)", dir: "orchestral_harp", gm: 46, lo: 40, hi: 88, gain: 1.0 },
  pizz:    { label: "Pizzicato strings (FluidR3)", dir: "pizzicato_strings", gm: 45, lo: 40, hi: 80, gain: 1.0 }
};
// Acoustic kit: Virtuosity Drums (CC0) + VSCO 2 CE shaker and tambourine (CC0), hosted in this repo.
const KIT = {
  kick:  { gm: 36, file: "kick",   label: "Acoustic kit: kick (Virtuosity Drums)", gain: 1.0 },
  snare: { gm: 38, file: "snare",  label: "Acoustic kit: snare (Virtuosity Drums)", gain: 0.8 },
  ghost: { gm: 40, file: "ghost",  label: "Acoustic kit: soft snare (Virtuosity Drums)", gain: 0.45 },
  rim:   { gm: 37, file: "rim",    label: "Acoustic kit: cross-stick rim click (Virtuosity Drums)", gain: 0.6 },
  hat:   { gm: 42, file: "hat",    label: "Acoustic kit: closed hi-hat (Virtuosity Drums)", gain: 0.45 },
  ohat:  { gm: 46, file: "ohat",   label: "Acoustic kit: open hi-hat (Virtuosity Drums)", gain: 0.35 },
  ride:  { gm: 51, file: "ride",   label: "Acoustic kit: ride (Virtuosity Drums)", gain: 0.4 },
  crash: { gm: 49, file: "crash",  label: "Acoustic kit: crash (Virtuosity Drums)", gain: 0.45 },
  htom:  { gm: 50, file: "htom",   label: "Acoustic kit: high tom (Virtuosity Drums)", gain: 0.7 },
  ltom:  { gm: 45, file: "ltom",   label: "Acoustic kit: low tom (Virtuosity Drums)", gain: 0.75 },
  shaker:{ gm: 82, file: "shaker", label: "Shaker (VSCO 2 CE)", gain: 0.5 },
  tamb:  { gm: 54, file: "tamb",   label: "Tambourine (VSCO 2 CE)", gain: 0.4 }
};
const KIT_BY_GM = Object.fromEntries(Object.entries(KIT).map(([k, v]) => [v.gm, k]));
const D = Object.fromEntries(Object.entries(KIT).map(([k, v]) => [k, v.gm])); // D.kick === 36
const noteName = n => NAMES[pc(n)] + (Math.floor(n / 12) - 1);
function sampleList(){
  const out = [];
  for (const [inst, d] of Object.entries(INST)) {
    const ns = []; for (let n = d.lo; n < d.hi + 2; n += 4) ns.push(n); if (ns[ns.length - 1] < d.hi - 2) ns.push(d.hi);
    for (const n of ns) out.push({ inst, id: inst + ":" + n, midi: n, url: `${SF}/${d.dir}-mp3/${noteName(n)}.mp3`, alt: `${SF_MIRROR}/${d.dir}-mp3/${noteName(n)}.mp3`, label: d.label });
  }
  for (const [k, v] of Object.entries(KIT)) out.push({ inst: "kit", id: "kit:" + k, piece: k, url: `${KIT_DIR}/${v.file}.flac`, label: v.label });
  return out;
}
const SAMPLES = sampleList();
const BY_INST = {}; for (const s of SAMPLES) if (s.inst !== "kit") (BY_INST[s.inst] = BY_INST[s.inst] || []).push(s);
function fold(n, lo, hi){ while (n < lo) n += 12; while (n > hi) n -= 12; return n; }
function nearestSample(inst, midi){
  const d = INST[inst], list = BY_INST[inst]; const n = fold(midi, d.lo - 2, d.hi + 2); let best = null;
  for (const s of list) { const sh = n - s.midi; if (!best || Math.abs(sh) < Math.abs(best.shift)) best = { id: s.id, shift: sh, n }; }
  return best;
}

// ---------- theory ----------
const QUAL = { "": [0,4,7], M: [0,4,7], m: [0,3,7], min: [0,3,7], "7": [0,4,7,10], m7: [0,3,7,10], maj7: [0,4,7,11], m7b5: [0,3,6,10], dim: [0,3,6], dim7: [0,3,6,9],
  aug: [0,4,8], sus2: [0,2,7], sus4: [0,5,7], sus: [0,5,7], "7sus4": [0,5,7,10], "6": [0,4,7,9], m6: [0,3,7,9], add9: [0,4,7,14], "9": [0,4,7,10,14], m9: [0,3,7,10,14], maj9: [0,4,7,11,14] };
const ROOTS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJ = [0,2,4,5,7,9,11], MIN = [0,2,3,5,7,8,10];
function mk(root, q){ q = q || ""; return { root: pc(root), q, ivs: QUAL[q] || QUAL[""] }; }
function parseChord(s){
  const m = /^([A-G])(#|b)?(maj9|maj7|m7b5|7sus4|min|m9|m7|m6|dim7|dim|aug|sus2|sus4|sus|add9|9|7|6|m|M)?(?:\/([A-G])(#|b)?)?$/.exec(String(s).trim()); if (!m) return null;
  const c = mk(ROOTS[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0), m[3] || ""); if (m[4]) c.bass = pc(ROOTS[m[4]] + (m[5] === "#" ? 1 : m[5] === "b" ? -1 : 0)); return c;
}
const tokens = str => String(str).trim().split(/[\s,|]+/).filter(Boolean);
function parseProg(str){ const t = tokens(str); if (t.length < 1 || t.length > 16) return null; const c = t.map(parseChord); return c.includes(null) ? null : c; }
const isMinorQ = q => /^m(?!aj)/.test(q) || q === "dim" || q === "min";
function chName(c){ return NAMES[c.root] + (c.q === "M" ? "" : c.q === "min" ? "m" : c.q) + (c.bass != null ? "/" + NAMES[c.bass] : ""); }
function tr(c, k){ const o = mk(c.root + k, c.q); if (c.bass != null) o.bass = pc(c.bass + k); return o; }
function inferKey(prog){ let best = null;
  for (const mode of ["major", "minor"]) for (let r = 0; r < 12; r++) { const set = new Set((mode === "major" ? MAJ : MIN).map(x => pc(x + r))); let s = 0;
    for (const c of prog) for (const iv of c.ivs) if (set.has(pc(c.root + iv))) s++;
    if (prog[0].root === r && (mode === "minor") === isMinorQ(prog[0].q)) s += 1.5; if (prog[prog.length - 1].root === r) s += 0.3;
    if (prog.some(c => c.root === pc(r + 7) && !isMinorQ(c.q)) && mode === "minor") s += 0.2;
    if (!best || s > best.s) best = { root: r, mode, s }; }
  return best; }
const ROMAN = { I: [0,""], Imaj7: [0,"maj7"], i: [0,"m"], bII: [1,""], ii: [2,"m"], ii7: [2,"m7"], iio: [2,"dim"], bIII: [3,""], iii: [4,"m"], IV: [5,""], IVmaj7: [5,"maj7"],
  iv: [5,"m"], V: [7,""], V7: [7,"7"], Vsus: [7,"sus4"], v: [7,"m"], bVI: [8,""], vi: [9,"m"], bVII: [10,""], viio: [11,"dim"] };
const rom = (key, r) => { const [iv, q] = ROMAN[r]; return mk(key.root + iv, q); };
const scaleOf = key => (key.mode === "minor" ? MIN : MAJ).map(x => pc(x + key.root));
function barScale(c, key){ // key scale with the chord's own tones substituted (e.g. the leading tone over V in minor)
  const sc = scaleOf(key).slice(); for (const iv of c.ivs) { const t = pc(c.root + iv); if (!sc.includes(t)) { const j = sc.findIndex(x => pc(x - t) === 1 || pc(t - x) === 1); if (j >= 0) sc[j] = t; } }
  return sc.sort((a, b) => a - b); }
function chordPcs(c){ return [...new Set(c.ivs.map(i => pc(c.root + i)))]; }
function nearestPc(target, pcs){ let best = null; for (let n = target - 7; n <= target + 7; n++) if (pcs.includes(pc(n)) && (best == null || Math.abs(n - target) < Math.abs(best - target))) best = n; return best; }
function scaleStep(n, k, sc){ // move k scale steps from n (n snapped into the scale first)
  let x = n; while (!sc.includes(pc(x))) x--; const dir = k >= 0 ? 1 : -1; for (let i = 0; i < Math.abs(k); i++) { do { x += dir; } while (!sc.includes(pc(x))); } return x; }
function voicing(c, lo, hi, prev, n){ // voice-led close voicing inside [lo, hi]
  const pcs = chordPcs(c).slice(0, n || 4), cands = [];
  for (let k = 0; k < pcs.length; k++) { let x = lo; while (pc(x) !== pcs[k]) x++; const v = [x];
    for (let j = 1; j < pcs.length; j++) { let y = v[v.length - 1] + 1; while (pc(y) !== pcs[(k + j) % pcs.length]) y++; v.push(y); }
    for (let o = 0; o <= 12; o += 12) if (v[v.length - 1] + o <= hi) cands.push(v.map(z => z + o)); }
  if (!cands.length) return [fold(c.root + 48, lo, hi)];
  const mid = (lo + hi) / 2, mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const score = v => prev && prev.length ? v.reduce((s, x, i) => s + Math.abs(x - prev[Math.min(i, prev.length - 1)]), 0) : Math.abs(mean(v) - mid);
  return cands.sort((a, b) => score(a) - score(b))[0]; }
const bassOf = (c, lo, hi) => fold((c.bass != null ? c.bass : c.root), lo, hi);

// ---------- state (persisted) ----------
let uid = 1; const nextSeed = () => 1 + hash(Date.now(), uid++, "seed") % 998; const newId = () => "s" + Date.now().toString(36) + (uid++);
const DEFAULT = { bpm: 92, chords: "Am F C G", keyRoot: 9, baseKey: 9, mode: "minor", loopBars: 8,
  arr: null, sel: null, loopSection: false, stuck: "thin", exportMode: "mix",
  mutes: {}, gains: {}, master: 0.8, liveGain: 0.9, liveInst: "piano", kbdOct: 4,
  midiIn: "", midiOut: "", audioIn: "", audioOut: "", monitor: false, rev: 1 };
const CHAIRS = [
  { id: "gkeys", name: "Guide keys (your loop)", ch: 0, guide: true, g: 0.55 }, { id: "gbass", name: "Guide bass (your loop)", ch: 1, guide: true, g: 0.8 },
  { id: "gdrums", name: "Guide drums (your loop)", ch: 9, guide: true, g: 0.75 },
  { id: "bass", name: "Bass line", ch: 2, g: 0.9 }, { id: "comp", name: "Comp", ch: 3, g: 0.75 }, { id: "strum", name: "Guitar", ch: 4, g: 0.75 },
  { id: "organ", name: "Organ", ch: 5, g: 0.7 }, { id: "pad", name: "Pad / strings", ch: 6, g: 0.7 }, { id: "counter", name: "Counter-line", ch: 7, g: 0.7 },
  { id: "harmony", name: "Harmony", ch: 8, g: 0.6 }, { id: "figure", name: "Figure", ch: 10, g: 0.7 }, { id: "hook", name: "Hook / lead", ch: 11, g: 0.75 },
  { id: "drums", name: "Drum moves (fills, ghosts)", ch: 9, g: 0.8 }, { id: "perc", name: "Percussion (shaker, tambourine)", ch: 9, g: 0.7 }
];
const CHAIR = Object.fromEntries(CHAIRS.map(c => [c.id, c]));
const loadJSON = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
const state = Object.assign({}, DEFAULT, loadJSON(APP + "-settings") || {});
for (const c of CHAIRS) { if (state.gains[c.id] == null) state.gains[c.id] = c.g; if (state.mutes[c.id] == null) state.mutes[c.id] = false; }
if (!(state.bpm >= 60 && state.bpm <= 180)) state.bpm = 92;
if (!parseProg(state.chords)) state.chords = DEFAULT.chords;
if (!Array.isArray(state.arr) || !state.arr.length) state.arr = [loopSection("Your loop")];
if (!state.arr.some(s => s.id === state.sel)) state.sel = state.arr[0].id;
let ver = 1; const save = () => { ver++; localStorage.setItem(APP + "-settings", JSON.stringify(state)); };
function loopSection(name){ return { id: newId(), kind: "loop", name: name || "Your loop", bars: null, moves: [], locked: false }; }
const progOf = st => parseProg(st.chords) || parseProg(DEFAULT.chords);
const songKey = st => ({ root: st.keyRoot, mode: st.mode });
const keyLabel = (st, shift) => NAMES[pc(st.keyRoot + (shift || 0))] + (st.mode === "minor" ? "m" : "");
function defaultLoopBars(st){ const n = progOf(st).length; return n >= 8 ? n : Math.ceil(8 / n) * n; }

// ---------- the moves ----------
// Every old desk maps onto one of these moves (see MERGE-PLAN.md). type: "part" adds a chair to a section,
// "mod" changes a section (transitions, feel), "section" inserts a new section on the timeline.
const E = (ch, i, n, s, d, v, x) => Object.assign({ ch, i, n, s, d, v }, x || {});
const opt = (label, choices, def) => ({ label, choices, def: def != null ? def : choices[0][0] });
const INSTS = ids => ids.map(id => [id, INST[id].label.replace(/ \(FluidR3.*\)$/, "").replace(/ \(.*\)$/, "")]);
const BARS = (...b) => opt("Bars", b.map(x => [x, x + " bars"]), b[0]);
const kitHit = (ch, piece, s, v, x) => E(ch, "kit", D[piece], s, 2, v, x);
function eachBar(x, fn){ for (let b = 0; b < x.bars; b++) fn(b, x.ch(b, 0), b * STEPS); }
function lineRange(i){ const d = INST[i]; return [Math.max(d.lo, 55), Math.min(d.hi, 86)]; }

// Melody writer shared by hook, solo, counter-lines and ad-libs. Seeded: same seed = same notes.
const RHY = {
  sparse: [[[0,6],[8,6]], [[0,4],[6,2],[8,8]], [[2,4],[8,6]], [[0,8],[10,4]]],
  medium: [[[0,3],[4,2],[6,2],[8,4],[12,4]], [[0,2],[2,2],[4,4],[10,2],[12,4]], [[0,4],[6,2],[8,2],[10,2],[12,4]], [[2,2],[4,2],[6,4],[12,2],[14,2]]],
  busy:   [[[0,2],[2,2],[4,2],[6,2],[8,2],[10,2],[12,2],[14,2]], [[0,1],[1,1],[2,2],[4,2],[6,4],[10,2],[12,2],[14,2]], [[0,3],[3,1],[4,2],[6,2],[8,3],[11,1],[12,4]]]
};
function melody(x, { ch, i, density, contour, from = 0, to = x.bars, half = null, vel = 0.8, lo, hi }){
  const R = x.R, out = []; [lo, hi] = lo != null ? [lo, hi] : lineRange(i); const mid = Math.round((lo + hi) / 2);
  const pick = () => RHY[density][Math.floor(R() * RHY[density].length)];
  const motif = [pick(), pick()], len = to - from; let prev = null;
  for (let b = from; b < to; b++) {
    const k = b - from, ph = (k % 4) / 4, last = k % 4 === 3 || b === to - 1;
    let rh = motif[k % 2]; if (k % 4 === 2 && R() < 0.5) rh = pick(); if (last) rh = rh.filter(([s]) => s < 12).concat([[12, 4]]);
    for (const [s, d] of rh) {
      if (half === "second" && s < 8) continue; if (half === "first" && s >= 8) continue;
      const c = x.ch(b, s), p = (k + s / 16) / Math.max(1, len), sc = barScale(c, x.key);
      const shape = contour === "rise" ? -5 + 10 * p : contour === "fall" ? 5 - 10 * p : contour === "arch" ? -4 + 9 * Math.sin(Math.PI * p) : (k % 4 < 2 ? -2 + 6 * ph : 3 - 6 * ph);
      const target = mid + shape; let n;
      if (s % 4 === 0 || last && s >= 12) n = nearestPc(Math.round(prev == null ? target : (prev + target) / 2), last && s >= 12 && (contour !== "question" || k % 8 >= 4) ? [pc(x.key.root), pc(c.root)].filter((v, j, a) => chordPcs(c).includes(v) || j === 0) : chordPcs(c));
      else { const dir = target > (prev ?? target) ? 1 : -1; n = scaleStep(prev ?? Math.round(target), R() < 0.7 ? dir : 2 * dir, sc); }
      n = fold(n, lo, hi); out.push(E(ch, i, n, b * STEPS + s, d - 0.2, vel * (s % 4 === 0 ? 1 : 0.85))); prev = n;
    }
  }
  return out;
}
function bassLine(x, b, c, nx, style, i, R){ // one bar of bass for any style
  const lo = 28, r = bassOf(c, lo, lo + 15), nr = bassOf(nx, lo, lo + 15), fifth = r + 7 <= 52 ? r + 7 : r - 5, third = r + (isMinorQ(c.q) ? 3 : 4), o = b * STEPS, ev = [];
  const N = (n, s, d, v) => ev.push(E("bass", i, n, o + s, d, v));
  const approach = R() < 0.5 ? nr - 1 : nr + 1, sc = barScale(c, x.key);
  switch (style) {
    case "walk": N(r, 0, 3.6, 0.95); N(R() < 0.5 ? third : fifth, 4, 3.6, 0.8); N(R() < 0.5 ? fifth : r + 12 > 55 ? fifth : r + 12, 8, 3.6, 0.85); N(scaleStep(nr, R() < 0.5 ? -1 : 1, sc), 12, 3.6, 0.8); break;
    case "chromatic": N(r, 0, 3.6, 0.95); N(third, 4, 3.6, 0.8); N(fifth, 8, 3.6, 0.85); N(approach, 12, 3.6, 0.82); break;
    case "two": N(r, 0, 7.5, 0.95); N(fifth, 8, 7.5, 0.85); break;
    case "octave": for (let s = 0; s < 16; s += 2) N(s % 4 === 0 ? r : r + 12, s, 1.6, s % 4 === 0 ? 0.95 : 0.75); break;
    case "motown": N(r, 0, 2.6, 0.95); N(r + 12, 3, 0.9, 0.7); N(fifth, 6, 1.8, 0.8); N(r, 8, 2.6, 0.9); N(r + 12, 11, 0.9, 0.7); N(scaleStep(nr, -1, sc), 14, 1.8, 0.8); break;
    case "push": N(r, 2, 1.6, 0.85); N(r, 6, 1.6, 0.8); N(r, 10, 1.6, 0.85); N(R() < 0.5 ? fifth : r, 14, 1.6, 0.8); break;
    case "pedal": N(fold(x.key.root, lo, lo + 11), 0, 15.5, 0.9); break;
    case "dompedal": N(fold(x.key.root + 7, lo, lo + 11), 0, 7.5, 0.9); N(fold(x.key.root + 7, lo, lo + 11), 8, 7.5, 0.85); break;
    case "pulse": for (let s = 0; s < 16; s += 2) N(r, s, 1.7, s % 4 === 0 ? 0.9 : 0.75); break;
    case "whole": N(r, 0, 15.5, 0.85); break;
    default: N(r, 0, 5.6, 0.9); N(r, 8, 3.6, 0.85); N(s14(R) ? fifth : r, 12, 3.6, 0.78);
  }
  return ev;
}
const s14 = R => R() < 0.5;
const COMP_RH = { whole: [[0,16]], half: [[0,8],[8,8]], charleston: [[0,3],[6,8]], offbeat: [[2,1.5],[6,1.5],[10,1.5],[14,1.5]],
  push: [[0,3],[3,3],[6,4],[10,2],[14,2]], stabs: [[0,1],[6,1],[10,1]], gospel: [[0,1],[2,1],[6,1],[8,1],[10,1],[14,1]], chops: [[0,1],[2,1],[4,1],[6,1],[8,1],[10,1],[12,1],[14,1]], shuffle: [[0,2],[3,1],[4,2],[7,1],[8,2],[11,1],[12,2],[15,1]] };
function chordsPart(x, { ch, i, rh, lo = 52, hi = 76, n = 4, vel = 0.62, sw = false, hold = false, anticipate = false, skip = 0 }){
  const out = []; let prev = null;
  eachBar(x, (b, c, o) => { for (const [s, d] of COMP_RH[rh]) { if (skip && s > 0 && x.R() < skip) continue;
      const cc = anticipate && s >= 14 && b < x.bars - 1 ? x.ch(b + 1, 0) : x.ch(b, s); const v = voicing(cc, lo, hi, prev, n); prev = v;
      for (const m of v) out.push(E(ch, i, m, o + s, hold ? d - 0.1 : d * 0.9, vel * (s % 4 === 0 ? 1 : 0.85) / Math.sqrt(v.length / 3), { sw })); } });
  return out; }
function guitarVoicing(c){ const r = fold(bassOf(c, 40, 51), 40, 51), pcs = chordPcs(c), v = [r]; let y = r;
  for (let k = 0; v.length < 5 && k < 40; k++) { y++; if (pcs.includes(pc(y)) && y - v[v.length - 1] >= 3) v.push(y); } return v.filter(n => n <= 76); }

const MOVES = {
  // ===== Parts =====
  bass: { cat: "part", name: "Bass walk", chairs: ["bass"], replaces: ["gbass"],
    opts: { style: opt("Line", [["walk","Walking quarters"],["chromatic","Chromatic approach"],["two","Two-feel"],["octave","Octave pop"],["motown","Motown pocket"],["push","Pushes on the and"],["pedal","Tonic pedal"]]), i: opt("Instrument", INSTS(["upright","finger"])) },
    gen(x){ const out = []; eachBar(x, (b, c) => out.push(...bassLine(x, b, c, b < x.bars - 1 ? x.ch(b + 1, 0) : x.next, x.o.style, x.o.i, x.R))); return out; } },
  comp: { cat: "part", name: "Chord comp", chairs: ["comp"], replaces: ["gkeys"],
    opts: { rh: opt("Rhythm", [["charleston","Charleston"],["half","Half notes"],["offbeat","Offbeats"],["push","16th push (anticipates)"],["stabs","Short stabs"],["whole","Whole notes"]]),
            i: opt("Instrument", INSTS(["epiano","piano","vibes","trumpet","horn"])), voicing: opt("Voicing", [["close","Close"],["spread","Spread"],["shell","Shell (3rd + 7th)"]]) },
    gen(x){ const o = x.o, sp = o.voicing === "spread"; return chordsPart(x, { ch: "comp", i: o.i, rh: o.rh, lo: sp ? 48 : 55, hi: sp ? 79 : 74, n: o.voicing === "shell" ? 2 : 4, anticipate: o.rh === "push", skip: 0.15 }); } },
  strum: { cat: "part", name: "Guitar strum", chairs: ["strum"],
    opts: { pat: opt("Pattern", [["folk","Folk D-DU-UDU"],["eighths","Straight eighths"],["chicka","Muted chicka 16ths"],["skank","Offbeat skank"],["power","Power-chord chug"],["pick","Fingerpicked"]]), i: opt("Guitar", INSTS(["nylon","steel","muted","drive"])) },
    gen(x){ const o = x.o, out = [], P = { folk: [[0,"D",4],[4,"D",2],[6,"U",2],[10,"U",2],[12,"D",2],[14,"U",2]], eighths: [[0,"D",2],[2,"U",2],[4,"D",2],[6,"U",2],[8,"D",2],[10,"U",2],[12,"D",2],[14,"U",2]],
        chicka: Array.from({ length: 16 }, (_, s) => [s, s % 2 ? "U" : "D", 0.8]), skank: [[2,"U",1],[6,"U",1],[10,"U",1],[14,"U",1]], power: [[0,"D",1.5],[2,"D",1.5],[4,"D",1.5],[6,"D",1.5],[8,"D",1.5],[10,"D",1.5],[12,"D",1.5],[14,"D",1.5]] };
      eachBar(x, (b, c0, off) => {
        if (o.pat === "pick") { for (let s = 0; s < 16; s += 2) { const v = guitarVoicing(x.ch(b, s)), idx = [0,2,1,3,2,4,3,2][s / 2] % v.length; out.push(E("strum", o.i, v[idx], off + s, 3.5, s % 4 ? 0.6 : 0.75)); } return; }
        for (const [s, dir, d] of P[o.pat]) { const c = x.ch(b, s); let v = guitarVoicing(c);
          if (o.pat === "power") v = [bassOf(c, 40, 47), bassOf(c, 40, 47) + 7, bassOf(c, 40, 47) + 12]; if (o.pat === "skank") v = v.slice(-3);
          if (dir === "U") v = v.slice(-4).reverse(); const acc = o.pat === "chicka" ? (s % 8 === 4 ? 0.85 : 0.45) : (dir === "D" ? 0.72 : 0.55);
          v.forEach((m, j) => out.push(E("strum", o.i, m, off + s + j * 0.06, d - j * 0.06, acc * (o.pat === "power" ? 1 : 0.8)))); } });
      return out; } },
  counter: { cat: "part", name: "Counter-melody", chairs: ["counter"],
    opts: { style: opt("Shape", [["answer","Answer (call and response)"],["contrary","Contrary motion"],["long","Long guide tones"],["adlib","Ad-lib fills"]]), i: opt("Instrument", INSTS(["violin","trumpet","sax","flute","harmonica","cello"])) },
    gen(x){ const o = x.o, i = o.i;
      if (o.style === "answer") return melody(x, { ch: "counter", i, density: "medium", contour: "fall", half: "second", vel: 0.72 });
      if (o.style === "adlib") return melody(x, { ch: "counter", i, density: "busy", contour: "arch", vel: 0.66 }).filter(e => (e.s % STEPS) >= 10 && Math.floor(e.s / STEPS) % 2 === 1);
      const [lo, hi] = lineRange(i), out = []; let prev = null;
      if (o.style === "long") { eachBar(x, (b, c, off) => { for (const s of [0, 8]) { const cc = x.ch(b, s), gt = [pc(cc.root + cc.ivs[1]), pc(cc.root + (cc.ivs[3] ?? cc.ivs[2]))];
          const n = fold(nearestPc(prev ?? Math.round((lo + hi) / 2), gt), lo, hi); out.push(E("counter", i, n, off + s, 7.6, 0.62, { sw: s === 0 })); prev = n; } }); return out; }
      let n = fold(nearestPc(hi - 4, chordPcs(x.ch(0, 0))), lo, hi); // contrary: falls stepwise while the bass climbs
      eachBar(x, (b, c, off) => { for (const s of [0, 8]) { const cc = x.ch(b, s); if (s === 0) n = fold(nearestPc(n, chordPcs(cc)), lo, hi); out.push(E("counter", i, n, off + s, 7.6, 0.66)); n = scaleStep(n, -1, barScale(cc, x.key)); if (n < lo) n += 12; } });
      return out; } },
  harmony: { cat: "part", name: "Harmony line", chairs: ["harmony"],
    opts: { iv: opt("Interval", [["third","A third under"],["sixth","A sixth above"],["octave","Octave double"]]), i: opt("Instrument", INSTS(["violin","trumpet","strings","choir","flute"])) },
    gen(x){ const o = x.o; let ref = x.sofar.filter(e => e.ch === "hook" || e.ch === "counter");
      if (!ref.length) ref = melody(Object.assign({}, x, { R: rng(hash(x.sec.id, "guide-melody")) }), { ch: "hook", i: "violin", density: "sparse", contour: "arch" });
      const [lo, hi] = [INST[o.i].lo, INST[o.i].hi];
      return ref.map(e => { const sc = barScale(x.ch(Math.floor(e.s / STEPS), e.s % STEPS), x.key); let n = o.iv === "third" ? scaleStep(e.n, -2, sc) : o.iv === "sixth" ? scaleStep(e.n, -2, sc) + 12 : e.n + 12;
        return E("harmony", o.i, fold(n, lo, hi), e.s, e.d, e.v * 0.8); }); } },
  organ: { cat: "part", name: "Organ", chairs: ["organ"],
    opts: { style: opt("Style", [["held","Held chords"],["swell","Swell in"],["gospel","Gospel chops"],["chops","Eighth chops"],["shuffle","Booker shuffle"]]) },
    gen(x){ const s = x.o.style; return chordsPart(x, { ch: "organ", i: "organ", rh: s === "held" || s === "swell" ? "whole" : s, lo: 53, hi: 77, sw: s === "swell", hold: true, vel: s === "held" || s === "swell" ? 0.55 : 0.6 }); } },
  figure: { cat: "part", name: "Melodic figure", chairs: ["figure"],
    opts: { pat: opt("Figure", [["arp","Rising arpeggio"],["broken","Broken chord 1-5-3-5"],["motif","1-5-8 motif"],["sparkle","Bell sparkle"],["ostinato","16th ostinato"]]), i: opt("Instrument", INSTS(["marimba","glock","vibes","harp","pizz","violin"])) },
    gen(x){ const o = x.o, out = [], d = INST[o.i], lo = Math.max(d.lo, 60), hi = Math.min(d.hi, lo + 19);
      eachBar(x, (b, c0, off) => { const seq = { arp: [0,1,2,3,2,1,0,1], broken: [0,2,1,2,0,2,1,2], motif: [0,2,3,-1,0,2,3,-1], sparkle: [-1,3,-1,-1,-1,2,-1,-1], ostinato: [0,2,0,1,0,2,0,1,0,2,0,1,0,2,0,1] }[o.pat];
        const st = seq.length === 16 ? 1 : 2; seq.forEach((k, j) => { if (k < 0) return; const s = j * st, c = x.ch(b, s), v = voicing(c, lo, hi, null, 3); v.push(v[0] + 12);
          out.push(E("figure", o.i, fold(v[k % v.length], d.lo, d.hi), off + s, o.pat === "sparkle" ? 6 : st * 1.4, (j % 2 ? 0.6 : 0.75) * (o.pat === "sparkle" ? 0.8 : 1))); }); });
      return out; } },
  hook: { cat: "part", name: "Hook line", chairs: ["hook"],
    opts: { contour: opt("Contour", [["question","Question / answer"],["rise","Rises"],["fall","Falls"],["arch","Arch"]]), density: opt("Density", [["medium","Medium"],["sparse","Sparse"],["busy","Busy"]]),
            i: opt("Instrument", INSTS(["violin","trumpet","flute","sax","harmonica","epiano","piano"])) },
    gen(x){ return melody(x, { ch: "hook", i: x.o.i, density: x.o.density, contour: x.o.contour }); } },
  pad: { cat: "part", name: "Pad / string bed", chairs: ["pad"],
    opts: { i: opt("Sound", INSTS(["strings","choir","horn","organ"])), style: opt("Motion", [["held","Held"],["swell","Swell every bar"],["pulse","Eighth pulse"],["rise","Top voice climbs"]]) },
    gen(x){ const o = x.o; if (o.style === "pulse") return chordsPart(x, { ch: "pad", i: o.i, rh: "chops", lo: 52, hi: 76, vel: 0.5 });
      if (o.style !== "rise") return chordsPart(x, { ch: "pad", i: o.i, rh: "whole", lo: 52, hi: 76, sw: o.style === "swell", hold: true, vel: 0.5 });
      const out = chordsPart(x, { ch: "pad", i: o.i, rh: "whole", lo: 50, hi: 70, hold: true, vel: 0.45, n: 3 }); let t = 67;
      eachBar(x, (b, c, off) => { t = fold(nearestPc(t + 1, chordPcs(c)), 64, 84); out.push(E("pad", o.i, t, off, 15.8, 0.5)); }); return out; } },

  // ===== Sections (insert a new section on the timeline) =====
  intro: { cat: "section", name: "Intro", where: "start", role: "intro",
    opts: { style: opt("Walk-in", [["walkin","Instruments walk in"],["drums","Drums first"],["keys","Keys alone"],["pedal","Tonic pedal"]]), bars: BARS(4, 8) },
    chords(x){ return x.o.style === "pedal" ? Array(x.bars).fill(0).map(() => [rom(x.key, x.key.mode === "minor" ? "i" : "I")]) : x.loopBars(x.bars); },
    guide(x){ return { walkin: x.o.style === "walkin", drums: x.o.style === "drums" ? "straight" : "none", keys: x.o.style === "drums" ? "none" : "whole", bass: x.o.style === "keys" ? "none" : "whole" }; },
    gen(x){ const out = [], L = (x.bars - 1) * STEPS; for (const [s, p] of [[12,"snare"],[13,"snare"],[14,"htom"],[15,"ltom"]]) out.push(kitHit("drums", p, L + s, 0.5 + s / 40, { imm: 1 })); out.push(kitHit("drums", "crash", x.bars * STEPS, 0.7)); return out; } },
  verse2: { cat: "section", name: "Verse 2", where: "after", role: "verse",
    opts: { style: opt("Development", [["answer","Answer line in the holes"],["pass","Second-pass inner motion"],["sparse","Sparser, ghosted"]]), bars: BARS(8, 16, 4) },
    chords(x){ return x.loopBars(x.bars); }, guide(x){ return x.o.style === "sparse" ? { keys: "whole", drums: "thin" } : {}; },
    gen(x){ if (x.o.style === "answer") return melody(x, { ch: "counter", i: "violin", density: "medium", contour: "fall", half: "second", vel: 0.68 });
      if (x.o.style === "pass") return chordsPart(Object.assign({}, x, { bars: x.bars }), { ch: "comp", i: "epiano", rh: "offbeat", lo: 60, hi: 74, n: 3, vel: 0.5 }).filter(e => e.s >= x.bars * 8);
      const out = []; eachBar(x, (b, c, o) => { for (const s of [3, 7, 11, 15]) out.push(kitHit("drums", "ghost", o + s, 0.35)); }); return out; } },
  pre: { cat: "section", name: "Pre-chorus", where: "before", role: "pre",
    opts: { harmony: opt("Harmony", [["climb","Climb (IV–V–vi–V)"],["suspend","Suspend on V"],["relative","Relative minor (vi–IV–ii–V)"]]), bars: BARS(4, 8, 2) },
    chords(x){ const P = x.key.mode === "minor" ? { climb: ["iv","v","bVI","bVII"], suspend: ["bVI","bVI","bVII","V"], relative: ["bIII","bVI","iv","V"] } : { climb: ["IV","V","vi","V"], suspend: ["IV","IV","Vsus","V"], relative: ["vi","IV","ii","V"] };
      const p = P[x.o.harmony]; return Array.from({ length: x.bars }, (_, b) => [rom(x.key, p[Math.min(3, Math.floor(b * 4 / x.bars))])]); },
    gen(x){ const out = MOVES.pad.gen(Object.assign({}, x, { o: { i: "strings", style: "rise" } }));
      const L = (x.bars - 1) * STEPS; for (let s = 8; s < 16; s += s < 12 ? 2 : 1) out.push(kitHit("drums", "snare", L + s, 0.4 + s / 40, { imm: 1 })); out.push(kitHit("drums", "crash", x.bars * STEPS, 0.7)); return out; } },
  bridge: { cat: "section", name: "Bridge / middle 8", where: "after", role: "bridge",
    opts: { harmony: opt("Harmony", [["relative","Relative minor"],["four","Lean on IV"],["borrowed","Borrowed bVI–bVII"],["pedal","Dominant pedal"]]), bars: BARS(8, 4, 16) },
    chords(x){ const P = x.key.mode === "minor" ? { relative: ["bIII","bVII","iv","bVI","bIII","bVII","iv","V"], four: ["iv","v","bVI","bVII","iv","v","bVI","V"], borrowed: ["bVI","bVII","bIII","bIII","bVI","bVII","iv","V"], pedal: ["iv","iv","V","V","bVI","bVI","Vsus","V"] }
        : { relative: ["vi","IV","I","V","vi","IV","ii","V"], four: ["IV","V","iii","vi","IV","V","IV","V"], borrowed: ["bVI","bVII","I","I","bVI","bVII","IV","V"], pedal: ["IV","IV","V","V","IV","IV","Vsus","V"] };
      const p = P[x.o.harmony]; return Array.from({ length: x.bars }, (_, b) => [rom(x.key, p[Math.floor(b * 8 / x.bars) % 8])]); },
    guide(x){ return x.o.harmony === "pedal" ? { bass: "dompedal" } : {}; },
    gen(x){ return MOVES.pad.gen(Object.assign({}, x, { o: { i: "strings", style: "swell" } })).concat([kitHit("drums", "crash", x.bars * STEPS, 0.7)]); } },
  post: { cat: "section", name: "Post-chorus", where: "after", role: "chorus",
    opts: { style: opt("Style", [["vamp","Vamp on two chords"],["chant","Chant riff"],["drop","Drums + bass + stabs"]]), bars: BARS(4, 8) },
    chords(x){ const l = x.loopBars(2); if (x.o.style === "chant") return Array.from({ length: x.bars }, (_, b) => [rom(x.key, b % 2 ? (x.key.mode === "minor" ? "bVI" : "IV") : (x.key.mode === "minor" ? "i" : "I"))]);
      if (x.o.style === "drop") return Array.from({ length: x.bars }, () => [l[0][0]]); return Array.from({ length: x.bars }, (_, b) => [l[b % 2][0]]); },
    guide(x){ return x.o.style === "drop" ? { keys: "none" } : {}; },
    gen(x){ if (x.o.style === "drop") return chordsPart(x, { ch: "comp", i: "trumpet", rh: "stabs", lo: 58, hi: 77, n: 3, vel: 0.6 });
      return melody(Object.assign({}, x, { R: rng(hash(x.seed, "chant")) }), { ch: "figure", i: x.o.style === "chant" ? "marimba" : "vibes", density: "busy", contour: "question", to: Math.min(2, x.bars) }).flatMap(e => Array.from({ length: Math.ceil(x.bars / 2) }, (_, k) => Object.assign({}, e, { s: e.s + k * 32 }))).filter(e => e.s < x.bars * STEPS); } },
  last: { cat: "section", name: "Last chorus lift", where: "after", role: "chorus",
    opts: { lift: opt("Lift", [["stack","Stack (strings, tambourine, crash)"],["choir","Choir loft"],["double","Brass + strings double"],["halfdrop","Half-time, then full"]]) },
    chords(x){ return x.loopBars(x.bars); }, bars(x){ return x.loopBarsN; },
    guide(x){ return x.o.lift === "halfdrop" ? { drums: "halfthenfull" } : {}; },
    gen(x){ const o = x.o.lift, out = [];
      if (o === "stack" || o === "double") out.push(...MOVES.pad.gen(Object.assign({}, x, { o: { i: "strings", style: "held" } })));
      if (o === "choir") out.push(...MOVES.pad.gen(Object.assign({}, x, { o: { i: "choir", style: "swell" } })));
      if (o === "double") out.push(...melody(x, { ch: "counter", i: "trumpet", density: "medium", contour: "arch", half: "second", vel: 0.7 }));
      if (o === "stack") eachBar(x, (b, c, off) => { for (const s of [4, 12]) out.push(kitHit("perc", "tamb", off + s, 0.6)); });
      for (let b = 0; b < x.bars; b += 4) out.push(kitHit("drums", "crash", b * STEPS, 0.6)); return out; } },
  keychange: { cat: "section", name: "Key change", where: "after", role: "chorus",
    opts: { up: opt("Up by", [[2,"Whole step (+2)"],[1,"Half step (+1, truck driver)"],[3,"Minor third (+3)"]]), pivot: opt("Pivot", [["v7","V7 of the new key, 1 bar"],["none","No pivot (straight in)"],["stop","1 bar stop, then in"]]) },
    bars(x){ return x.loopBarsN + (x.o.pivot === "none" ? 0 : 1); }, shift(o){ return +o.up; },
    chords(x){ const piv = x.o.pivot !== "none" ? 1 : 0, l = x.loopBars(x.bars - piv); return piv ? [[x.o.pivot === "v7" ? rom(x.key, "V7") : rom(x.key, "V")]].concat(l) : l; },
    gen(x){ const piv = x.o.pivot !== "none" ? 1 : 0, out = [kitHit("drums", "crash", piv * STEPS, 0.75)];
      out.push(...MOVES.pad.gen(Object.assign({}, x, { o: { i: "strings", style: "held" } })).filter(e => e.s >= piv * STEPS));
      if (x.o.pivot === "stop") x.masks.push(evs => evs.filter(e => e.imm || e.s >= STEPS || e.s === 0 && e.ch !== "gdrums" || e.ch === "gdrums" && e.s === 0));
      if (piv) for (const s of [8, 10, 12, 13, 14, 15]) out.push(kitHit("drums", "snare", s, 0.45 + s / 40, { imm: 1 })); return out; } },
  cadence: { cat: "section", name: "Cadence", where: "after", role: "ending",
    opts: { type: opt("Cadence", [["authentic","Authentic (ii–V–I)"],["plagal","Plagal (IV–I)"],["deceptive","Deceptive (V–vi)"],["half","Half (ends on V)"],["borrowed","Borrowed iv–I"],["picardy","Picardy (minor to major I)"]]), bars: BARS(4, 8) },
    chords(x){ const m = x.key.mode === "minor", P = m ? { authentic: ["iv","V7","i","i"], plagal: ["iv","iv","i","i"], deceptive: ["iv","V7","bVI","bVI"], half: ["i","iv","V","V"], borrowed: ["bVI","bVII","i","i"], picardy: ["iv","V7","I","I"] }
        : { authentic: ["ii","V7","I","I"], plagal: ["IV","IV","I","I"], deceptive: ["IV","V7","vi","vi"], half: ["I","IV","V","V"], borrowed: ["IV","iv","I","I"], picardy: ["IV","V7","I","I"] };
      const p = P[x.o.type]; return Array.from({ length: x.bars }, (_, b) => [rom(x.key, p[Math.min(3, Math.floor(b * 4 / x.bars))])]); },
    guide(){ return { keys: "half", drums: "thin" }; },
    gen(x){ const out = MOVES.pad.gen(Object.assign({}, x, { o: { i: "strings", style: "swell" } }));
      eachBar(x, (b, c, o) => { const n = fold(c.root + 48, 40, 60); out.push(E("counter", "cello", n, o, 15.6, 0.55)); }); return out; } },
  solo: { cat: "section", name: "Instrumental solo", where: "after", role: "chorus",
    opts: { i: opt("Soloist", INSTS(["sax","trumpet","violin","drive","harmonica","flute"])), bars: BARS(8, 16, 4) },
    chords(x){ return x.loopBars(x.bars); },
    gen(x){ const d = INST[x.o.i]; return melody(x, { ch: "hook", i: x.o.i, density: "busy", contour: "rise", lo: Math.max(d.lo, 55), hi: Math.min(d.hi, 84), vel: 0.78 }); } },

  // ===== Transitions =====
  build: { cat: "transition", name: "Build", where: "before", role: "build",
    opts: { style: opt("Build", [["all","Snare roll + toms + swell"],["snare","Snare roll"],["toms","Tom climb"],["swell","String swell"],["stack","Stack one chair per bar"]]), harmony: opt("Harmony", [["loop","Your chords"],["dominant","Sit on V"]]), bars: BARS(4, 2, 8) },
    chords(x){ return x.o.harmony === "dominant" ? Array.from({ length: x.bars }, () => [rom(x.key, "V")]) : x.loopBars(x.bars); },
    guide(x){ return x.o.style === "stack" ? { stack: true } : { drums: "kick4" }; },
    gen(x){ const st = x.o.style, out = [], N = x.bars * STEPS;
      if (st === "all" || st === "snare" || st === "stack") for (let s = 0; s < N; s++) { const p = s / N, every = p < 0.25 ? 4 : p < 0.5 ? 2 : 1; if (s % every === 0) out.push(kitHit("drums", "snare", s, 0.3 + 0.55 * p, { imm: 1 })); }
      if (st === "all" || st === "toms") for (let s = N - 8; s < N; s++) out.push(kitHit("drums", s < N - 4 ? "htom" : "ltom", s, 0.75, { imm: 1 }));
      if (st === "toms") for (let s = 0; s < N - 8; s += 4) out.push(kitHit("drums", s % 8 ? "ltom" : "htom", s, 0.4 + 0.4 * s / N));
      if (st === "all" || st === "swell") eachBar(x, (b, c, o) => { if (b % 2 === 0) { const v = voicing(c, 55 + b, 79, null, 3); for (const m of v) out.push(E("pad", "strings", m, o, Math.min(2, x.bars - b) * STEPS - 0.2, 0.55, { sw: true })); } });
      out.push(kitHit("drums", "crash", N, 0.8), kitHit("drums", "kick", N, 0.9)); return out; } },
  drop: { cat: "transition", name: "Drop", where: "after", role: "drop",
    opts: { style: opt("Drop", [["full","Full band, four on the floor"],["half","Half-time drop"],["bass","Kick + bass + stabs only"]]), air: opt("Air before it", [["yes","Silence the last beat before"],["no","No gap"]]), bars: BARS(8, 4, 16) },
    chords(x){ return x.loopBars(x.bars); },
    guide(x){ return x.o.style === "half" ? { drums: "half" } : x.o.style === "bass" ? { drums: "kick4", keys: "none", bass: "octave" } : { drums: "four", bass: "octave" }; },
    prevMask(x){ return x.o.air === "yes" ? 4 : 0; },
    gen(x){ const out = [kitHit("drums", "crash", 0, 0.85)]; if (x.o.style === "bass") out.push(...chordsPart(x, { ch: "comp", i: "trumpet", rh: "stabs", lo: 58, hi: 77, n: 3, vel: 0.62 })); return out; } },
  brk: { cat: "transition", name: "Break / breakdown", where: "after", role: "verse",
    opts: { style: opt("Who plays", [["drums","Drum break"],["keys","Keys alone (breath)"],["bassdrums","Bass + drums"],["floor","Breakdown floor (kick + pad)"]]), bars: BARS(4, 2, 8) },
    chords(x){ return x.loopBars(x.bars); },
    guide(x){ return { drums: "keys bassdrums".includes(x.o.style) && x.o.style === "keys" ? "none" : x.o.style === "floor" ? "kick4" : "straight", keys: x.o.style === "keys" ? "half" : "none", bass: x.o.style === "bassdrums" ? "root" : x.o.style === "floor" ? "whole" : "none" }; },
    gen(x){ const out = [];
      if (x.o.style === "drums") eachBar(x, (b, c, o) => { for (const [s, p] of [[3,"ghost"],[6,"kick"],[7,"ghost"],[11,"ghost"],[14,"htom"],[15,"ltom"]]) if (b % 2 || s < 14) out.push(kitHit("drums", p, o + s, p === "ghost" ? 0.4 : 0.7)); });
      if (x.o.style === "floor") out.push(...MOVES.pad.gen(Object.assign({}, x, { o: { i: "strings", style: "swell" } })));
      return out; } },
  fill: { cat: "transition", name: "Drum fill", chairs: ["drums"],
    opts: { style: opt("Fill", [["snaretom","Snare into toms"],["snare","Snare 16ths"],["toms","Tom run"],["kick","Kick pickup"]]), len: opt("Length", [[4,"Last beat"],[8,"Last 2 beats"],[16,"Last bar"]], 8) },
    gen(x){ const N = x.bars * STEPS, L = +x.o.len, out = []; x.masks.push(evs => evs.filter(e => e.ch !== "gdrums" || e.s < N - L || e.n === D.kick && e.s === N - L));
      for (let s = N - L; s < N; s++) { const p = (s - (N - L)) / L, st = x.o.style;
        if (st === "kick") { if (s >= N - 4 && s % 2 === 0 || s === N - 1) out.push(kitHit("drums", "kick", s, 0.8, { imm: 1 })); continue; }
        if (L >= 16 && s % 2 && p < 0.5) continue;
        const piece = st === "snare" ? "snare" : st === "toms" ? (p < 0.5 ? "htom" : "ltom") : (p < 0.5 ? "snare" : p < 0.75 ? "htom" : "ltom"); out.push(kitHit("drums", piece, s, 0.45 + 0.4 * p, { imm: 1 })); }
      out.push(kitHit("drums", "crash", N, 0.8)); return out; } },
  stop: { cat: "transition", name: "Stop-time", chairs: [],
    opts: { hits: opt("Hits", [["one","Hit on 1, hold the rest"],["oneand","Hits on 1 and the and of 2"],["last2","Only the last 2 bars"],["die","False ending: last 2 bars silent"]]) },
    gen(x){ const N = x.bars * STEPS, h = x.o.hits, hitSet = h === "oneand" ? [0, 6] : [0];
      x.masks.push(evs => evs.filter(e => { if (e.imm) return true; const b = Math.floor(e.s / STEPS), s = e.s - b * STEPS, inZone = h === "last2" || h === "die" ? b >= x.bars - 2 : true;
        if (!inZone) return true; if (h === "die") return false; if (!hitSet.some(k => Math.abs(s - k) < 0.5)) return false; if (e.ch === "gdrums" || e.ch === "drums") return e.n === D.kick || e.n === D.crash || e.n === D.snare; e.d = Math.min(e.d, 1.8); return true; }));
      const out = []; if (h !== "die") for (let b = h === "last2" ? x.bars - 2 : 0; b < x.bars; b++) for (const k of hitSet) out.push(kitHit("drums", "crash", b * STEPS + k, 0.55, { imm: 1 }));
      if (h === "die") out.push(kitHit("drums", "snare", N - 2, 0.6, { imm: 1 }), kitHit("drums", "snare", N - 1, 0.75, { imm: 1 })); return out; } },
  half: { cat: "transition", name: "Half-time", chairs: [],
    opts: { where: opt("Where", [["all","Whole section"],["second","Second half only"]]) },
    gen(x){ x.guide.drums = x.o.where === "all" ? "half" : "halfsecond"; if (x.o.where === "all") x.guide.bass = "two"; return []; } },
  lift: { cat: "transition", name: "Lift / pickup", chairs: ["bass","drums","hook"],
    opts: { style: opt("Pickup", [["walkup","Bass walk-up"],["flam","Snare flams, crescendo"],["kickpush","Kick push on the and of 4"],["brass","Trumpet pickup line"],["stopin","Stop, then pickup on the and of 4"],["roll","Piano roll up"]]) },
    gen(x){ const N = x.bars * STEPS, L = N - STEPS, nr = bassOf(x.next, 28, 43), out = [], st = x.o.style;
      if (st === "walkup") { x.masks.push(evs => evs.filter(e => !(e.ch === "gbass" || e.ch === "bass") || e.s < N - 8)); [nr - 3, nr - 2, nr - 1].forEach((n, k) => out.push(E("bass", "upright", n, N - 6 + k * 2, 1.8, 0.85, { imm: 1 }))); out.push(E("bass", "upright", nr - 4, N - 8, 1.8, 0.85, { imm: 1 })); }
      if (st === "flam") for (let s = N - 4; s < N; s++) { out.push(kitHit("drums", "snare", s, 0.5 + (s - N + 4) * 0.12, { imm: 1 })); out.push(kitHit("drums", "ghost", s + 0.12, 0.35, { imm: 1 })); }
      if (st === "kickpush") out.push(kitHit("drums", "kick", N - 2, 0.85, { imm: 1 }), kitHit("drums", "kick", N - 1, 0.7, { imm: 1 }));
      if (st === "brass" || st === "stopin") { const t = fold(nearestPc(70, chordPcs(x.next)), 62, 80), sc = barScale(x.next, x.key); [scaleStep(t, -2, sc), scaleStep(t, -1, sc)].forEach((n, k) => out.push(E("hook", "trumpet", n, N - 4 + k * 2, 1.7, 0.75, { imm: 1 }))); out.push(E("hook", "trumpet", t, N, 6, 0.8)); }
      if (st === "stopin") { x.masks.push(evs => evs.filter(e => e.imm || e.s < N - 8)); out.push(kitHit("drums", "snare", N - 2, 0.8, { imm: 1 })); }
      if (st === "roll") { const v = voicing(x.next, 60, 84, null, 3); for (let k = 0; k < 6; k++) out.push(E("hook", "piano", v[k % 3] + 12 * Math.floor(k / 3) - 12, N - 3 + k * 0.5, 2.5, 0.55 + k * 0.05, { imm: 1 })); }
      out.push(kitHit("drums", "crash", N, 0.7)); return out; } },
  slide: { cat: "transition", name: "Bass slide", chairs: ["bass"],
    opts: { dir: opt("Slide", [["up","Slide up into the next 1"],["down","Fall down into the next 1"]]), i: opt("Bass", INSTS(["finger","upright"])) },
    gen(x){ const N = x.bars * STEPS, nr = bassOf(x.next, 31, 46), gl = x.o.dir === "up" ? 4 : -4;
      x.masks.push(evs => evs.filter(e => !(e.ch === "gbass" || e.ch === "bass") || e.s < N - 8));
      return [E("bass", x.o.i, nr, N - 8, 7.8, 0.9, { gl, imm: 1 }), kitHit("drums", "kick", N - 8, 0.8, { imm: 1 }), kitHit("drums", "crash", N, 0.7)]; } },
  tension: { cat: "transition", name: "Tension & release", chairs: ["bass","pad","counter"],
    opts: { style: opt("Tension", [["dompedal","Dominant pedal under the chords"],["tonicpedal","Tonic pedal"],["sus","Sus4 suspensions resolving"],["contrary","Contrary lines (violin falls, bass climbs)"]]) },
    gen(x){ const st = x.o.style, out = [];
      if (st === "dompedal" || st === "tonicpedal") { x.guide.bass = "none"; eachBar(x, (b, c) => out.push(...bassLine(x, b, c, x.next, st === "dompedal" ? "dompedal" : "pedal", "upright", x.R))); out.push(...MOVES.pad.gen(Object.assign({}, x, { o: { i: "strings", style: "held" } }))); }
      if (st === "sus") eachBar(x, (b, c, o) => { const s4 = mk(c.root, "sus4"), v1 = voicing(s4, 57, 76, null, 3), v2 = voicing(c, 57, 76, v1, 3); v1.forEach(m => out.push(E("pad", "strings", m, o, 7.8, 0.5))); v2.forEach(m => out.push(E("pad", "strings", m, o + 8, 7.8, 0.5))); });
      if (st === "contrary") { out.push(...MOVES.counter.gen(Object.assign({}, x, { o: { style: "contrary", i: "violin" } }))); x.guide.bass = "none"; let n = bassOf(x.ch(0, 0), 31, 43);
        eachBar(x, (b, c, o) => { for (const s of [0, 8]) { const cc = x.ch(b, s); if (s === 0) n = fold(nearestPc(n, chordPcs(cc)), 28, 50); out.push(E("bass", "upright", n, o + s, 7.6, 0.85)); n = scaleStep(n, 1, barScale(cc, x.key)); } }); }
      return out; } },
  turn: { cat: "transition", name: "Turnaround", chairs: [],
    opts: { type: opt("Turnaround", [["iiV","ii–V into the next 1"],["V7","V7 of the next chord"],["bVII","bVII (rock turn)"],["walkdown","Bass walks down"]]) },
    chordMod(x, bars){ const n = x.next, L = bars.length - 1; if (L < 0) return;
      if (x.o.type === "iiV") bars[L] = [mk(n.root + 2, "m7"), Object.assign(mk(n.root + 7, "7"), { at: 8 })];
      if (x.o.type === "V7") bars[L] = [mk(n.root + 7, "7")]; if (x.o.type === "bVII") bars[L] = [mk(n.root + 10, "")]; },
    gen(x){ if (x.o.type !== "walkdown") return []; const N = x.bars * STEPS, nr = bassOf(x.next, 31, 43); x.masks.push(evs => evs.filter(e => !(e.ch === "gbass" || e.ch === "bass") || e.s < N - STEPS));
      return [nr + 4, nr + 3, nr + 2, nr + 1].map((n, k) => E("bass", "upright", n, N - 16 + k * 4, 3.6, 0.85, { imm: 1 })); } },

  // ===== Endings (appended at the end) =====
  tag: { cat: "ending", name: "Tag", where: "end", role: "chorus",
    opts: { style: opt("Tag", [["repeat","Say the last line twice"],["deceptive","Deceptive, then home"]]) }, bars(){ return 5; },
    chords(x){ const l = x.loopBarsAll, a = (l[l.length - 2] || l[0])[0], b = l[l.length - 1][0], m = x.key.mode === "minor", T = rom(x.key, m ? "i" : "I");
      return x.o.style === "repeat" ? [[a], [b], [a], [b], [T]] : [[rom(x.key, m ? "iv" : "IV")], [rom(x.key, "V7")], [rom(x.key, m ? "bVI" : "vi")], [rom(x.key, "V7")], [T]]; },
    gen(x){ x.masks.push(evs => evs.filter(e => e.s < 4 * STEPS || e.s === 4 * STEPS && e.ch !== "gdrums" || e.ch === "gdrums" && e.s === 4 * STEPS && (e.n === D.kick))); return [kitHit("drums", "crash", 4 * STEPS, 0.8)].concat(voicing(x.ch(4, 0), 48, 76, null, 4).map(n => E("pad", "strings", n, 4 * STEPS, 15.5, 0.55))); } },
  button: { cat: "ending", name: "Button ending", where: "end", role: "hit",
    opts: { style: opt("Button", [["hit","One tight hit on 1"],["held","Hit and hold"],["false","False ending, then the hit"]]) }, bars(x){ return x.o.style === "false" ? 3 : 1; },
    chords(x){ const T = rom(x.key, x.key.mode === "minor" ? "i" : "I"); return x.o.style === "false" ? [[rom(x.key, "V7")], [rom(x.key, "V7")], [T]] : [[T]]; },
    guide(){ return { keys: "none", bass: "none", drums: "none" }; },
    gen(x){ const o = (x.bars - 1) * STEPS, c = x.ch(x.bars - 1, 0), d = x.o.style === "held" ? 15.5 : 1.5, out = [kitHit("drums", "kick", o, 0.95), kitHit("drums", "crash", o, 0.8), kitHit("drums", "snare", o, 0.7)];
      for (const n of voicing(c, 52, 76, null, 4)) out.push(E("comp", "piano", n, o, d, 0.7)); out.push(E("bass", "upright", bassOf(c, 28, 43), o, d, 0.95));
      if (x.o.style === "held") out.push(...voicing(c, 55, 79, null, 3).map(n => E("pad", "strings", n, o, 15.5, 0.5)));
      if (x.o.style === "false") { out.push(kitHit("drums", "snare", o - 2, 0.6), kitHit("drums", "snare", o - 1, 0.75)); for (const n of voicing(x.ch(0, 0), 52, 76, null, 4)) out.push(E("comp", "piano", n, 0, 1.5, 0.7)); out.push(kitHit("drums", "crash", 0, 0.7)); }
      return out; } },
  fade: { cat: "ending", name: "Fade-out", where: "end", role: "chorus",
    opts: { bars: BARS(8, 16, 4) }, chords(x){ return x.loopBars(x.bars); },
    gen(x){ const N = x.bars * STEPS; x.masks.push(evs => evs.map(e => Object.assign(e, { v: e.v * Math.max(0.03, 1 - e.s / N) }))); return melody(x, { ch: "counter", i: "violin", density: "sparse", contour: "fall", vel: 0.6 }); } },
  amen: { cat: "ending", name: "Amen (plagal) ending", where: "end", role: "ending",
    opts: { who: opt("Choir", [["both","Organ + choir"],["organ","Organ"],["choir","Choir"]]), final: opt("Last chord", [["home","Home chord"],["picardy","Major I (Picardy, in minor)"]]) }, bars(){ return 4; },
    chords(x){ const m = x.key.mode === "minor", T = rom(x.key, m && x.o.final !== "picardy" ? "i" : "I"); return [[rom(x.key, m ? "iv" : "IV")], [rom(x.key, m ? "iv" : "IV")], [T], [T]]; },
    guide(){ return { drums: "none", keys: "whole", bass: "whole" }; },
    gen(x){ const out = []; if (x.o.who !== "choir") out.push(...chordsPart(x, { ch: "organ", i: "organ", rh: "whole", lo: 53, hi: 77, sw: true, hold: true, vel: 0.55 }));
      if (x.o.who !== "organ") out.push(...MOVES.pad.gen(Object.assign({}, x, { o: { i: "choir", style: "swell" } }))); return out; } },
  rideout: { cat: "ending", name: "Ride-out", where: "end", role: "chorus",
    opts: { i: opt("Ad-libs", INSTS(["sax","trumpet","violin","drive","harmonica"])), bars: BARS(8, 16) },
    chords(x){ const l = x.loopBars(x.bars - 1); return l.concat([[rom(x.key, x.key.mode === "minor" ? "i" : "I")]]); },
    gen(x){ const N = (x.bars - 1) * STEPS, out = melody(x, { ch: "hook", i: x.o.i, density: "busy", contour: "arch", to: x.bars - 1, vel: 0.72 });
      x.masks.push(evs => evs.filter(e => e.s < N || e.s === N && e.ch !== "gdrums" && e.ch !== "drums")); out.push(kitHit("drums", "crash", N, 0.85, { imm: 1 }), kitHit("drums", "kick", N, 0.9, { imm: 1 }));
      for (const n of voicing(x.ch(x.bars - 1, 0), 52, 76, null, 4)) out.push(E("pad", "strings", n, N, 15.5, 0.5, { imm: 1 })); return out; } },

  // ===== Feel =====
  ghost: { cat: "feel", name: "Ghost notes", chairs: ["drums"],
    opts: { style: opt("Ghosts", [["chatter","Snare chatter on the e and a"],["hats","16th hats with accents"],["side","Side-stick + ghosts"],["late","Late kick (a of 2, and of 3)"]]) },
    gen(x){ const st = x.o.style, out = [];
      eachBar(x, (b, c, o) => { if (st === "chatter" || st === "side") for (const s of [3, 7, 9, 11, 15]) if (x.R() < 0.8) out.push(kitHit("drums", "ghost", o + s, 0.3 + x.R() * 0.12));
        if (st === "hats") for (let s = 0; s < 16; s++) out.push(kitHit("drums", "hat", o + s, s % 4 === 2 ? 0.55 : s % 2 ? 0.22 : 0.35));
        if (st === "side") for (const s of [4, 12]) out.push(kitHit("drums", "rim", o + s, 0.7));
        if (st === "late") for (const s of [7, 10]) out.push(kitHit("drums", "kick", o + s, 0.6)); });
      if (st === "side") x.masks.push(evs => evs.filter(e => !(e.ch === "gdrums" && e.n === D.snare))); if (st === "hats") x.masks.push(evs => evs.filter(e => !(e.ch === "gdrums" && e.n === D.hat)));
      return out; } },
  space: { cat: "feel", name: "Space / hush", chairs: [],
    opts: { style: opt("Space", [["hush","Hush to near-silence"],["air","Air: drums out for the first half"],["hold","Hold: everyone holds whole notes"],["thin","Thin to bass + drums"],["cut","Cut the last 2 bars to one chair"]]) },
    gen(x){ const st = x.o.style, N = x.bars * STEPS;
      if (st === "hush") { Object.assign(x.guide, { keys: "whole", bass: "whole", drums: "hush" }); x.masks.push(evs => evs.map(e => e.imm ? e : Object.assign(e, { v: e.v * 0.6 }))); }
      if (st === "air") x.masks.push(evs => evs.filter(e => e.imm || !(e.ch === "gdrums" || e.ch === "drums" || e.ch === "perc") || e.s >= N / 2));
      if (st === "hold") { Object.assign(x.guide, { keys: "whole", bass: "whole", drums: "thin" }); x.masks.push(evs => evs.filter(e => e.imm || e.i === "kit" || e.s % STEPS === 0).map(e => e.i === "kit" || e.imm ? e : Object.assign(e, { d: Math.max(e.d, 15.5) }))); }
      if (st === "thin") x.masks.push(evs => evs.filter(e => e.imm || ["gbass", "bass", "gdrums", "drums"].includes(e.ch)));
      if (st === "cut") x.masks.push(evs => evs.filter(e => e.imm || e.s < N - 32 || e.ch === "gkeys" || e.ch === "comp"));
      return []; } },
  pocket: { cat: "feel", name: "Pocket", chairs: ["drums","bass"],
    opts: { style: opt("Pocket", [["rim","Rim click 2 and 4"],["clave","3-2 son clave (rim click)"],["and","Kick on 1, bass on the and"],["four","Four on the floor"],["tight","Tight 16th hats + staccato bass"]]) },
    gen(x){ const st = x.o.style, out = [];
      eachBar(x, (b, c, o) => { if (st === "rim") for (const s of [4, 12]) out.push(kitHit("drums", "rim", o + s, 0.7));
        if (st === "clave") for (const s of (b % 2 ? [4, 8] : [0, 6, 12])) out.push(kitHit("drums", "rim", o + s, 0.75));
        if (st === "four") for (const s of [0, 4, 8, 12]) out.push(kitHit("drums", "kick", o + s, 0.85));
        if (st === "tight") for (let s = 0; s < 16; s++) out.push(kitHit("drums", "hat", o + s, s % 4 === 0 ? 0.5 : 0.25)); });
      if (st === "and") { x.guide.bass = "none"; eachBar(x, (b, c) => out.push(...bassLine(x, b, c, x.next, "push", "upright", x.R))); }
      if (st === "rim" || st === "clave") x.masks.push(evs => evs.filter(e => !(e.ch === "gdrums" && e.n === D.snare)));
      if (st === "tight") x.masks.push(evs => evs.map(e => (e.ch === "gbass" || e.ch === "bass") ? Object.assign(e, { d: Math.min(e.d, 1.5) }) : e).filter(e => !(e.ch === "gdrums" && e.n === D.hat)));
      return out; } },
  shaker: { cat: "feel", name: "Shaker & tambourine", chairs: ["perc"],
    opts: { style: opt("Pattern", [["both","Shaker 16ths + tambourine on 2 and 4"],["shaker","Shaker 16ths"],["eighths","Shaker eighths"],["tamb","Tambourine on 2 and 4"]]) },
    gen(x){ const st = x.o.style, out = []; eachBar(x, (b, c, o) => {
        if (st === "both" || st === "shaker") for (let s = 0; s < 16; s++) out.push(kitHit("perc", "shaker", o + s, s % 4 === 2 ? 0.75 : s % 2 ? 0.4 : 0.55));
        if (st === "eighths") for (let s = 0; s < 16; s += 2) out.push(kitHit("perc", "shaker", o + s, s % 4 ? 0.75 : 0.5));
        if (st === "both" || st === "tamb") for (const s of [4, 12]) out.push(kitHit("perc", "tamb", o + s, 0.65)); }); return out; } },
  room: { cat: "feel", name: "Room", chairs: [],
    opts: { size: opt("Room", [["0.18","Small room"],["0.32","Medium hall"],["0.5","Big hall"]]) },
    gen(x){ const r = +x.o.size; x.masks.push(evs => evs.map(e => Object.assign(e, { room: r }))); return []; } }
};
for (const [id, m] of Object.entries(MOVES)) { m.id = id; m.type = m.where ? "section" : m.chordMod || !m.chairs || !m.chairs.length || m.cat === "transition" || m.cat === "feel" ? "mod" : "part"; }
const CATS = [["part", "Parts"], ["section", "Sections"], ["transition", "Transitions"], ["ending", "Endings"], ["feel", "Feel"]];
const defOpts = id => Object.fromEntries(Object.entries(MOVES[id].opts || {}).map(([k, v]) => [k, v.def]));
// old desk -> move + preset (see MERGE-PLAN.md); type an old desk's name in Browse to load its preset
const DESKS = {"MuteEight":["space",{"style":"cut"}],"BarNine":["turn",{"type":"V7"}],"LiftFour":["lift",{"style":"walkup"}],"EndEight":["last",{"lift":"stack"}],"TurnTwo":["turn",{"type":"iiV"}],"OpenEight":["intro",{"style":"walkin","bars":"8"}],"VerseTwo":["verse2",{"style":"pass"}],"BridgeEight":["bridge",{"harmony":"relative","bars":"8"}],"LastHook":["last",{"lift":"double"}],"AfterHook":["post",{"style":"vamp"}],"PreEight":["pre",{"harmony":"climb","bars":"8"}],"ModEight":["keychange",{"up":"2","pivot":"v7"}],"TagFour":["tag",{"style":"repeat"}],"HalfEight":["half",{"where":"all"}],"LiftTwo":["lift",{"style":"kickpush"}],"FillFour":["fill",{"style":"snaretom","len":"16"}],"ButtonFour":["button",{"style":"hit"}],"RideEight":["rideout",{"i":"sax","bars":"8"}],"StopFour":["stop",{"hits":"oneand"}],"CallFour":["counter",{"style":"answer","i":"trumpet"}],"NeedThree":["strum",{"pat":"folk","i":"nylon"}],"GhostEight":["ghost",{"style":"chatter"}],"BreakFour":["brk",{"style":"drums","bars":"4"}],"StabFour":["comp",{"rh":"stabs","i":"trumpet"}],"DropEight":["drop",{"style":"full","bars":"8"}],"OrganEight":["organ",{"style":"gospel"}],"MidEight":["bridge",{"harmony":"four","bars":"8"}],"SoloEight":["solo",{"i":"sax","bars":"8"}],"TurnFour":["turn",{"type":"walkdown"}],"SlideTwo":["slide",{"dir":"up","i":"finger"}],"ChoirEight":["pad",{"i":"choir","style":"held"}],"SwellFour":["pad",{"i":"strings","style":"swell"}],"BuildFour":["build",{"style":"all","bars":"4"}],"RiseEight":["build",{"style":"stack","bars":"8"}],"WalkEight":["bass",{"style":"walk","i":"upright"}],"RhodesEight":["comp",{"rh":"half","i":"epiano","voicing":"spread"}],"CongaFour":["pocket",{"style":"clave"}],"PedalFour":["tension",{"style":"tonicpedal"}],"HarpFour":["figure",{"pat":"arp","i":"harp"}],"PizzFour":["figure",{"pat":"ostinato","i":"pizz"}],"PivotFour":["turn",{"type":"bVII"}],"ChickFour":["strum",{"pat":"chicka","i":"muted"}],"RimFour":["pocket",{"style":"rim"}],"VibesFour":["figure",{"pat":"broken","i":"vibes"}],"OpenFour":["intro",{"style":"keys","bars":"4"}],"SteelFour":["strum",{"pat":"folk","i":"steel"}],"CueFour":["lift",{"style":"stopin"}],"BowFour":["pad",{"i":"strings","style":"held"}],"BridgeFour":["bridge",{"harmony":"relative","bars":"4"}],"ClapFour":["ghost",{"style":"side"}],"GlockFour":["figure",{"pat":"sparkle","i":"glock"}],"LeadFour":["hook",{"contour":"arch","i":"trumpet"}],"DropFour":["drop",{"style":"full","bars":"4"}],"MarimFour":["figure",{"pat":"ostinato","i":"marimba"}],"TomTwo":["fill",{"style":"toms","len":"8"}],"AltoFour":["hook",{"contour":"rise","i":"sax"}],"BassFour":["bass",{"style":"octave","i":"finger"}],"FingerFour":["bass",{"style":"motown","i":"finger"}],"AirFour":["space",{"style":"air"}],"RiffFour":["strum",{"pat":"power","i":"drive"}],"HarmFour":["hook",{"contour":"question","i":"harmonica"}],"AdlibFour":["counter",{"style":"adlib","i":"trumpet"}],"RhodesFour":["comp",{"rh":"charleston","i":"epiano"}],"WalkFour":["bass",{"style":"walk","i":"upright"}],"DrawFour":["organ",{"style":"chops"}],"Exhale":["amen",{"who":"organ","final":"home"}],"HoldFour":["space",{"style":"hold"}],"UpStep":["keychange",{"up":"1","pivot":"stop"}],"ChorusTwo":["last",{"lift":"stack"}],"ThinFour":["space",{"style":"thin"}],"DieTwice":["button",{"style":"false"}],"PickupTwo":["lift",{"style":"roll"}],"OffLoop":["bridge",{"harmony":"borrowed","bars":"8"}],"ReturnFour":["turn",{"type":"V7"}],"DoorTwo":["lift",{"style":"flam"}],"FromHook":["verse2",{"style":"sparse","bars":"8"}],"VerseEight":["verse2",{"style":"sparse","bars":"8"}],"SeamFour":["turn",{"type":"iiV"}],"AmenFour":["amen",{"who":"both","final":"home"}],"FadeEight":["fade",{"bars":"8"}],"ClimbFour":["pre",{"harmony":"climb","bars":"4"}],"HalfFour":["half",{"where":"all"}],"BreathFour":["brk",{"style":"keys","bars":"4"}],"StrumFour":["strum",{"pat":"eighths","i":"nylon"}],"BorrowFour":["cadence",{"type":"borrowed","bars":"4"}],"OrganFour":["organ",{"style":"held"}],"ThirdFour":["harmony",{"iv":"third","i":"violin"}],"ReplyFour":["counter",{"style":"answer","i":"violin"}],"ShakeFour":["shaker",{"style":"both"}],"EarnFour":["space",{"style":"hush"}],"LineFour":["counter",{"style":"contrary","i":"violin"}],"LandFour":["cadence",{"type":"authentic","bars":"4"}],"BreakTwo":["brk",{"style":"drums","bars":"2"}],"PreLift":["pre",{"harmony":"suspend","bars":"8"}],"FloorEight":["brk",{"style":"floor","bars":"8"}],"AirCut":["drop",{"style":"full","air":"yes","bars":"8"}],"PickBar":["lift",{"style":"walkup"}],"PedalEight":["tension",{"style":"tonicpedal"}],"HoleFour":["stop",{"hits":"last2"}],"Unravel":["last",{"lift":"halfdrop"}],"AnswerEight":["verse2",{"style":"answer","bars":"8"}],"AndEight":["pocket",{"style":"and"}],"ClaveEight":["pocket",{"style":"clave"}],"CoatEight":["intro",{"style":"drums"}],"PassTwo":["verse2",{"style":"pass"}],"StackEight":["build",{"style":"stack","bars":"8"}],"CallEight":["counter",{"style":"answer","i":"trumpet"}],"AirEight":["space",{"style":"air"}],"SnapFour":["lift",{"style":"flam"}],"TurnEight":["turn",{"type":"walkdown"}],"WalkBass":["bass",{"style":"walk","i":"upright"}],"RollFour":["fill",{"style":"snare","len":"16"}],"TightFour":["pocket",{"style":"tight"}],"CompFour":["comp",{"rh":"push","i":"piano"}],"TensionFour":["tension",{"style":"dompedal"}],"HookLine":["hook",{"contour":"arch","i":"violin"}],"ResolveFour":["cadence",{"type":"authentic","bars":"4"}],"CounterFour":["counter",{"style":"long","i":"violin"}],"PunchFour":["comp",{"rh":"stabs","i":"trumpet"}],"RoomFour":["room",{"size":"0.32"}],"ArcEight":["build",{"style":"stack","harmony":"loop","bars":"8"}],"SpaceFour":["space",{"style":"hush"}],"GhostFour":["ghost",{"style":"hats"}],"FormFour":["bridge",{"harmony":"four","bars":"4"}],"HushFour":["space",{"style":"thin"}],"VampFour":["post",{"style":"vamp"}],"StrideFour":["bass",{"style":"walk","i":"upright"}],"DoorFour":["lift",{"style":"brass"}],"StackFour":["build",{"style":"stack","bars":"4"}],"TensionEight":["tension",{"style":"sus"}],"FigureFour":["figure",{"pat":"motif","i":"violin"}],"VoicingFour":["comp",{"rh":"half","i":"piano","voicing":"shell"}],"CadenceFour":["cadence",{"type":"authentic","bars":"4"}]};
const DESK_NOTES = {"FormCut":"arrangement map absorbed into the timeline itself","ColdNote":"sour-note analysis, not an arrangement move; still its own desk","Inkwell":"eight-block arrangement map absorbed into the timeline itself","FitFour":"instrument-fit desk absorbed as the per-move sound options + mixer"};
const deskOpts = (id, o) => { const out = defOpts(id); for (const [k, v] of Object.entries(o)) { const ch = ((MOVES[id].opts || {})[k] || { choices: [] }).choices.find(c => String(c[0]) === v); if (ch) out[k] = ch[0]; } return out; };
const wasDesks = id => Object.keys(DESKS).filter(k => DESKS[k][0] === id);

// ---------- the song: ONE function feeds live playback, WAV and MIDI ----------
const ROLE_GUIDE = { loop: { keys: "half", bass: "root", drums: "straight", crash: true }, verse: { keys: "whole", bass: "root", drums: "straight" }, chorus: { keys: "half", bass: "root", drums: "straight", crash: true },
  intro: { keys: "whole", bass: "whole", drums: "none" }, pre: { keys: "half", bass: "pulse", drums: "straight" }, bridge: { keys: "whole", bass: "two", drums: "ride", crash: true },
  build: { keys: "pulse", bass: "pulse", drums: "straight" }, drop: { keys: "half", bass: "root", drums: "straight", crash: true }, ending: { keys: "whole", bass: "whole", drums: "thin" }, hit: { keys: "none", bass: "none", drums: "none" } };
const tonicOf = key => rom(key, key.mode === "minor" ? "i" : "I");
function loopChordsFor(st, shift){ const prog = progOf(st), k = st.keyRoot - st.baseKey + shift, per = prog.length > st.loopBars ? 2 : 1;
  return n => Array.from({ length: n }, (_, b) => per === 1 ? [tr(prog[b % prog.length], k)] : [tr(prog[(2 * b) % prog.length], k), Object.assign(tr(prog[(2 * b + 1) % prog.length], k), { at: 8 })]); }
function chordAtBar(bars, b, s){ const L = bars[clamp(b, 0, bars.length - 1)]; let c = L[0]; for (const x of L) if ((x.at || 0) <= s) c = x; return c; }
function guideEvents(x, g){
  const out = [], N = x.bars, startOf = { keys: 0, bass: 0, drums: 0 };
  if (g.walkin) Object.assign(startOf, { bass: Math.max(1, Math.floor(N / 4)), drums: Math.floor(N / 2) }), g.drums = "straight";
  if (g.stack) Object.assign(startOf, { bass: Math.min(1, N - 1), drums: Math.min(2, N - 1) }), g.drums = "straight";
  let prev = null;
  for (let b = 0; b < N; b++) {
    const o = b * STEPS, c = x.ch(b, 0), half = x.ch(b, 8), nx = b < N - 1 ? x.ch(b + 1, 0) : x.next;
    if (g.keys !== "none" && b >= startOf.keys) { const hits = g.keys === "whole" ? [[0, 15.6]] : g.keys === "pulse" ? [0, 2, 4, 6, 8, 10, 12, 14].map(s => [s, 1.6]) : [[0, 7.6], [8, 7.6]];
      for (const [s, d] of hits) { const cc = s >= 8 ? half : c, v = voicing(cc, 52, 72, prev, 4); prev = v; for (const n of v) out.push(E("gkeys", "piano", n, o + s, d, (s % 8 === 0 ? 0.55 : 0.42))); } }
    if (g.bass !== "none" && b >= startOf.bass) { const style = { root: "root", whole: "whole", pulse: "pulse", two: "two", octave: "octave", dompedal: "dompedal", pedal: "pedal" }[g.bass] || "root";
      for (const e of bassLine(x, b, c, nx, style, "finger", rng(hash(x.sec.id, b, "gbass")))) { e.ch = "gbass"; if (half !== c && e.s - o >= 8 && style !== "pedal" && style !== "dompedal") e.n = bassOf(half, 28, 43) + (e.n - bassOf(c, 28, 43)); out.push(e); } }
    if (g.drums !== "none" && b >= startOf.drums) {
      let pat = g.drums; if (pat === "halfsecond") pat = b >= N / 2 ? "half" : "straight"; if (pat === "halfthenfull") pat = b < N / 2 ? "half" : "straight";
      const K = (p, s, v) => out.push(kitHit("gdrums", p, o + s, v));
      if (pat === "straight") { K("kick", 0, 0.9); K("kick", 8, 0.85); if (b % 2) K("kick", 10, 0.6); K("snare", 4, 0.8); K("snare", 12, 0.82); for (let s = 0; s < 16; s += 2) K("hat", s, s % 4 ? 0.45 : 0.65); }
      if (pat === "half") { K("kick", 0, 0.9); if (b % 2) K("kick", 14, 0.55); K("snare", 8, 0.85); for (let s = 0; s < 16; s += 4) K("hat", s, 0.6); }
      if (pat === "four") { for (const s of [0, 4, 8, 12]) K("kick", s, 0.9); K("snare", 4, 0.75); K("snare", 12, 0.78); for (const s of [2, 6, 10, 14]) K("ohat", s, 0.5); }
      if (pat === "ride") { K("kick", 0, 0.85); K("kick", 8, 0.7); K("rim", 4, 0.6); K("rim", 12, 0.62); for (let s = 0; s < 16; s += 2) K("ride", s, s % 4 ? 0.4 : 0.6); }
      if (pat === "thin") { K("kick", 0, 0.75); K("rim", 12, 0.5); for (let s = 0; s < 16; s += 4) K("hat", s, 0.4); }
      if (pat === "hush") { for (let s = 0; s < 16; s += 4) K("hat", s, 0.3); K("kick", 0, 0.45); }
      if (pat === "kick4") for (const s of [0, 4, 8, 12]) K("kick", s, 0.85);
    }
  }
  if (g.crash && x.idx > 0 && g.drums !== "none") out.push(kitHit("gdrums", "crash", 0, 0.7));
  return out;
}
function buildSong(st, pv){
  const arr = (pv && pv.arr) || st.arr, S = []; let shift = 0, bar = 0;
  arr.forEach((sec, idx) => {
    const m = sec.kind === "loop" ? null : MOVES[sec.kind]; if (sec.kind !== "loop" && !m) return;
    const o = Object.assign(m ? defOpts(sec.kind) : {}, sec.opts || {}); if (m && m.shift) shift += m.shift(o);
    const key = { root: pc(st.keyRoot + shift), mode: st.mode }, L = loopChordsFor(st, shift);
    const x = { key, o, sec, idx, seed: sec.seed || 1, loopBars: L, loopBarsN: st.loopBars, loopBarsAll: L(st.loopBars), R: rng(hash(sec.seed || 1, sec.kind)) };
    const bars = sec.kind === "loop" ? (sec.bars || st.loopBars) : m.bars ? m.bars(x) : (+o.bars || 4); x.bars = bars;
    const chords = sec.kind === "loop" ? L(bars) : m.chords(x);
    S.push({ sec, m, o, x, bars, chords, start: bar, key, shift, idx: S.length }); bar += bars; });
  S.forEach((s, i) => { s.next = i < S.length - 1 ? S[i + 1].chords[0][0] : tonicOf(s.key); s.x.next = s.next; });
  const movesOf = s => s.sec.moves.filter(mv => !mv.muted && MOVES[mv.id]).concat(pv && pv.secId === s.sec.id && pv.move && !pv.bare ? [pv.move] : []).filter(mv => !(pv && pv.without === mv.uid));
  S.forEach(s => { for (const mv of movesOf(s)) { const m = MOVES[mv.id]; if (m.chordMod) m.chordMod(Object.assign({}, s.x, { o: Object.assign(defOpts(mv.id), mv.opts) }), s.chords); } });
  const events = [], prevMasks = [];
  S.forEach((s, i) => {
    const x = s.x; x.chords = s.chords; x.ch = (b, st2) => chordAtBar(s.chords, b, st2); x.masks = []; x.sofar = [];
    const role = s.sec.kind === "loop" ? (s.sec.role || "loop") : (s.m.role || "loop");
    x.guide = Object.assign({}, ROLE_GUIDE[role] || ROLE_GUIDE.loop, s.m && s.m.guide ? s.m.guide(x) : {});
    if (s.m && !(pv && pv.bare && pv.arr && pv.focus === s.sec.id)) x.sofar.push(...s.m.gen(x));
    const mvs = movesOf(s).slice().sort((a, b) => (a.id === "harmony") - (b.id === "harmony"));
    for (const mv of mvs) { const m = MOVES[mv.id], xm = Object.assign({}, x, { o: Object.assign(defOpts(mv.id), mv.opts), R: rng(hash(mv.seed || 1, mv.id, s.sec.id)), seed: mv.seed || 1 });
      for (const g of m.replaces || []) x.guide[{ gbass: "bass", gkeys: "keys", gdrums: "drums" }[g]] = "none";
      for (const e of m.gen(xm)) { e.mv = mv.uid; x.sofar.push(e); } }
    let all = guideEvents(x, x.guide).concat(x.sofar);
    for (const f of x.masks) all = f(all);
    if (s.m && s.m.prevMask) { const n = s.m.prevMask(x); if (n && i > 0) prevMasks.push([i - 1, n]); }
    s.events = all; });
  for (const [i, n] of prevMasks) { const s = S[i], N = s.bars * STEPS; s.events = s.events.filter(e => e.imm || e.s < N - n || e.s >= N); }
  const totalBars = bar;
  for (const s of S) for (const e of s.events) { const abs = s.start * STEPS + e.s; if (abs < 0 || abs >= totalBars * STEPS) continue; e.abs = abs; e.sec = s.idx; events.push(e); }
  events.sort((a, b) => a.abs - b.abs);
  return { S, events, totalBars };
}
let songCache = null;
function song(pv){ const key = ver + "|" + (pv ? JSON.stringify(pv) : ""); if (songCache && songCache.key === key) return songCache.song;
  const sg = buildSong(state, pv); sg.byStep = new Map(); for (const e of sg.events) { const k = Math.floor(e.abs + 1e-6); if (!sg.byStep.has(k)) sg.byStep.set(k, []); sg.byStep.get(k).push(e); }
  songCache = { key, song: sg }; return sg; }
const instsOf = sg => [...new Set(sg.events.filter(e => e.i !== "kit").map(e => e.i))];

// ---------- where you're stuck -> ranked moves with a plain reason ----------
const STUCK = [
  ["thin", "My loop sounds thin", "Add a part to the selected section"],
  ["verse2", "Verse 2 sounds like verse 1", "Develop the second time through"],
  ["chorus", "Getting into the chorus", "Pre-chorus, builds, lifts and fills"],
  ["bridge", "I need a bridge", "Somewhere new to go, then home"],
  ["harder", "The chorus needs to hit harder", "Lifts, drops, key changes, stacking"],
  ["ending", "I can't end it", "Tags, buttons, fades, amen cadences"],
  ["intro", "I need an intro", "Bring the band in"],
  ["feel", "The groove feels stiff", "Ghost notes, pocket, shaker, space, room"]
];
function progFacts(st){ const p = progOf(st), key = { root: st.baseKey, mode: st.mode }, deg = c => pc(c.root - key.root);
  const last = p[p.length - 1], first = p[0];
  return { p, n: p.length, names: p.map(chName).join(" "), first: chName(first), last: chName(last), endsOnV: deg(last) === 7, endsOnIV: deg(last) === 5, startsOnI: deg(first) === 0,
    minor: st.mode === "minor", slow: st.bpm < 84, fast: st.bpm >= 120, bpm: st.bpm, key: keyLabel(st), hasBorrowed: p.some(c => ![0,2,3,4,5,7,8,9,10,11].includes(deg(c))) }; }
function suggest(stuck, secId, st){
  st = st || state; const f = progFacts(st), sec = st.arr.find(s => s.id === secId) || st.arr[0], has = id => sec.moves.some(m => m.id === id), inSong = id => st.arr.some(s => s.kind === id);
  const lead = f.minor ? "violin" : "trumpet", out = [];
  const S = (id, opts, reason, score) => out.push({ id, opts: Object.assign(defOpts(id), opts || {}), reason, score: score || 0, type: MOVES[id].type });
  if (stuck === "thin") {
    S("bass", { style: f.slow ? "two" : f.fast ? "push" : "walk", i: f.slow ? "upright" : "finger" }, `${f.names} at ${f.bpm} BPM: the guide bass only plays roots. A ${f.slow ? "two-feel" : f.fast ? "pushed" : "walking"} line moves between ${f.first} and ${f.last} and pulls every bar into the next.`, has("bass") ? -9 : 9);
    S("pad", { i: "strings", style: f.slow ? "swell" : "held" }, `A string bed holds ${f.names} under everything, so the loop stops sounding like four separate hits.`, has("pad") ? -9 : 8);
    S("comp", { rh: f.fast ? "push" : "charleston", i: "epiano" }, `Electric-piano ${f.fast ? "16th pushes" : "Charleston comping"} fills the space between the downbeats at ${f.bpm} BPM.`, has("comp") ? -9 : 7);
    S("counter", { style: "answer", i: lead }, `A ${INST[lead].label.split(" (")[0].toLowerCase()} answers in the second half of each bar, where your vocal usually breathes. It stays on ${f.key} scale tones.`, has("counter") ? -9 : 6);
    S("strum", { pat: f.fast ? "eighths" : "folk", i: "steel" }, `Acoustic strumming gives ${f.names} motion without adding new notes.`, has("strum") ? -9 : 5);
    S("figure", { pat: f.slow ? "broken" : "arp", i: f.minor ? "harp" : "marimba" }, `A repeating ${f.minor ? "harp" : "marimba"} figure spells each chord, so the harmony is clear even when it's quiet.`, has("figure") ? -9 : 4);
    S("organ", { style: f.slow ? "swell" : "held" }, `Drawbar organ glues the band together and makes the chorus sound wider.`, has("organ") ? -9 : 3);
    S("hook", { contour: "question", i: lead }, `A seeded hook line over ${f.names}: question in bars 1–4, answer in 5–8. Re-roll until one sticks.`, has("hook") ? -9 : 3);
    S("harmony", { iv: "third" }, `A third under the hook or counter-line in the same rhythm. It's strongest once there is a hook to harmonize.`, has("harmony") ? -9 : sec.moves.some(m => m.id === "hook" || m.id === "counter") ? 6 : 0);
  }
  if (stuck === "verse2") {
    S("verse2", { style: "answer" }, `Same ${f.names}, but a violin answers in the holes the second time, so verse 2 tells the listener something new.`, 8);
    S("verse2", { style: "pass" }, `Second-pass inner motion: off-beat electric-piano chords join halfway through, so the verse grows without getting louder.`, 6);
    S("verse2", { style: "sparse" }, `Pull back for verse 2: held keys, side-stick and ghost notes. Contrast makes the next chorus land.`, 5);
    S("ghost", { style: "chatter" }, `Ghost notes on the snare give the second verse momentum without adding instruments.`, 4);
    S("shaker", { style: "eighths" }, `Shaker eighths at ${f.bpm} BPM: the cheapest way to make verse 2 feel like it moved forward.`, 4);
  }
  if (stuck === "chorus") {
    S("pre", { harmony: f.endsOnV ? "relative" : "climb" }, f.minor ? `A 4-bar pre-chorus on iv–v–bVI–bVII climbs out of ${f.key} and lands on your ${f.first} with a snare pickup.` : `A 4-bar pre-chorus on IV–V–vi–V climbs out of ${f.key}; the V at the end makes your ${f.first} feel like arrival.`, 9);
    S("build", { style: "all", harmony: f.endsOnV ? "loop" : "dominant" }, `A 4-bar build: snare roll from quarters to 16ths, tom run and string swell, crashing into the chorus downbeat.`, 8);
    S("lift", { style: "walkup" }, `The bass walks up three half steps into ${f.first} on the last beat, so the chorus has a door to walk through.`, 7);
    S("fill", { style: "snaretom", len: 8 }, `A two-beat snare-into-toms fill on the last bar before the chorus, ending on a crash.`, 7);
    S("turn", { type: f.endsOnV ? "walkdown" : "iiV" }, f.endsOnV ? `Your loop already ends on ${f.last} (the V), so a bass walk-down is enough to point at the chorus.` : `Your loop ends on ${f.last}. A ii–V in the last bar points straight at ${f.first}.`, 6);
    S("slide", { dir: "up" }, `A bass slide up into the next 1: short, physical, works at ${f.bpm} BPM.`, 5);
    S("stop", { hits: "die" }, `The last 2 bars drop out completely; the chorus comes back in on the 1. Old trick, still works.`, 4);
  }
  if (stuck === "bridge") {
    S("bridge", { harmony: f.minor ? "relative" : "relative" }, f.minor ? `Move to the relative major (bIII) for 8 bars, then a V chord sends you back to ${f.key}.` : `Lean on vi (the relative minor) for 8 bars so the bridge feels like a different room, then V back home.`, 9);
    S("bridge", { harmony: "borrowed" }, `Borrowed bVI–bVII: chords from outside ${f.key} that still resolve home. Big, cinematic.`, 7);
    S("bridge", { harmony: "pedal" }, `Hold the dominant in the bass while the chords move above it; tension builds until the last chorus.`, 6);
    S("bridge", { harmony: "four" }, `Start on IV and stay away from I the whole time, so coming home after the bridge feels earned.`, 5);
    S("brk", { style: "keys" }, `A breakdown (keys alone, ${f.names}) before or after the bridge gives the listener a breath.`, 4);
    S("solo", { i: f.minor ? "violin" : "sax" }, `An instrumental solo over your loop instead of a new section.`, 3);
  }
  if (stuck === "harder") {
    S("last", { lift: "stack" }, `Last chorus: strings, tambourine on 2 and 4, a crash every four bars. Same ${f.names}, much bigger.`, 9);
    S("keychange", { up: 2, pivot: "v7" }, `A whole-step key change for the last chorus, with one bar of the new V7 as a pivot. From ${f.key} to ${keyLabel(st, 2)}.`, inSong("keychange") ? -9 : 8);
    S("drop", { style: f.fast ? "full" : "half", air: "yes" }, f.fast ? `At ${f.bpm} BPM a four-on-the-floor drop with one beat of silence before it hits hardest.` : `A half-time drop with one beat of air before it: heavier, not faster.`, 7);
    S("shaker", { style: "both" }, `Shaker 16ths plus tambourine on 2 and 4 on the chorus only, so it lifts compared to the verse.`, 6);
    S("organ", { style: "gospel" }, `Gospel organ chops under the chorus add energy without crowding the vocal.`, 5);
    S("last", { lift: "choir" }, `Choir loft on the last chorus: aahs over ${f.names}.`, 4);
    S("last", { lift: "halfdrop" }, `Half-time for the first half, then full time: the chorus feels like it doubles.`, 4);
  }
  if (stuck === "ending") {
    S("tag", { style: f.endsOnV ? "deceptive" : "repeat" }, f.endsOnV ? `Your loop ends on ${f.last} (V). A deceptive tag (IV–V–vi–V–I) fakes the ending once, then lands home.` : `Say the last line twice, then land on ${f.minor ? "i" : "I"} with a crash and a held chord.`, 8);
    S("button", { style: "hit" }, `One tight hit on the 1 of the bar after your last chorus: everyone, then silence.`, 7);
    S("amen", { who: "both", final: f.minor ? "picardy" : "home" }, f.minor ? `iv–I amen with organ and choir, ending on a major I (Picardy third). A classic way to end a minor song.` : `IV–I amen cadence with organ and choir. Ends a song like a hymn.`, f.endsOnIV ? 9 : 6);
    S("fade", { bars: 8 }, `Repeat the loop and fade over 8 bars while a violin drifts down.`, 5);
    S("rideout", { i: f.minor ? "violin" : "sax" }, `Ride out on your loop with ad-libs, then a final hit.`, 5);
    S("cadence", { type: "authentic" }, `A written-out ${f.minor ? "iv–V7–i" : "ii–V7–I"} cadence so the song resolves completely.`, 4);
  }
  if (stuck === "intro") {
    S("intro", { style: "walkin", bars: 4 }, `Four bars of ${f.names}: keys first, then bass, then drums, with a fill into the first verse.`, 8);
    S("intro", { style: "drums", bars: 4 }, `Drums alone for four bars. Instantly tells people the tempo (${f.bpm} BPM).`, 6);
    S("intro", { style: "keys", bars: 4 }, `Keys alone, then the band. Intimate, good for ballads.`, f.slow ? 7 : 4);
    S("intro", { style: "pedal", bars: 4 }, `Four bars on a ${f.key} tonic pedal before the chords start moving.`, 3);
  }
  if (stuck === "feel") {
    S("ghost", { style: f.fast ? "hats" : "chatter" }, f.fast ? `16th hats with accents on the and: at ${f.bpm} BPM that's where the groove lives.` : `Soft ghost notes on the e and a of the beat loosen up a stiff backbeat.`, 8);
    S("pocket", { style: f.slow ? "rim" : "and" }, f.slow ? `Rim click on 2 and 4 instead of the snare: the pocket sits further back.` : `Kick on 1, bass on the and: the band leans forward.`, 7);
    S("shaker", { style: "shaker" }, `Shaker 16ths: a real shaker sample, not a relabeled drum.`, 6);
    S("space", { style: "air" }, `Drums out for the first half of the section: space makes the second half feel stronger.`, 5);
    S("half", { where: "second" }, `Half-time in the second half of the section.`, 4);
    S("room", { size: "0.32" }, `Put the band in a medium hall so the parts sound like one room.`, 4);
    S("tension", { style: "dompedal" }, `A dominant pedal under ${f.names} adds tension that resolves when the pedal moves.`, 3);
  }
  return out.filter(x => x.score > -5).sort((a, b) => b.score - a.score);
}
// where a suggested move goes: parts and mods go on the selected section; sections insert next to it
function placeIndex(arr, secIdx, where){ if (where === "start") return 0; if (where === "end") return arr.length; if (where === "before") return secIdx; return secIdx + 1; }
function newMove(id, opts, seed){ return { uid: "m" + Date.now().toString(36) + (uid++), id, opts: Object.assign(defOpts(id), opts || {}), seed: seed || nextSeed(), locked: false, muted: false }; }
function newSection(id, opts, seed){ return { id: newId(), kind: id, name: MOVES[id].name, opts: Object.assign(defOpts(id), opts || {}), seed: seed || nextSeed(), moves: [], locked: false }; }
function previewFor(sug, secId, st){ st = st || state; const i = Math.max(0, st.arr.findIndex(s => s.id === secId));
  if (sug.type === "section") { const sec = newSection(sug.id, sug.opts, sug.seed), arr = st.arr.slice(), at = placeIndex(arr, i, MOVES[sug.id].where); arr.splice(at, 0, sec); return { arr, focus: sec.id, sec }; }
  const mv = newMove(sug.id, sug.opts, sug.seed); return { secId: st.arr[i].id, move: mv, focus: st.arr[i].id }; }
function commitPreview(pv){ if (pv.arr) { state.arr = pv.arr; state.sel = pv.focus; } else { const s = state.arr.find(x => x.id === pv.secId); s.moves.push(pv.move); } save(); }
// one-click arrangement from your loop; locked sections are kept
const TEMPLATE = [["intro", { style: "walkin", bars: 4 }], ["loop", "Verse 1", "verse"], ["pre", {}], ["loop", "Chorus 1", "chorus", [["bass", {}], ["pad", {}]]], ["post", { style: "vamp" }],
  ["verse2", { style: "answer" }], ["pre", {}], ["loop", "Chorus 2", "chorus", [["bass", {}], ["pad", {}], ["shaker", { style: "both" }]]], ["bridge", {}], ["build", { style: "all" }], ["keychange", { up: 2 }], ["tag", {}], ["button", { style: "held" }]];
function autoArrange(st){ st = st || state; const keep = st.arr.filter(s => s.locked), seed = nextSeed(), arr = [];
  TEMPLATE.forEach(([kind, a, role, mvs], j) => { if (kind === "loop") { const s = loopSection(a); s.role = role; s.moves = (mvs || []).map(([id, o], k) => newMove(id, o, seed + j * 7 + k)); arr.push(s); } else arr.push(newSection(kind, a, seed + j)); });
  for (const s of keep) { const j = arr.findIndex(t => t.kind === s.kind && t.name === s.name && !t.keep); if (j >= 0) arr[j] = Object.assign(s, { keep: true }); else arr.push(s); }
  arr.forEach(s => delete s.keep); st.arr = arr; st.sel = arr[1].id; save(); }
function autoSuggest(secId){ const sec = state.arr.find(s => s.id === secId); if (!sec || sec.locked) return null;
  const stuck = sec.kind === "loop" ? (sec.role === "verse" ? "feel" : "thin") : MOVES[sec.kind].cat === "ending" ? "feel" : "thin";
  const top = suggest(stuck, secId).find(s => s.type !== "section"); if (!top) return null; sec.moves.push(newMove(top.id, top.opts)); save(); return top; }
function reroll(){ let n = 0; for (const s of state.arr) { if (s.locked) continue; if (s.kind !== "loop") { s.seed = nextSeed(); n++; } for (const m of s.moves) if (!m.locked) { m.seed = nextSeed(); n++; } } save(); return n; }

// ---------- samples: fetched once, decoded once at 48 kHz (mono), shared by live and offline contexts ----------
const bufs = {}, loading = new Map(), missing = new Map(); let decoder = null; window.__loadLog = [];
const decodeCtx = () => decoder || (decoder = new OfflineAudioContext(1, 1, SR));
function toMono(b){ if (b.numberOfChannels === 1) return b; const m = new AudioBuffer({ length: b.length, numberOfChannels: 1, sampleRate: b.sampleRate }), d = m.getChannelData(0), l = b.getChannelData(0), r = b.getChannelData(1); for (let i = 0; i < d.length; i++) d[i] = 0.5 * (l[i] + r[i]); return m; }
function loadSample(s){ if (bufs[s.id]) return Promise.resolve(true); if (loading.has(s.id)) return loading.get(s.id);
  const p = (async () => { try { let r = null, err = null;
      for (const [u, wait] of [[s.url, 0], [s.url, 400], [s.alt, 0], [s.alt, 800]]) { if (!u) continue; if (wait) await new Promise(z => setTimeout(z, wait));
        try { r = await fetch(u); if (r.ok) break; err = new Error("HTTP " + r.status); r = null; } catch (e) { err = e; r = null; } }
      if (!r) throw err || new Error("unavailable"); const ab = await r.arrayBuffer(); const b = await decodeCtx().decodeAudioData(ab);
      bufs[s.id] = s.inst === "kit" ? b : toMono(b); missing.delete(s.id); return true; } catch (e) { missing.set(s.id, s); window.__loadLog.push({ id: s.id, err: String(e) }); return false; } finally { loading.delete(s.id); } })();
  loading.set(s.id, p); return p; }
const filesFor = insts => SAMPLES.filter(s => s.inst === "kit" ? insts.includes("kit") : insts.includes(s.inst));
async function ensureInstruments(insts, label){ const list = filesFor([...new Set(insts.concat(["kit"]))]), todo = list.filter(s => !bufs[s.id]);
  if (!todo.length) { paintLoad(); return missingLabels(list).length === 0; }
  let done = 0; paintLoad(`Loading samples 0/${todo.length}${label ? " for " + label : ""}…`);
  const q = todo.slice(); await Promise.all(Array.from({ length: 6 }, async () => { while (q.length) { const s = q.shift(); await loadSample(s); done++; paintLoad(`Loading samples ${done}/${todo.length}${label ? " for " + label : ""}…`); } }));
  const miss = missingLabels(list); paintLoad(); return miss.length === 0; }
function missingLabels(list){ return [...new Set((list || [...missing.values()]).filter(s => !bufs[s.id]).map(s => s.inst === "kit" ? s.label : INST[s.inst].label))]; }
const onsetCache = new WeakMap();
function onsetOf(buf){ if (onsetCache.has(buf)) return onsetCache.get(buf); const d = buf.getChannelData(0); let pk = 0;
  for (let i = 0; i < Math.min(d.length, buf.sampleRate); i++) pk = Math.max(pk, Math.abs(d[i]));
  let i = 0; while (i < d.length && Math.abs(d[i]) < pk * 0.02) i++; const t = Math.max(0, i - 8) / buf.sampleRate; onsetCache.set(buf, t); return t; }
const loopCache = new WeakMap();
function loopPoints(buf){ if (loopCache.has(buf)) return loopCache.get(buf); const d = buf.getChannelData(0), sr = buf.sampleRate, on = onsetOf(buf);
  const zc = t => { let i = Math.floor(t * sr); while (i < d.length - 1 && !(d[i] <= 0 && d[i + 1] > 0)) i++; return i / sr; };
  const r = [zc(on + Math.min(1.0, buf.duration * 0.35)), zc(Math.min(2.4, buf.duration * 0.8))]; loopCache.set(buf, r); return r; }

// ---------- voices ----------
let active = new Set();
const roomCache = new WeakMap();
function roomBus(c, dest, size){ let m = roomCache.get(c); if (!m) { m = {}; roomCache.set(c, m); } const k = String(size); if (m[k]) return m[k];
  const len = Math.round(c.sampleRate * (0.8 + size * 4)), ir = c.createBuffer(2, len, c.sampleRate), R = rng(hash("room", k));
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (R() * 2 - 1) * Math.pow(1 - i / len, 3) * Math.exp(-i / (c.sampleRate * (0.15 + size * 0.9))); }
  const cv = c.createConvolver(); cv.buffer = ir; const g = c.createGain(); g.gain.value = 0.35; cv.connect(g); g.connect(dest); m[k] = cv; return cv; }
function playEvent(c, dest, e, when, sd, live, roomDest){
  let buf, rate = 1, sus = false, gain = e.v, src;
  if (e.i === "kit") { const piece = KIT_BY_GM[e.n]; buf = bufs["kit:" + piece]; if (!buf) return null; gain *= KIT[piece].gain; }
  else { const d = INST[e.i], mid = e.n - (e.gl || 0) / 2, ns = nearestSample(e.i, mid); if (!ns || Math.abs(ns.shift) + Math.abs((e.gl || 0) / 2) > MAX_SHIFT) return null;
    buf = bufs[ns.id]; if (!buf) return null; rate = Math.pow(2, (ns.shift - (e.gl || 0) / 2) / 12); sus = !!d.sus; gain *= d.gain; }
  const t = live ? when : Math.round(when * c.sampleRate) / c.sampleRate, dur = Math.max(0.03, e.d * sd);
  src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate; src.playbackRate.setValueAtTime(rate, t); // k-rate: the base value must already be right for a note that starts mid-quantum
  if (e.gl) src.playbackRate.linearRampToValueAtTime(rate * Math.pow(2, e.gl / 12), t + dur * 0.9);
  const on = onsetOf(buf), g = c.createGain();
  if (e.i === "kit") { g.gain.setValueAtTime(gain, t); src.connect(g); g.connect(dest); src.start(t, on); const end = t + (buf.duration - on); src.stop(end + 0.01); }
  else {
    if (sus) { const [a, b] = loopPoints(buf); if (b - a > 0.2) { src.loop = true; src.loopStart = a; src.loopEnd = b; } }
    const atk = e.sw ? Math.min(0.8, dur * 0.45) : sus ? 0.015 : 0.003, rel = sus ? Math.min(0.18, Math.max(0.03, dur * 0.2)) : Math.min(0.12, Math.max(0.02, dur * 0.15));
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + atk); g.gain.setValueAtTime(gain, t + Math.max(atk, dur));
    g.gain.linearRampToValueAtTime(0, t + Math.max(atk, dur) + rel); src.connect(g); g.connect(dest); src.start(t, on); src.stop(t + Math.max(atk, dur) + rel + 0.01); }
  if (e.room && roomDest) { const s = c.createGain(); s.gain.value = 1; g.connect(s); s.connect(roomBus(c, roomDest, e.room)); }
  if (live) { const r = { src, g }; active.add(r); src.onended = () => active.delete(r); }
  return src; }
function fastRelease(r, now){ try { r.g.gain.cancelScheduledValues(now); r.g.gain.setValueAtTime(r.g.gain.value, now); r.g.gain.linearRampToValueAtTime(0, now + FAST_RELEASE); r.src.stop(now + FAST_RELEASE + 0.004); } catch (e) {} }

// ---------- live bus: chair gains -> A/B makeup -> master -> safety limiter -> output ----------
let ctx = null, bus = null;
function buildBus(c){ const comp = c.createDynamicsCompressor(); comp.threshold.value = -6; comp.knee.value = 3; comp.ratio.value = 20; comp.attack.value = 0.002; comp.release.value = 0.1;
  const master = c.createGain(), ab = c.createGain(), live = c.createGain(), an = c.createAnalyser(), chairs = {}; an.fftSize = 256; master.gain.value = state.master; live.gain.value = state.liveGain;
  for (const ch of CHAIRS) { const g = c.createGain(); g.gain.value = state.mutes[ch.id] ? 0 : state.gains[ch.id]; g.connect(ab); chairs[ch.id] = g; }
  ab.connect(master); live.connect(master); master.connect(comp); comp.connect(c.destination); comp.connect(an); return { comp, master, ab, live, chairs, an }; }
async function ensureCtx(){ if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); bus = buildBus(ctx); applySink(); } if (ctx.state !== "running") await ctx.resume(); } // device default rate

// ---------- transport: audio-clock lookahead scheduler ----------
let play = null, timerId = null; const stepLog = []; window.__schedLog = [];
const stepDur = () => 60 / state.bpm / 4;
function secRange(sg, secId){ const s = sg.S.find(x => x.sec.id === secId) || sg.S[0]; return [s.start * STEPS, (s.start + s.bars) * STEPS]; }
function playRange(){ const sg = song(play.pv);
  if (play.audition) { const s = sg.S.find(x => x.sec.id === play.audition) || sg.S[0], a = Math.max(0, s.start - (s.idx > 0 && sg.S[s.idx - 1].sec.id !== s.sec.id ? Math.min(2, sg.S[s.idx - 1].bars) : 0)), b = Math.min(sg.totalBars, s.start + s.bars + (s.idx < sg.S.length - 1 ? 1 : 0)); return [a * STEPS, b * STEPS, true]; }
  if (state.loopSection) { const [a, b] = secRange(sg, state.sel); return [a, b, true]; }
  return [0, sg.totalBars * STEPS, false]; }
function start(opts){ if (!ctx || ctx.state !== "running") return false; stop(true); opts = opts || {};
  play = { pv: opts.pv || null, audition: opts.audition || null, step: 0, nextT: ctx.currentTime + 0.1, ended: false };
  const [a] = playRange(); play.step = opts.fromStep != null ? opts.fromStep : a; if (opts.fromStep == null && !play.audition && !state.loopSection) play.step = 0;
  stepLog.length = 0; timerId = setInterval(scheduler, LOOKAHEAD_MS); scheduler(); requestAnimationFrame(draw); paintTransport(); return true; }
function scheduler(){ if (!play || play.ended) return; const sd = stepDur();
  while (play.nextT < ctx.currentTime + SCHEDULE_AHEAD) {
    const [a, b, loop] = playRange(); if (play.step < a && loop) play.step = a;
    if (play.step >= b) { if (loop) play.step = a; else { play.ended = true; const endT = play.nextT; clearInterval(timerId); timerId = null; setTimeout(() => { if (play && play.ended) { play = null; paintTransport(); setStatus("End of the song. Press Play to hear it again."); } }, Math.max(0, (endT - ctx.currentTime) * 1000) + 1500); return; } }
    scheduleStep(song(play.pv), play.step, play.nextT, sd); play.nextT += sd; play.step++; } }
function scheduleStep(sg, k, time, sd){ const evs = sg.byStep.get(k) || [], heard = [];
  for (const e of evs) { if (state.mutes[e.ch]) continue; const t = time + (e.abs - k) * sd; playEvent(ctx, bus.chairs[e.ch], e, t, sd, true, bus.ab); midiSend(e, t, sd); heard.push(e.ch + ":" + e.n); }
  stepLog.push({ s: k, time }); if (stepLog.length > 512) stepLog.shift();
  window.__schedLog.push({ step: k, time, ver, bpm: state.bpm, keyRoot: state.keyRoot, notes: heard }); if (window.__schedLog.length > 4000) window.__schedLog.shift(); }
function stop(quiet){ clearInterval(timerId); timerId = null; const was = !!play; play = null;
  if (ctx) { const now = ctx.currentTime; for (const r of active) fastRelease(r, now); active.clear(); liveAllOff(true); }
  if (midiOut) for (let c = 0; c < 16; c++) { midiOut.send([0xB0 | c, 123, 0]); midiOut.send([0xB0 | c, 120, 0]); }
  if (bus) bus.ab.gain.setTargetAtTime(1, ctx.currentTime, 0.005);
  paintTransport(); if (was && !quiet) setStatus("Stopped."); }
function draw(){ if (!play) return; const now = ctx.currentTime; let cur = null; for (const e of stepLog) { if (e.time <= now) cur = e; else break; }
  if (cur) paintPlayhead(cur.s); requestAnimationFrame(draw); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { if (play) { stop(true); setStatus("Stopped because the tab was hidden. Press Play to start again."); } liveAllOff(); } });
async function measureStopSilence(){ const a = new Float32Array(bus.an.fftSize), t0 = performance.now(); stop(); for (let i = 0; i < 200; i++) { await new Promise(r => setTimeout(r, 2)); bus.an.getFloatTimeDomainData(a); let p = 0; for (const x of a) p = Math.max(p, Math.abs(x)); if (p < 0.001) return { ms: performance.now() - t0, peak: p }; } return { ms: null }; }

// ---------- export: OfflineAudioContext, 48 kHz, exact bar length, downbeat at sample 0, tail folded, peak -1 dBFS ----------
// No compressor on the export path (its lookahead would move the downbeat off sample 0); the peak is normalized instead.
function exportRange(o){ const sg = song(o.pv || null); if (o.all) return [0, sg.totalBars, sg];
  const s = sg.S.find(x => x.sec.id === (o.secId || state.sel)) || sg.S[0]; return [s.start, s.start + s.bars, sg, s]; }
async function renderRange(o){ o = o || {}; const [b0, b1, sg] = exportRange(o), sd = stepDur(), N = Math.round((b1 - b0) * 4 * 60 / state.bpm * SR), T = Math.round(TAIL_S * SR);
  const need = instsOf(sg); if (!(await ensureInstruments(need))) throw new Error("Missing instruments: " + missingLabels().join(", "));
  const oc = new OfflineAudioContext(2, N + T, SR), sum = oc.createGain(); sum.connect(oc.destination); const chairs = {};
  for (const c of CHAIRS) { const g = oc.createGain(); g.gain.value = state.gains[c.id]; g.connect(sum); chairs[c.id] = g; }
  const only = o.only || CHAIRS.filter(c => (o.mode || state.exportMode) === "added" ? !c.guide : true).map(c => c.id);
  // sample-anchored timing: each section starts on its own rounded bar sample and its notes are placed from there,
  // so a section export, the same section inside the whole song, and a looped repeat are identical to the sample
  const barSmp = 4 * 60 / state.bpm * SR, s0 = Math.round(b0 * barSmp);
  for (const e of sg.events) { if (e.abs < b0 * STEPS || e.abs >= b1 * STEPS || state.mutes[e.ch] || !only.includes(e.ch)) continue; const ss = sg.S[e.sec].start;
    playEvent(oc, chairs[e.ch], e, (Math.round(ss * barSmp) - s0 + Math.round((e.abs - ss * STEPS) * sd * SR)) / SR, sd, false, sum); }
  const buf = await oc.startRendering(), ch = [0, 1].map(i => { const src = buf.getChannelData(i), x = src.slice(0, N); for (let j = 0; j < T && j < N; j++) x[j] += src[N + j]; return x; });
  let pk = 0; for (const x of ch) for (let i = 0; i < N; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; }
  const target = Math.pow(10, -1.1 / 20), g = o.gain != null ? o.gain : (pk > 0 ? target / pk : 1); if (!o.noNorm) for (const x of ch) for (let i = 0; i < N; i++) x[i] *= g;
  return { ch, N, gain: g, peak: pk, peakOut: o.noNorm ? pk : pk * g, bars: b1 - b0, b0, sg }; }
function wav24(ch, N){ const nc = 2, len = N * nc * 3, b = new ArrayBuffer(44 + len), v = new DataView(b); let p = 0;
  const str = s => { for (const c of s) v.setUint8(p++, c.charCodeAt(0)); }, u32 = x => { v.setUint32(p, x, true); p += 4; }, u16 = x => { v.setUint16(p, x, true); p += 2; };
  str("RIFF"); u32(36 + len); str("WAVE"); str("fmt "); u32(16); u16(1); u16(nc); u32(SR); u32(SR * nc * 3); u16(nc * 3); u16(24); str("data"); u32(len);
  for (let i = 0; i < N; i++) for (let c = 0; c < nc; c++) { let x = Math.round(Math.max(-1, Math.min(1, ch[c][i])) * 8388607); if (x < 0) x += 16777216; v.setUint8(p++, x & 255); v.setUint8(p++, (x >> 8) & 255); v.setUint8(p++, (x >> 16) & 255); }
  return new Uint8Array(b); }
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
function fileBase(o){ o = o || {}; const [, , sg, s] = exportRange(o), name = o.all ? "song" : slug(s.sec.name || "section");
  return `${APP}-${name}${o.part ? "-" + o.part : ""}-${state.bpm}bpm-${keyLabel(state).replace("b", "b")}`; }
function midiFile(o){ o = o || {}; const [b0, b1, sg] = exportRange(o), PPQ = 480, T = PPQ / 4, total = (b1 - b0) * STEPS * T, vlq = n => { const a = [n & 127]; while (n >>= 7) a.unshift((n & 127) | 128); return a; };
  const trk = evs => { evs.sort((a, b) => a.t - b.t || a.o - b.o); let last = 0; const d = []; for (const e of evs) { d.push(...vlq(e.t - last), ...e.b); last = e.t; }
    d.push(...vlq(Math.max(0, total - last)), 0xFF, 0x2F, 0); return [0x4D, 0x54, 0x72, 0x6B, (d.length >>> 24) & 255, (d.length >> 16) & 255, (d.length >> 8) & 255, d.length & 255, ...d]; };
  const meta = (type, s) => { const c = [...new TextEncoder().encode(s)]; return [0xFF, type, ...vlq(c.length), ...c]; }, us = Math.round(60000000 / state.bpm);
  const cond = [{ t: 0, o: 0, b: meta(0x03, `${BRAND} ${state.bpm} BPM ${keyLabel(state)}`) }, { t: 0, o: 1, b: [0xFF, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] }, { t: 0, o: 2, b: [0xFF, 0x58, 4, 4, 2, 24, 8] }];
  for (const s of sg.S) if (s.start >= b0 && s.start < b1) cond.push({ t: (s.start - b0) * STEPS * T, o: 3, b: meta(0x06, `${s.sec.name}: ${s.chords.map(b => b.map(chName).join("/")).join(" ")}`) });
  const tracks = [trk(cond)], only = o.only || CHAIRS.filter(c => (o.mode || state.exportMode) === "added" ? !c.guide : true).map(c => c.id);
  for (const c of CHAIRS) { if (!only.includes(c.id) || state.mutes[c.id]) continue;
    const evs = sg.events.filter(e => e.ch === c.id && e.abs >= b0 * STEPS && e.abs < b1 * STEPS); if (!evs.length) continue;
    const out = [{ t: 0, o: 0, b: meta(0x03, c.name) }]; let prog = null;
    for (const e of evs) { const t0 = Math.round((e.abs - b0 * STEPS) * T), t1 = Math.min(total, Math.round((e.abs - b0 * STEPS + e.d) * T)), v = clamp(Math.round(e.v * 127), 1, 127);
      if (e.i !== "kit" && INST[e.i].gm !== prog) { prog = INST[e.i].gm; out.push({ t: t0, o: 1, b: [0xC0 | c.ch, prog] }); }
      out.push({ t: t0, o: 3, b: [0x90 | c.ch, e.n, v] }); out.push({ t: Math.max(t0 + 1, e.i === "kit" ? t0 + T / 2 : t1), o: 2, b: [0x80 | c.ch, e.n, 0] }); }
    tracks.push(trk(out)); }
  return new Uint8Array([].concat([0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, PPQ >> 8, PPQ & 255], ...tracks)); }
async function exportWavBytes(o){ o = o || {}; const r = await renderRange(o); return { bytes: wav24(r.ch, r.N), name: fileBase(o) + ".wav", frames: r.N, gain: r.gain, peak: r.peak, bars: r.bars }; }
function exportMidBytes(o){ o = o || {}; return { bytes: midiFile(o), name: fileBase(o) + ".mid" }; }
function crc32(b){ let c, crc = -1; for (let i = 0; i < b.length; i++) { c = (crc ^ b[i]) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ -1) >>> 0; }
function zipStore(fl){ const parts = [], cen = []; let off = 0; const enc = new TextEncoder(); const le = (n, w) => { const a = []; for (let i = 0; i < w; i++) a.push((n >>> (8 * i)) & 255); return a; };
  for (const f of fl) { const nm = enc.encode(f.name), c = crc32(f.bytes), sz = f.bytes.length;
    const h = new Uint8Array([0x50, 0x4B, 3, 4, 20, 0, 0, 0, 0, 0, 0, 0, 0x21, 0, ...le(c, 4), ...le(sz, 4), ...le(sz, 4), ...le(nm.length, 2), 0, 0, ...nm]);
    parts.push(h, f.bytes); cen.push(new Uint8Array([0x50, 0x4B, 1, 2, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0x21, 0, ...le(c, 4), ...le(sz, 4), ...le(sz, 4), ...le(nm.length, 2), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le(off, 4), ...nm])); off += h.length + sz; }
  const cl = cen.reduce((a, x) => a + x.length, 0), end = new Uint8Array([0x50, 0x4B, 5, 6, 0, 0, 0, 0, ...le(fl.length, 2), ...le(fl.length, 2), ...le(cl, 4), ...le(off, 4), 0, 0]);
  const out = new Uint8Array(off + cl + end.length); let p = 0; for (const x of [...parts, ...cen, end]) { out.set(x, p); p += x.length; } return out; }
async function exportStemsBytes(o){ o = Object.assign({ all: true }, o); const full = await exportWavBytes(Object.assign({}, o, { mode: "mix" })), fl = [{ name: full.name, bytes: full.bytes }, exportMidBytes(Object.assign({}, o, { mode: "mix" }))];
  const sg = song(); for (const c of CHAIRS) { if (state.mutes[c.id] || !sg.events.some(e => e.ch === c.id)) continue;
    const w = await exportWavBytes(Object.assign({}, o, { only: [c.id], part: c.id, gain: full.gain })); fl.push({ name: w.name, bytes: w.bytes }); }
  return { zip: zipStore(fl), name: fileBase(o) + "-stems.zip", files: fl }; }
function download(bytes, name, type){ const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
// A/B at matched loudness: render both versions of the audition range offline and match their RMS
async function measureLoudness(pv, secId){ const rms = r => { let s = 0; for (const x of r.ch) for (let i = 0; i < r.N; i++) s += x[i] * x[i]; return Math.sqrt(s / (2 * r.N)); };
  const id = secId, A = await renderRange({ pv: Object.assign({}, pv, { bare: true }), secId: id, mode: "mix", noNorm: true }), B = await renderRange({ pv, secId: id, mode: "mix", noNorm: true });
  const a = rms(A), b = rms(B); return { a, b, makeup: a > 0 ? clamp(b / a, 0.25, 4) : 1, db: 20 * Math.log10(Math.max(1e-9, b) / Math.max(1e-9, a)) }; }

// ---------- Lemon Squeezy license gate (empty config = checkout not live yet) ----------
const LEMON = { checkoutUrl: "", storeId: null, productId: null, price: "$39 once" };
const LS_API = "https://api.lemonsqueezy.com/v1/licenses/";
const lic = loadJSON(APP + "-license") || { valid: false };
const configured = () => !!(LEMON.storeId && LEMON.productId);
async function lsCall(action, params){ const r = await fetch(LS_API + action, { method: "POST", headers: { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() }); return r.json(); }
const ours = j => !!j && j.meta && +j.meta.store_id === +LEMON.storeId && +j.meta.product_id === +LEMON.productId;
async function activateKey(key){ if (!configured()) return { ok: false, reason: "Checkout opening soon. License keys can't be checked until the store is live." };
  const j = await lsCall("activate", { license_key: key, instance_name: BRAND + " web" }); if (!j.activated) return { ok: false, reason: j.error || "That key could not be activated." };
  if (!ours(j)) { if (j.instance) lsCall("deactivate", { license_key: key, instance_id: j.instance.id }).catch(() => {}); return { ok: false, reason: "That key is for a different product." }; }
  return { ok: true, instance: j.instance.id }; }
async function validateKey(key, instance){ if (!configured()) return false; const j = await lsCall("validate", { license_key: key, instance_id: instance }); return !!j.valid && ours(j); }
const saveLic = () => localStorage.setItem(APP + "-license", JSON.stringify(lic));
const gated = () => !lic.valid;
const FREE_BARS = 8;

// ---------- Web MIDI in/out ----------
let midiAccess = null, midiOut = null, midiInPort = null;
function midiSend(e, time, sd){ if (!midiOut || !ctx) return; const ch = CHAIR[e.ch].ch, at = performance.now() + (time - ctx.currentTime) * 1000, v = clamp(Math.round(e.v * 127), 1, 127);
  midiOut.send([0x90 | ch, e.n, v], at); midiOut.send([0x80 | ch, e.n, 0], at + Math.max(15, (e.i === "kit" ? 0.5 : e.d) * sd * 1000 - 3)); }
function onMidi(ev){ const d = ev.data, s = d[0], cmd = s & 0xF0, n = d[1], v = d[2]; if (s >= 0xF0) return; // clock/start/stop ignored: MIDI never starts the transport
  if (cmd === 0xB0 && n === 64) { setSustain(v >= 64); return; } if (cmd === 0xB0 && (n === 123 || n === 120)) { liveAllOff(); return; }
  if (cmd === 0x90 && v > 0) liveOn(n, v / 127, "midi"); else if (cmd === 0x80 || (cmd === 0x90 && v === 0)) liveOff(n, "midi"); }
function refreshMidi(){ if (!midiAccess) return;
  const fill = (sel, ports, cur) => { sel.innerHTML = '<option value="">(none)</option>' + [...ports.values()].map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(""); sel.value = [...ports.keys()].includes(cur) ? cur : ""; };
  fill(ui.midiIn, midiAccess.inputs, state.midiIn); fill(ui.midiOut, midiAccess.outputs, state.midiOut);
  if (midiInPort) midiInPort.onmidimessage = null; midiInPort = midiAccess.inputs.get(ui.midiIn.value) || null; if (midiInPort) midiInPort.onmidimessage = onMidi;
  midiOut = midiAccess.outputs.get(ui.midiOut.value) || null;
  ui.midiNote.textContent = (midiAccess.inputs.size ? (midiInPort ? `Playing ${INST[state.liveInst].label} from ${midiInPort.name}. Velocity and sustain (CC64) work. Notes never start the transport.` : "Pick your controller above.") : "No MIDI controller found. Plug one in; it shows up here.")
    + (midiOut ? ` Sending every chair on its own channel (drums on 10) to ${midiOut.name} while playing.` : ""); }

// ---------- live play (MIDI, on-screen pads/keys, computer keys) ----------
const liveVoices = new Map(); let sustain = false; window.__liveLog = [];
function liveVoice(note, vel, t){ const i = state.liveInst, ns = nearestSample(i, note); if (!ns || Math.abs(ns.shift) > MAX_SHIFT) return null; const buf = bufs[ns.id]; if (!buf) return null;
  const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; src.playbackRate.value = Math.pow(2, ns.shift / 12);
  if (INST[i].sus) { const [a, b] = loopPoints(buf); src.loop = true; src.loopStart = a; src.loopEnd = b; }
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * INST[i].gain, t + 0.005); src.connect(g); g.connect(bus.live); src.start(t, onsetOf(buf)); src.stop(t + 30); return { src, g }; }
function liveOn(note, vel, src, chordNotes){ if (!ctx || ctx.state !== "running") { setStatus("Tap to start audio first."); return; } const t = ctx.currentTime + 0.005, key = src + ":" + note;
  window.__liveLog.push({ note, vel, src, t, playing: !!play }); keyVis(note, true); const old = liveVoices.get(key); if (old) releaseVoice(old, t);
  const r = { vs: [] }; for (const n of chordNotes || [note]) { const v = liveVoice(n, vel * (chordNotes ? 0.6 : 1), t); if (v) r.vs.push(v); } liveVoices.set(key, r); }
function releaseVoice(r, t, fast){ if (r.done) return; r.done = true; const rel = fast ? FAST_RELEASE : 0.15; for (const v of r.vs) { try { v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value, t); v.g.gain.linearRampToValueAtTime(0, t + rel); v.src.stop(t + rel + 0.01); } catch (e) {} } }
function liveOff(note, src){ const key = src + ":" + note, vo = liveVoices.get(key); keyVis(note, false); if (!vo) return; if (sustain) { vo.sustained = true; return; } liveVoices.delete(key); releaseVoice(vo, ctx.currentTime); }
function setSustain(down){ sustain = down; if (!down && ctx) for (const [k, vo] of [...liveVoices]) if (vo.sustained) { liveVoices.delete(k); releaseVoice(vo, ctx.currentTime); } }
function liveAllOff(fast){ if (!ctx) return; for (const [, vo] of liveVoices) releaseVoice(vo, ctx.currentTime, fast); liveVoices.clear(); sustain = false; document.querySelectorAll(".down").forEach(k => k.classList.remove("down")); }
const KEYROW = "QWERTYUIOP";
const keyNotes = () => { const sc = state.mode === "minor" ? MIN : MAJ, out = []; for (let i = 0; i < 10; i++) out.push(12 * (state.kbdOct + 1) + state.keyRoot + sc[i % 7] + 12 * Math.floor(i / 7)); return out; };
function padChords(){ const sg = song(), s = sg.S.find(x => x.sec.id === state.sel) || sg.S[0], seen = [], out = [];
  for (const b of s.chords) for (const c of b) { const nm = chName(c); if (!seen.includes(nm) && out.length < 8) { seen.push(nm); out.push(c); } } return out; }
function keyVis(n, on){ document.querySelectorAll(`[data-n="${n}"]`).forEach(k => k.classList.toggle("down", on)); }

// ---------- audio devices: output (setSinkId) + input ----------
const sinkOK = () => typeof (window.AudioContext || function(){}).prototype.setSinkId === "function";
async function listDevices(){ let devs = []; try { devs = await navigator.mediaDevices.enumerateDevices(); } catch (e) {}
  const ins = devs.filter(d => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default"), outs = devs.filter(d => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default");
  ui.audioIn.innerHTML = '<option value="">System default input</option>' + ins.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || "Audio input " + (i + 1))}</option>`).join(""); ui.audioIn.value = ins.some(d => d.deviceId === state.audioIn) ? state.audioIn : "";
  if (!sinkOK()) { ui.audioOut.innerHTML = '<option value="">System default</option>'; ui.audioOut.disabled = true; ui.audioOutNote.textContent = "This browser can't route Web Audio to a chosen device (no setSinkId); sound uses your system output."; return; }
  ui.audioOut.innerHTML = '<option value="">System default</option>' + outs.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || "Audio output " + (i + 1))}</option>`).join(""); ui.audioOut.value = outs.some(d => d.deviceId === state.audioOut) ? state.audioOut : "";
  if (outs.length && !outs[0].label) ui.audioOutNote.textContent = "Device names appear after you allow the input once."; }
async function applySink(){ if (!ctx || !sinkOK()) return; try { const want = state.audioOut || ""; if ((typeof ctx.sinkId === "string" ? ctx.sinkId : "") !== want) await ctx.setSinkId(want); ui.audioOutNote.textContent = state.audioOut ? "Playing through the selected output." : "Playing through the system default output."; }
  catch (e) { ui.audioOutNote.textContent = "Couldn't switch output (" + e.name + "); using the system default."; state.audioOut = ""; save(); ui.audioOut.value = ""; } }
let input = null;
async function enableInput(){ await ensureCtx(); try { const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: state.audioIn ? { exact: state.audioIn } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(), mon = ctx.createGain(); an.fftSize = 1024; mon.gain.value = state.monitor ? 1 : 0; src.connect(an); src.connect(mon); mon.connect(bus.master);
    input = { stream, src, an, mon }; ui.inBtn.textContent = "Turn input off"; ui.inState.textContent = "Input on: " + (stream.getAudioTracks()[0].label || "default") + (state.monitor ? " · monitoring (use headphones)." : " · meter only."); listDevices(); meter(); }
  catch (e) { ui.inState.textContent = "Input not available (" + e.name + ")."; } }
function disableInput(){ if (!input) return; input.stream.getTracks().forEach(t => t.stop()); try { input.src.disconnect(); input.mon.disconnect(); } catch (e) {} input = null; ui.inBtn.textContent = "Turn input on"; ui.inState.textContent = "Input off."; ui.meter.style.width = "0%"; }
function meter(){ if (!input) return; const a = new Float32Array(input.an.fftSize); input.an.getFloatTimeDomainData(a); let p = 0; for (const x of a) p = Math.max(p, Math.abs(x)); ui.meter.style.width = Math.min(100, p * 100) + "%"; requestAnimationFrame(meter); }
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange", listDevices);

// ---------- UI ----------
const $ = id => document.getElementById(id), ui = {};
["tap","tapBtn","status","loadStatus","bpm","key","mode","loopBars","chords","chordErr","progs","stuck","sugFor","audition","sugs","cats","allMoves","timeline","secPanel","songLen","mixer","master","liveGain","liveInst",
 "pads","keys","octLbl","deskFind","midiIn","midiOut","midiNote","audioIn","audioOut","audioOutNote","inBtn","inState","monitor","meter","licKey","licBtn","licOff","licState","play","playSel","stopBtn","loopSection","fileInfo","buy"].forEach(k => ui[k] = $(k));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const setStatus = t => { ui.status.textContent = t; };
function paintLoad(msg){ const el = ui.loadStatus; if (msg) { el.textContent = msg; el.classList.remove("bad"); return; }
  const sg = song(), list = filesFor(instsOf(sg).concat(["kit", state.liveInst])), miss = missingLabels(list);
  if (miss.length) { el.textContent = `Missing instruments: ${miss.join(", ")}. Playback and export are off until they load. Check your connection (or unblock cdn.jsdelivr.net) and reload.`; el.classList.add("bad"); }
  else { el.textContent = `All ${list.length} samples for this song are loaded (${Object.keys(bufs).length} in memory).`; el.classList.remove("bad"); } }
ui.key.innerHTML = NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join("");
ui.liveInst.innerHTML = Object.entries(INST).map(([id, d]) => `<option value="${id}">${esc(d.label)}</option>`).join("");
const PROGS = { major: [["I–V–vi–IV", [[0,""],[7,""],[9,"m"],[5,""]]], ["I–vi–IV–V", [[0,""],[9,"m"],[5,""],[7,""]]], ["vi–IV–I–V", [[9,"m"],[5,""],[0,""],[7,""]]], ["ii–V–I–I", [[2,"m7"],[7,"7"],[0,"maj7"],[0,"maj7"]]], ["I–IV–V–IV", [[0,""],[5,""],[7,""],[5,""]]]],
  minor: [["i–VI–III–VII", [[0,"m"],[8,""],[3,""],[10,""]]], ["i–iv–v–i", [[0,"m"],[5,"m"],[7,"m"],[0,"m"]]], ["i–VII–VI–VII", [[0,"m"],[10,""],[8,""],[10,""]]], ["i–iv–VII–III", [[0,"m"],[5,"m"],[10,""],[3,""]]], ["i–VI–iv–V", [[0,"m"],[8,""],[5,"m"],[7,""]]]] };
let aud = null, browseCat = "part";
function setChords(text, keepKey){ const p = parseProg(text); if (!p) { ui.chordErr.textContent = "Type 1–16 chords, e.g. Am F C G (m, 7, m7, maj7, 9, m9, m7b5, dim, aug, sus2, sus4, 6, m6, add9, slash bass like C/E)."; return false; }
  ui.chordErr.textContent = ""; const t = tokens(text), k = inferKey(p); state.chords = t.join(" ");
  if (keepKey) { state.baseKey = state.keyRoot; } else Object.assign(state, { keyRoot: k.root, baseKey: k.root, mode: k.mode });
  state.loopBars = defaultLoopBars(state) > 16 ? 16 : defaultLoopBars(state); save(); render(); preload(); return true; }
function render(){ ui.bpm.value = state.bpm; ui.key.value = state.keyRoot; ui.mode.value = state.mode; ui.loopBars.value = state.loopBars; if (document.activeElement !== ui.chords) ui.chords.value = state.chords;
  ui.loopSection.checked = state.loopSection; ui.master.value = state.master; ui.liveGain.value = state.liveGain; ui.liveInst.value = state.liveInst; ui.monitor.checked = state.monitor;
  document.querySelectorAll('input[name="exm"]').forEach(r => r.checked = r.value === state.exportMode);
  ui.progs.innerHTML = PROGS[state.mode].map(([n, cs]) => { const t = cs.map(([iv, q]) => NAMES[pc(state.keyRoot + iv)] + q).join(" "); return `<button class="chip" data-p="${t}">${n} <small>${t}</small></button>`; }).join("");
  ui.stuck.innerHTML = STUCK.map(([id, t, sub]) => `<button class="stk${state.stuck === id ? " on" : ""}" data-stuck="${id}"><b>${esc(t)}</b><small>${esc(sub)}</small></button>`).join("");
  paintSugs(); paintBrowse(); paintTimeline(); paintSection(); paintKeys(); paintFileInfo(); }
const optSummary = (id, o) => Object.entries(MOVES[id].opts || {}).map(([k, v]) => (v.choices.find(c => String(c[0]) === String(o[k])) || [0, o[k]])[1]).join(" · ");
const catName = c => (CATS.find(x => x[0] === c) || [0, c])[1];
function sugCard(s, i, list){ const m = MOVES[s.id], tgt = s.type === "section" ? ({ start: "goes at the start", end: "goes at the end", before: "goes before the selected section", after: "goes after the selected section" })[m.where] : "goes on the selected section";
  return `<div class="sug cat-${m.cat}"><div class="sugh"><span class="tag">${catName(m.cat)}</span><b>${esc(m.name)}</b><small>${esc(optSummary(s.id, s.opts))}</small></div><p>${esc(s.reason)}</p>
  <div class="row"><button class="primary" data-aud="${list}:${i}">▶ Audition</button><button data-add="${list}:${i}">+ Add</button><small class="tgt">${tgt}</small></div></div>`; }
let sugList = [], allList = [];
function paintSugs(){ const sec = selSec(); sugList = suggest(state.stuck, state.sel); ui.sugFor.textContent = `for “${(STUCK.find(s => s[0] === state.stuck) || [])[1]}” · selected: ${sec ? sec.name : ""}`;
  ui.sugs.innerHTML = sugList.map((s, i) => sugCard(s, i, "s")).join("") || "<p>No more ideas here. Try another area.</p>"; paintAudition(); }
function paintBrowse(){ const q = (ui.deskFind.value || "").trim().toLowerCase();
  if (q) { const hits = Object.keys(DESKS).filter(k => k.toLowerCase().includes(q)), notes = Object.keys(DESK_NOTES).filter(k => k.toLowerCase().includes(q));
    allList = hits.map(k => { const [id, o] = DESKS[k]; return { id, opts: deskOpts(id, o), type: MOVES[id].type, desk: k, reason: `${k} is now ${MOVES[id].name} with this preset. Audition it, then change any option.` }; });
    ui.allMoves.innerHTML = allList.map((s, i) => sugCard(s, i, "a")).join("") + notes.map(k => `<div class="sug"><div class="sugh"><b>${esc(k)}</b></div><p>${esc(DESK_NOTES[k])}.</p></div>`).join("") || `<p class="small">No old desk matches “${esc(q)}”.</p>`; return; }
  ui.cats.innerHTML = CATS.map(([c, n]) => `<button class="${c === browseCat ? "on" : ""}" data-cat="${c}">${n} (${Object.values(MOVES).filter(m => m.cat === c).length})</button>`).join("");
  allList = Object.values(MOVES).filter(m => m.cat === browseCat).map(m => ({ id: m.id, opts: defOpts(m.id), type: m.type, reason: `Options: ${Object.values(m.opts || {}).map(o => o.label + " (" + o.choices.map(c => c[1]).join(", ") + ")").join("; ")}.` + (wasDesks(m.id).length ? ` Replaces ${wasDesks(m.id).join(", ")}.` : "") }));
  ui.allMoves.innerHTML = allList.map((s, i) => sugCard(s, i, "a")).join(""); }
function paintAudition(){ if (!aud) { ui.audition.hidden = true; return; } const m = MOVES[aud.sug.id]; ui.audition.hidden = false;
  ui.audition.innerHTML = `<b>Auditioning ${esc(m.name)}</b> <small>${esc(optSummary(aud.sug.id, aud.sug.opts))}</small>
   <div class="row"><button class="${aud.ab === "A" ? "on" : ""}" data-ab="A">A · without</button><button class="${aud.ab === "B" ? "on" : ""}" data-ab="B">B · with</button>
   <span class="small">${aud.loud ? `Matched loudness: A is lifted ${aud.loud.db.toFixed(1)} dB so you hear the move, not the volume.` : "Matching loudness…"}</span></div>
   <div class="row"><button class="primary" id="keep">✓ Keep</button><button id="discard">✕ Discard</button><button id="audReroll">↻ Another take</button></div>`; }
const selSec = () => state.arr.find(s => s.id === state.sel);
const KIND_CLASS = s => s.kind === "loop" ? "loop" : MOVES[s.kind].cat;
function paintTimeline(){ const sg = song(aud && aud.ab === "B" ? aud.pv : null), tot = sg.totalBars;
  ui.songLen.textContent = `${sg.S.length} sections · ${tot} bars · ${fmtTime(tot * 4 * 60 / state.bpm)} at ${state.bpm} BPM`;
  ui.timeline.innerHTML = sg.S.map(s => { const sec = s.sec, prev = aud && aud.pv && aud.pv.focus === sec.id && aud.pv.arr ? " preview" : "";
    return `<button class="blk k-${KIND_CLASS(sec)}${sec.id === state.sel ? " sel" : ""}${sec.locked ? " locked" : ""}${prev}" data-sec="${sec.id}" style="flex-grow:${s.bars}">
      <b>${esc(sec.name)}${sec.locked ? " 🔒" : ""}</b><small>${s.bars} bars${s.shift ? " · +" + s.shift : ""}</small><i>${esc(s.chords.slice(0, 4).map(b => b.map(chName).join("/")).join(" "))}${s.chords.length > 4 ? " …" : ""}</i>
      <span class="badges">${sec.moves.map(m => `<em class="c-${MOVES[m.id].cat}${m.muted ? " off" : ""}">${esc(MOVES[m.id].name)}</em>`).join("")}</span></button>`; }).join("") + `<div id="ph" class="ph"></div>`; }
const fmtTime = s => Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");
function paintPlayhead(step){ const ph = $("ph"); if (!ph) return; const sg = song(play && play.pv), tot = sg.totalBars * STEPS; ph.style.left = (100 * step / tot) + "%"; ph.style.display = "block"; }
function optSelects(id, o, attr){ return Object.entries(MOVES[id].opts || {}).map(([k, v]) => `<label>${esc(v.label)} <select ${attr} data-k="${k}">${v.choices.map(([cv, cl]) => `<option value="${cv}"${String(cv) === String(o[k]) ? " selected" : ""}>${esc(cl)}</option>`).join("")}</select></label>`).join(""); }
function paintSection(){ const sec = selSec(); if (!sec) { ui.secPanel.innerHTML = ""; return; } const sg = song(), s = sg.S.find(x => x.sec.id === sec.id), L = sec.locked ? " disabled" : "";
  const kind = sec.kind === "loop" ? "Your loop" : `${catName(MOVES[sec.kind].cat)}: ${MOVES[sec.kind].name}`;
  ui.secPanel.innerHTML = `<div class="sechead"><input id="secName" value="${esc(sec.name)}"${L} aria-label="Section name"><span class="tag">${esc(kind)}</span>
    <label class="chk"><input type="checkbox" id="secLock"${sec.locked ? " checked" : ""}> Lock</label>
    <button id="secLeft"${L}>←</button><button id="secRight"${L}>→</button><button id="secDup">Duplicate</button><button id="secDel"${L || state.arr.length < 2 ? " disabled" : ""}>Delete</button></div>
    <div class="row">${sec.kind === "loop" ? `<label>Bars <select id="secBars"${L}>${[2, 4, 8, 12, 16].map(b => `<option${(sec.bars || state.loopBars) === b ? " selected" : ""}>${b}</option>`).join("")}</select></label>
      <label>Plays like <select id="secRole"${L}>${[["loop", "Chorus / main loop"], ["verse", "Verse (lighter)"], ["chorus", "Chorus (crash in)"]].map(([v, n]) => `<option value="${v}"${(sec.role || "loop") === v ? " selected" : ""}>${n}</option>`).join("")}</select></label>`
      : optSelects(sec.kind, Object.assign(defOpts(sec.kind), sec.opts), `data-secopt${L}`)}
      ${sec.kind !== "loop" ? `<button id="secSeed"${L}>↻ New take</button>` : ""}</div>
    <div class="bars">${s.chords.map((b, i) => `<span><small>${s.start + i + 1}</small>${esc(b.map(chName).join(" / "))}</span>`).join("")}</div>
    <h3>Moves on this section <small>(${sec.moves.length})</small></h3>
    ${sec.moves.map((m, j) => `<div class="mv cat-${MOVES[m.id].cat}${m.muted ? " off" : ""}" data-j="${j}"><div class="mvh"><span class="tag">${catName(MOVES[m.id].cat)}</span><b>${esc(MOVES[m.id].name)}</b>
      <label class="chk"><input type="checkbox" data-mvlock${m.locked ? " checked" : ""}${L}> Lock</label><label class="chk"><input type="checkbox" data-mvmute${m.muted ? " checked" : ""}> Mute</label>
      <button data-mvseed${m.locked || sec.locked ? " disabled" : ""}>↻ New take</button><button data-mvdel${m.locked || sec.locked ? " disabled" : ""}>Remove</button></div>
      <div class="row">${optSelects(m.id, m.opts, `data-mvopt${m.locked || sec.locked ? " disabled" : ""}`)}</div></div>`).join("") || `<p class="small">Nothing stacked yet. Pick where you're stuck above, or press Auto-suggest.</p>`}`; }
function paintMixer(){ ui.mixer.innerHTML = CHAIRS.map(c => `<label class="chair${state.mutes[c.id] ? " muted" : ""}${c.guide ? " guide" : ""}"><span>${esc(c.name)}</span><input type="range" min="0" max="1.5" step="0.01" value="${state.gains[c.id]}" data-gain="${c.id}" aria-label="${esc(c.name)} volume"><span class="mute"><input type="checkbox" data-mute="${c.id}" ${state.mutes[c.id] ? "checked" : ""}> mute</span></label>`).join(""); }
function paintKeys(){ ui.pads.innerHTML = padChords().map((c, b) => `<button class="pad" data-n="${1000 + b}" data-bar="${b}">${esc(chName(c))}<small>${b + 1}</small></button>`).join("");
  ui.keys.innerHTML = keyNotes().map((n, i) => `<button class="pkey" data-n="${n}">${NAMES[pc(n)]}${Math.floor(n / 12) - 1}<small>${KEYROW[i]}</small></button>`).join(""); ui.octLbl.textContent = "Octave " + state.kbdOct; }
function paintFileInfo(){ const sec = selSec(), sg = song(), s = sg.S.find(x => x.sec.id === state.sel) || sg.S[0];
  ui.fileInfo.textContent = `Section: ${fileBase()}.wav + .mid · ${s.bars} bars = ${Math.round(s.bars * 4 * 60 / state.bpm * SR).toLocaleString()} samples. Whole song: ${sg.totalBars} bars = ${Math.round(sg.totalBars * 4 * 60 / state.bpm * SR).toLocaleString()} samples. 48 kHz / 24-bit, downbeat at sample 0.`; }
function paintTransport(){ ui.play.classList.toggle("on", !!play && !play.audition); ui.play.textContent = play && !play.audition ? "▶ Playing" : "▶ Play song"; if (!play) { const ph = $("ph"); if (ph) ph.style.display = "none"; } }
function licUI(){ ui.licOff.hidden = !lic.valid; ui.licState.textContent = lic.valid ? "Licensed: whole-song WAV and MIDI, stems ZIP and long sections unlocked. Thank you!" :
  `Free: every move, auditions, the timeline, live play, MIDI in/out, and WAV + multitrack MIDI of any section up to ${FREE_BARS} bars. The license (${LEMON.price}, no subscription) adds whole-song WAV + MIDI, the stems ZIP (one grid-locked WAV per chair) and section exports longer than ${FREE_BARS} bars.`; }
function relayout(){ save(); render(); preload(); }
let preloadTimer = null;
function preload(){ clearTimeout(preloadTimer); preloadTimer = setTimeout(() => ensureInstruments(instsOf(song(aud && aud.pv)).concat([state.liveInst])), 30); }

// --- loop inputs
ui.bpm.addEventListener("change", () => { const v = Math.round(+ui.bpm.value); if (!(v >= 60 && v <= 180)) { ui.bpm.value = state.bpm; setStatus("BPM must be 60–180."); return; } state.bpm = v; relayout(); });
ui.key.addEventListener("change", () => { state.keyRoot = +ui.key.value; relayout(); });
ui.mode.addEventListener("change", () => { state.mode = ui.mode.value; relayout(); });
ui.loopBars.addEventListener("change", () => { state.loopBars = +ui.loopBars.value; relayout(); });
ui.chords.addEventListener("change", () => setChords(ui.chords.value));
ui.progs.addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (b) { const k = state.keyRoot, md = state.mode; if (setChords(b.dataset.p)) { Object.assign(state, { keyRoot: k, baseKey: k, mode: md }); relayout(); } } });
ui.stuck.addEventListener("click", e => { const b = e.target.closest("[data-stuck]"); if (!b) return; state.stuck = b.dataset.stuck; save(); render(); ui.sugs.scrollIntoView({ behavior: "smooth", block: "nearest" }); });
ui.deskFind.addEventListener("input", paintBrowse);
ui.cats.addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (b) { browseCat = b.dataset.cat; paintBrowse(); } });
// --- audition / add
const pick = key => { const [l, i] = key.split(":"); return (l === "s" ? sugList : allList)[+i]; };
async function audition(sug){ await ensureCtx(); const sec = selSec(); if (sec && sec.locked && sug.type !== "section") { setStatus(`“${sec.name}” is locked. Unlock it to audition moves on it.`); return; }
  sug = Object.assign({}, sug, { seed: sug.seed || nextSeed() }); const pv = previewFor(sug, state.sel);
  if (!(await ensureInstruments(instsOf(song(pv)), MOVES[sug.id].name))) { setStatus("Can't audition: " + ui.loadStatus.textContent); return; }
  aud = { sug, pv, ab: "B", loud: null }; start({ pv, audition: pv.focus }); bus.ab.gain.value = 1; paintAudition(); paintTimeline();
  setStatus(`Auditioning ${MOVES[sug.id].name} on a loop around “${(pv.sec || sec).name}”. Switch A/B, then Keep or Discard.`);
  const mine = aud; measureLoudness(pv, pv.focus).then(l => { if (aud !== mine) return; aud.loud = l; if (aud.ab === "A") bus.ab.gain.setTargetAtTime(l.makeup, ctx.currentTime, 0.01); paintAudition(); }).catch(() => {}); }
function setAB(ab){ if (!aud || !play) return; aud.ab = ab; play.pv = ab === "B" ? aud.pv : Object.assign({}, aud.pv, { bare: true }); if (aud.loud) bus.ab.gain.setTargetAtTime(ab === "A" ? aud.loud.makeup : 1, ctx.currentTime, 0.01); paintAudition(); }
function endAudition(keep){ if (!aud) return; const a = aud; aud = null; stop(true); if (keep) { commitPreview(a.pv); setStatus(`Added ${MOVES[a.sug.id].name}. Edit its options below, lock it, or keep stacking.`); } else setStatus("Discarded. Nothing changed."); render(); preload(); }
function addNow(sug){ const sec = selSec(); if (sec && sec.locked && sug.type !== "section") { setStatus(`“${sec.name}” is locked.`); return; } const pv = previewFor(sug, state.sel); commitPreview(pv); render(); preload(); setStatus(`Added ${MOVES[sug.id].name}.`); }
for (const box of [ui.sugs, ui.allMoves]) box.addEventListener("click", e => { const a = e.target.closest("[data-aud]"), d = e.target.closest("[data-add]"); if (a) audition(pick(a.dataset.aud)); if (d) addNow(pick(d.dataset.add)); });
ui.audition.addEventListener("click", e => { const ab = e.target.closest("[data-ab]"); if (ab) setAB(ab.dataset.ab); if (e.target.id === "keep") endAudition(true); if (e.target.id === "discard") endAudition(false);
  if (e.target.id === "audReroll") { const s = Object.assign({}, aud.sug, { seed: nextSeed() }); aud = null; audition(s); } });
// --- timeline + section panel
ui.timeline.addEventListener("click", e => { const b = e.target.closest("[data-sec]"); if (!b) return; state.sel = b.dataset.sec; save(); render(); });
const mutSec = fn => { const sec = selSec(); if (!sec) return; fn(sec); save(); paintTimeline(); paintSection(); paintFileInfo(); paintKeys(); preload(); };
ui.secPanel.addEventListener("change", e => { const t = e.target, sec = selSec(), j = t.closest("[data-j]") ? +t.closest("[data-j]").dataset.j : null;
  if (t.id === "secName") return mutSec(s => s.name = t.value.trim() || s.name); if (t.id === "secLock") return mutSec(s => s.locked = t.checked);
  if (t.id === "secBars") return mutSec(s => s.bars = +t.value); if (t.id === "secRole") return mutSec(s => s.role = t.value);
  if (t.hasAttribute("data-secopt")) return mutSec(s => { s.opts = Object.assign(defOpts(s.kind), s.opts, { [t.dataset.k]: isNaN(+t.value) ? t.value : +t.value }); });
  if (j == null) return; const m = sec.moves[j];
  if (t.hasAttribute("data-mvopt")) mutSec(() => { m.opts = Object.assign({}, m.opts, { [t.dataset.k]: isNaN(+t.value) || t.value === "" ? t.value : +t.value }); });
  if (t.hasAttribute("data-mvlock")) mutSec(() => m.locked = t.checked); if (t.hasAttribute("data-mvmute")) mutSec(() => m.muted = t.checked); });
ui.secPanel.addEventListener("click", e => { const t = e.target, sec = selSec(), i = state.arr.indexOf(sec), j = t.closest("[data-j]") ? +t.closest("[data-j]").dataset.j : null;
  if (t.id === "secLeft" && i > 0) mutSec(() => { state.arr.splice(i, 1); state.arr.splice(i - 1, 0, sec); });
  if (t.id === "secRight" && i < state.arr.length - 1) mutSec(() => { state.arr.splice(i, 1); state.arr.splice(i + 1, 0, sec); });
  if (t.id === "secDup") mutSec(() => { const c = JSON.parse(JSON.stringify(sec)); c.id = newId(); c.name = sec.name + " (copy)"; c.locked = false; c.moves.forEach(m => m.uid = "m" + Date.now().toString(36) + (uid++)); state.arr.splice(i + 1, 0, c); state.sel = c.id; });
  if (t.id === "secDel" && state.arr.length > 1) { state.arr.splice(i, 1); state.sel = state.arr[Math.max(0, i - 1)].id; relayout(); }
  if (t.id === "secSeed") mutSec(s => s.seed = nextSeed());
  if (j != null && t.hasAttribute("data-mvseed")) mutSec(() => sec.moves[j].seed = nextSeed());
  if (j != null && t.hasAttribute("data-mvdel")) mutSec(() => sec.moves.splice(j, 1)); });
$("autoArr").onclick = () => { autoArrange(); render(); preload(); setStatus("Auto-arranged a full song from your loop. Locked sections were kept. Everything stays editable."); };
$("autoSug").onclick = () => { const r = autoSuggest(state.sel); render(); preload(); setStatus(r ? `Added ${MOVES[r.id].name}: ${r.reason}` : "That section is locked or already full."); };
$("reroll").onclick = () => { const n = reroll(); render(); setStatus(`New takes for ${n} unlocked parts. Locked ones didn't change.`); };
$("addLoop").onclick = () => { const s = loopSection("Loop " + (state.arr.filter(x => x.kind === "loop").length + 1)), i = state.arr.indexOf(selSec()); state.arr.splice(i + 1, 0, s); state.sel = s.id; relayout(); };
ui.loopSection.addEventListener("change", () => { state.loopSection = ui.loopSection.checked; save(); });
// --- transport
async function playSong(fromSel){ await ensureCtx(); if (aud) { aud = null; paintAudition(); }
  if (!(await ensureInstruments(instsOf(song()).concat([state.liveInst])))) { setStatus("Can't play yet. " + ui.loadStatus.textContent); return; }
  const sg = song(), [a] = secRange(sg, state.sel); start({ fromStep: fromSel || state.loopSection ? a : 0 }); paintTimeline();
  setStatus(state.loopSection ? "Looping the selected section. Edits are heard on the next step." : "Playing the whole song. Edits are heard on the next step."); }
ui.play.onclick = () => playSong(false); ui.playSel.onclick = () => playSong(true); ui.stopBtn.onclick = () => { if (aud) { aud = null; paintAudition(); paintTimeline(); } stop(); };
// --- export
document.querySelectorAll('input[name="exm"]').forEach(r => r.addEventListener("change", () => { state.exportMode = r.value; save(); }));
const busy = async (msg, fn) => { setStatus(msg); try { await fn(); } catch (e) { setStatus("Export failed: " + e.message); } };
$("exportWav").onclick = () => busy("Rendering at 48 kHz…", async () => { const s = song().S.find(x => x.sec.id === state.sel); if (s.bars > FREE_BARS && gated()) { setStatus(`Sections longer than ${FREE_BARS} bars export with the license (${LEMON.price}).`); return; }
  const r = await exportWavBytes(); download(r.bytes, r.name, "audio/wav"); setStatus(`Saved ${r.name} (${r.frames.toLocaleString()} samples, downbeat at sample 0). Drop it on the bar where “${s.sec.name}” starts.`); });
$("exportMid").onclick = () => { const s = song().S.find(x => x.sec.id === state.sel); if (s.bars > FREE_BARS && gated()) { setStatus(`Sections longer than ${FREE_BARS} bars export with the license (${LEMON.price}).`); return; }
  const r = exportMidBytes(); download(r.bytes, r.name, "audio/midi"); setStatus(`Saved ${r.name}: one track per chair, tempo, 4/4 and section markers.`); };
$("exportSongWav").onclick = () => { if (gated()) { setStatus(`Whole-song export is in the licensed version (${LEMON.price}).`); return; } busy("Rendering the whole song at 48 kHz…", async () => { const r = await exportWavBytes({ all: true }); download(r.bytes, r.name, "audio/wav"); setStatus(`Saved ${r.name} (${r.frames.toLocaleString()} samples).`); }); };
$("exportSongMid").onclick = () => { if (gated()) { setStatus(`Whole-song export is in the licensed version (${LEMON.price}).`); return; } const r = exportMidBytes({ all: true }); download(r.bytes, r.name, "audio/midi"); setStatus(`Saved ${r.name} with section markers.`); };
$("exportStems").onclick = () => { if (gated()) { setStatus(`The stems ZIP is in the licensed version (${LEMON.price}).`); return; } busy("Rendering stems…", async () => { const r = await exportStemsBytes(); download(r.zip, r.name, "application/zip"); setStatus(`Saved ${r.name} (${r.files.length} files).`); }); };
// --- mixer, live, devices
ui.mixer.addEventListener("input", e => { const m = e.target.dataset.mute, g = e.target.dataset.gain;
  if (m) { state.mutes[m] = e.target.checked; e.target.closest(".chair").classList.toggle("muted", e.target.checked); } if (g) state.gains[g] = +e.target.value;
  const id = m || g; if (bus && id) bus.chairs[id].gain.setTargetAtTime(state.mutes[id] ? 0 : state.gains[id], ctx.currentTime, 0.01); save(); });
for (const [id, node] of [["master", "master"], ["liveGain", "live"]]) ui[id].addEventListener("input", () => { state[id] = +ui[id].value; if (bus) bus[node].gain.setTargetAtTime(state[id], ctx.currentTime, 0.01); save(); });
ui.liveInst.addEventListener("change", () => { state.liveInst = ui.liveInst.value; save(); ensureInstruments([state.liveInst], INST[state.liveInst].label); refreshMidi(); });
ui.midiIn.addEventListener("change", () => { state.midiIn = ui.midiIn.value; save(); refreshMidi(); }); ui.midiOut.addEventListener("change", () => { state.midiOut = ui.midiOut.value; save(); refreshMidi(); });
ui.audioOut.addEventListener("change", () => { state.audioOut = ui.audioOut.value; save(); applySink(); });
ui.audioIn.addEventListener("change", async () => { state.audioIn = ui.audioIn.value; save(); if (input) { disableInput(); await enableInput(); } });
ui.inBtn.onclick = async () => { if (input) disableInput(); else await enableInput(); };
ui.monitor.addEventListener("change", () => { state.monitor = ui.monitor.checked; save(); if (input) input.mon.gain.setTargetAtTime(state.monitor ? 1 : 0, ctx.currentTime, 0.02); });
$("octDn").onclick = () => { state.kbdOct = Math.max(2, state.kbdOct - 1); save(); paintKeys(); }; $("octUp").onclick = () => { state.kbdOct = Math.min(6, state.kbdOct + 1); save(); paintKeys(); };
function chordNotesFor(b){ const c = padChords()[b]; return c ? voicing(c, 55, 74, null, 4) : []; }
function padOn(el, src){ const n = +el.dataset.n; if (el.dataset.bar != null) liveOn(n, 0.85, src, chordNotesFor(+el.dataset.bar)); else liveOn(n, 0.85, src); return n; }
function pointer(box){ const down = new Map(); box.addEventListener("pointerdown", e => { const k = e.target.closest("[data-n]"); if (!k) return; e.preventDefault(); down.set(e.pointerId, padOn(k, "ptr")); });
  const up = e => { if (!down.has(e.pointerId)) return; liveOff(down.get(e.pointerId), "ptr"); down.delete(e.pointerId); }; box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up); box.addEventListener("pointerleave", up); }
pointer(ui.pads); pointer(ui.keys);
const held = new Map();
window.addEventListener("keydown", e => { if (e.repeat || e.metaKey || e.ctrlKey || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return; const K = e.key.toUpperCase();
  if (K === " ") { e.preventDefault(); return; } // Space is not a transport key: notes never start the transport
  const d = parseInt(K, 10); if (d >= 1 && d <= padChords().length) { held.set(K, 1000 + d - 1); liveOn(1000 + d - 1, 0.85, "kbd", chordNotesFor(d - 1)); return; }
  const i = KEYROW.indexOf(K); if (i >= 0 && K) { const n = keyNotes()[i]; held.set(K, n); liveOn(n, 0.85, "kbd"); } });
window.addEventListener("keyup", e => { const K = e.key.toUpperCase(); if (held.has(K)) { liveOff(held.get(K), "kbd"); held.delete(K); } });
ui.tapBtn.onclick = async () => { ui.tapBtn.textContent = "Starting…"; await ensureCtx(); if (ctx.state === "running") { ui.tap.classList.add("hide"); setStatus("Audio on. Pick where you're stuck, audition a move, or press Play song."); } else ui.tapBtn.textContent = "Tap again to start audio"; };
ui.licBtn.onclick = async () => { const k = ui.licKey.value.trim(); if (!k) return; ui.licState.textContent = "Checking…";
  try { const r = await activateKey(k); if (r.ok) { Object.assign(lic, { valid: true, key: k, instance: r.instance, checked: Date.now() }); saveLic(); licUI(); } else ui.licState.textContent = r.reason; } catch (e) { ui.licState.textContent = "Couldn't reach Lemon Squeezy. Try again."; } };
ui.licOff.onclick = async () => { if (lic.key && lic.instance && configured()) await lsCall("deactivate", { license_key: lic.key, instance_id: lic.instance }).catch(() => {}); for (const k of Object.keys(lic)) delete lic[k]; lic.valid = false; saveLic(); licUI(); };
if (LEMON.checkoutUrl) { ui.buy.href = LEMON.checkoutUrl; ui.buy.textContent = "Buy FinishKit · " + LEMON.price; } else { ui.buy.removeAttribute("href"); ui.buy.setAttribute("aria-disabled", "true"); ui.buy.textContent = "Checkout opening soon · " + LEMON.price; }
if (lic.valid && lic.key) validateKey(lic.key, lic.instance).then(v => { lic.valid = v; saveLic(); licUI(); }).catch(() => {});
if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) document.querySelectorAll(".ios").forEach(e => e.hidden = false);
window.__finishkit = { DESKS, DESK_NOTES, state, MOVES, CATS, CHAIRS, INST, KIT, SAMPLES, song, buildSong, suggest, previewFor, commitPreview, autoArrange, autoSuggest, reroll, newMove, newSection, loopSection,
  exportWavBytes, exportMidBytes, exportStemsBytes, renderRange, measureLoudness, liveOn, liveOff, setSustain, start, stop, playSong, audition, setAB, endAudition, measureStopSilence, ensureInstruments, missingLabels,
  voices: liveVoices, LEMON, save, render, setChords, bufs, get ver(){ return ver; }, get ctx(){ return ctx; }, get bus(){ return bus; }, get play(){ return play; }, get sustain(){ return sustain; }, get active(){ return active.size; }, get lic(){ return lic; }, get aud(){ return aud; } };
render(); licUI(); paintMixer(); paintTransport(); listDevices(); preload();
if (navigator.requestMIDIAccess) navigator.requestMIDIAccess().then(a => { midiAccess = a; a.onstatechange = refreshMidi; refreshMidi(); }).catch(() => { ui.midiNote.textContent = "Web MIDI unavailable or blocked in this browser. The pads and computer keys still play."; });
else ui.midiNote.textContent = "Web MIDI isn't supported in this browser (try Chrome or Edge). The pads and computer keys still play.";
