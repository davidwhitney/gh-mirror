import { readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { listRepos } from "./github.js";
import { pullRepo } from "./git.js";
import { matchGlob } from "./glob.js";
import { parallel } from "./parallel.js";

async function discoverLocalRepos(basePath, manifest) {
  const repos = [];
  for (const org of manifest.orgs) {
    const orgDir = join(basePath, org);
    try {
      await access(orgDir);
    } catch {
      continue;
    }
    const entries = await readdir(orgDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          await access(join(orgDir, entry.name, ".git"));
          repos.push({ org, name: entry.name, path: join(orgDir, entry.name) });
        } catch {
          // not a git repo
        }
      }
    }
  }
  return repos;
}

export async function update(token, basePath, target, concurrency, manifest, exclude, timeoutMs) {
  let repos;

  if (target && target.org && !target.pattern) {
    if (manifest.orgs.includes(target.org)) {
      repos = await discoverLocalRepos(basePath, { orgs: [target.org] });
    } else {
      const allRepos = await discoverLocalRepos(basePath, manifest);
      repos = allRepos.filter((r) => matchGlob(target.org, r.name) || matchGlob(target.org, `${r.org}/${r.name}`));
    }
  } else if (target && target.pattern) {
    const orgRepos = await discoverLocalRepos(basePath, { orgs: [target.org] });
    repos = orgRepos.filter((r) => matchGlob(target.pattern, r.name));
  } else {
    repos = await discoverLocalRepos(basePath, manifest);
  }

  if (exclude && exclude.size > 0) {
    repos = repos.filter((r) => !exclude.has(r.path));
  }

  if (repos.length === 0) {
    console.log("No repos found to update.");
    return;
  }

  console.log(`Updating ${repos.length} repos (concurrency: ${concurrency})...`);

  const results = await parallel(repos, concurrency, async (repo) => {
    process.stdout.write(`  updating ${repo.org}/${repo.name}...\n`);
    const output = await pullRepo(repo.path, timeoutMs);
    return { name: `${repo.org}/${repo.name}`, output };
  });

  const succeeded = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r) => r.status === "rejected");

  console.log(`\nUpdated ${succeeded.length}/${repos.length} repos`);
  for (const s of succeeded) {
    if (s.value.output && s.value.output !== "Already up to date.") {
      console.log(`  ${s.value.name}: ${s.value.output.split("\n")[0]}`);
    }
  }
  for (const f of failed) {
    console.error(`  FAILED: ${f.reason.message}`);
  }
}
