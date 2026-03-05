const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { Msg } = require("./msg");
const { ensureDir, isFile, writeJson, readJson, removePath, execTarCreate, execTarExtract, execTarExtractStdin } = require("./util");

function mkTempDir(prefix = "bunudocker-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(filename) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filename, "r");
  const buf = Buffer.alloc(1024 * 1024);
  let bytes = 0;
  while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
    hash.update(buf.subarray(0, bytes));
  }
  fs.closeSync(fd);
  return hash.digest("hex");
}

function readStdinToFile(outfile) {
  const data = fs.readFileSync(0);
  fs.writeFileSync(outfile, data);
}

function parsePlatform(platform) {
  if (!platform) return ["", "", ""];
  const parts = String(platform).toLowerCase().split("/");
  if (parts.length === 3) return [parts[0], parts[1], parts[2]];
  if (parts.length === 2) return [parts[0], parts[1], ""];
  return [parts[0] || "", "", ""];
}

function defaultPlatform() {
  let osname = process.platform === "win32" ? "windows" : process.platform;
  if (osname === "android") osname = "linux";
  const archMap = { x64: "amd64", arm64: "arm64", arm: "arm", ia32: "386" };
  const arch = archMap[process.arch] || process.arch;
  return [osname, arch, ""];
}

class LocalFileApi {
  constructor(localrepo) {
    this.localrepo = localrepo;
  }

  importToImage(tarfile, imagerepo, tag, platform = "") {
    if (!tarfile) return false;
    if (tarfile !== "-" && !isFile(tarfile)) {
      Msg.err("Error: tar file does not exist:", tarfile);
      return false;
    }
    this.localrepo.setup_imagerepo(imagerepo);
    if (this.localrepo.cd_imagerepo(imagerepo, tag)) {
      Msg.err("Error: tag already exists in repo:", tag);
      return false;
    }
    if (!this.localrepo.setup_tag(tag) || !this.localrepo.set_version("v2")) {
      Msg.err("Error: creating repo and tag");
      return false;
    }

    const tmpDir = mkTempDir();
    const tmpTar = path.join(tmpDir, "import.tar");
    if (tarfile === "-") {
      readStdinToFile(tmpTar);
      tarfile = tmpTar;
    }

    const layerHash = sha256File(tarfile);
    const layerDigest = `sha256:${layerHash}`;
    const layerFile = path.join(this.localrepo.layersdir, layerDigest);
    ensureDir(this.localrepo.layersdir);
    if (!isFile(layerFile)) {
      fs.copyFileSync(tarfile, layerFile);
    }
    this.localrepo.add_image_layer(layerFile);

    const [pOs, pArch, pVar] = platform ? parsePlatform(platform) : defaultPlatform();
    const config = {
      created: new Date().toISOString(),
      architecture: pArch || "unknown",
      os: pOs || "unknown",
      rootfs: { type: "layers", diff_ids: [layerDigest] },
      config: {},
    };
    if (pVar) config.variant = pVar;
    const configJson = JSON.stringify(config);
    const configDigest = `sha256:${sha256Buffer(Buffer.from(configJson))}`;
    const configFile = path.join(this.localrepo.cur_tagdir, configDigest);
    fs.writeFileSync(configFile, configJson);

    const manifest = {
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: {
        mediaType: "application/vnd.oci.image.config.v1+json",
        size: Buffer.byteLength(configJson),
        digest: configDigest,
      },
      layers: [
        {
          mediaType: "application/vnd.oci.image.layer.v1.tar",
          size: fs.statSync(layerFile).size,
          digest: layerDigest,
        },
      ],
    };
    this.localrepo.save_json("manifest", manifest);

    removePath(tmpDir);
    return true;
  }

  exportContainer(containerDir, tarfile) {
    const rootDir = path.join(containerDir, "ROOT");
    if (!tarfile) return false;
    return execTarCreate(rootDir, tarfile);
  }

