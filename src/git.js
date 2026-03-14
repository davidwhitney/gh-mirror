import { execFile } from "node:child_process";

const DEFAULT_TIMEOUT = 300 * 1000; // 5 minutes

function run(cmd, args, opts = {}, timeoutMs) {
  const timeout = timeoutMs || DEFAULT_TIMEOUT;
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, {
      ...opts,
      maxBuffer: 10 * 1024 * 1024,
      timeout,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...opts.env },
    }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed) {
          reject(new Error(`${cmd} ${args[0]} timed out after ${timeout / 1000}s: ${args.slice(1).join(" ")}`));
        } else {
          err.stderr = stderr;
          reject(err);
        }
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
    child.stdin?.end();
  });
}

export async function cloneRepo(sshUrl, dest, timeoutMs) {
  await run("git", ["clone", sshUrl, dest], {}, timeoutMs);
}

export async function pullRepo(repoPath, timeoutMs) {
  const { stdout } = await run("git", ["pull"], { cwd: repoPath }, timeoutMs);
  return stdout;
}
