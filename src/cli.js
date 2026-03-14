#!/usr/bin/env node

import { clone } from "./clone.js";
import { update } from "./update.js";
import { loadManifest, saveManifest, manifestExists } from "./manifest.js";
import { resolve } from "node:path";
import { getToken } from "./auth.js";

const HELP = `
Usage: gh-mirror [options] [target]

By default (no --clone or --update flag), both clone and update are run.

Options:
  --clone [target]       Clone repositories only
  --update [target]      Update (pull) repositories only
  --token <token>        GitHub personal access token
  --path <path>          Base path for repos (default: current directory)
  --concurrency <n>      Max parallel git operations (default: 10)
  --include-archived     Include archived repositories (excluded by default)
  --timeout <seconds>    Git operation timeout in seconds (default: 300)
  --help                 Show this help

Targets:
  Owner                  All repos for a user or organisation
  Owner/Repo*            Glob pattern within a user or organisation
  A,B,C                  Comma-separated list of targets
  (empty)                Use manifest to clone new / update all

Environment:
  GITHUB_TOKEN           GitHub personal access token (alternative to --token)

Examples:
  gh-mirror MyOrg                          # clone new + update existing
  gh-mirror MyOrg,myuser                   # multiple owners
  gh-mirror                                # clone new + update all from manifest
  gh-mirror --clone MyOrg,OtherOrg         # clone only, multiple owners
  gh-mirror --clone "MyOrg/Api*"
  gh-mirror --update                       # update only
  gh-mirror --update "Some*Glob*"
  gh-mirror --concurrency 8 --clone MyOrg
`.trim();

function parseCliArgs(argv) {
  const args = { clone: undefined, update: undefined, token: undefined, path: undefined, concurrency: undefined, timeout: undefined, help: false, includeArchived: false, positional: null };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const nextIsFlag = next && next.startsWith("-");
    const nextValue = next && !nextIsFlag ? next : null;

    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--clone" || arg === "-c") {
      args.clone = nextValue || true;
      if (nextValue) i++;
    } else if (arg === "--update" || arg === "-u") {
      args.update = nextValue || true;
      if (nextValue) i++;
    } else if (arg === "--token" || arg === "-t") {
      args.token = nextValue;
      if (nextValue) i++;
    } else if (arg === "--path" || arg === "-p") {
      args.path = nextValue;
      if (nextValue) i++;
    } else if (arg === "--include-archived") {
      args.includeArchived = true;
    } else if (arg === "--timeout") {
      args.timeout = nextValue ? parseInt(nextValue, 10) : undefined;
      if (nextValue) i++;
    } else if (arg === "--concurrency" || arg === "-n") {
      args.concurrency = nextValue ? parseInt(nextValue, 10) : undefined;
      if (nextValue) i++;
    } else if (!arg.startsWith("-")) {
      args.positional = arg;
    }
  }
  return args;
}

function parseTargets(value) {
  if (!value || value === true) return null;
  return value.split(",").map((v) => {
    const trimmed = v.trim();
    if (trimmed.includes("/")) {
      const [org, pattern] = trimmed.split("/", 2);
      return { org, pattern };
    }
    return { org: trimmed, pattern: null };
  });
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  // Default mode: both clone and update
  const defaultMode = args.clone === undefined && args.update === undefined;
  if (defaultMode) {
    args.clone = args.positional || true;
    args.update = args.positional || true;
  }

  const basePath = resolve(args.path || process.cwd());
  const concurrency = args.concurrency || undefined;
  const timeoutMs = args.timeout ? args.timeout * 1000 : undefined;
  const isFirstRun = !(await manifestExists(basePath));

  if (isFirstRun) {
    const targets = parseTargets(args.clone !== undefined ? args.clone : args.update);
    console.log("First run — no manifest found. Here's what will happen:\n");
    console.log(`  Base path:    ${basePath}`);
    console.log(`  Repos cloned: ${basePath}/<owner>/<repo>`);
    console.log(`  Manifest:     ${basePath}/.gh-mirror/manifest.json`);
    console.log(`  Concurrency:  ${concurrency || 10}`);
    if (targets) {
      const owners = targets.map((t) => t.org + (t.pattern ? ` (filter: ${t.pattern})` : "")).join(", ");
      console.log(`  Owners:       ${owners}`);
    }
    console.log(`\nTo change the base path, re-run with --path <dir>`);
    console.log(`To change concurrency, re-run with --concurrency <n>\n`);
  }

  let token;
  try {
    token = getToken(args.token);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const freshlyCloned = new Set();

  if (args.clone !== undefined) {
    const targets = parseTargets(args.clone);
    const manifest = await loadManifest(basePath);
    const effectiveConcurrency = concurrency || manifest.concurrency || 10;

    if (targets) {
      for (const target of targets) {
        if (!manifest.orgs.includes(target.org)) {
          manifest.orgs.push(target.org);
        }
      }
      if (concurrency) manifest.concurrency = concurrency;
      await saveManifest(basePath, manifest);

      for (const target of targets) {
        const cloned = await clone(token, basePath, target.org, target.pattern, effectiveConcurrency, args.includeArchived, timeoutMs);
        if (cloned) for (const p of cloned) freshlyCloned.add(p);
      }
    } else {
      if (manifest.orgs.length === 0) {
        console.error("No owners in manifest. Run: gh-mirror --clone <owner>");
        process.exit(1);
      }
      if (concurrency) {
        manifest.concurrency = concurrency;
        await saveManifest(basePath, manifest);
      }
      for (const org of manifest.orgs) {
        const cloned = await clone(token, basePath, org, null, effectiveConcurrency, args.includeArchived, timeoutMs);
        if (cloned) for (const p of cloned) freshlyCloned.add(p);
      }
    }
  }

  if (args.update !== undefined) {
    const targets = parseTargets(args.update);
    const manifest = await loadManifest(basePath);
    const effectiveConcurrency = concurrency || manifest.concurrency || 10;

    if (concurrency) {
      manifest.concurrency = concurrency;
      await saveManifest(basePath, manifest);
    }

    if (targets) {
      for (const target of targets) {
        await update(token, basePath, target, effectiveConcurrency, manifest, freshlyCloned, timeoutMs);
      }
    } else {
      await update(token, basePath, null, effectiveConcurrency, manifest, freshlyCloned, timeoutMs);
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
  }
);
