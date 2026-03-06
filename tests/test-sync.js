#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// WorkIt Sync Test Harness
// Simulates login/logout/offline/reconnect flows without a browser
// ═══════════════════════════════════════════════════════════════════

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
let uidCounter = 0;
const uid = () => "w" + (++uidCounter);
const toDateStr = (d) => d.toISOString().slice(0,10);

// ─── Reducer (extracted from index.html) ───────────────────────
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
      return { ...state, history: hist, trackingSession: null, activeView: "dashboard" };
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

// ─── Mock Sheets API (in-memory) ───────────────────────────────
class MockSheetsService {
  constructor() { this.remoteData = null; }

  async saveAll(state) {
    // Simulate what saveAll does: serialize state to sheets format, then loadAll reconstructs it
    this.remoteData = {
      scheduleType: state.scheduleType,
      weeklySchedule: state.weeklySchedule,
      cadenceSchedule: state.cadenceSchedule,
      workouts: state.workouts,
      history: state.history,
      weightLog: state.weightLog,
      weightUnit: state.weightUnit,
    };
  }

  async loadAll() {
    if (!this.remoteData) {
      return {
        scheduleType: "weekly",
        weeklySchedule: DAYS.map(d => ({ day: d, workoutId: null })),
        cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
        workouts: {}, history: [], weightLog: [], weightUnit: "lbs",
      };
    }
    // Simulate the JSON.parse round-trip that happens via config sheet
    return JSON.parse(JSON.stringify(this.remoteData));
  }
}

// ─── Mock localStorage ─────────────────────────────────────────
class MockLocalStorage {
  constructor() { this.store = {}; }
  getItem(k) { return this.store[k] || null; }
  setItem(k, v) { this.store[k] = v; }
  removeItem(k) { delete this.store[k]; }
}

// ─── App Simulator ─────────────────────────────────────────────
class AppSimulator {
  constructor() {
    this.sheets = new MockSheetsService();
    this.localStorage = new MockLocalStorage();
    this.state = makeInitialState();
    this.authState = "loading";
    this.syncStatus = "";
  }

  dispatch(action) {
    this.state = reducer(this.state, action);
  }

  saveLocal() {
    const { activeView, trackingSession, ...data } = this.state;
    this.localStorage.setItem("workit_state", JSON.stringify(data));
  }

