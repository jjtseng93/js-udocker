const http = require("http");
const https = require("https");
const { URL } = require("url");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { conf } = require("./config");
const { Msg } = require("./msg");
const { ensureDir, isFile, removePath } = require("./util");

class DockerApi {
  constructor(localrepo) {
    this.index_url = conf.dockerio_index_url;
    this.registry_url = conf.dockerio_registry_url;
    this.localrepo = localrepo;
    this.v2_token_cache = new Map();
  }

  set_registry(registry_url) {
    this.registry_url = registry_url;
  }

  set_index(index_url) {
    this.index_url = index_url;
  }

  is_repo_name(imagerepo) {
    return Boolean(imagerepo && /^[a-zA-Z0-9][a-zA-Z0-9-_./:]+$/.test(imagerepo));
  }

  is_layer_name(layername) {
    return Boolean(layername && /^[a-zA-Z0-9]+@[a-z0-9]+:[a-z0-9]+$/.test(layername));
  }

  _parse_imagerepo(imagerepo) {
    let registry = "";
    let registry_url = "";
    let index_url = "";
    const components = imagerepo.split("/");
    if (components[0] && components[0].includes(".") && components.length >= 2) {
      registry = components.shift();
    }
    if (components[0] !== "library" && components.length === 1) {
      if (!registry || registry.includes("docker.io") || registry.includes("docker.com")) {
        components.unshift("library");
      }
    }
    const remoterepo = components.join("/");
    if (registry) {
      if (conf.docker_registries[registry]) {
        registry_url = conf.docker_registries[registry][0];
        index_url = conf.docker_registries[registry][1];
      } else {
        registry_url = registry.includes("://") ? registry : `https://${registry}`;
        index_url = registry_url;
      }
      if (registry_url) this.registry_url = registry_url;
      if (index_url) this.index_url = index_url;
    }
    return { imagerepo, remoterepo };
  }

