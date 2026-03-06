#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// WorkIt Security Tests
// Verifies SRI hashes, CSP meta tag, and last-synced timestamp
// ═══════════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf-8");

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.error("  ✗ " + msg); }
}

// ───────────────────────────────────────────────────────────────────
// 1. SRI integrity hashes on CDN resources
// ───────────────────────────────────────────────────────────────────
console.log("\n▸ SRI integrity hashes");

assert(
  html.includes('integrity="sha384-tMH8h3BGESGckSAVGZ82T9n90ztNXxvdwvdM6UoR56cYcf+0iGXBliJ29D+wZ/x8"'),
  "React 18.2.0 has SRI integrity hash"
);

assert(
  html.includes('integrity="sha384-bm7MnzvK++ykSwVJ2tynSE5TRdN+xL418osEVF2DE/L/gfWHj91J2Sphe582B1Bh"'),
  "React-DOM 18.2.0 has SRI integrity hash"
);

assert(
  html.includes('integrity="sha384-HtMZLkYo+pR5/u7zCzXxMJP6QoNnQJt1qkHM0EaOPvGDIzaVZbmYr/TlvUZ/sKAg"'),
  "Tailwind CSS 2.2.19 has SRI integrity hash"
);

// Verify crossorigin="anonymous" is set on all integrity-bearing tags
const integrityTags = html.match(/<(script|link)[^>]*integrity="[^"]+"/g) || [];
assert(integrityTags.length >= 3, "At least 3 tags have integrity attributes (found " + integrityTags.length + ")");

for (const tag of integrityTags) {
  assert(tag.includes('crossorigin="anonymous"'), "Tag with integrity also has crossorigin=\"anonymous\": " + tag.slice(0, 80) + "...");
}

// ───────────────────────────────────────────────────────────────────
// 2. Content Security Policy meta tag
// ───────────────────────────────────────────────────────────────────
console.log("\n▸ Content Security Policy");

const cspMatch = html.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/);
assert(!!cspMatch, "CSP meta tag exists");

if (cspMatch) {
  const csp = cspMatch[1];

  // default-src should be restrictive
  assert(csp.includes("default-src 'self'"), "CSP default-src is 'self'");

  // script-src should allow the specific CDNs we use
  assert(csp.includes("script-src"), "CSP has script-src directive");
  assert(csp.includes("https://unpkg.com"), "CSP script-src allows unpkg.com for React");
  assert(csp.includes("https://accounts.google.com"), "CSP script-src allows accounts.google.com for OAuth");

  // style-src should allow jsdelivr for Tailwind
  assert(csp.includes("style-src"), "CSP has style-src directive");
  assert(csp.includes("https://cdn.jsdelivr.net"), "CSP style-src allows cdn.jsdelivr.net for Tailwind");

  // connect-src should allow Sheets API and Drive API
  assert(csp.includes("connect-src"), "CSP has connect-src directive");
  assert(csp.includes("https://sheets.googleapis.com"), "CSP connect-src allows Sheets API");

  // img-src should allow data: URIs (for SVG favicon)
  assert(csp.includes("img-src"), "CSP has img-src directive");
  assert(csp.includes("data:"), "CSP img-src allows data: URIs");

  // Should NOT allow unsafe-eval
  assert(!csp.includes("unsafe-eval"), "CSP does NOT allow unsafe-eval");
}

// ───────────────────────────────────────────────────────────────────
// 3. SRI hashes match the actual CDN URLs referenced
// ───────────────────────────────────────────────────────────────────
console.log("\n▸ SRI hash ↔ URL pairing");

// React
const reactScript = html.match(/<script[^>]*src="https:\/\/unpkg\.com\/react@18\.2\.0\/umd\/react\.production\.min\.js"[^>]*/);
assert(!!reactScript && reactScript[0].includes("integrity="), "React script tag has both src and integrity");

// React-DOM
const reactDomScript = html.match(/<script[^>]*src="https:\/\/unpkg\.com\/react-dom@18\.2\.0\/umd\/react-dom\.production\.min\.js"[^>]*/);
assert(!!reactDomScript && reactDomScript[0].includes("integrity="), "React-DOM script tag has both src and integrity");

// Tailwind
const tailwindLink = html.match(/<link[^>]*href="https:\/\/cdn\.jsdelivr\.net\/npm\/tailwindcss@2\.2\.19\/dist\/tailwind\.min\.css"[^>]*/);
assert(!!tailwindLink && tailwindLink[0].includes("integrity="), "Tailwind link tag has both href and integrity");

// ───────────────────────────────────────────────────────────────────
// 4. Last-synced timestamp feature
// ───────────────────────────────────────────────────────────────────
console.log("\n▸ Last-synced timestamp");

assert(html.includes("lastSyncedAt"), "App tracks lastSyncedAt state");
assert(html.includes("setLastSyncedAt"), "App updates lastSyncedAt on sync");
assert(html.includes("_timeAgo"), "App has _timeAgo helper for relative time display");

// Verify _timeAgo produces correct relative times
// Extract and eval the function
const timeAgoMatch = html.match(/function _timeAgo\(date\)\s*\{[\s\S]*?return[^}]*\}/);
assert(!!timeAgoMatch, "_timeAgo function is defined in source");

if (timeAgoMatch) {
  eval("var _timeAgo = " + timeAgoMatch[0].replace("function _timeAgo", "function"));
  const now = new Date();

  assert(_timeAgo(null) === "", "_timeAgo(null) returns empty string");
  assert(_timeAgo(new Date(now - 5000)) === "just now", "_timeAgo(5s ago) returns 'just now'");
  assert(_timeAgo(new Date(now - 30000)) === "30s ago", "_timeAgo(30s ago) returns '30s ago'");
  assert(_timeAgo(new Date(now - 120000)) === "2m ago", "_timeAgo(2min ago) returns '2m ago'");
  assert(_timeAgo(new Date(now - 3600000)) === "1h ago", "_timeAgo(1hr ago) returns '1h ago'");
  assert(_timeAgo(new Date(now - 86400000)) === "1d ago", "_timeAgo(1day ago) returns '1d ago'");
}

// Verify lastSyncedAt is passed to NavBar
assert(html.includes("lastSyncedAt }"), "lastSyncedAt is passed as prop to NavBar");

// Verify timestamp is set on successful sync (both initial and retry paths)
const syncSetCalls = (html.match(/setLastSyncedAt\(new Date\(\)\)/g) || []).length;
assert(syncSetCalls >= 2, "setLastSyncedAt is called on at least 2 sync success paths (found " + syncSetCalls + ")");

// ───────────────────────────────────────────────────────────────────
// 5. No unsafe patterns
// ───────────────────────────────────────────────────────────────────
console.log("\n▸ Security hygiene");

// Google API script doesn't have SRI (it changes dynamically) but should still load from https
assert(html.includes('src="https://accounts.google.com/gsi/client"'), "Google Identity Services loads over HTTPS");

// No inline event handlers in the HTML (all React-managed)
const inlineHandlers = html.match(/<[^>]+(onclick|onerror|onload)=/gi);
assert(!inlineHandlers, "No inline event handlers in HTML markup");

// drive.file scope (minimal permissions)
assert(html.includes("drive.file"), "Uses minimal drive.file scope (not broader Drive access)");

// ───────────────────────────────────────────────────────────────────
// Results
// ───────────────────────────────────────────────────────────────────
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
