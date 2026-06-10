"use strict";

const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("node:path");
const https = require("node:https");

// Set data directory to user's app data folder before loading the server,
// so all persistent files (dashboards, generators, processors, settings)
// are stored outside the app bundle and survive updates.
process.env.DATA_DIR = app.getPath("userData");

// Use a dedicated port to avoid clashing with a separately-running server instance.
if (!process.env.PORT) {
  process.env.PORT = "3131";
}

const { start } = require("../server/src/index");

// ── Update check ─────────────────────────────────────────────────────────────
// Compares the running version against the latest GitHub release.
// If a newer version exists, shows a native dialog with a download link.
// No code-signing or auto-download is required.

const GITHUB_OWNER = "OWNER";   // TODO: replace with your GitHub username / org
const GITHUB_REPO  = "REPO";    // TODO: replace with your repository name

function compareVersions(a, b) {
  // Returns true when b is strictly newer than a.
  const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
  const [aMaj, aMin, aPatch = 0] = parse(a);
  const [bMaj, bMin, bPatch = 0] = parse(b);
  if (bMaj !== aMaj) return bMaj > aMaj;
  if (bMin !== aMin) return bMin > aMin;
  return bPatch > aPatch;
}

function checkForUpdates(win) {
  if (GITHUB_OWNER === "OWNER" || GITHUB_REPO === "REPO") {
    // GitHub repo not configured yet — skip silently.
    return;
  }

  const options = {
    hostname: "api.github.com",
    path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    headers: { "User-Agent": `Sigvis/${app.getVersion()}` },
  };

  const req = https.get(options, (res) => {
    let body = "";
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => {
      try {
        const release = JSON.parse(body);
        const latestTag = release.tag_name;
        const currentVersion = app.getVersion();
        if (latestTag && compareVersions(currentVersion, latestTag)) {
          dialog.showMessageBox(win, {
            type: "info",
            title: "Update available",
            message: `Version ${latestTag} is available`,
            detail: `You are running v${currentVersion}. Download the new version from the releases page.`,
            buttons: ["Download", "Later"],
            defaultId: 0,
            cancelId: 1,
          }).then(({ response }) => {
            if (response === 0) {
              shell.openExternal(
                `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
              );
            }
          });
        }
      } catch {
        // Ignore parse errors — update check is best-effort.
      }
    });
  });

  req.on("error", () => {
    // Network unavailable or rate-limited — skip silently.
  });

  req.end();
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(`http://localhost:${port}`);

  // Check for updates a few seconds after the window is ready so the app
  // feels responsive before showing any dialog.
  win.webContents.once("did-finish-load", () => {
    setTimeout(() => checkForUpdates(win), 3000);
  });

  return win;
}

app.whenReady().then(async () => {
  let port = Number(process.env.PORT);
  try {
    const result = await start();
    port = result.PORT;
  } catch (err) {
    dialog.showErrorBox(
      "Failed to start server",
      `The embedded server could not start:\n\n${err.message}`
    );
    app.quit();
    return;
  }

  createWindow(port);

  app.on("activate", () => {
    // macOS: re-create the window when the dock icon is clicked and no windows are open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(port);
    }
  });
});

app.on("window-all-closed", () => {
  // On macOS apps conventionally stay open until the user quits explicitly.
  if (process.platform !== "darwin") {
    app.quit();
  }
});
