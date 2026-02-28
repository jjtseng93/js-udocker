const path = require("path");
const fs = require("fs");
const { conf, resolveDirs } = require("./config");
const { Msg } = require("./msg");
const {
  ensureDir,
  isDir,
  isFile,
  isSymlink,
  readJson,
  writeJson,
  writeFile,
  removePath,
  listDir,
  duSizeMb,
} = require("./util");

class LocalRepository {
  constructor(topdir = null) {
    if (topdir) conf.topdir = topdir;
    resolveDirs();
    this.topdir = conf.topdir;
    this.bindir = conf.bindir;
    this.libdir = conf.libdir;
    this.docdir = conf.docdir;
    this.reposdir = conf.reposdir;
    this.layersdir = conf.layersdir;
    this.containersdir = conf.containersdir;
    this.homedir = conf.homedir;
    this.cur_repodir = "";
    this.cur_tagdir = "";
    this.cur_containerdir = "";
  }

  setup(topdir) {
    return new LocalRepository(topdir);
  }

  createRepo() {
    try {
      ensureDir(this.topdir);
      ensureDir(this.reposdir);
      ensureDir(this.layersdir);
      ensureDir(this.containersdir);
      ensureDir(this.bindir);
      ensureDir(this.libdir);
      ensureDir(this.docdir);
      return true;
    } catch {
      return false;
    }
  }

  isRepo() {
    return [this.reposdir, this.layersdir, this.containersdir, this.bindir, this.libdir].every(isDir);
  }

  _isTag(tagDir) {
    try {
      return isFile(path.join(tagDir, "TAG"));
    } catch {
      return false;
    }
  }

  isprotected_imagerepo(imagerepo, tag) {
    if (!imagerepo || !tag) return false;
    return isFile(path.join(this.reposdir, imagerepo, tag, "PROTECT"));
  }

  _get_tags(tagDir) {
    const tagList = [];
    if (!isDir(tagDir)) return tagList;
    for (const name of listDir(tagDir)) {
      const p = path.join(tagDir, name);
      if (this._isTag(p)) {
        const rel = path.relative(this.reposdir, tagDir);
        tagList.push([rel, name]);
      } else if (isDir(p)) {
        tagList.push(...this._get_tags(p));
      }
    }
    return tagList;
  }

  get_imagerepos() {
    return this._get_tags(this.reposdir);
  }

  get_layers(imagerepo, tag) {
    const layers = [];
    const tagDir = this.cd_imagerepo(imagerepo, tag);
    if (!tagDir) return layers;
    for (const name of listDir(tagDir)) {
      const filename = path.join(tagDir, name);
      if (isSymlink(filename)) {
        try {
          layers.push([filename, fs.statSync(filename).size]);
        } catch {
          // ignore broken links
        }
      }
    }
    return layers;
  }

  cd_imagerepo(imagerepo, tag) {
    if (!imagerepo || !tag) return "";
    const tagDir = path.join(this.reposdir, imagerepo, tag);
    if (isDir(tagDir) && this._isTag(tagDir)) {
      this.cur_repodir = path.join(this.reposdir, imagerepo);
      this.cur_tagdir = tagDir;
      return this.cur_tagdir;
    }
    return "";
  }

  setup_imagerepo(imagerepo) {
    if (!imagerepo) return null;
    const dir = path.join(this.reposdir, imagerepo);
    try {
      ensureDir(dir);
      this.cur_repodir = dir;
      return true;
    } catch {
      return null;
    }
  }

  setup_tag(tag) {
    const dir = path.join(this.cur_repodir, tag);
    try {
      ensureDir(dir);
      this.cur_tagdir = dir;
      writeFile(path.join(dir, "TAG"), `${this.cur_repodir}:${tag}`);
      return true;
    } catch {
      return false;
    }
  }

  set_version(version) {
    if (!this.cur_tagdir) return false;
    try {
      writeFile(path.join(this.cur_tagdir, version), "");
      return true;
    } catch {
      return false;
    }
  }

  save_json(filename, data) {
    const out = path.isAbsolute(filename) ? filename : path.join(this.cur_tagdir, filename);
    try {
      writeJson(out, data);
      return true;
    } catch {
      return false;
    }
  }