  load(imagefile, imagerepo = "") {
    if (!imagefile) return [];
    if (imagefile !== "-" && !isFile(imagefile)) {
      Msg.err("Error: image file does not exist:", imagefile);
      return [];
    }
    const tmpDir = mkTempDir();
    const ok = imagefile === "-" ? execTarExtractStdin(tmpDir) : execTarExtract(imagefile, tmpDir);
    if (!ok) {
      Msg.err("Error: failed to extract image:", imagefile);
      removePath(tmpDir);
      return [];
    }
    const manifestFile = path.join(tmpDir, "manifest.json");
    const manifestList = readJson(manifestFile);
    if (!manifestList || !Array.isArray(manifestList)) {
      Msg.err("Error: manifest.json missing or invalid");
      removePath(tmpDir);
      return [];
    }

    const loaded = [];
    for (const entry of manifestList) {
      const repoTags = entry.RepoTags || [];
      const layers = entry.Layers || [];
      const configPath = entry.Config || "";

      const useTags = imagerepo
        ? repoTags.length
          ? repoTags.map((t) => `${imagerepo}:${t.split(":").slice(1).join(":") || "latest"}`)
          : [`${imagerepo}:latest`]
        : repoTags.length
        ? repoTags
        : ["IMPORTED:latest"];

      for (const repotag of useTags) {
        const [repo, tag] = repotag.split(":", 2);
        this.localrepo.setup_imagerepo(repo);
        if (this.localrepo.cd_imagerepo(repo, tag)) {
          Msg.err("Error: repository and tag already exist", repo, tag);
          continue;
        }
        if (!this.localrepo.setup_tag(tag) || !this.localrepo.set_version("v2")) {
          Msg.err("Error: setting repository version");
          continue;
        }

        const layerDigests = [];
        for (const layerRel of layers) {
          const layerTar = path.join(tmpDir, layerRel);
          if (!isFile(layerTar)) {
            Msg.err("Error: layer file missing", layerRel);
            layerDigests.length = 0;
            break;
          }
          const hash = sha256File(layerTar);
          const digest = `sha256:${hash}`;
          const dest = path.join(this.localrepo.layersdir, digest);
          ensureDir(this.localrepo.layersdir);
          if (!isFile(dest)) fs.copyFileSync(layerTar, dest);
          this.localrepo.add_image_layer(dest);
          layerDigests.push({ digest, size: fs.statSync(dest).size });
        }
        if (!layerDigests.length) continue;

        let configJson = {};
        const configAbs = configPath ? path.join(tmpDir, configPath) : "";
        if (configAbs && isFile(configAbs)) {
          try {
            configJson = JSON.parse(fs.readFileSync(configAbs, "utf8"));
          } catch {
            configJson = {};
          }
        }
        const configStr = JSON.stringify(configJson);
        const configDigest = `sha256:${sha256Buffer(Buffer.from(configStr))}`;
        const configFile = path.join(this.localrepo.cur_tagdir, configDigest);
        fs.writeFileSync(configFile, configStr);

        const manifest = {
          schemaVersion: 2,
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          config: {
            mediaType: "application/vnd.oci.image.config.v1+json",
            size: Buffer.byteLength(configStr),
            digest: configDigest,
          },
          layers: layerDigests.map((l) => ({
            mediaType: "application/vnd.oci.image.layer.v1.tar",
            size: l.size,
            digest: l.digest,
          })),
        };
        this.localrepo.save_json("manifest", manifest);
        loaded.push(`${repo}:${tag}`);
      }
    }
    removePath(tmpDir);
    return loaded;
  }

  save(imagetagList, imagefile) {
    if (!imagetagList?.length) return false;
    if (imagefile !== "-" && isFile(imagefile)) {
      Msg.err("Error: output file already exists:", imagefile);
      return false;
    }
    const tmpDir = mkTempDir();
    const manifestEntries = [];
    const repos = {};

    for (const [imagerepo, tag] of imagetagList) {
      if (!this.localrepo.cd_imagerepo(imagerepo, tag)) {
        Msg.err("Error: image not found:", imagerepo, tag);
        continue;
      }
      const manifest = this.localrepo.load_json("manifest");
      if (!manifest || !manifest.layers) {
        Msg.err("Error: manifest missing or unsupported for image", imagerepo, tag);
        continue;
      }
      const layerPaths = [];
      for (const layer of manifest.layers) {
        const digest = layer.digest;
        const linkPath = path.join(this.localrepo.cur_tagdir, digest);
        if (!isFile(linkPath)) {
          Msg.err("Error: layer missing:", digest);
          layerPaths.length = 0;
          break;
        }
        const id = digest.replace("sha256:", "");
        const layerDir = path.join(tmpDir, id);
        ensureDir(layerDir);
        fs.copyFileSync(linkPath, path.join(layerDir, "layer.tar"));
        fs.writeFileSync(path.join(layerDir, "VERSION"), "1.0");
        fs.writeFileSync(path.join(layerDir, "json"), "{}");
        layerPaths.push(`${id}/layer.tar`);
      }
      if (!layerPaths.length) continue;

      let configJson = {};
      if (manifest.config?.digest) {
        const cfgPath = path.join(this.localrepo.cur_tagdir, manifest.config.digest);
        if (isFile(cfgPath)) {
          try {
            configJson = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
          } catch {
            configJson = {};
          }
        }
      }
      const configStr = JSON.stringify(configJson);
      const configDigest = `sha256:${sha256Buffer(Buffer.from(configStr))}`;
      const configFileName = `${configDigest.replace("sha256:", "")}.json`;
      fs.writeFileSync(path.join(tmpDir, configFileName), configStr);

      manifestEntries.push({
        Config: configFileName,
        RepoTags: [`${imagerepo}:${tag}`],
        Layers: layerPaths,
      });
      if (!repos[imagerepo]) repos[imagerepo] = {};
      repos[imagerepo][tag] = layerPaths[layerPaths.length - 1].split("/")[0];
    }

    if (!manifestEntries.length) {
      removePath(tmpDir);
      return false;
    }
    fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify(manifestEntries, null, 2));
    fs.writeFileSync(path.join(tmpDir, "repositories"), JSON.stringify(repos, null, 2));

    const ok = execTarCreate(tmpDir, imagefile);
    removePath(tmpDir);
    return ok;
  }
}

module.exports = { LocalFileApi };
