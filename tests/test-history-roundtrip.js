#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// WorkIt History Round-Trip Test
// Tests the ACTUAL cell-based serialization that happens via Sheets
// Reproduces: "synced but data corruption" bug
// ═══════════════════════════════════════════════════════════════════

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { console.log("  ✅ " + msg); passed++; } else { console.log("  ❌ FAIL: " + msg); failed++; } }

// ─── Copied from index.html: effortToRir ───────────────────────
const effortToRir = (v) => v >= 9 ? 0 : v >= 7 ? 1 : v >= 4 ? 2 : 3;

// ─── Copied from index.html: _flattenHistory ───────────────────
function flattenHistory(history) {
  const rows = [["Date","Workout","Exercise","Set #","Reps","Weight","RIR","Warmup"]];
  history.forEach(function(entry) {
    (entry.exercises||[]).forEach(function(ex) {
      (ex.sets||[]).forEach(function(set, si) {
        var rir = set.rir !== undefined ? set.rir : (set.effort !== undefined ? effortToRir(set.effort) : 2);
        var warmup = set.warmup || rir === 3;
        rows.push([entry.date, entry.workoutName||"Unknown", ex.name, si+1, set.reps, set.weight, rir, warmup?"Y":"N"]);
      });
    });
  });
  return rows;
}

// ─── Copied from index.html (CURRENT BUGGY): _parseHistory ─────
function parseHistoryBuggy(rows) {
  const groups = {};
  rows.forEach(function(r) {
    if (!r[0] || r[0]==="Date") return;
    var key = r[0] + "|" + (r[1]||"");
    if (!groups[key]) groups[key] = { date: r[0], workoutId: null, workoutName: r[1]||"Unknown", wasOverride: false, exercises: {} };
    var exName = r[2]||"";
    if (!groups[key].exercises[exName]) groups[key].exercises[exName] = { exerciseId: exName, name: exName, sets: [] };
    // BUG 1: r.length >= 8 is never true when reading A2:G (7 cols)
    // BUG 2: parseInt(r[6])||2 turns RIR 0 into 2 (0 is falsy)
    var rir = r.length >= 8 ? (parseInt(r[6])||2) : (r[6] !== undefined ? effortToRir(parseInt(r[6])||5) : 2);
    var warmup = r.length >= 8 ? r[7]==="Y" : false;
    groups[key].exercises[exName].sets.push({ reps: parseInt(r[4])||0, weight: parseFloat(r[5])||0, rir: rir, warmup: warmup });
  });
  return Object.values(groups).map(function(g) {
    return { date: g.date, workoutId: g.workoutId, workoutName: g.workoutName, wasOverride: g.wasOverride, exercises: Object.values(g.exercises) };
  });
}

// ─── FIXED version of _parseHistory ─────────────────────────────
function parseHistoryFixed(rows) {
  const groups = {};
  rows.forEach(function(r) {
    if (!r[0] || r[0]==="Date") return;
    var key = r[0] + "|" + (r[1]||"");
    if (!groups[key]) groups[key] = { date: r[0], workoutId: null, workoutName: r[1]||"Unknown", wasOverride: false, exercises: {} };
    var exName = r[2]||"";
    if (!groups[key].exercises[exName]) groups[key].exercises[exName] = { exerciseId: exName, name: exName, sets: [] };
    // FIX 1: read range now includes column H (8 cols), so r.length >= 8 works
    // FIX 2: use (r[6] != null && r[6] !== "" ? parseInt(r[6]) : 2) to preserve RIR 0
    var rir = r.length >= 8 ? (r[6] != null && r[6] !== "" ? parseInt(r[6]) : 2) : (r[6] !== undefined ? effortToRir(parseInt(r[6])||5) : 2);
    var warmup = r.length >= 8 ? r[7]==="Y" : false;
    groups[key].exercises[exName].sets.push({ reps: parseInt(r[4])||0, weight: parseFloat(r[5])||0, rir: rir, warmup: warmup });
  });
  return Object.values(groups).map(function(g) {
    return { date: g.date, workoutId: g.workoutId, workoutName: g.workoutName, wasOverride: g.wasOverride, exercises: Object.values(g.exercises) };
  });
}

// ─── Simulate the ACTUAL Sheets read/write ─────────────────────
// saveAll writes to "history!A1:H50000" (8 columns: A through H)
// loadAll reads from "history!A2:G50000" (7 columns: A through G) <-- BUG

