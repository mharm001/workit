#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// WorkIt Reducer & State Tests
// Tests core state management: workouts, tracking, history, schedule
// ═══════════════════════════════════════════════════════════════════

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
let uidCounter = 0;
const uid = () => "w" + (++uidCounter);
const toDateStr = (d) => d.toISOString().slice(0,10);
const effortToRir = (e) => e <= 2 ? 0 : e <= 4 ? 1 : e <= 7 ? 2 : 3;

const makeInitialState = () => ({
  scheduleType: "weekly",
  weeklySchedule: DAYS.map(d => ({ day: d, workoutId: null })),
  cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
  workouts: {}, history: [], weightLog: [],
  weightUnit: "lbs",
  activeView: "dashboard", trackingSession: null,
});

function reducer(state, action) {
  switch (action.type) {
    case "SET_VIEW": return { ...state, activeView: action.view };
    case "SET_SCHEDULE_TYPE": return { ...state, scheduleType: action.scheduleType };
    case "SET_WEEKLY_SCHEDULE": return { ...state, weeklySchedule: action.schedule };
    case "SET_CADENCE_SCHEDULE": return { ...state, cadenceSchedule: { ...state.cadenceSchedule, ...action.data } };
    case "UPSERT_WORKOUT": { const id = action.workout.id || uid(); return { ...state, workouts: { ...state.workouts, [id]: { ...action.workout, id } } }; }
    case "DELETE_WORKOUT": {
      const w = { ...state.workouts }; delete w[action.id];
      return { ...state, workouts: w,
        weeklySchedule: state.weeklySchedule.map(d => d.workoutId === action.id ? { ...d, workoutId: null } : d),
        cadenceSchedule: { ...state.cadenceSchedule, rotation: state.cadenceSchedule.rotation.filter(r => r.workoutId !== action.id) },
      };
    }
    case "START_TRACKING": return { ...state, trackingSession: action.session, activeView: "tracking" };
    case "EDIT_WORKOUT": return { ...state, trackingSession: { ...action.session, editingDate: action.editingDate }, activeView: "tracking" };
    case "UPDATE_TRACKING": return { ...state, trackingSession: { ...state.trackingSession, ...action.data } };
    case "SAVE_WORKOUT": {
      const s = state.trackingSession;
      const entry = { date: s.editingDate || toDateStr(new Date()), workoutId: s.workoutId, workoutName: (state.workouts[s.workoutId]||{}).name||"Unknown", wasOverride: s.wasOverride||false, exercises: s.exercises };
      let hist = state.history;
      if (s.editingDate) {
        hist = state.history.map(h => h.date === s.editingDate && h.workoutId === s.workoutId ? entry : h);
      } else {
        hist = [...state.history, entry];
      }
      let cad = state.cadenceSchedule;
      if (!s.editingDate && state.scheduleType === "cadence" && cad.rotation.length > 0) cad = { ...cad, currentIndex: (cad.currentIndex + 1) % cad.rotation.length };
      return { ...state, history: hist, cadenceSchedule: cad, trackingSession: null, activeView: "dashboard" };
    }
    case "CANCEL_TRACKING": return { ...state, trackingSession: null, activeView: "dashboard" };
    case "DELETE_HISTORY_ENTRY": return { ...state, history: state.history.filter(h => !(h.date === action.date && h.workoutId === action.workoutId)), trackingSession: null, activeView: "dashboard" };
    case "LOG_WEIGHT": {
      const existing = state.weightLog.find(w => w.date === action.date);
      const entry = { date: action.date, weight: action.weight != null ? action.weight : (existing ? existing.weight : null), bodyFat: action.bodyFat != null ? action.bodyFat : (existing ? existing.bodyFat : null) };
      return { ...state, weightLog: [...state.weightLog.filter(w => w.date !== entry.date), entry].filter(w => w.weight != null).sort((a,b)=>a.date.localeCompare(b.date)) };
    }
    case "SET_WEIGHT_UNIT": return { ...state, weightUnit: action.unit };
    case "LOAD_FROM_SHEETS": return { ...state, ...action.data };
    case "IMPORT_STATE": return { ...action.state, activeView: "dashboard", trackingSession: null };
    default: return state;
  }
}

// ─── Test helpers ──────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FAIL: ${msg}`); }
}

function dispatch(state, action) { return reducer(state, action); }

