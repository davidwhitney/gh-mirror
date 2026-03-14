import { access } from "node:fs/promises";
import { join } from "node:path";
import { listRepos } from "./github.js";
import { cloneRepo } from "./git.js";
import { matchGlob } from "./glob.js";
import { parallel } from "./parallel.js";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function clone(token, basePath, org, pattern, concurrency, includeArchived = false, timeoutMs) {
  console.log(`Fetching repos for ${org}...`);
  const repos = await listRepos(token, org);
  console.log(`Found ${repos.length} repos in ${org}`);

  let filtered = repos;
  if (!includeArchived) {
    const archivedCount = filtered.filter((r) => r.archived).length;
    filtered = filtered.filter((r) => !r.archived);
    if (archivedCount > 0) {
      console.log(`Excluded ${archivedCount} archived repos (use --include-archived to include them)`);
    }
  }
  if (pattern) {
    filtered = filtered.filter((r) => matchGlob(pattern, r.name));
    console.log(`${filtered.length} repos match pattern "${pattern}"`);
  }

  const checks = await Promise.all(
    filtered.map(async (r) => ({
      repo: r,
      exists: await exists(join(basePath, org, r.name)),
    }))
  );
  const toClone = checks.filter((c) => !c.exists).map((c) => c.repo);

  if (toClone.length === 0) {
    console.log("All matching repos already cloned.");
    return new Set();
  }

  console.log(`Cloning ${toClone.length} repos (concurrency: ${concurrency})...`);

  const results = await parallel(toClone, concurrency, async (repo) => {
    const dest = join(basePath, org, repo.name);
    process.stdout.write(`  cloning ${org}/${repo.name}...\n`);
    await cloneRepo(repo.sshUrl, dest, timeoutMs);
    return repo.name;
  });

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected");

  console.log(`\nCloned ${succeeded}/${toClone.length} repos`);
  for (const f of failed) {
    console.error(`  FAILED: ${f.reason.message}`);
  }

  const cloned = new Set();
  for (const r of results) {
    if (r.status === "fulfilled") {
      cloned.add(join(basePath, org, r.value));
    }
  }
  return cloned;
}