function simulateSheetsRoundTrip(history) {
  // WRITE: flatten produces 8-column rows (including header)
  const allRows = flattenHistory(history);
  const dataRows = allRows.slice(1); // skip header (A2 onwards)

  // READ (BUGGY): _getValues("history!A2:G50000") only returns 7 columns
  const readRows_buggy = dataRows.map(r => r.slice(0, 7)); // columns A-G only

  // READ (FIXED): _getValues("history!A2:H50000") returns all 8 columns
  const readRows_fixed = dataRows.map(r => r.slice(0, 8)); // columns A-H

  return {
    buggy: parseHistoryBuggy(readRows_buggy),    // current code: wrong range + wrong parser
    fixed: parseHistoryFixed(readRows_fixed),      // fixed code: correct range + fixed parser
  };
}


// ═══════════════════════════════════════════════════════════════════
// TEST 1: RIR values get corrupted through the buggy read range
// ═══════════════════════════════════════════════════════════════════
console.log("\n═══ History round-trip: RIR corruption via G-only read ═══");

const historyWithRIR = [{
  date: "2026-03-05",
  workoutId: "w1",
  workoutName: "Push",
  wasOverride: false,
  exercises: [{
    exerciseId: "e1", name: "Bench Press",
    sets: [
      { reps: 8, weight: 135, rir: 0, warmup: false },  // Failure (RIR 0)
      { reps: 10, weight: 115, rir: 1, warmup: false },  // Moderate (RIR 1)
      { reps: 12, weight: 95, rir: 2, warmup: false },   // Light (RIR 2)
      { reps: 10, weight: 45, rir: 3, warmup: true },    // Warmup (RIR 3)
    ]
  }]
}];

const result1 = simulateSheetsRoundTrip(historyWithRIR);
const bugSets = result1.buggy[0].exercises[0].sets;
const fixSets = result1.fixed[0].exercises[0].sets;

// FIXED path should preserve exact RIR values (including RIR 0!)
assert(fixSets[0].rir === 0, "FIXED: RIR 0 (Failure) preserved → got " + fixSets[0].rir);
assert(fixSets[1].rir === 1, "FIXED: RIR 1 (Moderate) preserved → got " + fixSets[1].rir);
assert(fixSets[2].rir === 2, "FIXED: RIR 2 (Light) preserved → got " + fixSets[2].rir);
assert(fixSets[3].rir === 3, "FIXED: RIR 3 (Warmup) preserved → got " + fixSets[3].rir);

// BUGGY path corrupts RIR values through two bugs:
// Bug A: Reading only 7 cols → effortToRir conversion applied to RIR values
//   RIR 0 → parseInt("0")||5 = 5 → effortToRir(5) = 2 (WRONG)
//   RIR 1 → parseInt("1")||5 = 1 → effortToRir(1) = 3 (WRONG)
// Bug B: Even with 8 cols, parseInt(r[6])||2 turns RIR 0 into 2 (0 is falsy)
assert(bugSets[0].rir !== 0, "BUGGY: RIR 0 gets corrupted → got " + bugSets[0].rir + " (should be 0)");
assert(bugSets[1].rir !== 1, "BUGGY: RIR 1 gets corrupted → got " + bugSets[1].rir + " (should be 1)");


// ═══════════════════════════════════════════════════════════════════
// TEST 2: Warmup flag always false in buggy path
// ═══════════════════════════════════════════════════════════════════
console.log("\n═══ History round-trip: Warmup flag lost via G-only read ═══");

assert(fixSets[3].warmup === true, "FIXED: Warmup flag preserved for warmup set");
assert(fixSets[0].warmup === false, "FIXED: Non-warmup flag preserved");
assert(bugSets[3].warmup === false, "BUGGY: Warmup flag lost (always false) → got " + bugSets[3].warmup);


// ═══════════════════════════════════════════════════════════════════
// TEST 3: Multiple exercises in one session
// ═══════════════════════════════════════════════════════════════════
console.log("\n═══ History round-trip: Multi-exercise session ═══");

