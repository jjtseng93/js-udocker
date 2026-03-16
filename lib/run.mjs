#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const libDir = path.dirname(__filename);
const topDir = path.resolve(libDir, "..");
const udockerJs = path.join(topDir, "udocker.js");
const scriptsDir = path.join(topDir, "scripts");
const udroot = path.join(process.env.HOME || "", ".udocker", "containers");

if( process.env.PKG_RDIR )
{
  let ndpath = path.join(process.env.PKG_RDIR,"bin/node") ;
  if( fileExists(ndpath) )
  {
    process.execPath = ndpath ;
  }
}

function fileExists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function spawnWait(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(cmd, args, options);
    let stdout = "";

    child.on("error", reject);

    if (options.stdio === "pipe" || Array.isArray(options.stdio)) {
      if (child.stdout) {
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
      }
    }

    child.on("close", (code, signal) => {
      resolve({
        code: code ?? (signal ? 1 : 0),
        signal,
        stdout,
      });
    });
  });
}

function splitOption(arg) {
  const idx = arg.indexOf("=");
  if (idx === -1) return [arg, ""];
  return [arg.slice(0, idx), arg.slice(idx + 1)];
}

function parseEntrypointValue(value) {
  if (typeof value !== "string") return [];
  if (value.startsWith("data:application/json,")) {
    try {
      const parsed = JSON.parse(decodeURIComponent(value.slice("data:application/json,".length)));
      return Array.isArray(parsed) ? parsed.map((v) => `${v}`) : [];
    } catch {
      return [];
    }
  }
  if (value.startsWith("@json:")) {
    try {
      const parsed = JSON.parse(value.slice(6));
      return Array.isArray(parsed) ? parsed.map((v) => `${v}`) : [];
    } catch {
      return [];
    }
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

function normArgList(value) {
  if (Array.isArray(value)) return value.map((v) => `${v}`);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed.split(/\s+/) : [];
  }
  return [];
}

function parseRunArgs(argv) {
  const opts = {
    entrypointMode: "meta",
    entrypointValue: "",
    binds: [],
    envs: [],
    remove: false,
    workdir: "",
    isolated: false,
    forceProot: false,
    name: "",
  };
  const rest = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      rest.push(...argv.slice(i));
      break;
    }

    if (arg.startsWith("--name=")) {
      opts.name = splitOption(arg)[1];
      continue;
    }
    if (arg === "--name") {
      opts.name = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--entrypoint=")) {
      opts.entrypointMode = "set";
      opts.entrypointValue = splitOption(arg)[1];
      if (!opts.entrypointValue) opts.entrypointMode = "clear";
      continue;
    }
    if (arg === "--entrypoint") {
      const next = argv[i + 1];
      if (next != null && !next.startsWith("-")) {
        opts.entrypointMode = "set";
        opts.entrypointValue = next;
        i += 1;
      } else {
        opts.entrypointMode = "clear";
        opts.entrypointValue = "";
      }
      continue;
    }
    if (arg.startsWith("--bind=")) {
      opts.binds.push(arg);
      continue;
    }
    if (arg === "-v" || arg === "-b" || arg === "--volume") {
      i += 1;
      const vol = argv[i] || "";
      if (/^[^/]+:/.test(vol)) {
        const idx = vol.indexOf(":");
        const vname = vol.slice(0, idx);
        const vsuffix = vol.slice(idx);
        const realb = path.join(process.env.HOME || "", ".udocker", "volumes", vname);
        fs.mkdirSync(realb, { recursive: true });
        opts.binds.push(`--bind=${realb}${vsuffix}`);
      } else if (vol) {
        opts.binds.push(`--bind=${vol}`);
      }
      continue;
    }
    if (arg === "-e" || arg === "--env") {
      i += 1;
      if (argv[i] != null) opts.envs.push(argv[i]);
      continue;
    }
    if (arg === "--rm") {
      opts.remove = true;
      continue;
    }
    if (arg === "-p") {
      i += 1;
      const portMap = argv[i] || "";
      const parts = portMap.split(":");
      const hostp = Number(parts[0]);
      const contp = Number(parts[parts.length - 1]);
      const portdiff = hostp - contp;
      if (Number.isFinite(portdiff) && portdiff > 1000) {
        opts.portAdd = `${portdiff}`;
      }
      continue;
    }
    if (arg === "-w" || arg === "--workdir") {
      i += 1;
      opts.workdir = argv[i] || "";
      continue;
    }
    if (arg === "--isolated") {
      opts.isolated = true;
      continue;
    }
    if (arg === "--proot") {
      opts.forceProot = true;
      continue;
    }
  }

  return { opts, rest };
}

