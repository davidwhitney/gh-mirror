import { readdir, access, stat } from "node:fs/promises";
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

async function getLastFetchTime(repoPath) {
  // Check FETCH_HEAD first (written on every fetch/pull), fall back to HEAD
  for (const ref of ["FETCH_HEAD", "HEAD"]) {
    try {
      const s = await stat(join(repoPath, ".git", ref));
      return s.mtime;
    } catch {
      // continue
    }
  }
  return null;
}

export async function update(token, basePath, target, concurrency, manifest, exclude, timeoutMs, force = false) {
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

  if (exclude?.size > 0) {
    repos = repos.filter((r) => !exclude.has(r.path));
  }

  if (repos.length === 0) {
    console.log("No repos found to update.");
    return;
  }

  let toUpdate = repos;

  if (!force) {
    // Fetch pushed_at times from GitHub to skip repos that haven't changed
    const orgsToFetch = [...new Set(repos.map((r) => r.org))];
    const remoteByKey = new Map();
    for (const org of orgsToFetch) {
      try {
        const remoteRepos = await listRepos(token, org);
        for (const r of remoteRepos) {
          remoteByKey.set(`${org}/${r.name}`, r);
        }
      } catch {
        // If we can't fetch remote info, we'll just update everything for this org
      }
    }

    // Filter out repos that haven't been pushed since last fetch
    toUpdate = [];
    let skipped = 0;
    for (const repo of repos) {
      const remote = remoteByKey.get(`${repo.org}/${repo.name}`);
      if (remote?.pushedAt) {
        const lastFetch = await getLastFetchTime(repo.path);
        if (lastFetch && new Date(remote.pushedAt) < lastFetch) {
          skipped++;
          continue;
        }
      }
      toUpdate.push(repo);
    }

    if (skipped > 0) {
      console.log(`Skipped ${skipped} repos with no remote changes since last fetch`);
    }

    if (toUpdate.length === 0) {
      console.log("All repos are up to date.");
      return;
    }
  }

  console.log(`Updating ${toUpdate.length} repos (concurrency: ${concurrency})...`);

  const results = await parallel(toUpdate, concurrency, async (repo) => {
    process.stdout.write(`  updating ${repo.org}/${repo.name}...\n`);
    const output = await pullRepo(repo.path, timeoutMs);
    return { name: `${repo.org}/${repo.name}`, output };
  });

  const succeeded = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r) => r.status === "rejected");

  console.log(`\nUpdated ${succeeded.length}/${toUpdate.length} repos`);
  for (const s of succeeded) {
    if (s.value.output && s.value.output !== "Already up to date.") {
      console.log(`  ${s.value.name}: ${s.value.output.split("\n")[0]}`);
    }
  }
  for (const f of failed) {
    console.error(`  FAILED: ${f.reason.message}`);
  }
}