const historyMultiExercise = [{
  date: "2026-03-04",
  workoutId: "w2",
  workoutName: "Pull",
  wasOverride: false,
  exercises: [
    { exerciseId: "e1", name: "Rows", sets: [
      { reps: 10, weight: 135, rir: 1, warmup: false },
      { reps: 8, weight: 155, rir: 0, warmup: false },
    ]},
    { exerciseId: "e2", name: "Pulldowns", sets: [
      { reps: 12, weight: 100, rir: 2, warmup: false },
      { reps: 8, weight: 45, rir: 3, warmup: true },
    ]},
  ]
}];

const result3 = simulateSheetsRoundTrip(historyMultiExercise);
assert(result3.fixed[0].exercises.length === 2, "FIXED: Both exercises preserved");
assert(result3.buggy[0].exercises.length === 2, "BUGGY: Both exercises still present (structure OK)");

// FIXED path preserves all RIR/warmup
assert(result3.fixed[0].exercises[0].sets[1].rir === 0, "FIXED: Rows set2 RIR=0 preserved → got " + result3.fixed[0].exercises[0].sets[1].rir);
assert(result3.fixed[0].exercises[1].sets[1].rir === 3, "FIXED: Pulldowns warmup RIR=3 preserved → got " + result3.fixed[0].exercises[1].sets[1].rir);
assert(result3.fixed[0].exercises[1].sets[1].warmup === true, "FIXED: Pulldowns warmup flag preserved");

// BUGGY path corrupts everything
assert(result3.buggy[0].exercises[0].sets[1].rir !== 0, "BUGGY: Rows set2 RIR=0 corrupted → got " + result3.buggy[0].exercises[0].sets[1].rir);
assert(result3.buggy[0].exercises[1].sets[1].warmup === false, "BUGGY: Pulldowns warmup flag lost");


// ═══════════════════════════════════════════════════════════════════
// TEST 4: Config round-trip (workouts, schedule, etc.)
// ═══════════════════════════════════════════════════════════════════
console.log("\n═══ Config round-trip: Verify workout/schedule parsing ═══");

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// Simulate what saveAll writes to config tab
function simulateConfigSave(state) {
  const rows = [
    ["scheduleType", JSON.stringify(state.scheduleType)],
    ["weeklySchedule", JSON.stringify(state.weeklySchedule)],
    ["cadenceSchedule", JSON.stringify(state.cadenceSchedule)],
    ["workouts", JSON.stringify(state.workouts)],
    ["weightUnit", JSON.stringify(state.weightUnit || "lbs")],
  ];
  return rows;
}

