const fs = require("fs");
const path = require("path");
const { Msg } = require("./msg");
const { uuid, execTarList, execTarExtract, chmodLayerTree, removePath, isDir } = require("./util");

class ContainerStructure {
  constructor(localrepo, container_id = null) {
    this.localrepo = localrepo;
    this.container_id = container_id;
    this.imagerepo = "";
    this.tag = "";
  }

  _apply_whiteouts(tarfile, destdir) {
    const entries = execTarList(tarfile);
    for (const entry of entries) {
      const base = path.basename(entry);
      const dir = path.dirname(entry);
      if (base === ".wh..wh..opq") {
        const targetDir = path.join(destdir, dir);
        if (!isDir(targetDir)) continue;
        for (const name of fs.readdirSync(targetDir)) {
          removePath(path.join(targetDir, name));
        }
      } else if (base.startsWith(".wh.")) {
        const target = path.join(destdir, dir, base.replace(".wh.", ""));
        removePath(target);
      }
    }
  }

  _untar_layers(tarfiles, destdir) {
    if (!tarfiles?.length || !destdir) return false;
    let status = true;
    for (const tarf of tarfiles) {
      if (tarf !== "-") this._apply_whiteouts(tarf, destdir);
      Msg.out("Info: extracting:", tarf, { l: Msg.INF });
      const ok = execTarExtract(tarf, destdir);
      if (!ok) {
        Msg.err("Error: while extracting image layer");
        status = false;
      }
      chmodLayerTree(destdir);
    }
    return status;
  }

  create_fromimage(imagerepo, tag) {
    this.imagerepo = imagerepo;
    this.tag = tag;
    const imageDir = this.localrepo.cd_imagerepo(imagerepo, tag);
    if (!imageDir) {
      Msg.err("Error: create container: imagerepo is invalid");
      return false;
    }
    const [containerJson, layerFiles] = this.localrepo.get_image_attributes();
    if (!containerJson || !layerFiles) {
      Msg.err("Error: create container: getting layers or json");
      return false;
    }
    if (!this.container_id) this.container_id = uuid();
    const containerDir = this.localrepo.setup_container(imagerepo, tag, this.container_id);
    if (!containerDir) {
      Msg.err("Error: create container: setting up container");
      return false;
    }
    fs.writeFileSync(path.join(containerDir, "container.json"), JSON.stringify(containerJson));
    const status = this._untar_layers(layerFiles, path.join(containerDir, "ROOT"));
    if (!status) {
      Msg.err("Error: creating container:", this.container_id);
    }
    return this.container_id;
  }
}

module.exports = { ContainerStructure };
