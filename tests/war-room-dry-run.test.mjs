import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildDirectorSummary,
  deriveTrafficLight,
  isMainModule,
  shouldIncludeInDirectorSummary,
  validateSnapshot,
} from "../scripts/war-room-dry-run.mjs";

const fixture = JSON.parse(
  await readFile(new URL("../docs/issue-5/baseline.example.json", import.meta.url), "utf8"),
);

test("the anonymous fixture is a valid dry-run snapshot", () => {
  assert.deepEqual(validateSnapshot(fixture), []);
});

test("the director summary contains only delayed, unknown, blocked, or decision cases", () => {
  const summary = buildDirectorSummary(fixture);
  assert.equal(summary.mode, "DRY_RUN");
  assert.equal(summary.exception_count, 2);
  assert.deepEqual(
    summary.items.map((item) => item.case_key),
    ["CASE-DEMO-003", "CASE-DEMO-004"],
  );
});

test("a near-due inferred case without blockers or decisions stays out of the summary", () => {
  assert.equal(fixture.projects[1].traffic_light, "注意");
  assert.equal(shouldIncludeInDirectorSummary(fixture.projects[1]), false);
});

test("unknown evidence always produces an unknown light", () => {
  const project = structuredClone(fixture.projects[0]);
  project.evidence_status = "UNKNOWN";
  assert.equal(deriveTrafficLight(project, fixture.captured_at), "未知");
});

test("an overdue verified case produces a delayed light", () => {
  const project = structuredClone(fixture.projects[0]);
  project.planned_completion_date = "2026-09-07";
  assert.equal(deriveTrafficLight(project, fixture.captured_at), "延誤");
});

test("non-dry-run input fails closed", () => {
  const snapshot = structuredClone(fixture);
  snapshot.mode = "LIVE";
  assert.match(validateSnapshot(snapshot).join("\n"), /schema \/mode: must be equal to constant/);
});

test("missing required fields fail full schema validation", () => {
  const snapshot = structuredClone(fixture);
  delete snapshot.captured_at;
  assert.notDeepEqual(validateSnapshot(snapshot), []);
});

test("additional properties fail full schema validation", () => {
  const snapshot = structuredClone(fixture);
  snapshot.unapproved_field = true;
  assert.notDeepEqual(validateSnapshot(snapshot), []);
});

test("invalid date formats fail full schema validation", () => {
  const snapshot = structuredClone(fixture);
  snapshot.captured_at = "not-a-date";
  assert.notDeepEqual(validateSnapshot(snapshot), []);
});

test("duplicate case keys and record IDs fail closed", () => {
  const duplicateCase = structuredClone(fixture);
  duplicateCase.projects[1].case_key = duplicateCase.projects[0].case_key;
  assert.match(validateSnapshot(duplicateCase).join("\n"), /case_key must be unique/);

  const duplicateRecord = structuredClone(fixture);
  duplicateRecord.projects[1].record_id = duplicateRecord.projects[0].record_id;
  assert.match(validateSnapshot(duplicateRecord).join("\n"), /record_id must be unique/);
});

test("VERIFIED evidence must have a reference, timestamp, and validator", () => {
  const snapshot = structuredClone(fixture);
  const project = snapshot.projects[0];
  project.evidence_refs = [];
  project.last_verified_at = null;
  project.verified_by = "";
  assert.notDeepEqual(validateSnapshot(snapshot), []);
});

test("source cutoff cannot be later than snapshot capture", () => {
  const snapshot = structuredClone(fixture);
  snapshot.source_cutoff_at = "2026-09-08T15:01:00+08:00";
  assert.match(
    validateSnapshot(snapshot).join("\n"),
    /source_cutoff_at must not be later than captured_at/,
  );
});

test("the main-module guard accepts an absent argv entry", () => {
  assert.equal(isMainModule(undefined), false);
});