// ═══════════════════════════════════════════════════════════════════
// TEST: Workout CRUD
// ═══════════════════════════════════════════════════════════════════
function testWorkoutCRUD() {
  console.log("\n═══ Workout CRUD ═══");
  let s = makeInitialState();

  // Create
  s = dispatch(s, { type: "UPSERT_WORKOUT", workout: { name: "Push", exercises: [{ id: "e1", name: "Bench Press", sets: 4, defaultReps: 8 }] } });
  const pushId = Object.keys(s.workouts)[0];
  assert(Object.keys(s.workouts).length === 1, "Created 1 workout");
  assert(s.workouts[pushId].name === "Push", "Workout name is Push");

  // Update
  s = dispatch(s, { type: "UPSERT_WORKOUT", workout: { id: pushId, name: "Push Day", exercises: [] } });
  assert(Object.keys(s.workouts).length === 1, "Still 1 workout after update");
  assert(s.workouts[pushId].name === "Push Day", "Name updated to Push Day");

  // Create another
  s = dispatch(s, { type: "UPSERT_WORKOUT", workout: { name: "Pull", exercises: [] } });
  assert(Object.keys(s.workouts).length === 2, "Created 2nd workout");

  // Delete
  s = dispatch(s, { type: "DELETE_WORKOUT", id: pushId });
  assert(Object.keys(s.workouts).length === 1, "Deleted workout, 1 remaining");
  assert(!s.workouts[pushId], "Push is gone");
}

// ═══════════════════════════════════════════════════════════════════
// TEST: Schedule Management
// ═══════════════════════════════════════════════════════════════════
function testSchedule() {
  console.log("\n═══ Schedule Management ═══");
  let s = makeInitialState();

  s = dispatch(s, { type: "UPSERT_WORKOUT", workout: { name: "Push", exercises: [] } });
  s = dispatch(s, { type: "UPSERT_WORKOUT", workout: { name: "Pull", exercises: [] } });
  const [pushId, pullId] = Object.keys(s.workouts);

  // Set weekly schedule
  const sched = s.weeklySchedule.map(d => {
    if (d.day === "Tue" || d.day === "Thu") return { ...d, workoutId: pushId };
    if (d.day === "Wed" || d.day === "Fri") return { ...d, workoutId: pullId };
    return d;
  });
  s = dispatch(s, { type: "SET_WEEKLY_SCHEDULE", schedule: sched });
  assert(s.weeklySchedule.filter(d => d.workoutId).length === 4, "4 days scheduled");
  assert(s.weeklySchedule.find(d => d.day === "Tue").workoutId === pushId, "Tue is Push");

  // Delete workout clears schedule references
  s = dispatch(s, { type: "DELETE_WORKOUT", id: pushId });
  assert(s.weeklySchedule.filter(d => d.workoutId).length === 2, "Only 2 days remain after deleting Push");
  assert(s.weeklySchedule.find(d => d.day === "Tue").workoutId === null, "Tue cleared to null");

  // Cadence schedule
  s = dispatch(s, { type: "SET_SCHEDULE_TYPE", scheduleType: "cadence" });
  assert(s.scheduleType === "cadence", "Schedule type changed to cadence");
}

// ═══════════════════════════════════════════════════════════════════
// TEST: Tracking Session (Save new, Edit, Delete)
// ═══════════════════════════════════════════════════════════════════
function testTrackingSession() {
  console.log("\n═══ Tracking Session ═══");
  let s = makeInitialState();
  s = dispatch(s, { type: "UPSERT_WORKOUT", workout: { name: "Push", exercises: [{ id: "e1", name: "Bench", sets: 3, defaultReps: 8 }] } });
  const pushId = Object.keys(s.workouts)[0];

  // Start tracking
  const session = { workoutId: pushId, exercises: [{ name: "Bench", sets: [{ reps: 8, weight: 135, rir: 2, warmup: false }] }] };
  s = dispatch(s, { type: "START_TRACKING", session });
  assert(s.activeView === "tracking", "Switched to tracking view");
  assert(s.trackingSession !== null, "Tracking session started");

  // Save workout
  s = dispatch(s, { type: "SAVE_WORKOUT" });
  assert(s.history.length === 1, "History has 1 entry");
  assert(s.trackingSession === null, "Tracking session cleared");
  assert(s.activeView === "dashboard", "Back to dashboard");
  assert(s.history[0].exercises[0].sets[0].weight === 135, "Weight recorded as 135");

  // Edit workout
  const entry = s.history[0];
  s = dispatch(s, { type: "EDIT_WORKOUT", editingDate: entry.date, session: { workoutId: entry.workoutId, exercises: [{ name: "Bench", sets: [{ reps: 10, weight: 155, rir: 1, warmup: false }] }] } });
  assert(s.trackingSession.editingDate === entry.date, "Edit mode has editingDate");

  // Save edit (should replace, not append)
  s = dispatch(s, { type: "SAVE_WORKOUT" });
  assert(s.history.length === 1, "Still 1 entry after edit (replaced, not appended)");
  assert(s.history[0].exercises[0].sets[0].weight === 155, "Weight updated to 155");
  assert(s.history[0].exercises[0].sets[0].reps === 10, "Reps updated to 10");

  // Delete from history
  s = dispatch(s, { type: "DELETE_HISTORY_ENTRY", date: entry.date, workoutId: entry.workoutId });
  assert(s.history.length === 0, "History empty after delete");
  assert(s.activeView === "dashboard", "Back to dashboard after delete");
}

