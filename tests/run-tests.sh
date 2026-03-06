#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# WorkIt Test Runner
# Runs all test suites and reports overall results
# ═══════════════════════════════════════════════════════════════════

DIR="$(cd "$(dirname "$0")" && pwd)"
TOTAL_PASS=0
TOTAL_FAIL=0
FAILED_SUITES=()

echo "═══════════════════════════════════════════════════"
echo "  WorkIt Test Runner"
echo "═══════════════════════════════════════════════════"

for test_file in "$DIR"/test-*.js; do
  name=$(basename "$test_file")
  echo ""
  echo "▶ Running $name ..."
  echo "─────────────────────────────────────────────────"

  output=$(node "$test_file" 2>&1)
  exit_code=$?

  echo "$output"

  # Parse results line
  results=$(echo "$output" | grep -oP '\d+ passed, \d+ failed' | tail -1)
  if [ -n "$results" ]; then
    p=$(echo "$results" | grep -oP '^\d+')
    f=$(echo "$results" | grep -oP '\d+ failed' | grep -oP '^\d+')
    TOTAL_PASS=$((TOTAL_PASS + p))
    TOTAL_FAIL=$((TOTAL_FAIL + f))
  fi

  if [ $exit_code -ne 0 ]; then
    FAILED_SUITES+=("$name")
  fi
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "  TOTAL: $TOTAL_PASS passed, $TOTAL_FAIL failed"
if [ ${#FAILED_SUITES[@]} -gt 0 ]; then
  echo "  FAILED SUITES: ${FAILED_SUITES[*]}"
  echo "═══════════════════════════════════════════════════"
  exit 1
else
  echo "  All suites passed ✓"
  echo "═══════════════════════════════════════════════════"
  exit 0
fi