function getScriptPair(isolated) {
  return isolated
    ? {
        shell: path.join(scriptsDir, "srpri"),
        cmd: path.join(scriptsDir, "srprci"),
      }
    : {
        shell: path.join(scriptsDir, "srpr"),
        cmd: path.join(scriptsDir, "srprc"),
      };
}

async function askYesNo(question, defaultYes = true) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const suffix = defaultYes ? " (Y/n) " : " (y/N) ";
    const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return !answer.startsWith("n");
  } finally {
    rl.close();
  }
}

function ensureDns(rootfs) {
  const etcResolv = path.join(rootfs, "etc", "resolv.conf");
  const tmpResolv = path.join(rootfs, "tmp", "resolv.conf");
  const content = "nameserver 1.1.1.1\nnameserver 8.8.8.8\n";

  if (!fileExists(etcResolv) || fs.statSync(etcResolv).size === 0) {
    fs.writeFileSync(etcResolv, content);
  }
  if (!fileExists(tmpResolv) || fs.statSync(tmpResolv).size === 0) {
    fs.writeFileSync(tmpResolv, content);
  }
}

async function ensureNonPrimaryUser(rootfs) {
  if (!(/\/data\/user\/[^0][0-9]*\/./).test(process.cwd())) 
    return;
  
  console.error("Non-primary user, disabling apt sandbox");
  
  await spawnWait("sh", [
    path.join(scriptsDir, "srprc"),
    rootfs,
    "sh",
    "-c",
    "which apt && echo 'APT::Sandbox::User \"root\";' > /etc/apt/apt.conf.d/99no-sandbox",
  ], {
    stdio: "inherit",
    env: process.env,
  });
}

async function runUdocker(args, captureStdout = false) {
  return spawnWait(process.execPath, [udockerJs, ...args], {
    stdio: captureStdout ? ["inherit", "pipe", "inherit"] : "inherit",
    env: process.env,
  });
}

async function runProudockerCreate(args) {
  if (dirExists("/data/data/com.termux")) {
    return spawnWait("proot", ["-l", "-S", "/", process.execPath, udockerJs, ...args], {
      stdio: ["inherit", "pipe", "inherit"],
      env: process.env,
    });
  }

  const shr = process.env.shr;
  const pkgRdir = process.env.PKG_RDIR;
  if (!shr || !pkgRdir) {
    throw new Error("Missing shr/PKG_RDIR for proot create");
  }

  return spawnWait("sh", [
    shr,
    "proot",
    "-l",
    "-S",
    "/",
    `--bind=${path.join(pkgRdir, "bin", "mksh")}:/system/bin/sh`,
    `--bind=${path.join(pkgRdir, "bin", "toybox")}:/system/bin/toybox`,
    "/bin/sh",
    shr,
    "node",
    udockerJs,
    ...args,
  ], {
    stdio: ["inherit", "pipe", "inherit"],
    env: process.env,
  });
}

function getContainerRoot(containerId) {
  return path.join(udroot, containerId, "ROOT");
}

function removeContainerWritable(containerId) {
  const containerDir = path.join(udroot, containerId);
  if (dirExists(containerDir)) {
    childProcess.spawnSync("chmod", ["-R", "777", containerDir], {
      stdio: "inherit",
      env: process.env,
    });
  }
}

async function removeContainer(containerId, label = containerId) {
  console.error(`Removing container ${label}...`);
  removeContainerWritable(containerId);
  await runUdocker(["rm", containerId]);
}

