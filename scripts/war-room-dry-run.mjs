#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schema = JSON.parse(
  readFileSync(
    new URL("../docs/issue-5/project-war-room.schema.json", import.meta.url),
    "utf8",
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateAgainstSchema = ajv.compile(schema);

export const EVIDENCE_STATUSES = new Set([
  "VERIFIED",
  "INFERRED",
  "UNKNOWN",
  "CONFLICT",
  "NOT_READY",
  "BLOCKED_EXTERNAL",
]);

export const TRAFFIC_LIGHTS = new Set(["正常", "注意", "延誤", "未知"]);

function dateOnly(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00+08:00`);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function deriveTrafficLight(project, asOf) {
  if (["UNKNOWN", "CONFLICT", "NOT_READY"].includes(project.evidence_status)) {
    return "未知";
  }

  const due = dateOnly(project.planned_completion_date);
  const current = new Date(asOf);
  const currentDay = new Date(
    current.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }) +
      "T00:00:00+08:00",
  );
  const daysUntilDue = due ? (due - currentDay) / 86_400_000 : null;
  const hasOpenBlocker = project.blockers.some((item) => item.status !== "RESOLVED");
  const hasPendingDecision = project.director_decisions.some(
    (item) => item.status !== "DECIDED",
  );

  if (daysUntilDue !== null && daysUntilDue < 0) return "延誤";
  if (project.evidence_status === "BLOCKED_EXTERNAL") return "注意";
  if (hasOpenBlocker || hasPendingDecision) return "注意";
  if (daysUntilDue !== null && daysUntilDue <= 2) return "注意";
  return "正常";
}

export function validateSnapshot(snapshot) {
  if (!validateAgainstSchema(snapshot)) {
    return validateAgainstSchema.errors.map((error) => {
      const location = error.instancePath || "/";
      return `schema ${location}: ${error.message}`;
    });
  }

  const errors = [];
  const seenCaseKeys = new Set();
  const seenRecordIds = new Set();
  for (const [index, project] of snapshot.projects.entries()) {
    const prefix = `projects[${index}]`;
    if (seenCaseKeys.has(project.case_key)) {
      errors.push(`${prefix}.case_key must be unique`);
    }
    seenCaseKeys.add(project.case_key);
    if (seenRecordIds.has(project.record_id)) {
      errors.push(`${prefix}.record_id must be unique`);
    }
    seenRecordIds.add(project.record_id);

    const derived = deriveTrafficLight(project, snapshot.captured_at);
    if (project.traffic_light !== derived) {
      errors.push(`${prefix}.traffic_light expected ${derived}, got ${project.traffic_light}`);
    }
  }

  if (new Date(snapshot.source_cutoff_at) > new Date(snapshot.captured_at)) {
    errors.push("source_cutoff_at must not be later than captured_at");
  }

  return errors;
}

export function shouldIncludeInDirectorSummary(project) {
  const hasOpenBlocker = project.blockers.some((item) => item.status !== "RESOLVED");
  const hasPendingDecision = project.director_decisions.some(
    (item) => item.status !== "DECIDED",
  );
  const hasUnknownEvidence = ["UNKNOWN", "CONFLICT", "NOT_READY"].includes(
    project.evidence_status,
  );

  return (
    project.traffic_light === "延誤" ||
    hasUnknownEvidence ||
    project.evidence_status === "BLOCKED_EXTERNAL" ||
    hasOpenBlocker ||
    hasPendingDecision
  );
}

export function buildDirectorSummary(snapshot) {
  const items = snapshot.projects
    .filter(shouldIncludeInDirectorSummary)
    .map((project) => ({
      case_key: project.case_key,
      case_name: project.case_name,
      evidence_status: project.evidence_status,
      traffic_light: project.traffic_light,
      next_step: project.next_step,
      planned_completion_date: project.planned_completion_date,
      blockers: project.blockers
        .filter((item) => item.status !== "RESOLVED")
        .map((item) => item.summary),
      director_decisions: project.director_decisions
        .filter((item) => item.status !== "DECIDED")
        .map((item) => item.question),
    }));

  return {
    mode: "DRY_RUN",
    snapshot_id: snapshot.snapshot_id,
    source_cutoff_at: snapshot.source_cutoff_at,
    exception_count: items.length,
    items,
  };
}

async function main() {
  const inputPath = process.argv[2] ?? "docs/issue-5/baseline.example.json";
  const snapshot = JSON.parse(await readFile(inputPath, "utf8"));
  const errors = validateSnapshot(snapshot);
  if (errors.length > 0) {
    console.error(JSON.stringify({ mode: "DRY_RUN", errors }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(buildDirectorSummary(snapshot), null, 2));
}

export function isMainModule(argvEntry = process.argv[1]) {
  return Boolean(argvEntry) && import.meta.url === pathToFileURL(argvEntry).href;
}

if (isMainModule()) {
  await main();
}
