#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { LocalRepository } = require("./lib/localrepo");
const { DockerApi } = require("./lib/dockerapi");
const { ContainerStructure } = require("./lib/container");
const { LocalFileApi } = require("./lib/localfile");
const { Msg } = require("./lib/msg");

function usage() {
  Msg.out("Usage:");
  Msg.out("  udocker pull [--platform=os/arch[/variant]] [--registry=URL] [--pull=missing|always|never] [-q|--quiet] <repo/image:tag>");
  Msg.out("  udocker create [--name=NAME] [--force] <repo/image:tag>");
  Msg.out("  udocker import <tar> <repo/image:tag>");
  Msg.out("  udocker import - <repo/image:tag>");
  Msg.out("  udocker export -o <tar> <container>");
  Msg.out("  udocker export - <container>");
  Msg.out("  udocker load -i <exported-image>");
  Msg.out("  udocker load");
  Msg.out("  udocker save -o <imagefile> <repo/image:tag>");
  Msg.out("  udocker inspect -p <repo/image:tag|container>");
  Msg.out("  udocker verify <repo/image:tag>");
  Msg.out("  udocker manifest inspect <repo/image:tag>");
  Msg.out("  udocker ps");
  Msg.out("  udocker images [-l] [-p] [--all] [--no-trunc]");
  Msg.out("  udocker rm <container-id|name>");
  Msg.out("  udocker rmi <repo/image:tag>");
  Msg.out("  udocker rename <container-id|name> <new-name>");
  Msg.out("  udocker help");
  Msg.out("");
  Msg.out("Commands:");
  Msg.out("  pull      Download image layers and metadata");
  Msg.out("            Options: --platform, --registry, --index, --pull, -q, --quiet");
  Msg.out("  import    Import tar file (docker export) into an image");
  Msg.out("  export    Export container directory tree to tar");
  Msg.out("  load      Load image from file or stdin (docker save format)");
  Msg.out("  save      Save image with layers to file (docker save format)");
  Msg.out("  inspect   Print image or container metadata");
  Msg.out("  verify    Verify a pulled image");
  Msg.out("  manifest  Print manifest metadata");
  Msg.out("  create    Create a container from a pulled image");
  Msg.out("            Options: --name, --force");
  Msg.out("  images    List local images");
  Msg.out("            Options: -l, -p, --all, --no-trunc");
  Msg.out("  ps        List local containers");
  Msg.out("  rm        Remove a local container by id or name");
  Msg.out("  rmi       Remove a local image by repository and tag");
  Msg.out("  rename    Rename a local container");
  Msg.out("");
  Msg.out("Examples:");
  Msg.out("  udocker pull alpine");
  Msg.out("  udocker pull --platform=linux/arm64 alpine:latest");
  Msg.out("  udocker create --name=myap alpine");
  Msg.out("  udocker images -p");
  Msg.out("  udocker ps");
  Msg.out("  udocker rename myap myapp");
  Msg.out("  udocker rm myapp");
  Msg.out("  udocker rmi alpine:latest");
}

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-") {
      positional.push(arg);
      continue;
    }
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const k = arg.slice(2, eqIdx);
        const v = arg.slice(eqIdx + 1);
        opts[k] = v;
      } else {
        const k = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          opts[k] = next;
          i += 1;
        } else {
          opts[k] = true;
        }
      }
    } else if (arg.startsWith("-")) {
      const short = arg.slice(1);
      if ((short === "o" || short === "i") && argv[i + 1] && !argv[i + 1].startsWith("-")) {
        opts[short] = argv[i + 1];
        i += 1;
      } else {
        opts[short] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { opts, positional };
}

function checkImageSpec(dockerApi, imagespec) {
  if (!imagespec) return [null, null];
  let imagerepo = "";
  let tag = "";
  if (imagespec.includes("@")) {
    [imagerepo, tag] = imagespec.split("@", 2);
  } else if (imagespec.includes(":")) {
    [imagerepo, tag] = imagespec.split(":", 2);
  } else {
    imagerepo = imagespec;
    tag = "latest";
  }
  if (!imagerepo || !tag) return [null, null];
  if (!(dockerApi.is_repo_name(imagespec) || dockerApi.is_layer_name(imagespec))) return [null, null];
  return [imagerepo, tag];
}

function normalizePullPolicy(value) {
  if (!value || value === true) return "missing";
  const v = String(value).toLowerCase();
  if (v === "reuse") return "missing";
  if (v === "missing" || v === "always" || v === "never") return v;
  return "";
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    usage();
    process.exitCode = 1;
    return;
  }

  const cmd = argv[0];
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    usage();
    process.exitCode = 0;
    return;
  }
  const { opts, positional } = parseArgs(argv.slice(1));
  if (opts.q || opts.quiet) {
    Msg.level = Msg.ERR;
  }

  const localrepo = new LocalRepository();
  localrepo.createRepo();
  const dockerApi = new DockerApi(localrepo);
  const localfile = new LocalFileApi(localrepo);

  if (cmd === "pull") {
    const imagespec = positional[0];
    const [imagerepo, tag] = checkImageSpec(dockerApi, imagespec);
    if (!imagerepo) {
      Msg.err("Error: must specify image:tag or repository/image:tag");
      process.exitCode = 1;
      return;
    }
    if (opts.registry) {
      const reg = String(opts.registry);
      dockerApi.set_registry(reg.includes("://") ? reg : `https://${reg}`);
    }
    if (opts.index) {
      const idx = String(opts.index);
      dockerApi.set_index(idx.includes("://") ? idx : `https://${idx}`);
    }
    const platform = opts.platform || "";
    const pullPolicy = normalizePullPolicy(opts.pull);
    if (!pullPolicy) {
      Msg.err("Error: invalid --pull policy (missing|always|never)");
      process.exitCode = 1;
      return;
    }
    const files = await dockerApi.get(imagerepo, tag, platform, pullPolicy);
    if (!files || files.length === 0) {
      Msg.err("Error: no files downloaded");
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
    return;
  }

  if (cmd === "create") {
    const imagespec = positional[0];
    const name = opts.name || "";
    const force = Boolean(opts.force);
    const [imagerepo, tag] = checkImageSpec(dockerApi, imagespec);
    if (!imagerepo) {
      Msg.err("Error: must specify image:tag or repository/image:tag");
      process.exitCode = 1;
      return;
    }
    if (!force && name && localrepo.get_container_id(name)) {
      Msg.err("Error: container name already exists");
      process.exitCode = 1;
      return;
    }
    const containerId = new ContainerStructure(localrepo).create_fromimage(imagerepo, tag);
    if (!containerId) {
      process.exitCode = 1;
      return;
    }
    Msg.out(containerId);
    if (name) {
      const ok = localrepo.set_container_name(containerId, name);
      if (!ok && !force) {
        Msg.err("Error: invalid container name or wrong format");
        process.exitCode = 1;
        return;
      }
    }
    process.exitCode = 0;
    return;
  }

  if (cmd === "import") {
    const tarfile = positional[0];
    const imagespec = positional[1];
    if (!tarfile || !imagespec) {
      Msg.err("Error: must specify tar file and image:tag");
      process.exitCode = 1;
      return;
    }
    const [imagerepo, tag] = checkImageSpec(dockerApi, imagespec);
    if (!imagerepo) {
      Msg.err("Error: must specify image:tag or repository/image:tag");
      process.exitCode = 1;
      return;
    }
    const platform = opts.platform || "";
    const ok = localfile.importToImage(tarfile, imagerepo, tag, platform);
    if (!ok) {
      Msg.err("Error: importing");
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
    return;
  }

  if (cmd === "export") {
    const toFile = Boolean(opts.o);
    let tarfile = toFile ? String(opts.o) : "-";
    let containerName = toFile ? positional[0] : positional[0];
    if (!toFile && positional[0] === "-") {
      tarfile = "-";
      containerName = positional[1];
    }
    if (!containerName) {
      Msg.err("Error: must specify container id or name");
      process.exitCode = 1;
      return;
    }
    if (toFile && (tarfile === "true" || !tarfile)) {
      Msg.err("Error: must specify output tar file");
      process.exitCode = 1;
      return;
    }
    const containerId = localrepo.get_container_id(containerName);
    if (!containerId) {
      Msg.err("Error: invalid container id or name");
      process.exitCode = 1;
      return;
    }
    const containerDir = localrepo.cd_container(containerId);
    if (!containerDir) {
      Msg.err("Error: container not found");
      process.exitCode = 1;
      return;
    }
    if (!tarfile) {
      Msg.err("Error: invalid output file name");
      process.exitCode = 1;
      return;
    }
    const ok = localfile.exportContainer(containerDir, tarfile);
    if (!ok) {
      Msg.err("Error: exporting");
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
    return;
  }

  if (cmd === "load") {
    let imagefile = opts.i || opts.input || "-";
    if (imagefile === true) imagefile = "-";
    if (positional[0] === "-" || opts["-"]) imagefile = "-";
    const imagerepo = positional[0] && positional[0] !== "-" ? positional[0] : "";
    const repos = localfile.load(imagefile, imagerepo);
    if (!repos || repos.length === 0) {
      Msg.err("Error: load failed");
      process.exitCode = 1;
      return;
    }
    for (const repo of repos) Msg.out(repo);
    process.exitCode = 0;
    return;
  }

  if (cmd === "save") {
    const imagefile = opts.o || opts.output || "-";
    const imagespec = positional[0];
    if (imagefile === true) {
      Msg.err("Error: must specify output file for -o/--output");
      process.exitCode = 1;
      return;
    }
    if (!imagespec) {
      Msg.err("Error: must specify image:tag");
      process.exitCode = 1;
      return;
    }
    const [imagerepo, tag] = checkImageSpec(dockerApi, imagespec);
    if (!imagerepo) {
      Msg.err("Error: must specify image:tag or repository/image:tag");
      process.exitCode = 1;
      return;
    }
    const ok = localfile.save([[imagerepo, tag]], imagefile);
    if (!ok) {
      Msg.err("Error: save failed");
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
    return;
  }

  if (cmd === "inspect") {
    const target = positional[0];
    const printDir = Boolean(opts.p);
    if (!target) {
      Msg.err("Error: must specify container id or image:tag");
      process.exitCode = 1;
      return;
    }
    const containerId = localrepo.get_container_id(target);
    if (containerId) {
      const containerDir = localrepo.cd_container(containerId);
      if (printDir) {
        Msg.out(path.join(containerDir, "ROOT"));
        process.exitCode = 0;
        return;
      }
      const jsonPath = path.join(containerDir, "container.json");
      if (fs.existsSync(jsonPath)) {
        Msg.out(fs.readFileSync(jsonPath, "utf8"));
        process.exitCode = 0;
        return;
      }
      Msg.err("Error: container metadata not found");
      process.exitCode = 1;
      return;
    }
    const [imagerepo, tag] = checkImageSpec(dockerApi, target);
    if (!imagerepo || !localrepo.cd_imagerepo(imagerepo, tag)) {
      Msg.err("Error: image not found", imagerepo || target);
      process.exitCode = 1;
      return;
    }
    const [containerJson] = localrepo.get_image_attributes();
    if (!containerJson) {
      Msg.err("Error: image metadata not found");
      process.exitCode = 1;
      return;
    }
    Msg.out(JSON.stringify(containerJson, null, 2));
    process.exitCode = 0;
    return;
  }

  if (cmd === "verify") {
    const imagespec = positional[0];
    const [imagerepo, tag] = checkImageSpec(dockerApi, imagespec);
    if (!imagerepo) {
      Msg.err("Error: must specify image:tag or repository/image:tag");
      process.exitCode = 1;
      return;
    }
    Msg.out(`Info: verifying: ${imagerepo}:${tag}`, { l: Msg.INF });
    if (!localrepo.cd_imagerepo(imagerepo, tag)) {
      Msg.err("Error: selecting image and tag");
      process.exitCode = 1;
      return;
    }
    if (localrepo.verify_image()) {
      Msg.out("Info: image Ok", { l: Msg.INF });
      process.exitCode = 0;
      return;
    }
    Msg.err("Error: image verification failure");
    process.exitCode = 1;
    return;
  }

  if (cmd === "manifest") {
    const sub = positional[0];
    const imagespec = positional[1];
    if (sub !== "inspect") {
      Msg.err("Error: manifest subcommand must be inspect");
      process.exitCode = 1;
      return;
    }
    const [imagerepo, tag] = checkImageSpec(dockerApi, imagespec);
    if (!imagerepo) {
      Msg.err("Error: must specify image:tag or repository/image:tag");
      process.exitCode = 1;
      return;
    }
    if (opts.registry) {
      const reg = String(opts.registry);
      dockerApi.set_registry(reg.includes("://") ? reg : `https://${reg}`);
    }
    if (opts.index) {
      const idx = String(opts.index);
      dockerApi.set_index(idx.includes("://") ? idx : `https://${idx}`);
    }
    const platform = opts.platform || "";
    const { remoterepo } = dockerApi._parse_imagerepo(imagerepo);
    const { manifest } = await dockerApi.get_v2_image_manifest(remoterepo, tag, platform);
    if (!manifest) {
      Msg.err("Error: manifest not found");
      process.exitCode = 1;
      return;
    }
    Msg.out(JSON.stringify(manifest, null, 2));
    process.exitCode = 0;
    return;
  }

  if (cmd === "ps") {
    const list = localrepo.get_containers_list(false);
    const header = ["CONTAINER ID".padEnd(36), "NAMES".padEnd(20), "IMAGE"];
    Msg.out(header.join(" "));
    for (const [id, image, names] of list) {
      const row = [String(id).padEnd(36), (names || "-").padEnd(20), image || "-"];
      Msg.out(row.join(" "));
    }
    process.exitCode = 0;
    return;
  }

  if (cmd === "images") {
    const verbose = Boolean(opts.l);
    const printPlatform = Boolean(opts.p);
    opts["no-trunc"]; // accepted for compatibility
    opts.all; // accepted for compatibility
    const imagesList = localrepo.get_imagerepos();
    Msg.out("REPOSITORY");
    for (const [imagerepo, tag] of imagesList) {
      const prot = localrepo.isprotected_imagerepo(imagerepo, tag) ? "P" : ".";
      const imagerepoDir = localrepo.cd_imagerepo(imagerepo, tag);
      if (printPlatform) {
        const platform = localrepo.get_image_platform_fmt();
        Msg.out(`${String(platform).padEnd(18).slice(0, 18)} ${prot} ${imagerepo}:${tag}`);
      } else {
        Msg.out(`${imagerepo}:${tag}    ${prot}`);
      }
      if (verbose) {
        Msg.out(` ${imagerepoDir}`);
        const layersList = localrepo.get_layers(imagerepo, tag);
        for (const [layerName, size] of layersList) {
          let fileSizeMb = Math.floor(Number(size || 0) / (1024 * 1024));
          if (!fileSizeMb && size) fileSizeMb = 1;
          Msg.out(`    ${layerName.replace(imagerepoDir, "")} (${fileSizeMb} MB)`);
        }
      }
    }
    process.exitCode = 0;
    return;
  }

  if (cmd === "rm") {
    const target = positional[0];
    if (!target) {
      Msg.err("Error: must specify container id or name");
      process.exitCode = 1;
      return;
    }
    const containerId = localrepo.get_container_id(target);
    if (!containerId) {
      Msg.err("Error: container id or name not found");
      process.exitCode = 1;
      return;
    }
    const ok = localrepo.del_container(containerId, false);
    if (!ok) {
      Msg.err("Error: removing container");
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
    return;
  }

  if (cmd === "rmi") {
    const imagespec = positional[0];
    const [imagerepo, tag] = checkImageSpec(dockerApi, imagespec);
    if (!imagerepo) {
      Msg.err("Error: must specify image:tag or repository/image:tag");
      process.exitCode = 1;
      return;
    }
    if (!localrepo.cd_imagerepo(imagerepo, tag)) {
      Msg.err("Error: image not found");
      process.exitCode = 1;
      return;
    }
    const ok = localrepo.del_imagerepo(imagerepo, tag, false);
    if (!ok) {
      Msg.err("Error: removing image");
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
    return;
  }

  if (cmd === "rename") {
    const name = positional[0];
    const newName = positional[1];
    if (!name || !newName) {
      Msg.err("Error: invalid container id or name");
      process.exitCode = 1;
      return;
    }
    const containerId = localrepo.get_container_id(name);
    if (!containerId) {
      Msg.err("Error: container does not exist");
      process.exitCode = 1;
      return;
    }
    if (localrepo.get_container_id(newName)) {
      Msg.err("Error: new name already exists");
      process.exitCode = 1;
      return;
    }
    
    localrepo.del_container_name(name);

    if (!localrepo.set_container_name(containerId, newName)) {
      Msg.err("Error: setting new name");
      localrepo.set_container_name(containerId, name);
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((err) => {
  Msg.err(String(err?.stack || err));
  process.exitCode = 1;
});