// ═══════════════════════════════════════════════════════════════════
// TEST: Cancel Tracking
// ═══════════════════════════════════════════════════════════════════
function testCancelTracking() {
  console.log("\n═══ Cancel Tracking ═══");
  let s = makeInitialState();
  s = dispatch(s, { type: "UPSERT_WORKOUT", workout: { name: "Push", exercises: [] } });
  const pushId = Object.keys(s.workouts)[0];

  s = dispatch(s, { type: "START_TRACKING", session: { workoutId: pushId, exercises: [] } });
  assert(s.activeView === "tracking", "In tracking view");

  s = dispatch(s, { type: "CANCEL_TRACKING" });
  assert(s.trackingSession === null, "Session cancelled");
  assert(s.activeView === "dashboard", "Back to dashboard");
  assert(s.history.length === 0, "No history entry created");
}

// ═══════════════════════════════════════════════════════════════════
// TEST: Weight & Body Fat Logging
// ═══════════════════════════════════════════════════════════════════
function testWeightLogging() {
  console.log("\n═══ Weight & Body Fat Logging ═══");
  let s = makeInitialState();

  // Log weight
  s = dispatch(s, { type: "LOG_WEIGHT", date: "2026-03-05", weight: 176.5, bodyFat: null });
  assert(s.weightLog.length === 1, "1 weight entry");
  assert(s.weightLog[0].weight === 176.5, "Weight is 176.5");
  assert(s.weightLog[0].bodyFat === null, "No body fat");

  // Log body fat for same day (merges)
  s = dispatch(s, { type: "LOG_WEIGHT", date: "2026-03-05", weight: null, bodyFat: 18.2 });
  assert(s.weightLog.length === 1, "Still 1 entry (merged by date)");
  assert(s.weightLog[0].weight === 176.5, "Weight preserved");
  assert(s.weightLog[0].bodyFat === 18.2, "Body fat added");

  // Update weight same day
  s = dispatch(s, { type: "LOG_WEIGHT", date: "2026-03-05", weight: 177.0, bodyFat: null });
  assert(s.weightLog[0].weight === 177.0, "Weight updated to 177");
  assert(s.weightLog[0].bodyFat === 18.2, "Body fat preserved");

  // Add different day
  s = dispatch(s, { type: "LOG_WEIGHT", date: "2026-03-06", weight: 176.0, bodyFat: 18.0 });
  assert(s.weightLog.length === 2, "2 weight entries");
  assert(s.weightLog[0].date === "2026-03-05", "Sorted: first is 03-05");
  assert(s.weightLog[1].date === "2026-03-06", "Sorted: second is 03-06");

  // Weight unit toggle
  s = dispatch(s, { type: "SET_WEIGHT_UNIT", unit: "kg" });
  assert(s.weightUnit === "kg", "Unit changed to kg");
}

// ═══════════════════════════════════════════════════════════════════
// TEST: Import / Load from Sheets
// ═══════════════════════════════════════════════════════════════════
function testImportAndLoad() {
  console.log("\n═══ Import / Load from Sheets ═══");
  let s = makeInitialState();

  // LOAD_FROM_SHEETS merges (keeps activeView, trackingSession)
  s = dispatch(s, { type: "SET_VIEW", view: "analytics" });
  s = dispatch(s, { type: "LOAD_FROM_SHEETS", data: {
    workouts: { w1: { id: "w1", name: "Push", exercises: [] } },
    history: [{ date: "2026-03-05", workoutId: "w1", workoutName: "Push", exercises: [] }],
  }});
  assert(s.activeView === "analytics", "LOAD_FROM_SHEETS preserves activeView");
  assert(Object.keys(s.workouts).length === 1, "Workouts loaded");
  assert(s.history.length === 1, "History loaded");

  // IMPORT_STATE resets everything
  s = dispatch(s, { type: "IMPORT_STATE", state: {
    workouts: { w2: { id: "w2", name: "Legs", exercises: [] } },
    history: [], weightLog: [],
    scheduleType: "weekly",
    weeklySchedule: DAYS.map(d => ({ day: d, workoutId: null })),
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    weightUnit: "lbs",
  }});
  assert(s.activeView === "dashboard", "IMPORT_STATE resets to dashboard");
  assert(s.trackingSession === null, "IMPORT_STATE clears tracking");
  assert(Object.keys(s.workouts).length === 1, "New workouts imported");
  assert(s.workouts.w2.name === "Legs", "Imported workout is Legs");
}

