import { rename, mkdir, access, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listRepos } from "./github.js";
import { selectRepos } from "./update.js";

const REMOVED_DIR = ".removed";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Pick a destination under .removed that doesn't collide with a previous move.
async function uniqueDest(basePath, org, name) {
  const base = join(basePath, REMOVED_DIR, org, name);
  if (!(await exists(base))) return base;
  for (let i = 1; ; i++) {
    const candidate = `${base}.${i}`;
    if (!(await exists(candidate))) return candidate;
  }
}

// Prune locally-cloned repos that are no longer mirroring candidates: repos that are
// archived (unless --include-archived) or no longer present on the remote. By default
// they are moved into .removed; with del=true they are permanently deleted.
export async function clean(token, basePath, target, manifest, includeArchived = false, del = false) {
  const repos = await selectRepos(basePath, target, manifest);

  if (repos.length === 0) {
    console.log("No local repos found to check.");
    return;
  }

  // Fetch the remote repo listing per org so we can tell what's still a candidate.
  const orgs = [...new Set(repos.map((r) => r.org))];
  const remoteByKey = new Map();
  const failedOrgs = new Set();
  for (const org of orgs) {
    try {
      const remoteRepos = await listRepos(token, org);
      for (const r of remoteRepos) {
        remoteByKey.set(`${org}/${r.name}`, r);
      }
    } catch (err) {
      // If we can't list an org, don't risk removing its repos.
      failedOrgs.add(org);
      console.error(`  Could not fetch remote repos for ${org}, skipping it: ${err.message}`);
    }
  }

  const inactive = [];
  for (const repo of repos) {
    if (failedOrgs.has(repo.org)) continue;
    const remote = remoteByKey.get(`${repo.org}/${repo.name}`);
    if (!remote) {
      inactive.push({ ...repo, reason: "no longer on remote" });
    } else if (remote.archived && !includeArchived) {
      inactive.push({ ...repo, reason: "archived" });
    }
  }

  if (inactive.length === 0) {
    console.log("No inactive repos to clean.");
    return;
  }

  const verb = del ? "Deleting" : "Moving";
  const dest = del ? "" : ` to ${join(basePath, REMOVED_DIR)}`;
  console.log(`${verb} ${inactive.length} inactive repos${dest}...`);

  let done = 0;
  for (const repo of inactive) {
    try {
      if (del) {
        await rm(repo.path, { recursive: true, force: true });
      } else {
        const target = await uniqueDest(basePath, repo.org, repo.name);
        await mkdir(dirname(target), { recursive: true });
        await rename(repo.path, target);
      }
      console.log(`  ${repo.org}/${repo.name} (${repo.reason})`);
      done++;
    } catch (err) {
      console.error(`  FAILED to ${del ? "delete" : "move"} ${repo.org}/${repo.name}: ${err.message}`);
    }
  }

  console.log(`\n${del ? "Deleted" : "Moved"} ${done}/${inactive.length} inactive repos${del ? "" : ` to ${REMOVED_DIR}/`}.`);
}
