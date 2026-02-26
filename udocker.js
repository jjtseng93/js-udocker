#!/usr/bin/env node
const { LocalRepository } = require("./lib/localrepo");
const { DockerApi } = require("./lib/dockerapi");
const { ContainerStructure } = require("./lib/container");
const { Msg } = require("./lib/msg");

function usage() {
  Msg.out("Usage:");
  Msg.out("  udocker pull [--platform=os/arch[/variant]] [--registry=URL] <repo/image:tag>");
  Msg.out("  udocker create [--name=NAME] [--force] <repo/image:tag>");
  Msg.out("  udocker ps");
  Msg.out("  udocker images [-l] [-p] [--all] [--no-trunc]");
  Msg.out("  udocker rm <container-id|name>");
  Msg.out("  udocker rmi <repo/image:tag>");
  Msg.out("  udocker rename <container-id|name> <new-name>");
  Msg.out("  udocker help");
  Msg.out("");
  Msg.out("Commands:");
  Msg.out("  pull      Download image layers and metadata");
  Msg.out("            Options: --platform, --registry, --index");
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
      opts[arg.slice(1)] = true;
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

  const localrepo = new LocalRepository();
  localrepo.createRepo();
  const dockerApi = new DockerApi(localrepo);

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
    const files = await dockerApi.get(imagerepo, tag, platform);
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
    if (!localrepo.del_container_name(name)) {
      Msg.err("Error: name does not exist");
      process.exitCode = 1;
      return;
    }
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
