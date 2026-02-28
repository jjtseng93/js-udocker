const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync, spawnSync } = require("child_process");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function readJson(p) {
  try {
    const data = fs.readFileSync(p, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data));
}

function writeFile(p, data) {
  fs.writeFileSync(p, data);
}

function removePath(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function listDir(p) {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function execTarList(tarfile) {
  try {
    const out = execFileSync("tar", ["-tf", tarfile], { encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function execTarExtract(tarfile, destdir) {
  const args = [
    "-C",
    destdir,
    "-xf",
    tarfile,
    "--no-same-owner",
    "--overwrite",
    "--exclude=dev/*",
    "--exclude=etc/udev/devices/*",
    "--no-same-permissions",
    "--exclude=.wh.*",
  ];
  const res = spawnSync("tar", args, { stdio: "inherit" });
  return res.status === 0;
}

function execTarExtractStdin(destdir) {
  const args = [
    "-C",
    destdir,
    "-xf",
    "-",
    "--no-same-owner",
    "--overwrite",
    "--exclude=dev/*",
    "--exclude=etc/udev/devices/*",
    "--no-same-permissions",
    "--exclude=.wh.*",
  ];
  const res = spawnSync("tar", args, { stdio: "inherit" });
  return res.status === 0;
}

function execTarCreate(srcdir, outfile) {
  const args = ["-C", srcdir, "-cf", outfile, "."];
  if (outfile === "-") args[3] = "-";
  const res = spawnSync("tar", args, { stdio: "inherit" });
  return res.status === 0;
}

function chmodLayerTree(destdir) {
  try {
    spawnSync(
      "find",
      [
        destdir,
        "(",
        "-type",
        "d",
        "!",
        "-perm",
        "-u=x",
        "-exec",
        "chmod",
        "u+x",
        "{}",
        ";",
        ")",
        ",",
        "(",
        "!",
        "-perm",
        "-u=w",
        "-exec",
        "chmod",
        "u+w",
        "{}",
        ";",
        ")",
        ",",
        "(",
        "!",
        "-perm",
        "-u=r",
        "-exec",
        "chmod",
        "u+r",
        "{}",
        ";",
        ")",
        ",",
        "(",
        "-name",
        ".wh.*",
        "-exec",
        "rm",
        "-f",
        "--preserve-root",
        "{}",
        ";",
        ")",
      ],
      { stdio: "inherit" }
    );
  } catch {
    // best effort
  }
}

function duSizeMb(dir) {
  try {
    const out = execFileSync("du", ["-s", "-m", "-x", dir], { encoding: "utf8" });
    const size = parseInt(out.trim().split(/\s+/)[0], 10);
    return Number.isFinite(size) ? size : -1;
  } catch {
    return -1;
  }
}

module.exports = {
  ensureDir,
  isDir,
  isFile,
  isSymlink,
  readJson,
  writeJson,
  writeFile,
  removePath,
  listDir,
  uuid,
  execTarList,
  execTarExtract,
  execTarExtractStdin,
  execTarCreate,
  chmodLayerTree,
  duSizeMb,
};