// Simulate what loadAll reads from config tab
function simulateConfigLoad(rows) {
  const config = {};
  rows.forEach(function(r) {
    try { config[r[0]] = JSON.parse(r[1]); }
    catch(e) { config[r[0]] = r[1]; }
  });
  let workouts = config.workouts || {};
  return {
    scheduleType: config.scheduleType || "weekly",
    weeklySchedule: config.weeklySchedule || DAYS.map(d => ({ day: d, workoutId: null })),
    cadenceSchedule: config.cadenceSchedule || { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    workouts: workouts,
    weightUnit: config.weightUnit || "lbs",
  };
}

const testState = {
  scheduleType: "weekly",
  weeklySchedule: DAYS.map(d => ({
    day: d,
    workoutId: d === "Tue" ? "w1" : d === "Thu" ? "w2" : d === "Sat" ? "w3" : null
  })),
  cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
  workouts: {
    w1: { id: "w1", name: "Push", exercises: [{ id: "e1", name: "Bench Press", sets: 3, defaultReps: 10, alternatives: [] }] },
    w2: { id: "w2", name: "Pull", exercises: [{ id: "e2", name: "Rows", sets: 3, defaultReps: 10, alternatives: [] }] },
    w3: { id: "w3", name: "Legs", exercises: [{ id: "e3", name: "Squat", sets: 3, defaultReps: 10, alternatives: [] }] },
  },
  weightUnit: "lbs",
};

const configRows = simulateConfigSave(testState);
const loadedConfig = simulateConfigLoad(configRows);

assert(Object.keys(loadedConfig.workouts).length === 3, "Config round-trip: 3 workouts preserved");
assert(loadedConfig.weeklySchedule.find(d => d.day === "Thu").workoutId === "w2", "Config round-trip: Thu=Pull schedule preserved");
assert(loadedConfig.weeklySchedule.find(d => d.day === "Tue").workoutId === "w1", "Config round-trip: Tue=Push schedule preserved");
assert(loadedConfig.scheduleType === "weekly", "Config round-trip: scheduleType preserved");


// ═══════════════════════════════════════════════════════════════════
// TEST 5: Full sync scenario matching user's bug report
// "Fresh login → synced → but dashboard shows no data"
// ═══════════════════════════════════════════════════════════════════
console.log("\n═══ Full sync scenario: Fresh login with remote data ═══");

// Simulate the entire flow:
// 1. Remote has workouts + schedule + history
// 2. User does fresh login
// 3. connectSheets loads from remote
// 4. Verify state has all data including history with correct RIR/warmup

const remoteState = {
  ...testState,
  history: historyWithRIR,
  weightLog: [{ date: "2026-03-05", weight: 180, bodyFat: 15 }],
};

// Step 1: saveAll (simulated)
const savedConfigRows = simulateConfigSave(remoteState);
const savedHistoryRows = flattenHistory(remoteState.history);

// Step 2: loadAll (simulated with the BUG)
const loadedConf = simulateConfigLoad(savedConfigRows);
const histDataRows = savedHistoryRows.slice(1); // skip header
const buggyHistRows = histDataRows.map(r => r.slice(0, 7)); // A-G only
const loadedHistoryBuggy = parseHistoryBuggy(buggyHistRows);

// Step 3: LOAD_FROM_SHEETS dispatch
const finalStateBuggy = {
  ...loadedConf,
  history: loadedHistoryBuggy,
};

assert(Object.keys(finalStateBuggy.workouts).length === 3, "Sync: workouts loaded → " + Object.keys(finalStateBuggy.workouts).length);
assert(finalStateBuggy.history.length === 1, "Sync: history loaded → " + finalStateBuggy.history.length);

// This is the critical check: RIR values after full round-trip with BUGGY code
const syncedSets = finalStateBuggy.history[0].exercises[0].sets;
assert(syncedSets[0].rir !== 0, "Sync BUGGY: Set 1 RIR 0 (Failure) is corrupted → got " + syncedSets[0].rir);
assert(syncedSets[3].warmup === false, "Sync BUGGY: Set 4 warmup flag is lost → got " + syncedSets[3].warmup);

// Same with FIXED path
const fixedHistRows = histDataRows.map(r => r.slice(0, 8));
const loadedHistoryFixed = parseHistoryFixed(fixedHistRows);
const finalStateFixed = { ...loadedConf, history: loadedHistoryFixed };
const fixedSyncSets = finalStateFixed.history[0].exercises[0].sets;
assert(fixedSyncSets[0].rir === 0, "Sync FIXED: Set 1 RIR should be 0 (Failure) → got " + fixedSyncSets[0].rir);
assert(fixedSyncSets[3].warmup === true, "Sync FIXED: Set 4 should be warmup → got " + fixedSyncSets[3].warmup);


// ═══════════════════════════════════════════════════════════════════
// TEST 6: Verify stats computation with corrupted vs correct data
// ═══════════════════════════════════════════════════════════════════
console.log("\n═══ Stats impact: Corrupted RIR affects workout stats ═══");

function computeAvgRir(sets) {
  const working = sets.filter(s => !s.warmup);
  if (working.length === 0) return null;
  const sum = working.reduce((acc, s) => acc + s.rir, 0);
  return sum / working.length;
}

const avgRirBuggy = computeAvgRir(bugSets);
const avgRirFixed = computeAvgRir(fixSets);

// With fixed data: working sets have RIR 0, 1, 2 → avg = 1.0
assert(avgRirFixed === 1.0, "FIXED: Avg RIR of working sets = 1.0 → got " + avgRirFixed);
// With buggy data: all sets are "not warmup" (warmup always false), and RIR values are corrupted
assert(avgRirBuggy !== 1.0, "BUGGY: Avg RIR is wrong → got " + avgRirBuggy + " (should be 1.0)");

// In the buggy version, warmup set (RIR 3) is included as a working set
const buggyWorkingSets = bugSets.filter(s => !s.warmup);
const fixedWorkingSets = fixSets.filter(s => !s.warmup);
assert(fixedWorkingSets.length === 3, "FIXED: 3 working sets (warmup excluded)");
assert(buggyWorkingSets.length === 4, "BUGGY: 4 'working' sets (warmup included as working) → " + buggyWorkingSets.length);


// ═══════════════════════════════════════════════════════════════════
console.log("\n═══ RESULTS: " + passed + " passed, " + failed + " failed ═══");
process.exit(failed > 0 ? 1 : 0);