function checkContainerBinaries(rootfs) {
  console.error("Checking /usr/bin/env /bin/sh: ");
  const envRes = childProcess.spawnSync("ls", [path.join(rootfs, "usr", "bin", "env")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    encoding: "utf8",
  });
  if (envRes.stdout) process.stderr.write(envRes.stdout);
  if (envRes.stderr) process.stderr.write(envRes.stderr);
  const shRes = childProcess.spawnSync("ls", [path.join(rootfs, "bin", "sh")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    encoding: "utf8",
  });
  if (shRes.stdout) process.stderr.write(shRes.stdout);
  if (shRes.stderr) process.stderr.write(shRes.stderr);
  return envRes.status === 0 && shRes.status === 0;
}

function loadContainerConfig(containerId) {
  const jsonPath = path.join(udroot, containerId, "container.json");
  let cfg = {};
  if (fileExists(jsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      cfg = parsed.config || {};
    } catch {
      cfg = {};
    }
  }
  return {
    jsonPath,
    cfg,
  };
}

function buildFinalArgs(cfg, entrypointMode, entrypointValue, userArgs) {
  let entryp = [];
  let cmd = [];

  cmd = normArgList(cfg.Cmd);
  if (entrypointMode === "meta") {
    entryp = normArgList(cfg.Entrypoint);
  } else if (entrypointMode === "set") {
    entryp = parseEntrypointValue(entrypointValue);
  } else {
    entryp = [];
  }

  let finalArgs = [];
  if (userArgs.length > 0) {
    finalArgs = entryp.concat(userArgs);
  } else if (entryp.length > 0) {
    finalArgs = entryp.concat(cmd);
  } else if (cmd.length > 0) {
    finalArgs = cmd;
  }


  if (Array.isArray(cfg.Env) && finalArgs.length > 0) {
    finalArgs.unshift("/usr/bin/env", ...cfg.Env);
  }


  if(finalArgs.some(i=>i.includes('\n')))
  {
    process.env.PROOT_ESCAPE_NEWLINE="1";
  }
  else
  {
    process.env.PROOT_ESCAPE_NEWLINE="";
  }


  return finalArgs;
}

function formatDisplayArgs(args) {
  return args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ");
}

async function createContainer(distro, name, forceProot) {
  const pullRes = await runUdocker(["pull", distro]);
  if (pullRes.code !== 0) return { code: pullRes.code || 1 };

  console.error(`Creating container from ${distro} as ${name || ""}`);

  const createArgs = ["create"];
  if (name) createArgs.push(`--name=${name}`);
  createArgs.push(distro);

  let createRes;
  if (!forceProot) {
    createRes = await runUdocker(createArgs, true);
  } else {
    console.error("  Using proot, may be slow...");
    createRes = await runProudockerCreate(createArgs);
  }
  
  if (createRes.code !== 0)
    console.error( createRes.code || 1 ) ;

  const cid = (createRes.stdout || "").trim() || name;
  if (!cid) return { code: 1 };

  const rootfs = getContainerRoot(cid);
  if (!checkContainerBinaries(rootfs)) {
    if (!forceProot) {
      console.error(`*** Failed to create from ${distro} ***`);
      await removeContainer(cid);

      console.error("  Using proot, may be slow...");
      const retryRes = await runProudockerCreate(createArgs);
      if (retryRes.code !== 0) return { code: retryRes.code || 1 };
      return {
        code: 0,
        cid: (retryRes.stdout || "").trim() || name,
      };
    }
  }

  return { code: 0, cid };
}

function makeScriptEnv(opts) {
  const env = { ...process.env , PROOT_TMP_DIR: process.env.TMPDIR || "" };
  if (opts.binds.length > 0) env.PROOT_EXTRA_BIND = opts.binds.join("\n");
  if (opts.envs.length > 0) env.PROOT_EXTRA_ENV = opts.envs.join("\n");
  if (opts.portAdd) env.PROOT_PORT_ADD = opts.portAdd;
  return env;
}

