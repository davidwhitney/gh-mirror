import { execFile } from "node:child_process";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

export async function cloneRepo(sshUrl, dest) {
  await run("git", ["clone", sshUrl, dest]);
}

export async function pullRepo(repoPath) {
  const { stdout } = await run("git", ["pull"], { cwd: repoPath });
  return stdout;
}
