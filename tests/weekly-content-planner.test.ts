import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { collectPlanningContext } from "../.agents/skills/weekly-content-planner/scripts/collect-planning-context.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const bankPath = path.join(repositoryRoot, "content", "topic-bank.json");

test("ships a balanced four-week topic reserve", () => {
  const bank = JSON.parse(readFileSync(bankPath, "utf8")) as {
    ideas: Array<{ id: string; pillar: string; priority: number; status: string }>;
  };
  const ids = new Set(bank.ideas.map((idea) => idea.id));
  const counts = Object.groupBy(bank.ideas, (idea) => idea.pillar);

  assert.equal(bank.ideas.length, 16);
  assert.equal(ids.size, bank.ideas.length);
  assert.deepEqual(Object.keys(counts).sort(), ["community", "drop-readiness", "education", "market-literacy"]);
  for (const ideas of Object.values(counts)) assert.equal(ideas?.length, 4);
  for (const idea of bank.ideas) {
    assert.match(idea.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(idea.priority >= 1 && idea.priority <= 3);
    assert.equal(idea.status, "backlog");
  }
});

test("context helper reads recent plans and tolerates a missing reference database", async () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "weekly-content-planner-"));
  try {
    const contentDirectory = path.join(fixtureRoot, "content");
    const plansDirectory = path.join(contentDirectory, "plans");
    mkdirSync(plansDirectory, { recursive: true });
    writeFileSync(path.join(contentDirectory, "topic-bank.json"), JSON.stringify({ version: 1, ideas: [] }));
    writeFileSync(path.join(plansDirectory, "2026-09-28.md"), "older");
    writeFileSync(path.join(plansDirectory, "2026-10-05.md"), "newer");

    const context = await collectPlanningContext({ root: fixtureRoot, weeks: 1 }) as {
      recentPlans: Array<{ file: string; content: string }>;
      referenceLibrary: string;
      savedImageReferences: unknown[];
    };

    assert.deepEqual(context.recentPlans, [{ file: path.join("content", "plans", "2026-10-05.md"), content: "newer" }]);
    assert.equal(context.referenceLibrary, "unavailable");
    assert.deepEqual(context.savedImageReferences, []);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
