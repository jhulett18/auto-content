#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const inferredRoot = path.resolve(scriptDirectory, "../../../..");
export async function collectPlanningContext(options = {}) {
  const root = path.resolve(options.root || inferredRoot);
  const weeks = options.weeks ?? 8;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    throw new Error("weeks must be an integer from 1 through 52.");
  }

  const bankPath = path.join(root, "content", "topic-bank.json");
  if (!existsSync(bankPath)) throw new Error(`Topic bank not found: ${bankPath}`);

  const topicBank = JSON.parse(await readFile(bankPath, "utf8"));
  const plansDirectory = path.join(root, "content", "plans");
  let recentPlans = [];
  if (existsSync(plansDirectory)) {
    const names = (await readdir(plansDirectory))
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .sort()
      .reverse()
      .slice(0, weeks);
    recentPlans = await Promise.all(names.map(async (name) => ({
      file: path.join("content", "plans", name),
      content: await readFile(path.join(plansDirectory, name), "utf8"),
    })));
  }

  let savedImageReferences = [];
  let referenceLibrary = "unavailable";
  const databasePath = path.join(root, "data", "references.sqlite3");
  if (existsSync(databasePath)) {
    try {
      const requireFromRoot = createRequire(path.join(root, "package.json"));
      const Database = requireFromRoot("better-sqlite3");
      const database = new Database(databasePath, { readonly: true, fileMustExist: true });
      try {
        savedImageReferences = database.prepare(`
          SELECT id,
                 saved_name AS savedName,
                 creator_handle AS creatorHandle,
                 platform,
                 media_type AS mediaType,
                 caption,
                 published_at AS publishedAt
          FROM reference_assets
          WHERE saved = 1 AND media_type = 'image'
          ORDER BY published_at DESC, id
        `).all();
        referenceLibrary = "available";
      } finally {
        database.close();
      }
    } catch (error) {
      referenceLibrary = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return { generatedAt: new Date().toISOString(), root, topicBank, recentPlans, referenceLibrary, savedImageReferences };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = argumentValue("--root") || inferredRoot;
  const weeks = Number.parseInt(argumentValue("--weeks") || "8", 10);
  process.stdout.write(`${JSON.stringify(await collectPlanningContext({ root, weeks }), null, 2)}\n`);
}
