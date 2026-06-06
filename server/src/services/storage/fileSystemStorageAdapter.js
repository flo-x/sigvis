"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");

class FileSystemStorageAdapter {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  async ensureDir() {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  nameToFile(name) {
    return `${encodeURIComponent(name)}.json`;
  }

  fileToName(file) {
    return decodeURIComponent(file.replace(/\.json$/i, ""));
  }

  async listNames() {
    await this.ensureDir();
    const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
    const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));

    const results = await Promise.allSettled(
      jsonFiles.map(async (entry) => {
        const fullPath = path.join(this.baseDir, entry.name);
        const raw = await fs.readFile(fullPath, "utf8");
        const parsed = JSON.parse(raw);
        return {
          name: parsed.name || this.fileToName(entry.name),
          savedAt: parsed.savedAt || null
        };
      })
    );

    const dashboards = results
      .filter((r) => {
        if (r.status === "rejected") {
          console.warn("[FileSystemStorageAdapter] Skipping unreadable dashboard file:", r.reason?.message ?? r.reason);
          return false;
        }
        return true;
      })
      .map((r) => r.value);

    return dashboards.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
  }

  async loadByName(name) {
    await this.ensureDir();
    const target = path.join(this.baseDir, this.nameToFile(name));
    const raw = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(raw);
    return {
      name: parsed.name || name,
      savedAt: parsed.savedAt || null,
      dashboard: parsed.dashboard
    };
  }

  async saveByName(name, dashboard) {
    await this.ensureDir();
    const target = path.join(this.baseDir, this.nameToFile(name));
    const payload = {
      name,
      savedAt: new Date().toISOString(),
      dashboard
    };
    await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  }

  async deleteByName(name) {
    await this.ensureDir();
    const target = path.join(this.baseDir, this.nameToFile(name));
    await fs.unlink(target);
  }
}

module.exports = {
  FileSystemStorageAdapter
};
