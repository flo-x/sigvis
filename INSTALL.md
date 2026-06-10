# Sigvis — Installation Guide

This guide covers all four ways to run Sigvis:

| Scenario | Who it's for |
|---|---|
| [Desktop app — Windows](#desktop-app--windows) | Single user on a Windows PC |
| [Desktop app — macOS](#desktop-app--macos) | Single user on a Mac |
| [Desktop app — Linux](#desktop-app--linux) | Single user on a Linux desktop |
| [Server-browser](#server-browser) | Shared deployment; multiple browsers connect to one server |

In all desktop variants the app runs entirely on your local machine — no internet connection is required after installation.

---

## Desktop app — Windows

### Requirements

- Windows 10 or later (64-bit)
- No additional software required

### Install

1. Go to the [Releases page](https://github.com/OWNER/REPO/releases/latest) and download the file named `Sigvis-Setup-x.y.z.exe`.
2. Double-click the downloaded file to run the installer.
3. **Windows SmartScreen warning** — because the app is not yet code-signed, Windows may show a blue dialog saying *"Windows protected your PC"*. Click **More info**, then **Run anyway**. This appears once per installer version.
4. Follow the installer prompts. You can choose the installation directory and whether to create a desktop shortcut.
5. After installation, launch Sigvis from the Start menu or the desktop shortcut.

### Data storage

All persistent data (saved dashboards, generator and processor definitions, server settings) is stored in:

```
%APPDATA%\Sigvis
```

For example: `C:\Users\YourName\AppData\Roaming\Sigvis`

This folder is not affected by app updates or uninstalls, so your data is preserved.

### Updates

When a new version is available, the app shows a dialog on startup:

> *"Version x.y.z is available — click Download to open the releases page."*

Click **Download** to open the releases page in your browser, download the new installer, and run it. Your data folder is unchanged.

### Uninstall

Use **Settings → Apps** or the classic **Control Panel → Programs → Uninstall a program**. Your data in `%APPDATA%\Sigvis` is not removed; delete that folder manually if you want a clean uninstall.

---

## Desktop app — macOS

### Requirements

- macOS 10.15 Catalina or later
- Intel (x64) or Apple Silicon (arm64)
- No additional software required

### Install

1. Go to the [Releases page](https://github.com/OWNER/REPO/releases/latest) and download the file named `Sigvis-x.y.z.dmg` (choose the `arm64` variant for Apple Silicon Macs, or `x64` for Intel).
2. Open the `.dmg` file. A window appears showing the Sigvis icon and an Applications folder shortcut.
3. Drag **Sigvis** into the **Applications** folder.
4. Eject the disk image.

### First launch — Gatekeeper bypass

Because the app is not notarized by Apple, macOS will block the first launch with a message like *"Sigvis cannot be opened because it is from an unidentified developer"*.

To bypass this **once**:

1. Open **Finder** and navigate to **Applications**.
2. **Right-click** (or Control-click) the Sigvis icon.
3. Select **Open** from the context menu.
4. A new dialog appears with an **Open** button — click it.

The app opens normally. From this point on, **all subsequent launches** work with a normal double-click. The bypass is only needed once per installed version.

> If you upgrade to a new version by replacing the app in Applications, you will need to repeat the right-click → Open step once for the new version.

### Data storage

All persistent data is stored in:

```
~/Library/Application Support/Sigvis
```

This folder survives app updates and uninstalls.

### Updates

When a new version is available, the app shows a dialog on startup prompting you to download it. Click **Download** — your browser opens the releases page. Download the new `.dmg`, drag the new app to Applications (replacing the old one), then right-click → Open once.

### Uninstall

Drag Sigvis from Applications to the Trash. To also remove data:

```bash
rm -rf ~/Library/Application\ Support/Sigvis
```

---

## Desktop app — Linux

### Requirements

- Any modern 64-bit Linux desktop (Ubuntu 20.04+, Debian 11+, Fedora 36+, Arch, etc.)
- FUSE 2 (required for AppImage) — see note below
- No additional software required beyond FUSE

### Install

1. Go to the [Releases page](https://github.com/OWNER/REPO/releases/latest) and download the file named `Sigvis-x.y.z.AppImage`.
2. Make it executable:

   ```bash
   chmod +x ~/Downloads/Sigvis-x.y.z.AppImage
   ```

3. Run it directly:

   ```bash
   ~/Downloads/Sigvis-x.y.z.AppImage
   ```

   Or move it somewhere permanent first:

   ```bash
   mkdir -p ~/.local/bin
   mv ~/Downloads/Sigvis-x.y.z.AppImage ~/.local/bin/Sigvis.AppImage
   ~/.local/bin/Sigvis.AppImage
   ```

#### FUSE note

AppImage requires FUSE 2. Most distributions ship it by default. If you get an error like `fuse: device not found`, install it:

```bash
# Ubuntu / Debian
sudo apt install libfuse2

# Fedora
sudo dnf install fuse

# Arch
sudo pacman -S fuse2
```

Alternatively, run the AppImage with `--appimage-extract-and-run` to bypass FUSE entirely:

```bash
./Sigvis-x.y.z.AppImage --appimage-extract-and-run
```

### Desktop integration (optional)

To add a launcher to your application menu, use a tool like [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher), or create a `.desktop` file manually:

```ini
# ~/.local/share/applications/sigvis.desktop
[Desktop Entry]
Type=Application
Name=Sigvis
Exec=/home/yourname/.local/bin/Sigvis.AppImage
Icon=/home/yourname/.local/bin/Sigvis.AppImage
Categories=Development;
```

Then run `update-desktop-database ~/.local/share/applications`.

### Data storage

All persistent data is stored in:

```
~/.config/Sigvis
```

This folder survives app updates.

### Updates

When a new version is available, the app shows a dialog on startup. Click **Download** to open the releases page, download the new `.AppImage`, make it executable, and replace the old file. Your data folder is unchanged.

### Uninstall

Delete the `.AppImage` file and, optionally, the data folder:

```bash
rm ~/.local/bin/Sigvis.AppImage
rm -rf ~/.config/Sigvis
```

---

## Server-browser

In this mode a Node.js server runs on one machine and any number of browsers on the same network can connect to it. This is suitable for shared lab setups, headless servers, or cases where the dashboard should be accessible from multiple devices.

For a full Docker-based deployment guide (recommended for servers), see **[DOCKER_INSTALLATION.md](DOCKER_INSTALLATION.md)**.

The section below covers a direct Node.js installation without Docker.

### Requirements

- Node.js 18 or later
- npm 9 or later

Check your versions:

```bash
node --version   # should print v18.x.x or higher
npm --version    # should print 9.x.x or higher
```

If Node.js is not installed, download it from [nodejs.org](https://nodejs.org/) or use a version manager like [nvm](https://github.com/nvm-sh/nvm).

### Install dependencies

From the project root:

```bash
npm install
npm install --prefix server
npm install --prefix web
```

### Build the frontend

```bash
npm run build
```

This compiles the Vue frontend into `web/dist/`. The server automatically serves these files in production.

### Start the server

```bash
npm run start
```

The server starts on port 3000 by default. Open `http://localhost:3000` in a browser (or replace `localhost` with the server's IP address to access from another machine on the network).

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `DATA_DIR` | `server/data` | Directory for all persistent data (dashboards, generators, processors, settings) |
| `DASHBOARD_STORAGE_DIR` | `server/data/dashboards` | Override dashboard storage location independently |
| `MIN_PUSH_INTERVAL_MS` | `30` | Minimum WebSocket push interval per client (ms) |
| `MQTT_BROKER_URL` | *(unset)* | MQTT broker URL — leave unset to disable MQTT |
| `MQTT_CLIENT_ID` | *(auto)* | MQTT client identifier |
| `MQTT_USERNAME` | *(unset)* | MQTT broker username |
| `MQTT_PASSWORD` | *(unset)* | MQTT broker password |
| `MQTT_INGEST_TOPIC` | `cmnd/sigvis/ingest` | MQTT topic to subscribe to for data ingestion |

Set variables before starting:

```bash
export PORT=8080
export DATA_DIR=/var/lib/sigvis
npm run start
```

### Persistent data

All state is stored under `DATA_DIR` (default: `server/data/`):

| File / folder | Contents |
|---|---|
| `data/dashboards/` | Saved dashboard JSON files |
| `data/generators.json` | Generator definitions |
| `data/processors.json` | Processor definitions |
| `data/server-settings.json` | Server settings (MQTT config, push interval) |

Back up this directory to preserve all your configuration.

### Running as a system service (Linux)

To keep the server running after logout, create a systemd service:

```ini
# /etc/systemd/system/sigvis.service
[Unit]
Description=Sigvis time-series dashboard
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/home/youruser/Sigvis
ExecStart=/usr/bin/node server/src/index.js
Restart=on-failure
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/sigvis

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable sigvis
sudo systemctl start sigvis
sudo systemctl status sigvis
```

### Updating

Pull the new source code, rebuild the frontend, and restart the server:

```bash
git pull
npm install
npm install --prefix server
npm install --prefix web
npm run build
npm run start          # or: sudo systemctl restart sigvis
```

Your data directory is not modified by this process.

---

## Data ingest

Regardless of which deployment you choose, external producers push data to the server via HTTP or MQTT. See [README.md](README.md) for the full ingest API reference and payload format.

Quick example — send a data point from any machine on the network:

```bash
curl -X POST http://<server-address>:3000/api/series/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "measurementName": "temperature",
    "time": true,
    "points": {
      "timestamps": ['"$(date +%s%3N)"'],
      "series": { "value": [23.5] }
    }
  }'
```
