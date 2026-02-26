const os = require("os");
const path = require("path");

const homedir = path.join(os.homedir(), ".udocker");
const conf = {
  verbose_level: 3,
  homedir,
  topdir: homedir,
  bindir: null,
  libdir: null,
  docdir: null,
  reposdir: null,
  layersdir: null,
  containersdir: null,
  dockerio_index_url: "https://hub.docker.com",
  dockerio_registry_url: "https://registry-1.docker.io",
  docker_registries: {
    "docker.io": ["https://registry-1.docker.io", "https://hub.docker.com"],
  },
};

function resolveDirs() {
  if (!conf.bindir) conf.bindir = path.join(conf.topdir, "bin");
  if (!conf.libdir) conf.libdir = path.join(conf.topdir, "lib");
  if (!conf.docdir) conf.docdir = path.join(conf.topdir, "doc");
  if (!conf.reposdir) conf.reposdir = path.join(conf.topdir, "repos");
  if (!conf.layersdir) conf.layersdir = path.join(conf.topdir, "layers");
  if (!conf.containersdir) conf.containersdir = path.join(conf.topdir, "containers");
}

resolveDirs();

module.exports = { conf, resolveDirs };