  load_json(filename) {
    const inFile = path.isAbsolute(filename) ? filename : path.join(this.cur_tagdir, filename);
    return readJson(inFile);
  }

  add_image_layer(filename, linkname = null) {
    if (!this.cur_tagdir) return false;
    if (!isFile(filename)) return false;
    const base = path.basename(linkname || filename);
    const linkPath = path.join(this.cur_tagdir, base);
    try {
      if (isSymlink(linkPath) || isFile(linkPath)) removePath(linkPath);
      const target = path.relative(path.dirname(linkPath), filename);
      fs.symlinkSync(target, linkPath);
      return true;
    } catch {
      return false;
    }
  }

  get_image_attributes() {
    const dir = this.cur_tagdir;
    if (!dir) return [null, null];
    if (isFile(path.join(dir, "v1"))) {
      return [null, null];
    }
    if (isFile(path.join(dir, "v2"))) {
      const manifest = this.load_json("manifest");
      if (!manifest) return [null, null];
      if (manifest.fsLayers) {
        const files = [];
        for (const layer of [...manifest.fsLayers].reverse()) {
          const layerFile = path.join(dir, layer.blobSum);
          if (!isFile(layerFile)) return [null, null];
          files.push(layerFile);
        }
        let containerJson = null;
        try {
          const jsonString = manifest.history?.[0]?.v1Compatibility?.trim();
          if (jsonString) containerJson = JSON.parse(jsonString);
        } catch {
          containerJson = null;
        }
        return [containerJson, files];
      }
      if (manifest.layers) {
        const files = [];
        for (const layer of manifest.layers) {
          const layerFile = path.join(dir, layer.digest);
          if (!isFile(layerFile)) return [null, null];
          files.push(layerFile);
        }
        let containerJson = null;
        if (manifest.config?.digest) {
          const jsonFile = path.join(dir, manifest.config.digest);
          containerJson = readJson(jsonFile);
        }
        return [containerJson, files];
      }
    }
    return [null, null];
  }

  get_image_platform_fmt() {
    const [manifestJson] = this.get_image_attributes();
    if (!manifestJson) return "unknown/unknown";
    const os = manifestJson.os || "unknown";
    const arch = manifestJson.architecture || "unknown";
    const variant = manifestJson.variant || "";
    return variant ? `${os}/${arch}/${variant}` : `${os}/${arch}`;
  }

  verify_image() {
    if (!this.cur_tagdir) return false;
    const manifest = this.load_json("manifest");
    if (!manifest) {
      Msg.err("Error: manifest is empty or missing");
      return false;
    }
    const layers = manifest.layers || [];
    for (const layer of layers) {
      const digest = layer.digest || layer.blobSum;
      if (!digest) {
        Msg.err("Error: layer digest missing in manifest");
        return false;
      }
      const layerLink = path.join(this.cur_tagdir, digest);
      if (!isFile(layerLink)) {
        Msg.err("Error: layer file missing", digest);
        return false;
      }
    }
    if (manifest.config?.digest) {
      const cfg = path.join(this.cur_tagdir, manifest.config.digest);
      if (!isFile(cfg)) {
        Msg.err("Error: config file missing", manifest.config.digest);
        return false;
      }
    }
    return true;
  }

  setup_container(imagerepo, tag, container_id) {
    const containerDir = path.join(this.containersdir, String(container_id));
    if (isDir(containerDir)) return "";
    try {
      ensureDir(path.join(containerDir, "ROOT"));
      writeFile(path.join(containerDir, "imagerepo.name"), `${imagerepo}:${tag}`);
      this.cur_containerdir = containerDir;
      return containerDir;
    } catch {
      return null;
    }
  }

  get_containers_list(dir_only = true) {
    const containers = [];
    if (!isDir(this.containersdir)) return containers;
    for (const name of listDir(this.containersdir)) {
      const p = path.join(this.containersdir, name);
      if (isDir(p)) {
        if (dir_only) {
          containers.push(p);
        } else if (!isSymlink(p)) {
          let reponame = "";
          try {
            reponame = fs.readFileSync(path.join(p, "imagerepo.name"), "utf8");
          } catch {
            reponame = "";
          }
          const names = this.get_container_name(name);
          containers.push([name, reponame.trim(), names.join(",")]);
        }
      }
    }
    return containers;
  }

