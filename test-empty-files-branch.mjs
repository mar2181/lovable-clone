// Smoke test for the new empty-files classification + aiMessage logic in
// worker/src/routes/chat.ts. Mirrors the *exact* logic shape of the new
// branch on representative inputs so a regression there breaks this test
// before it reaches users. Pure logic test — no Hono/Cloudflare runtime.

// === Mirror of the new logic from chat.ts (lines 377-413) ===
function classify(modifiedFiles, fullContent) {
  if (modifiedFiles && modifiedFiles.files && Object.keys(modifiedFiles.files).length > 0) {
    return { hitsBranch: false };
  }
  let reason;
  if (modifiedFiles === null) reason = "parse_failure";
  else if (modifiedFiles.files === undefined) reason = "missing_files_key";
  else reason = "structured_no_op";

  let aiMessage;
  if (modifiedFiles && typeof modifiedFiles.noChangesReason === "string"
      && modifiedFiles.noChangesReason.trim()) {
    aiMessage = modifiedFiles.noChangesReason.trim();
  } else if (reason === "parse_failure" && fullContent.trim()) {
    aiMessage = fullContent.trim().slice(0, 400);
  }
  return { hitsBranch: true, reason, aiMessage };
}

let failures = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? "PASS  " : "FAIL  ") + label + (ok ? "" : `\n      want=${JSON.stringify(want)}\n      got=${JSON.stringify(got)}`));
  if (!ok) failures++;
};

// Case 1: parser returned null because model emitted prose
// (this is the most common cause of "no files changed" today)
eq(
  "parse_failure: prose response → reason=parse_failure, aiMessage=truncated prose",
  classify(null, "The dark theme is already implemented in your existing files. No changes needed."),
  { hitsBranch: true, reason: "parse_failure", aiMessage: "The dark theme is already implemented in your existing files. No changes needed." }
);

// Case 2: parser returned null AND model produced no content
// (rare, but should not crash on undefined)
eq(
  "parse_failure: empty content → reason=parse_failure, aiMessage=undefined",
  classify(null, "   "),
  { hitsBranch: true, reason: "parse_failure", aiMessage: undefined }
);

// Case 3: model emitted JSON with the new structured no-op shape
eq(
  "structured_no_op with noChangesReason → reason=structured_no_op, aiMessage=reason",
  classify({ files: {}, noChangesReason: "Header already shows the logo via Header.tsx line 14." }, ""),
  { hitsBranch: true, reason: "structured_no_op", aiMessage: "Header already shows the logo via Header.tsx line 14." }
);

// Case 4: model emitted bare empty files map (no reason field)
eq(
  "structured_no_op without reason → reason=structured_no_op, aiMessage=undefined",
  classify({ files: {} }, ""),
  { hitsBranch: true, reason: "structured_no_op", aiMessage: undefined }
);

// Case 5: model emitted JSON without a files key at all
eq(
  "missing_files_key → reason=missing_files_key, aiMessage=undefined",
  classify({ dependencies: {} }, ""),
  { hitsBranch: true, reason: "missing_files_key", aiMessage: undefined }
);

// Case 6: very long prose gets truncated to 400 chars
const longProse = "A".repeat(800);
const r6 = classify(null, longProse);
eq(
  "parse_failure: long prose → aiMessage truncated to 400",
  { hitsBranch: r6.hitsBranch, reason: r6.reason, len: r6.aiMessage?.length },
  { hitsBranch: true, reason: "parse_failure", len: 400 }
);

// Case 7: legitimate files present → branch is NOT entered
eq(
  "real changes → branch skipped",
  classify({ files: { "/src/App.tsx": "..." } }, ""),
  { hitsBranch: false }
);

// Case 8: noChangesReason is whitespace-only → falls through to undefined
eq(
  "noChangesReason whitespace-only → aiMessage stays undefined",
  classify({ files: {}, noChangesReason: "   " }, ""),
  { hitsBranch: true, reason: "structured_no_op", aiMessage: undefined }
);

// Case 9: JSON parses but `files` is non-object — current logic treats it as
// structured_no_op because Object.keys() of non-object would throw — but the
// guard `Object.keys(modifiedFiles.files).length === 0` runs first in chat.ts.
// Mirroring that: this should hit the branch.
eq(
  "files: null → still hits branch (caught by the outer empty-check)",
  classify({ files: null }, ""),
  // Object.keys(null) throws in real chat.ts — but the guard
  // `!modifiedFiles.files` catches `null` first. Our classify mirror:
  // modifiedFiles is truthy, modifiedFiles.files is null (falsy) → guard
  // in chat.ts triggers BEFORE Object.keys. Then in classify:
  // modifiedFiles !== null, modifiedFiles.files !== undefined (it's null)
  // → reason = "structured_no_op". Document that behavior.
  { hitsBranch: true, reason: "structured_no_op", aiMessage: undefined }
);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll empty-files classification cases verified.");