  async _request(urlStr, options = {}) {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    const headers = options.headers || {};
    const method = options.method || "GET";
    const maxRedirects = options.maxRedirects ?? 3;
    const destFile = options.destFile || null;

    return new Promise((resolve, reject) => {
      const req = lib.request(
        url,
        {
          method,
          headers,
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
            res.resume();
            const redirectUrl = new URL(res.headers.location, url);
            const nextHeaders = { ...headers };
            if (nextHeaders.Authorization) {
              delete nextHeaders.Authorization;
            }
            return resolve(
              this._request(redirectUrl.toString(), {
                ...options,
                headers: nextHeaders,
                maxRedirects: maxRedirects - 1,
              })
            );
          }

          if (destFile) {
            ensureDir(path.dirname(destFile));
            const file = fs.createWriteStream(destFile);
            res.pipe(file);
            file.on("finish", () => file.close(() => resolve({ status: res.statusCode, headers: res.headers })));
            file.on("error", (err) => reject(err));
          } else {
            const chunks = [];
            res.on("data", (d) => chunks.push(d));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
          }
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  _parse_www_authenticate(header) {
    if (!header || !header.startsWith("Bearer")) return null;
    const params = {};
    const parts = header.replace("Bearer", "").trim().split(",");
    for (const p of parts) {
      const [k, v] = p.split("=").map((s) => s.trim());
      if (!k || !v) continue;
      params[k] = v.replace(/^"|"$/g, "");
    }
    return params;
  }

  async _get_v2_token(wwwAuthenticate) {
    const params = this._parse_www_authenticate(wwwAuthenticate);
    if (!params?.realm) return "";
    const url = new URL(params.realm);
    if (params.service) url.searchParams.set("service", params.service);
    if (params.scope) url.searchParams.set("scope", params.scope);
    const cacheKey = url.toString();
    if (this.v2_token_cache.has(cacheKey)) return this.v2_token_cache.get(cacheKey);
    const res = await this._request(url.toString(), { headers: { Accept: "application/json" } });
    if (res.status !== 200 || !res.body) return "";
    let token = "";
    try {
      const data = JSON.parse(res.body.toString("utf8"));
      token = data.token || data.access_token || "";
    } catch {
      token = "";
    }
    if (token) this.v2_token_cache.set(cacheKey, token);
    return token;
  }

  async _request_with_auth(urlStr, options = {}) {
    let res = await this._request(urlStr, options);
    if (res.status !== 401) return res;
    const authHeader = res.headers["www-authenticate"];
    const token = await this._get_v2_token(authHeader);
    if (!token) return res;
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
    return this._request(urlStr, { ...options, headers });
  }

  async _sha256_file(filename) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filename);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  async _verify_digest(filename, layer_id) {
    if (!isFile(filename)) return false;
    if (!layer_id || !layer_id.startsWith("sha256:")) return true;
    const expected = layer_id.slice("sha256:".length);
    try {
      const actual = await this._sha256_file(filename);
      return actual === expected;
    } catch {
      return false;
    }
  }

  async is_v2() {
    const res = await this._request_with_auth(`${this.registry_url}/v2/`, { headers: { Accept: "application/json" } });
    return res.status === 200 || res.status === 401;
  }

  _parse_platform(platform) {
    if (!platform) return ["", "", ""];
    const parts = platform.toLowerCase().split("/");
    const mapOs = (os) => (os === "android" ? "linux" : os);
    if (parts.length === 3) return [mapOs(parts[0]), parts[1], parts[2]];
    if (parts.length === 2) return [mapOs(parts[0]), parts[1], ""];
    return [mapOs(parts[0] || ""), "", ""];
  }

  _select_manifest_from_index(index, platform) {
    const [pOs, pArch, pVar] = this._parse_platform(platform);
    if (!index?.manifests) return "";
    for (const m of index.manifests) {
      const mp = m.platform || {};
      if (pOs && (mp.os || "").toLowerCase() !== pOs) continue;
      if (pArch && (mp.architecture || "").toLowerCase() !== pArch) continue;
      if (pVar && (mp.variant || "").toLowerCase() !== pVar) continue;
      return m.digest;
    }
    return "";
  }

  async get_v2_image_manifest(imagerepo, tag, platform) {
    const headers = {
      Accept: [
        "application/vnd.docker.distribution.manifest.v2+json",
        "application/vnd.docker.distribution.manifest.v1+prettyjws",
        "application/json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.oci.image.index.v1+json",
      ].join(", "),
    };
    const url = `${this.registry_url}/v2/${imagerepo}/manifests/${tag}`;
    const res = await this._request_with_auth(url, { headers });
    if (!res.body) return { status: res.status, headers: res.headers, manifest: null };
    const contentType = res.headers["content-type"] || "";
    let manifest = null;
    try {
      manifest = JSON.parse(res.body.toString("utf8"));
    } catch {
      manifest = null;
    }
    if (contentType.includes("manifest.list.v2") || contentType.includes("oci.image.index")) {
      if (!platform) return { status: res.status, headers: res.headers, manifest };
      const digest = this._select_manifest_from_index(manifest, platform);
      if (!digest) return { status: res.status, headers: res.headers, manifest: null };
      return this.get_v2_image_manifest(imagerepo, digest, platform);
    }
    return { status: res.status, headers: res.headers, manifest };
  }

  async get_v2_image_layer(imagerepo, layer_id, pullPolicy = "missing") {
    const filename = path.join(this.localrepo.layersdir, layer_id);
    if (isFile(filename)) {
      const okCached = await this._verify_digest(filename, layer_id);
      if (okCached) {
        if (pullPolicy !== "always") {
          Msg.out("Info: using cached layer", layer_id, { l: Msg.INF });
          this.localrepo.add_image_layer(filename);
          return true;
        }
        Msg.out("Info: re-downloading layer (policy=always)", layer_id, { l: Msg.INF });
        removePath(filename);
      } else {
        removePath(filename);
        Msg.out("Warning: cached layer invalid, re-downloading", layer_id, { l: Msg.WAR });
        if (pullPolicy === "never") return false;
      }
    } else if (pullPolicy === "never") {
      Msg.err("Error: layer missing and pull policy is never", layer_id);
      return false;
    }
    const url = `${this.registry_url}/v2/${imagerepo}/blobs/${layer_id}`;
    const res = await this._request_with_auth(url, { destFile: filename });
    if (res.status !== 200) return false;
    const okDownloaded = await this._verify_digest(filename, layer_id);
    if (!okDownloaded) {
      removePath(filename);
      return false;
    }
    this.localrepo.add_image_layer(filename);
    return true;
  }

  async get_v2_layers_all(imagerepo, fslayers, pullPolicy = "missing") {
    const files = [];
    for (const layer of fslayers) {
      const blob = layer.blobSum || layer.digest;
      Msg.out("Info: downloading layer", blob, { l: Msg.INF });
      const ok = await this.get_v2_image_layer(imagerepo, blob, pullPolicy);
      if (!ok) return [];
      files.push(blob);
    }
    return files;
  }

  async get_v2(imagerepo, tag, platform, pullPolicy = "missing") {
    const { status, manifest } = await this.get_v2_image_manifest(imagerepo, tag, platform);
    if (status === 401) {
      Msg.err("Error: manifest not found or not authorized");
      return [];
    }
    if (status !== 200 || !manifest) {
      Msg.err("Error: pulling manifest:");
      return [];
    }
    if (!(this.localrepo.setup_tag(tag) && this.localrepo.set_version("v2"))) {
      Msg.err("Error: setting localrepo v2 tag and version");
      return [];
    }
    this.localrepo.save_json("manifest", manifest);
    if (manifest.fsLayers) {
      return this.get_v2_layers_all(imagerepo, [...manifest.fsLayers].reverse(), pullPolicy);
    }
    if (manifest.layers) {
      const layers = [...manifest.layers];
      if (manifest.config) layers.push(manifest.config);
      return this.get_v2_layers_all(imagerepo, layers, pullPolicy);
    }
    Msg.err("Error: layers section missing in manifest");
    return [];
  }

  async get(imagerepo, tag, platform, pullPolicy = "missing") {
    const parsed = this._parse_imagerepo(imagerepo);
    const localImagerepo = parsed.imagerepo;
    const remoteRepo = parsed.remoterepo;
    if (!platform) {
      let os = process.platform === "win32" ? "windows" : process.platform;
      if (os === "android") os = "linux";
      const archMap = { x64: "amd64", arm64: "arm64", arm: "arm", ia32: "386" };
      const arch = archMap[process.arch] || process.arch;
      platform = `${os}/${arch}`;
    }
    let newRepo = false;
    if (!this.localrepo.cd_imagerepo(localImagerepo, tag)) {
      this.localrepo.setup_imagerepo(localImagerepo);
      newRepo = true;
    }
    const files = await this.get_v2(remoteRepo, tag, platform, pullPolicy);
    if (newRepo && !files.length) {
      return [];
    }
    return files;
  }
}

module.exports = { DockerApi };