  _name_is_valid(name) {
    return Boolean(name && /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(name));
  }

  get_container_id(container_name) {
    if (!container_name) return "";
    const p = path.join(this.containersdir, container_name);
    if (isSymlink(p)) {
      return path.basename(fs.readlinkSync(p));
    }
    if (isDir(p)) return container_name;
    return "";
  }

  get_container_name(container_id) {
    if (!isDir(this.containersdir)) return [];
    const list = [];
    for (const name of listDir(this.containersdir)) {
      const p = path.join(this.containersdir, name);
      if (isSymlink(p)) {
        const real = fs.readlinkSync(p);
        if (path.basename(real) === container_id) list.push(name);
      }
    }
    return list;
  }

  set_container_name(container_id, name) {
    if (!this._name_is_valid(name)) return false;
    const containerDir = this.cd_container(container_id);
    if (!containerDir) return false;
    const linkname = path.join(this.containersdir, name);
    if (isDir(linkname) || isSymlink(linkname)) return false;
    try {
      const target = path.relative(path.dirname(linkname), containerDir);
      fs.symlinkSync(target, linkname);
      return true;
    } catch {
      return false;
    }
  }

  del_container_name(name) {
    if (!this._name_is_valid(name)) return false;
    const linkname = path.join(this.containersdir, name);
    if (isSymlink(linkname)) {
      return removePath(linkname);
    }
    return false;
  }

  cd_container(container_id) {
    const dir = path.join(this.containersdir, String(container_id));
    if (isDir(dir)) return dir;
    return "";
  }

  isprotected_container(container_id) {
    const dir = this.cd_container(container_id);
    return dir ? isFile(path.join(dir, "PROTECT")) : false;
  }

  iswriteable_container(container_id) {
    const root = path.join(this.containersdir, String(container_id), "ROOT");
    try {
      fs.accessSync(root, fs.constants.W_OK);
      return 1;
    } catch {
      return isDir(root) ? 0 : 2;
    }
  }

  get_size(container_id) {
    const root = path.join(this.containersdir, String(container_id), "ROOT");
    return duSizeMb(root);
  }

  del_container(container_id, force = false) {
    const containerDir = this.cd_container(container_id);
    if (!containerDir) return false;
    for (const name of this.get_container_name(container_id)) {
      this.del_container_name(name);
    }
    if (!force && this.isprotected_container(container_id)) return false;
    return removePath(containerDir);
  }

  _find(filename, inDir) {
    const found = [];
    if (!isDir(inDir)) return found;
    for (const name of listDir(inDir)) {
      const p = path.join(inDir, name);
      try {
        if (isSymlink(p)) {
          if (name.includes(filename)) found.push(p);
        } else if (isDir(p)) {
          found.push(...this._find(filename, p));
        }
      } catch {
        // ignore
      }
    }
    return found;
  }

  _inrepository(filename) {
    return this._find(filename, this.reposdir);
  }

  _remove_layers(tagDir, force) {
    for (const fname of listDir(tagDir)) {
      const p = path.join(tagDir, fname);
      if (isSymlink(p)) {
        let linkname = "";
        try {
          linkname = fs.readlinkSync(p);
        } catch {
          linkname = "";
        }
        const layerFile = path.join(tagDir, linkname);
        if (!removePath(p) && !force) return false;
        if (linkname && this._inrepository(path.basename(linkname)).length === 0) {
          if (!removePath(layerFile) && !force) return false;
        }
      }
    }
    return true;
  }

  del_imagerepo(imagerepo, tag, force = false) {
    const tagDir = this.cd_imagerepo(imagerepo, tag);
    if (!tagDir) return false;
    if (!this._remove_layers(tagDir, force)) return false;
    if (!removePath(tagDir) && !force) return false;
    this.cur_repodir = "";
    this.cur_tagdir = "";
    let repo = imagerepo;
    while (repo) {
      const dir = path.join(this.reposdir, repo);
      try {
        fs.rmdirSync(dir);
      } catch {
        break;
      }
      const parts = repo.split("/");
      parts.pop();
      repo = parts.join("/");
    }
    return true;
  }
}

module.exports = { LocalRepository };
