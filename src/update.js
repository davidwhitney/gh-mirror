import { readdir, access, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { listRepos } from "./github.js";
import { pullRepo, cloneRepo } from "./git.js";
import { matchGlob } from "./glob.js";
import { parallel } from "./parallel.js";

export async function discoverLocalRepos(basePath, manifest) {
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

// Resolve the local repos a target refers to. Shared by update and clean.
export async function selectRepos(basePath, target, manifest) {
  if (target && target.org && !target.pattern) {
    if (manifest.orgs.includes(target.org)) {
      return await discoverLocalRepos(basePath, { orgs: [target.org] });
    }
    const allRepos = await discoverLocalRepos(basePath, manifest);
    return allRepos.filter((r) => matchGlob(target.org, r.name) || matchGlob(target.org, `${r.org}/${r.name}`));
  }
  if (target && target.pattern) {
    const orgRepos = await discoverLocalRepos(basePath, { orgs: [target.org] });
    return orgRepos.filter((r) => matchGlob(target.pattern, r.name));
  }
  return await discoverLocalRepos(basePath, manifest);
}

export async function update(token, basePath, target, concurrency, manifest, exclude, timeoutMs, force = false, recloneOnError = false) {
  let repos = await selectRepos(basePath, target, manifest);

  if (exclude?.size > 0) {
    repos = repos.filter((r) => !exclude.has(r.path));
  }

  if (repos.length === 0) {
    console.log("No repos found to update.");
    return;
  }

  // Fetch remote info when we need it: to skip unchanged repos (non-force),
  // or to look up clone URLs for re-cloning broken repos.
  const remoteByKey = new Map();
  if (!force || recloneOnError) {
    const orgsToFetch = [...new Set(repos.map((r) => r.org))];
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
  }

  let toUpdate = repos;

  if (!force) {
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
    const name = `${repo.org}/${repo.name}`;
    process.stdout.write(`  updating ${name}...\n`);
    try {
      const output = await pullRepo(repo.path, timeoutMs);
      return { name, output };
    } catch (err) {
      if (!recloneOnError) throw err;
      const remote = remoteByKey.get(name);
      const url = remote?.sshUrl;
      if (!url) {
        throw new Error(`${name}: pull failed and no remote URL available to re-clone: ${err.message}`);
      }
      process.stdout.write(`  pull failed for ${name}, removing and re-cloning...\n`);
      await rm(repo.path, { recursive: true, force: true });
      await cloneRepo(url, repo.path, timeoutMs);
      return { name, output: "re-cloned" };
    }
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
