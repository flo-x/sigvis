"use strict";
class DashboardStorageService {
  constructor(storageAdapter) {
    this.storageAdapter = storageAdapter;
  }

  async listDashboards() {
    return this.storageAdapter.listNames();
  }

  async loadDashboard(name) {
    return this.storageAdapter.loadByName(name);
  }

  async saveDashboard(name, dashboard) {
    if (!name || typeof name !== "string") {
      throw new Error("A non-empty dashboard name is required.");
    }

    if (!dashboard || typeof dashboard !== "object") {
      throw new Error("Dashboard payload must be an object.");
    }

    if (!Array.isArray(dashboard.widgets)) {
      throw new Error("Dashboard payload must include a widgets array.");
    }

    return this.storageAdapter.saveByName(name, dashboard);
  }

  async deleteDashboard(name) {
    if (!name || typeof name !== "string") {
      throw new Error("A non-empty dashboard name is required.");
    }
    return this.storageAdapter.deleteByName(name);
  }
}

module.exports = {
  DashboardStorageService
};