async function launchScript(script, args, env, removeAfter, cid, label = cid) {
  const res = await spawnWait("sh", [script, ...args], {
    stdio: "inherit",
    env,
  });

  if (removeAfter && cid) {
    await removeContainer(cid, label);
  }
  return res.code || 0;
}

export async function runMain(argv = process.argv.slice(2)) {
  const { opts, rest } = parseRunArgs(argv);
  if (rest.length === 0) {
    console.error("Error: run requires a container/image name");
    return 1;
  }

  let target = rest[0];
  let userArgs = rest.slice(1);
  let cid = "";
  let rootfs = "";
  let containerName = "";
  let isManagedContainer = false;
  let containerLabel = "";
  const scripts = getScriptPair(opts.isolated);

  if (dirExists(path.join(udroot, target))) {
    cid = target;
    isManagedContainer = true;
    containerLabel = target;
  } else {
    const pkgRdir = process.env.PKG_RDIR || "";
    const prootDir = pkgRdir ? path.join(pkgRdir, "proot", target) : "";
    if (target && prootDir && dirExists(prootDir)) {
      const reply = await askYesNo(`Do you want to launch proot/${target} ?`, true);
      if (reply) {
        rootfs = prootDir;
        containerName = `proot/${target}`;
        containerLabel = containerName;
        ensureDns(rootfs);
        await ensureNonPrimaryUser(rootfs);

        const env = makeScriptEnv(opts);
        if (userArgs.length === 0) {
          console.error("");
          console.error(`Running ${containerName} with cmdline:`);
          console.error("\x1b[33m  /bin/sh -l \x1b[0m");
          console.error("");
          return launchScript(scripts.shell, [rootfs], env, false, "", containerLabel);
        }

        console.error("");
        console.error(`Running ${containerName} with cmdline:`);
        console.error(`\x1b[33m  ${formatDisplayArgs(userArgs)} \x1b[0m`);
        console.error("");
        return launchScript(scripts.cmd, [rootfs, ...userArgs], env, false, "", containerLabel);
      }
    }

    const distro = target.split("@", 1)[0];
    const created = await createContainer(distro, opts.name, opts.forceProot);
    if (created.code !== 0 || !created.cid) return created.code || 1;
    cid = created.cid;
    isManagedContainer = true;
  }

  rootfs = getContainerRoot(cid);
  containerLabel = containerLabel || opts.name || target || cid;
  containerName = containerLabel;

  ensureDns(rootfs);
  await ensureNonPrimaryUser(rootfs);

  const { jsonPath, cfg } = loadContainerConfig(cid);
  const finalArgs = buildFinalArgs(cfg, opts.entrypointMode, opts.entrypointValue, userArgs);

  if (cfg.WorkingDir && fileExists(jsonPath)) {
    fs.writeFileSync(path.join(path.dirname(jsonPath), "WORKDIR"), cfg.WorkingDir);
  }

  let wd = opts.workdir;
  if (!wd) {
    try {
      wd = fs.readFileSync(path.join(udroot, cid, "WORKDIR"), "utf8").trim();
    } catch {
      wd = "";
    }
  }
  if (wd && dirExists(path.join(rootfs, wd))) {
    opts.binds.push(`--cwd=${wd}`);
  }

  const env = makeScriptEnv(opts);

  if (finalArgs.length === 0) {
    console.error("");
    console.error(`Running ${containerName} with cmdline:`);
    console.error("\x1b[33m  /bin/sh -l \x1b[0m");
    console.error("");
    return launchScript(scripts.shell, [rootfs], env, opts.remove && isManagedContainer, cid, containerLabel);
  }

  console.error("");
  console.error(`Running ${containerName} with cmdline:`);
  console.error(`\x1b[33m  ${formatDisplayArgs(finalArgs)} \x1b[0m`);
  console.error("");
  return launchScript(scripts.cmd, [rootfs, ...finalArgs], env, opts.remove && isManagedContainer, cid, containerLabel);
}

if (process.argv[1] === __filename) {
  const code = await runMain(process.argv.slice(2));
  process.exitCode = code;
}