  loadLocal() {
    try {
      const raw = this.localStorage.getItem("workit_state");
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  // Simulate the mount effect
  mount() {
    this.state = makeInitialState();
    this.authState = "loading";

    const hadSession = this.localStorage.getItem("workit_session") === "active";
    const cached = this.loadLocal();

    if (hadSession && cached) {
      const { trackingSession, ...data } = cached;
      this.dispatch({ type: "LOAD_FROM_SHEETS", data });
      this.authState = "offline";
    } else {
      this.authState = hadSession ? "offline" : "login";
    }

    // Effect #2: save to localStorage on state change (runs after authState changes)
    // FIXED: skip saving if on login screen with empty state
    if (this.authState !== "loading") {
      if (this.authState === "login" && Object.keys(this.state.workouts).length === 0 && this.state.history.length === 0) {
        // Skip — don't wipe good cached data with empty state
      } else {
        this.saveLocal();
      }
    }
  }

  // Simulate connectSheets (CURRENT v2.32.0 implementation)
  async connectSheets(fromOffline) {
    if (fromOffline) {
      await this.sheets.saveAll(this.state);
    }
    const remoteData = await this.sheets.loadAll();
    const wCount = Object.keys(remoteData.workouts || {}).length;
    const hCount = (remoteData.history || []).length;
    this.dispatch({ type: "LOAD_FROM_SHEETS", data: remoteData });
    this.authState = "ready";
    this.syncStatus = wCount > 0 || hCount > 0 ? "synced" : "empty";
    this.localStorage.setItem("workit_session", "active");
    // Effect #2 would fire here
    this.saveLocal();
  }

  // Simulate handleLogin
  async handleLogin() {
    this.authState = "loading";
    await this.connectSheets(false);
  }

  // Simulate handleSignOut
  handleSignOut() {
    this.localStorage.removeItem("workit_session");
    this.authState = "login";
    this.syncStatus = "";
    // Effect #2 fires: saves current state to localStorage (if not empty)
    if (Object.keys(this.state.workouts).length > 0 || this.state.history.length > 0) {
      this.saveLocal();
    }
  }

  // Simulate auto-reconnect (from offline after data change)
  async autoReconnect() {
    await this.connectSheets(true);
  }

  // Compute the data hash used by the auto-reconnect effect (v2.36.0+)
  // Must match the _quickHash logic in index.html
  static _quickHash(s) { var h=0; for(var i=0;i<Math.min(s.length,200);i++) h=(h*31+s.charCodeAt(i))|0; return h+":"+s.length; }
  _dataHash() {
    const qh = AppSimulator._quickHash;
    return qh(JSON.stringify(this.state.history)) + "|" + qh(JSON.stringify(this.state.weightLog)) + "|" + qh(JSON.stringify(this.state.workouts)) + "|" + qh(JSON.stringify(this.state.weeklySchedule)) + "|" + qh(JSON.stringify(this.state.cadenceSchedule)) + "|" + this.state.scheduleType;
  }

  // Check if auto-reconnect WOULD trigger (returns true if data changed while offline)
  shouldAutoReconnect(prevHash) {
    return this._dataHash() !== prevHash && this.authState === "offline";
  }

  // Simulate push to sheets only (Data tab → "Push to Sheet")
  async pushToSheets() {
    await this.sheets.saveAll(this.state);
    this.syncStatus = "synced";
  }

  // Simulate pull from sheets only (Data tab → "Pull from Sheet")
  async pullFromSheets() {
    const remoteData = await this.sheets.loadAll();
    this.dispatch({ type: "LOAD_FROM_SHEETS", data: remoteData });
    this.saveLocal();
  }

  // Print state summary
  summary(label) {
    const wk = Object.keys(this.state.workouts);
    const sched = this.state.weeklySchedule.filter(d => d.workoutId).map(d => `${d.day}:${d.workoutId}`);
    console.log(`\n── ${label} ──`);
    console.log(`  authState: ${this.authState}, syncStatus: ${this.syncStatus}`);
    console.log(`  workouts: [${wk.join(", ")}] (${wk.length})`);
    console.log(`  schedule: [${sched.join(", ")}] (${sched.length} assigned)`);
    console.log(`  history: ${this.state.history.length} entries`);
    console.log(`  weightLog: ${this.state.weightLog.length} entries`);
    console.log(`  localStorage workit_session: ${this.localStorage.getItem("workit_session")}`);
    console.log(`  localStorage has data: ${!!this.loadLocal()}`);
    const local = this.loadLocal();
    if (local) {
      console.log(`  localStorage schedule: [${(local.weeklySchedule||[]).filter(d=>d.workoutId).map(d=>`${d.day}:${d.workoutId}`).join(", ")}]`);
    }
    const remote = this.sheets.remoteData;
    if (remote) {
      console.log(`  REMOTE workouts: ${Object.keys(remote.workouts||{}).length}`);
      console.log(`  REMOTE schedule: [${(remote.weeklySchedule||[]).filter(d=>d.workoutId).map(d=>`${d.day}:${d.workoutId}`).join(", ")}]`);
    } else {
      console.log(`  REMOTE: empty`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEST CASES
// ═══════════════════════════════════════════════════════════════════

let passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FAIL: ${msg}`); }
}

async function test1_FreshLoginPullsSchedule() {
  console.log("\n\n═══ TEST 1: Fresh login pulls workouts + schedule from remote ═══");
  const app = new AppSimulator();

  // Pre-populate remote with workouts + schedule
  app.sheets.remoteData = {
    scheduleType: "weekly",
    weeklySchedule: [
      { day: "Mon", workoutId: null }, { day: "Tue", workoutId: "w1" },
      { day: "Wed", workoutId: "w2" }, { day: "Thu", workoutId: "w1" },
      { day: "Fri", workoutId: "w3" }, { day: "Sat", workoutId: "w2" },
      { day: "Sun", workoutId: null },
    ],
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    workouts: {
      w1: { id: "w1", name: "Push", exercises: [] },
      w2: { id: "w2", name: "Pull", exercises: [] },
      w3: { id: "w3", name: "Legs", exercises: [] },
    },
    history: [{ date: "2026-03-05", workoutId: "w1", workoutName: "Push", exercises: [] }],
    weightLog: [{ date: "2026-03-05", weight: 176.5, bodyFat: null }],
    weightUnit: "lbs",
  };

  // Simulate: open app for first time (no localStorage)
  app.mount();
  app.summary("After mount (no session)");
  assert(app.authState === "login", "Should be on login screen");
  assert(Object.keys(app.state.workouts).length === 0, "No workouts in state yet");

  // User signs in
  await app.handleLogin();
  app.summary("After login");
  assert(app.authState === "ready", "Should be ready");
  assert(Object.keys(app.state.workouts).length === 3, "Should have 3 workouts");
  assert(app.state.weeklySchedule.filter(d => d.workoutId).length === 5, "Should have 5 scheduled days");
  assert(app.state.history.length === 1, "Should have 1 history entry");
  assert(app.state.weeklySchedule[1].workoutId === "w1", "Tue should be Push (w1)");
  assert(app.syncStatus === "synced", "Sync status should be synced");
}

async function test2_SignOutSignInPreservesData() {
  console.log("\n\n═══ TEST 2: Sign out → sign in preserves all data ═══");
  const app = new AppSimulator();

  // Pre-populate remote
  app.sheets.remoteData = {
    scheduleType: "weekly",
    weeklySchedule: [
      { day: "Mon", workoutId: null }, { day: "Tue", workoutId: "w1" },
      { day: "Wed", workoutId: "w2" }, { day: "Thu", workoutId: "w1" },
      { day: "Fri", workoutId: "w3" }, { day: "Sat", workoutId: "w2" },
      { day: "Sun", workoutId: null },
    ],
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    workouts: {
      w1: { id: "w1", name: "Push", exercises: [] },
      w2: { id: "w2", name: "Pull", exercises: [] },
      w3: { id: "w3", name: "Legs", exercises: [] },
    },
    history: [{ date: "2026-03-05", workoutId: "w1", workoutName: "Push", exercises: [] }],
    weightLog: [], weightUnit: "lbs",
  };

  // Login
  app.mount();
  await app.handleLogin();
  app.summary("After initial login");
  assert(app.state.weeklySchedule.filter(d => d.workoutId).length === 5, "Schedule has 5 days");

  // Sign out
  app.handleSignOut();
  app.summary("After sign out");
  assert(app.authState === "login", "Should be on login screen");

  // KEY: Check if localStorage still has good data or was wiped
  const localAfterSignout = app.loadLocal();
  console.log("  localStorage schedule after signout:", localAfterSignout?.weeklySchedule?.filter(d=>d.workoutId).length, "assigned days");

  // Simulate page refresh after sign out
  app.mount();
  app.summary("After mount post-signout");

  // KEY CHECK: did mount + save effect wipe localStorage?
  const localAfterMount = app.loadLocal();
  console.log("  localStorage schedule after mount:", localAfterMount?.weeklySchedule?.filter(d=>d.workoutId).length, "assigned days");

  // Sign in again
  await app.handleLogin();
  app.summary("After re-login");
  assert(Object.keys(app.state.workouts).length === 3, "Should still have 3 workouts");
  assert(app.state.weeklySchedule.filter(d => d.workoutId).length === 5, "Should still have 4 scheduled days");
  assert(app.state.history.length === 1, "Should still have 1 history entry");
}

async function test3_OfflineDeleteThenReconnect() {
  console.log("\n\n═══ TEST 3: Offline delete → reconnect preserves delete ═══");
  const app = new AppSimulator();

  // Setup: logged in with data
  app.sheets.remoteData = {
    scheduleType: "weekly",
    weeklySchedule: DAYS.map(d => ({ day: d, workoutId: null })),
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    workouts: { w1: { id: "w1", name: "Push", exercises: [] } },
    history: [
      { date: "2026-03-04", workoutId: "w1", workoutName: "Push", exercises: [] },
      { date: "2026-03-05", workoutId: "w1", workoutName: "Push", exercises: [] },
    ],
    weightLog: [], weightUnit: "lbs",
  };

  app.mount();
  await app.handleLogin();
  assert(app.state.history.length === 2, "Start with 2 history entries");

  // Go offline (simulate token expiring)
  app.authState = "offline";
  app.syncStatus = "offline";

  // Delete one history entry
  app.dispatch({ type: "DELETE_HISTORY_ENTRY", date: "2026-03-04", workoutId: "w1" });
  app.saveLocal();
  assert(app.state.history.length === 1, "Local has 1 entry after delete");

  // Auto-reconnect
  await app.autoReconnect();
  app.summary("After reconnect post-delete");
  assert(app.state.history.length === 1, "Should still have 1 entry (delete preserved)");
  assert(app.sheets.remoteData.history.length === 1, "Remote should also have 1 entry");
}

async function test4_OfflineEditThenReconnect() {
  console.log("\n\n═══ TEST 4: Offline edit → reconnect preserves edit ═══");
  const app = new AppSimulator();

  app.sheets.remoteData = {
    scheduleType: "weekly",
    weeklySchedule: [
      { day: "Mon", workoutId: null }, { day: "Tue", workoutId: "w1" },
      { day: "Wed", workoutId: null }, { day: "Thu", workoutId: null },
      { day: "Fri", workoutId: null }, { day: "Sat", workoutId: null },
      { day: "Sun", workoutId: null },
    ],
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    workouts: { w1: { id: "w1", name: "Push", exercises: [{ id: "e1", name: "Bench", sets: 4, defaultReps: 8 }] } },
    history: [{ date: "2026-03-05", workoutId: "w1", workoutName: "Push", exercises: [{ name: "Bench", sets: [{ reps: 8, weight: 135, rir: 2, warmup: false }] }] }],
    weightLog: [], weightUnit: "lbs",
  };

  app.mount();
  await app.handleLogin();

  const origWeight = app.state.history[0].exercises[0].sets[0].weight;
  assert(origWeight === 135, "Original weight is 135");

  // Go offline
  app.authState = "offline";

  // Edit the workout (simulate: load into tracking, modify, save)
  app.dispatch({ type: "EDIT_WORKOUT", editingDate: "2026-03-05", session: { workoutId: "w1", exercises: [{ name: "Bench", sets: [{ reps: 8, weight: 185, rir: 1, warmup: false }] }] } });
  app.dispatch({ type: "SAVE_WORKOUT" });
  app.saveLocal();

  const editedWeight = app.state.history[0].exercises[0].sets[0].weight;
  assert(editedWeight === 185, "Edited weight is 185");

  // Reconnect
  await app.autoReconnect();
  app.summary("After reconnect post-edit");
  assert(app.state.history[0].exercises[0].sets[0].weight === 185, "Edit preserved in state after reconnect");
  assert(app.sheets.remoteData.history[0].exercises[0].sets[0].weight === 185, "Edit preserved in remote");
  assert(app.state.weeklySchedule[1].workoutId === "w1", "Schedule preserved after edit reconnect");
}

async function test5_SignOutRefreshSignIn() {
  console.log("\n\n═══ TEST 5: Sign out → REFRESH → sign in (the exact bug scenario) ═══");
  const app = new AppSimulator();

  app.sheets.remoteData = {
    scheduleType: "weekly",
    weeklySchedule: [
      { day: "Mon", workoutId: null }, { day: "Tue", workoutId: "w1" },
      { day: "Wed", workoutId: "w2" }, { day: "Thu", workoutId: "w1" },
      { day: "Fri", workoutId: "w3" }, { day: "Sat", workoutId: "w2" },
      { day: "Sun", workoutId: null },
    ],
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    workouts: {
      w1: { id: "w1", name: "Push", exercises: [] },
      w2: { id: "w2", name: "Pull", exercises: [] },
      w3: { id: "w3", name: "Legs", exercises: [] },
    },
    history: [{ date: "2026-03-05", workoutId: "w1", workoutName: "Push", exercises: [] }],
    weightLog: [{ date: "2026-03-05", weight: 176.5, bodyFat: null }],
    weightUnit: "lbs",
  };

  // 1. Login
  app.mount();
  await app.handleLogin();
  app.summary("Step 1: Initial login");
  assert(Object.keys(app.state.workouts).length === 3, "Has 3 workouts");
  assert(app.state.weeklySchedule.filter(d => d.workoutId).length === 5, "Has 4 scheduled days");

  // 2. Sign out
  app.handleSignOut();
  app.summary("Step 2: After sign out");

  // 3. REFRESH (key step — creates new app instance with same localStorage)
  const app2 = new AppSimulator();
  app2.sheets = app.sheets;  // same remote
  app2.localStorage = app.localStorage;  // same localStorage
  app2.mount();
  app2.summary("Step 3: After refresh (new mount)");

  // Check if localStorage was wiped by the save effect
  const localData = app2.loadLocal();
  const localScheduleAssigned = localData ? localData.weeklySchedule?.filter(d => d.workoutId).length : 0;
  console.log(`  ⚠️ localStorage schedule after refresh mount: ${localScheduleAssigned} assigned days`);

  // 4. Sign in again
  await app2.handleLogin();
  app2.summary("Step 4: After re-login");
  assert(Object.keys(app2.state.workouts).length === 3, "Should have 3 workouts after re-login");
  assert(app2.state.weeklySchedule.filter(d => d.workoutId).length === 5, "Should have 5 scheduled days after re-login");
  assert(app2.state.history.length === 1, "Should have 1 history entry after re-login");
  assert(app2.state.weightLog.length === 1, "Should have 1 weight entry after re-login");
}

async function test6_OfflineSyncButton() {
  console.log("\n\n═══ TEST 6: Open offline → press Sync button ═══");
  const app = new AppSimulator();

  // Pre-populate remote with full data
  app.sheets.remoteData = {
    scheduleType: "weekly",
    weeklySchedule: [
      { day: "Mon", workoutId: null }, { day: "Tue", workoutId: "w1" },
      { day: "Wed", workoutId: "w2" }, { day: "Thu", workoutId: "w1" },
      { day: "Fri", workoutId: "w3" }, { day: "Sat", workoutId: "w2" },
      { day: "Sun", workoutId: null },
    ],
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    workouts: {
      w1: { id: "w1", name: "Push", exercises: [] },
      w2: { id: "w2", name: "Pull", exercises: [] },
      w3: { id: "w3", name: "Legs", exercises: [] },
    },
    history: [{ date: "2026-03-05", workoutId: "w1", workoutName: "Push", exercises: [] }],
    weightLog: [], weightUnit: "lbs",
  };

  // Login first
  app.mount();
  await app.handleLogin();

  // Now sign out and refresh to simulate the user's exact scenario
  app.handleSignOut();
  const app2 = new AppSimulator();
  app2.sheets = app.sheets;
  app2.localStorage = app.localStorage;
  app2.mount();
  app2.summary("After refresh (offline or login)");

  // If offline, press Sync. If login, login.
  if (app2.authState === "offline") {
    await app2.autoReconnect();  // Sync button
  } else {
    await app2.handleLogin();  // Login
  }

  app2.summary("After Sync/Login");
  assert(Object.keys(app2.state.workouts).length === 3, "Should have 3 workouts");
  assert(app2.state.weeklySchedule.filter(d => d.workoutId).length === 5, "Should have 5 scheduled days");
}

async function test7_RealSheetsRoundTrip() {
  console.log("\n\n═══ TEST 7: Simulate REAL Sheets config serialization round-trip ═══");

  // Simulate what saveAll writes to config sheet
  const state = {
    scheduleType: "weekly",
    weeklySchedule: [
      { day: "Mon", workoutId: null }, { day: "Tue", workoutId: "w1" },
      { day: "Wed", workoutId: "w2" }, { day: "Thu", workoutId: "w1" },
      { day: "Fri", workoutId: "w3" }, { day: "Sat", workoutId: "w2" },
      { day: "Sun", workoutId: null },
    ],
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    workouts: {
      w1: { id: "w1", name: "Push", exercises: [] },
      w2: { id: "w2", name: "Pull", exercises: [] },
      w3: { id: "w3", name: "Legs", exercises: [] },
    },
    weightUnit: "lbs",
  };

  // What saveAll writes as config rows (skip header)
  const configVals = [
    ["scheduleType", JSON.stringify(state.scheduleType)],
    ["weeklySchedule", JSON.stringify(state.weeklySchedule)],
    ["cadenceSchedule", JSON.stringify(state.cadenceSchedule)],
    ["workouts", JSON.stringify(state.workouts)],
    ["weightUnit", JSON.stringify(state.weightUnit)],
  ];

  console.log("  Config rows written:");
  configVals.forEach(r => console.log(`    ${r[0]}: ${r[1].substring(0, 80)}${r[1].length > 80 ? "..." : ""}`));

  // What loadAll does: parse config rows
  const config = {};
  configVals.forEach(function(r) {
    try { config[r[0]] = JSON.parse(r[1]); } catch(e) { config[r[0]] = r[1]; }
  });

  console.log("\n  Parsed config:");
  console.log(`    scheduleType: ${config.scheduleType}`);
  console.log(`    weeklySchedule assignments: ${(config.weeklySchedule||[]).filter(d=>d.workoutId).length}`);
  console.log(`    workouts: ${Object.keys(config.workouts||{}).length}`);

  const result = {
    scheduleType: config.scheduleType || "weekly",
    weeklySchedule: config.weeklySchedule || DAYS.map(d => ({ day: d, workoutId: null })),
    workouts: config.workouts || {},
  };

  assert(Object.keys(result.workouts).length === 3, "Round-trip preserves 3 workouts");
  assert(result.weeklySchedule.filter(d => d.workoutId).length === 5, "Round-trip preserves 5 scheduled days");
  assert(result.weeklySchedule[1].workoutId === "w1", "Tue is still w1 (Push)");
  assert(result.scheduleType === "weekly", "Schedule type preserved");
}

// ═══════════════════════════════════════════════════════════════════
// TEST 8: Auto-reconnect triggers on schedule/workout changes (v2.35.0)
// ═══════════════════════════════════════════════════════════════════
async function test8_AutoReconnectOnScheduleChange() {
  console.log("\n\n═══ TEST 8: Auto-reconnect triggers on schedule/workout/cadence changes ═══");
  const app = new AppSimulator();

  // Setup: login, get data, then go offline
  app.sheets.remoteData = {
    scheduleType: "weekly",
    weeklySchedule: DAYS.map(d => ({ day: d, workoutId: null })),
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    workouts: { w1: { id: "w1", name: "Push", exercises: [] } },
    history: [], weightLog: [], weightUnit: "lbs",
  };
  app.mount();
  await app.handleLogin();
  // Simulate going offline (session stays active)
  app.authState = "offline";

  // Capture baseline hash
  const hashBefore = app._dataHash();

  // --- Test: history change triggers reconnect (existing behavior) ---
  app.dispatch({ type: "START_TRACKING", session: { workoutId: "w1", exercises: [], wasOverride: false } });
  app.dispatch({ type: "SAVE_WORKOUT" });
  assert(app.shouldAutoReconnect(hashBefore), "History change triggers auto-reconnect");

  // Reset state back
  app.dispatch({ type: "DELETE_HISTORY_ENTRY", date: app.state.history[0]?.date, workoutId: "w1" });
  const hashReset1 = app._dataHash();

  // --- Test: weekly schedule change triggers reconnect ---
  const newSched = app.state.weeklySchedule.map(d => d.day === "Tue" ? { ...d, workoutId: "w1" } : d);
  app.dispatch({ type: "SET_WEEKLY_SCHEDULE", schedule: newSched });
  assert(app.shouldAutoReconnect(hashReset1), "Weekly schedule change triggers auto-reconnect");

  // Capture new baseline
  const hashAfterSched = app._dataHash();

  // --- Test: adding a workout triggers reconnect ---
  app.dispatch({ type: "UPSERT_WORKOUT", workout: { name: "Pull", exercises: [] } });
  assert(app.shouldAutoReconnect(hashAfterSched), "Workout creation triggers auto-reconnect");

  const hashAfterWorkout = app._dataHash();

  // --- Test: cadence schedule change triggers reconnect ---
  app.dispatch({ type: "SET_CADENCE_SCHEDULE", data: { rotation: [{ workoutId: "w1" }], currentIndex: 0 } });
  assert(app.shouldAutoReconnect(hashAfterWorkout), "Cadence schedule change triggers auto-reconnect");

  const hashAfterCadence = app._dataHash();

  // --- Test: weight log triggers reconnect ---
  app.dispatch({ type: "LOG_WEIGHT", date: "2026-03-05", weight: 180 });
  assert(app.shouldAutoReconnect(hashAfterCadence), "Weight log triggers auto-reconnect");

  const hashAfterWeight = app._dataHash();

  // --- Test: NO change = NO reconnect ---
  assert(!app.shouldAutoReconnect(hashAfterWeight), "No change = no auto-reconnect");

  // --- Test: schedule type change triggers reconnect ---
  app.dispatch({ type: "SET_SCHEDULE_TYPE", scheduleType: "cadence" });
  assert(app.shouldAutoReconnect(hashAfterWeight), "Schedule type change triggers auto-reconnect (via weeklySchedule/cadenceSchedule hash)");

  // --- Test: only triggers when offline ---
  const hashNow = app._dataHash();
  app.authState = "ready"; // connected
  app.dispatch({ type: "LOG_WEIGHT", date: "2026-03-06", weight: 181 });
  assert(!app.shouldAutoReconnect(hashNow), "Does NOT trigger when already connected (authState=ready)");
}


// ═══════════════════════════════════════════════════════════════════
// TEST 9: Push vs Pull behavior (v2.36.0 Data tab)
// ═══════════════════════════════════════════════════════════════════
async function test9_PushVsPull() {
  console.log("\n\n═══ TEST 9: Push to Sheet vs Pull from Sheet ═══");
  const app = new AppSimulator();

  // Setup: remote has data
  app.sheets.remoteData = {
    scheduleType: "weekly",
    weeklySchedule: DAYS.map(d => ({ day: d, workoutId: d === "Mon" ? "w1" : null })),
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    workouts: {
      w1: { id: "w1", name: "Push", exercises: [] },
      w2: { id: "w2", name: "Pull", exercises: [] },
    },
    history: [{ date: "2026-03-01", workoutId: "w1", workoutName: "Push", exercises: [{ exerciseId: "e1", name: "Bench", sets: [{ reps: 10, weight: 135, rir: 1, warmup: false }] }] }],
    weightLog: [{ date: "2026-03-01", weight: 180, bodyFat: null }],
    weightUnit: "lbs",
  };

  // Login
  app.mount();
  await app.handleLogin();
  assert(Object.keys(app.state.workouts).length === 2, "Setup: 2 workouts loaded");
  assert(app.state.history.length === 1, "Setup: 1 history entry loaded");

  // --- Test Pull: remote has MORE data than local ---
  // Simulate: someone adds a workout via the sheet directly
  app.sheets.remoteData.workouts.w3 = { id: "w3", name: "Legs", exercises: [] };
  app.sheets.remoteData.history.push({ date: "2026-03-02", workoutId: "w2", workoutName: "Pull", exercises: [] });

  await app.pullFromSheets();
  assert(Object.keys(app.state.workouts).length === 3, "Pull: 3 workouts after pull (got new Legs)");
  assert(app.state.history.length === 2, "Pull: 2 history entries after pull");

  // Verify remote was NOT overwritten by pull
  assert(Object.keys(app.sheets.remoteData.workouts).length === 3, "Pull: remote still has 3 workouts (not overwritten)");

  // --- Test Push: local changes get sent to remote ---
  // Make local changes
  app.dispatch({ type: "DELETE_WORKOUT", id: "w3" });
  assert(Object.keys(app.state.workouts).length === 2, "After local delete: 2 workouts");

  // Push sends local to remote
  await app.pushToSheets();
  const remoteAfterPush = await app.sheets.loadAll();
  assert(Object.keys(remoteAfterPush.workouts).length === 2, "Push: remote now has 2 workouts (Legs deleted)");

  // --- Test: Pull recovers from messed up local state ---
  // Simulate corrupted local: accidentally delete all workouts
  app.dispatch({ type: "DELETE_WORKOUT", id: "w1" });
  app.dispatch({ type: "DELETE_WORKOUT", id: "w2" });
  assert(Object.keys(app.state.workouts).length === 0, "Local corrupted: 0 workouts");

  // Pull from remote (which still has 2 workouts from the push)
  await app.pullFromSheets();
  assert(Object.keys(app.state.workouts).length === 2, "Pull recovers: 2 workouts restored from remote");

  // --- Test: Push with corrupted local WOULD overwrite remote ---
  // This is the dangerous scenario the user asked about
  app.dispatch({ type: "DELETE_WORKOUT", id: "w1" });
  app.dispatch({ type: "DELETE_WORKOUT", id: "w2" });
  assert(Object.keys(app.state.workouts).length === 0, "Local corrupted again: 0 workouts");

  await app.pushToSheets();
  const remoteAfterBadPush = await app.sheets.loadAll();
  assert(Object.keys(remoteAfterBadPush.workouts).length === 0, "DANGER: Push with empty local wiped remote workouts (0)");
  // History still exists in local state (from earlier pull), so it's pushed too
  assert(remoteAfterBadPush.history.length === 2, "Push preserved history that was still in local state");
}


// ═══════════════════════════════════════════════════════════════════
// TEST 10: Pull from Sheet does NOT push local data first
// ═══════════════════════════════════════════════════════════════════
async function test10_PullDoesNotPush() {
  console.log("\n\n═══ TEST 10: Pull from Sheet is read-only (no push) ═══");
  const app = new AppSimulator();

  // Remote has specific data
  app.sheets.remoteData = {
    scheduleType: "cadence",
    weeklySchedule: DAYS.map(d => ({ day: d, workoutId: null })),
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [{ workoutId: "w1" }, { workoutId: "w2" }], currentIndex: 0 },
    workouts: {
      w1: { id: "w1", name: "Push", exercises: [] },
      w2: { id: "w2", name: "Pull", exercises: [] },
    },
    history: [], weightLog: [], weightUnit: "lbs",
  };

  app.mount();
  await app.handleLogin();

  // Local: make changes that differ from remote
  app.dispatch({ type: "UPSERT_WORKOUT", workout: { id: "w99", name: "Local Only Workout", exercises: [] } });
  assert(Object.keys(app.state.workouts).length === 3, "Local has 3 workouts (2 remote + 1 local)");

  // Pull should load remote (2 workouts), NOT push local first
  await app.pullFromSheets();
  assert(Object.keys(app.state.workouts).length === 2, "After pull: 2 workouts (remote wins, local-only removed)");
  assert(!app.state.workouts.w99, "After pull: local-only workout w99 is gone");

  // Verify remote was not modified (still 2, no w99)
  const remote = await app.sheets.loadAll();
  assert(Object.keys(remote.workouts).length === 2, "Remote unchanged: still 2 workouts");
  assert(!remote.workouts.w99, "Remote unchanged: no w99");

  // Verify cadence schedule came through
  assert(app.state.scheduleType === "cadence", "Pull loaded cadence schedule type");
  assert(app.state.cadenceSchedule.rotation.length === 2, "Pull loaded cadence rotation with 2 entries");
}


// ═══════════════════════════════════════════════════════════════════
// TEST 11: Schedule change while connected syncs to Sheets
// Reproduces: "changed schedule on browser, said autosaved, but phone shows old data"
// ═══════════════════════════════════════════════════════════════════
async function test11_ScheduleChangeSyncsWhenConnected() {
  console.log("\n\n═══ TEST 11: Schedule change while connected syncs to Sheets ═══");
  const app = new AppSimulator();

  // Setup: login with some data
  app.sheets.remoteData = {
    scheduleType: "cadence",
    weeklySchedule: DAYS.map(d => ({ day: d, workoutId: null })),
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    workouts: {
      w1: { id: "w1", name: "Push", exercises: [] },
      w2: { id: "w2", name: "Pull", exercises: [] },
      w3: { id: "w3", name: "Legs", exercises: [] },
    },
    history: [], weightLog: [], weightUnit: "lbs",
  };
  app.mount();
  await app.handleLogin();
  assert(app.authState === "ready", "Connected after login");
  assert(app.state.cadenceSchedule.rotation.length === 0, "Rotation starts empty");

  // Simulate: user adds Push, Pull, Legs, Rest to cadence rotation
  app.dispatch({type:"SET_CADENCE_SCHEDULE", data:{rotation:[{workoutId:"w1"},{workoutId:"w2"},{workoutId:"w3"},{workoutId:null}]}});
  assert(app.state.cadenceSchedule.rotation.length === 4, "Local state has 4 rotation entries");

  // The "Auto-saved" label flashes — this is LOCAL only.
  // The real question: does the debounced sync fire?
  // Simulate effect 4b: detect state change and trigger sync
  const {activeView, trackingSession, ...cur} = app.state;
  const prev = app.sheets.remoteData;
  const curJson = JSON.stringify(cur);
  const {activeView: _, trackingSession: __, ...prevClean} = {...makeInitialState(), ...prev};
  const prevJson = JSON.stringify(prevClean);
  const wouldSync = curJson !== prevJson;
  assert(wouldSync, "Effect 4b detects schedule change (cur !== prev)");

  // Simulate the debounced sync that effect 4b would trigger
  await app.pushToSheets();

  // Verify remote now has the rotation
  const remote = await app.sheets.loadAll();
  assert(remote.cadenceSchedule.rotation.length === 4, "Remote has 4 rotation entries after sync");
  assert(remote.cadenceSchedule.rotation[0].workoutId === "w1", "Remote rotation[0] is Push");
  assert(remote.cadenceSchedule.rotation[3].workoutId === null, "Remote rotation[3] is Rest");

  // Now simulate: login on SECOND DEVICE (phone) — fresh login pulls from remote
  const phone = new AppSimulator();
  phone.sheets = app.sheets; // same remote
  phone.mount();
  await phone.handleLogin();
  assert(phone.state.cadenceSchedule.rotation.length === 4, "Phone sees 4 rotation entries after fresh login");
  assert(phone.state.cadenceSchedule.rotation[0].workoutId === "w1", "Phone sees Push as first rotation entry");

  // ── Now test the FAILURE case: what if sync didn't happen? ──
  // Simulate: user changes schedule but sync fails/never fires
  app.dispatch({type:"SET_CADENCE_SCHEDULE", data:{rotation:[{workoutId:"w2"},{workoutId:"w1"}]}});
  assert(app.state.cadenceSchedule.rotation.length === 2, "Local changed to 2 entries");
  // DON'T push — simulating the sync not happening

  // Phone re-login: still sees OLD remote data (4 entries)
  const phone2 = new AppSimulator();
  phone2.sheets = app.sheets;
  phone2.mount();
  await phone2.handleLogin();
  assert(phone2.state.cadenceSchedule.rotation.length === 4, "Phone still sees OLD 4 entries (sync never happened)");
  assert(phone2.state.cadenceSchedule.rotation.length !== app.state.cadenceSchedule.rotation.length, "DESYNC: phone and browser have different data");
}


// ═══════════════════════════════════════════════════════════════════
// TEST 12: "Auto-saved" is local-only — Sheets sync is separate
// ═══════════════════════════════════════════════════════════════════
async function test12_AutoSavedVsSheetSync() {
  console.log("\n\n═══ TEST 12: Auto-saved is local-only, Sheets sync is separate ═══");
  const app = new AppSimulator();

  app.sheets.remoteData = {
    scheduleType: "weekly",
    weeklySchedule: DAYS.map(d => ({ day: d, workoutId: null })),
    cadenceSchedule: { restMode: "manual", autoRestEvery: 3, rotation: [], currentIndex: 0 },
    workouts: { w1: { id: "w1", name: "Push", exercises: [] } },
    history: [], weightLog: [], weightUnit: "lbs",
  };
  app.mount();
  await app.handleLogin();

  // User sets weekly schedule: Tue=Push
  app.dispatch({type:"SET_WEEKLY_SCHEDULE", schedule: app.state.weeklySchedule.map(s => s.day==="Tue"?{...s,workoutId:"w1"}:s)});

  // "Auto-saved" flashes — that's just local state
  app.saveLocal(); // effect #2 saves to localStorage
  const local = app.loadLocal();
  assert(local.weeklySchedule.find(d=>d.day==="Tue").workoutId === "w1", "localStorage has Tue=Push (local save works)");

  // But remote is STALE until syncToSheets runs
  const remoteBeforeSync = await app.sheets.loadAll();
  assert(remoteBeforeSync.weeklySchedule.find(d=>d.day==="Tue").workoutId === null, "Remote still has Tue=null (sync hasn't happened yet)");

  // After the 2s debounce, syncToSheets fires
  await app.pushToSheets();
  const remoteAfterSync = await app.sheets.loadAll();
  assert(remoteAfterSync.weeklySchedule.find(d=>d.day==="Tue").workoutId === "w1", "Remote now has Tue=Push (after sync)");
}


// ═══════════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════════════════════════
async function runAll() {
  console.log("🏋️ WorkIt Sync Test Harness\n");

  await test1_FreshLoginPullsSchedule();
  await test2_SignOutSignInPreservesData();
  await test3_OfflineDeleteThenReconnect();
  await test4_OfflineEditThenReconnect();
  await test5_SignOutRefreshSignIn();
  await test6_OfflineSyncButton();
  await test7_RealSheetsRoundTrip();
  await test8_AutoReconnectOnScheduleChange();
  await test9_PushVsPull();
  await test10_PullDoesNotPush();
  await test11_ScheduleChangeSyncsWhenConnected();
  await test12_AutoSavedVsSheetSync();

  console.log(`\n\n═══ RESULTS: ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) process.exit(1);
}

runAll();
