#!/usr/bin/env bash
set -euo pipefail
if ! command -v firebase >/dev/null 2>&1; then
  echo "Firebase CLI is not installed. Run: npm install -g firebase-tools" >&2
  exit 1
fi
npm install --prefix functions
firebase deploy --project skydream-academy --only functions,firestore:rules --non-interactive
firebase deploy --project skydream-academy --only firestore:indexes --non-interactive
echo "Firebase backend deployment completed successfully."