// ═══════════════════════════════════════════════════════════════════
// TEST: Cadence Schedule Rotation
// ═══════════════════════════════════════════════════════════════════
function testCadenceRotation() {
  console.log("\n═══ Cadence Schedule Rotation ═══");
  let s = makeInitialState();
  s = dispatch(s, { type: "UPSERT_WORKOUT", workout: { name: "Push", exercises: [] } });
  s = dispatch(s, { type: "UPSERT_WORKOUT", workout: { name: "Pull", exercises: [] } });
  s = dispatch(s, { type: "UPSERT_WORKOUT", workout: { name: "Legs", exercises: [] } });
  const [pushId, pullId, legsId] = Object.keys(s.workouts);

  s = dispatch(s, { type: "SET_SCHEDULE_TYPE", scheduleType: "cadence" });
  s = dispatch(s, { type: "SET_CADENCE_SCHEDULE", data: {
    rotation: [{ workoutId: pushId }, { workoutId: pullId }, { workoutId: legsId }],
    currentIndex: 0,
  }});
  assert(s.cadenceSchedule.currentIndex === 0, "Starts at index 0 (Push)");

  // Track and save — should advance cadence
  s = dispatch(s, { type: "START_TRACKING", session: { workoutId: pushId, exercises: [] } });
  s = dispatch(s, { type: "SAVE_WORKOUT" });
  assert(s.cadenceSchedule.currentIndex === 1, "Advanced to index 1 (Pull)");

  s = dispatch(s, { type: "START_TRACKING", session: { workoutId: pullId, exercises: [] } });
  s = dispatch(s, { type: "SAVE_WORKOUT" });
  assert(s.cadenceSchedule.currentIndex === 2, "Advanced to index 2 (Legs)");

  s = dispatch(s, { type: "START_TRACKING", session: { workoutId: legsId, exercises: [] } });
  s = dispatch(s, { type: "SAVE_WORKOUT" });
  assert(s.cadenceSchedule.currentIndex === 0, "Wraps back to index 0 (Push)");
}

// ═══════════════════════════════════════════════════════════════════
// TEST: Multiple history entries, same day different workouts
// ═══════════════════════════════════════════════════════════════════
function testMultipleHistoryEntries() {
  console.log("\n═══ Multiple History Entries ═══");
  let s = makeInitialState();
  s = dispatch(s, { type: "UPSERT_WORKOUT", workout: { name: "Push", exercises: [] } });
  s = dispatch(s, { type: "UPSERT_WORKOUT", workout: { name: "Pull", exercises: [] } });
  const [pushId, pullId] = Object.keys(s.workouts);

  // Save Push
  s = dispatch(s, { type: "START_TRACKING", session: { workoutId: pushId, exercises: [{ name: "Bench", sets: [{ reps: 8, weight: 135, rir: 2, warmup: false }] }] } });
  s = dispatch(s, { type: "SAVE_WORKOUT" });

  // Save Pull same day
  s = dispatch(s, { type: "START_TRACKING", session: { workoutId: pullId, exercises: [{ name: "Row", sets: [{ reps: 10, weight: 100, rir: 2, warmup: false }] }] } });
  s = dispatch(s, { type: "SAVE_WORKOUT" });
  assert(s.history.length === 2, "2 history entries (different workouts same day)");

  // Delete only Push entry
  const pushEntry = s.history.find(h => h.workoutId === pushId);
  s = dispatch(s, { type: "DELETE_HISTORY_ENTRY", date: pushEntry.date, workoutId: pushId });
  assert(s.history.length === 1, "1 entry after deleting Push");
  assert(s.history[0].workoutId === pullId, "Pull entry remains");
}

// ═══════════════════════════════════════════════════════════════════
// RUN ALL
// ═══════════════════════════════════════════════════════════════════
testWorkoutCRUD();
testSchedule();
testTrackingSession();
testCancelTracking();
testWeightLogging();
testImportAndLoad();
testCadenceRotation();
testMultipleHistoryEntries();

console.log(`\n═══ RESULTS: ${passed} passed, ${failed} failed ═══`);
if (failed > 0) process.exit(1);
