#!/usr/bin/env bash
#
# Phase 1 CI gate — port prompt §7:
#   "No address literals outside src/config/MonadAddresses.sol. CI enforces it."
#
# Fails if a 40-hex address literal appears outside the single permitted file.
# Catches Base addresses being reintroduced by hand and stops the address book
# from fragmenting across the codebase.
#
# Both src/ and script/ are hard failures. The Phase 1 ALLOW_LEGACY_SCRIPTS escape
# hatch was removed in Phase 2, when the last Base address left script/.
#
# Run locally:
#   ./script/ci/check-address-literals.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

ALLOWED="src/config/MonadAddresses.sol"

# 40-hex address literals. Excludes the allowed file, and excludes bytes32-style
# 64-hex values (storage slots, Morpho market ids, domain separators) which would
# otherwise match their first 40 hex characters.
scan() {
  grep -rnoE '0x[a-fA-F0-9]{40}([a-fA-F0-9]{24})?' "$1" \
    --include='*.sol' 2>/dev/null \
    | grep -vE "^${ALLOWED}:" \
    | grep -vE '0x[a-fA-F0-9]{64}' \
    || true
}

STATUS=0

SRC_HITS=$(scan src)
if [ -n "$SRC_HITS" ]; then
  echo "FAIL: address literal(s) in src/ outside ${ALLOWED}"
  echo "$SRC_HITS"
  echo
  echo "Move each into ${ALLOWED} as a named constant, with verification evidence in ADDRESSES.md."
  STATUS=1
else
  echo "OK: src/ has no address literals outside ${ALLOWED}"
fi

SCRIPT_HITS=$(scan script)
SCRIPT_COUNT=$(printf '%s' "$SCRIPT_HITS" | grep -c . || true)
if [ -n "$SCRIPT_HITS" ]; then
  echo "FAIL: ${SCRIPT_COUNT} address literal(s) in script/ outside ${ALLOWED}"
  printf '%s\n' "$SCRIPT_HITS" | sed 's/^/  /'
  echo
  echo "Deployed FORTRESS addresses belong in env vars (vm.envAddress), not source."
  STATUS=1
else
  echo "OK: script/ has no address literals outside ${ALLOWED}"
fi

exit $STATUS
