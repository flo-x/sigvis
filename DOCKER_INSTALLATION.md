# Docker Installation Guide

This guide walks you through deploying Sigvis on a Linux server using Docker, from zero Docker experience to a running, internet-accessible service.

---

## Table of Contents

1. [What You Need](#1-what-you-need)
2. [Get the Project Files onto Your Server](#2-get-the-project-files-onto-your-server)
3. [Verify Docker Is Working](#3-verify-docker-is-working)
4. [Install Docker Compose](#4-install-docker-compose)
5. [Build and Start the Container](#5-build-and-start-the-container)
6. [Verify the Application Is Running](#6-verify-the-application-is-running)
7. [Open the Firewall on the Server](#7-open-the-firewall-on-the-server)
8. [Allow Access from the Internet](#8-allow-access-from-the-internet)
9. [Environment Variables and MQTT](#9-environment-variables-and-mqtt)
10. [Persistent Data](#10-persistent-data)
11. [Day-to-Day Commands](#11-day-to-day-commands)
12. [Updating the Application](#12-updating-the-application)
13. [(Optional) Serve on Port 80/443 with Nginx](#13-optional-serve-on-port-80443-with-nginx)

---

## 1. What You Need

| Requirement | Notes |
|---|---|
| Linux server | Ubuntu 20.04+ / Debian 11+ / CentOS 8+ or similar |
| Docker | Already installed (verify in step 3) |
| Internet access on the server | To pull images and (optionally) expose the app |
| The project source code | Copied to the server (step 2) |

Port used by the application: **3000** (HTTP + WebSocket combined).

---

## 2. Get the Project Files onto Your Server

Choose one of these methods.

### Option A — Copy from your local machine with `scp`

Run this on your **local** machine (substitute your server's address and path):

```bash
scp -r /path/to/Sigvis user@your-server-ip:/home/user/Sigvis
```

### Option B — Clone from Git (if the project is in a repository)

Run this on the **server**:

```bash
git clone https://github.com/your-user/your-repo.git ~/Sigvis
```

### Option C — Transfer a zip archive

On your local machine:
```bash
zip -r sigvis.zip Sigvis/
scp sigvis.zip user@your-server-ip:/home/user/
```

On the server:
```bash
unzip ~/sigvis.zip -d ~/
```

After this step you should have the project folder on the server. All subsequent commands run **on the server**.

---

## 3. Verify Docker Is Working

```bash
docker --version
```

Expected output (version numbers will differ):
```
Docker version 24.0.5, build ced0996
```

Run a quick smoke test:
```bash
docker run --rm hello-world
```

You should see `Hello from Docker!`. If you get a permission error (`permission denied while trying to connect to the Docker daemon socket`), add your user to the `docker` group:

```bash
sudo usermod -aG docker $USER
# Then log out and back in, or run:
newgrp docker
```

---

## 4. Install Docker Compose

Modern Docker installations include Compose as a built-in plugin (`docker compose`). Check:

```bash
docker compose version
```

If that fails, install the standalone plugin:

```bash
# Ubuntu / Debian
sudo apt-get update
sudo apt-get install -y docker-compose-plugin

# CentOS / RHEL / Fedora
sudo dnf install -y docker-compose-plugin
```

---

## 5. Build and Start the Container

Navigate to the project folder and start everything with a single command:

```bash
cd ~/Sigvis
docker compose up --build -d
```

What this does step by step:
1. **Builds** the Docker image — compiles the Vue frontend inside a temporary container and bundles it with the Node.js server.
2. **Creates** a named volume (`sigvis-data`) for persistent storage.
3. **Starts** the container in the background (`-d` = detached).

The first build takes a few minutes because it downloads base images and installs npm packages. Subsequent builds are much faster thanks to Docker's layer cache.

---

## 6. Verify the Application Is Running

### Check that the container is up

```bash
docker compose ps
```

You should see something like:
```
NAME          IMAGE              COMMAND                  STATUS          PORTS
sigvis    sigvis:latest  "node src/index.js"      Up 2 minutes    0.0.0.0:3000->3000/tcp
```

### Check the logs

```bash
docker compose logs -f
```

Look for:
```
Server listening on http://localhost:3000
```

Press `Ctrl+C` to stop following the logs (the container keeps running).

### Test locally on the server

```bash
curl http://localhost:3000/api/health
```

Expected:
```json
{"status":"ok","timestamp":"..."}
```

---

## 7. Open the Firewall on the Server

By default, Linux servers block all inbound traffic except SSH. You must open port 3000.

### Ubuntu / Debian — UFW (most common)

```bash
# Check if UFW is active
sudo ufw status

# Allow port 3000 (TCP)
sudo ufw allow 3000/tcp

# Verify the rule was added
sudo ufw status
```

### CentOS / RHEL / Fedora — firewalld

```bash
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
```

### Any distro — iptables (lower-level)

```bash
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
# Make it persistent (install iptables-persistent first if needed)
sudo netfilter-persistent save
```

### Verify the port is open

From the server itself:
```bash
ss -tlnp | grep 3000
```

You should see a line with `0.0.0.0:3000`.

---

## 8. Allow Access from the Internet

The steps depend on how your server is connected.

### 8A — VPS / Cloud server (DigitalOcean, Hetzner, Linode, Vultr, …)

These providers have a **firewall or security group** in their web console, separate from the OS firewall. You must open the port there too.

**DigitalOcean:**
1. Go to **Networking → Firewalls** in the control panel.
2. Select the firewall attached to your Droplet (or create one and attach it).
3. Add an **Inbound rule**: Protocol `TCP`, Port `3000`, Sources `All IPv4 / All IPv6`.
4. Save.

**Hetzner Cloud:**
1. Go to **Firewalls** in the Cloud Console.
2. Add an inbound rule: Protocol `TCP`, Port `3000`.
3. Apply the firewall to your server.

**Linode / Akamai:**
1. Go to **Firewalls** under the Cloud Manager.
2. Add an inbound rule for TCP port 3000.

**AWS EC2:**
1. Go to **EC2 → Security Groups**.
2. Select the security group attached to your instance.
3. **Inbound rules → Edit → Add rule**: Type `Custom TCP`, Port `3000`, Source `0.0.0.0/0`.

**Google Cloud (GCE):**
1. Go to **VPC network → Firewall**.
2. **Create firewall rule**: Direction `Ingress`, Targets `All instances`, Protocols/ports `tcp:3000`, Source `0.0.0.0/0`.

---

### 8B — Home server behind a router (NAT)

Your router hides your server behind a private IP. You need **port forwarding** to expose port 3000 to the internet.

**Steps (router interface varies by brand):**

1. **Find your server's local (private) IP:**
   ```bash
   hostname -I
   ```
   Note the address, e.g. `192.168.1.50`.

2. **Find your public IP:**
   ```bash
   curl ifconfig.me
   ```

3. **Log in to your router** — usually at `http://192.168.1.1` or `http://192.168.0.1` in a browser.

4. **Find the Port Forwarding section** — it may be called "NAT", "Virtual Server", "Port Forwarding", or "Port Mapping".

5. **Add a rule:**
   | Setting | Value |
   |---|---|
   | Protocol | TCP |
   | External port | 3000 |
   | Internal IP | your server's local IP (e.g. 192.168.1.50) |
   | Internal port | 3000 |

6. **Save** and reboot the router if prompted.

7. **Give your server a static local IP** (recommended) so the forwarding rule doesn't break when the DHCP lease renews. Do this in the router's DHCP reservation settings using your server's MAC address.

8. **Test from outside your network:**
   From your phone (with Wi-Fi turned off) or any external device, open:
   ```
   http://<your-public-ip>:3000
   ```

> **Dynamic IP warning:** Home internet connections typically have a changing public IP. Consider a free dynamic-DNS service like [DuckDNS](https://www.duckdns.org/) or [No-IP](https://www.noip.com/) so you always reach your server by a fixed hostname.

---

### 8C — Test that access works

From any device outside your network:

```bash
curl http://<your-public-ip-or-hostname>:3000/api/health
```

Or open `http://<your-public-ip-or-hostname>:3000` in a browser. You should see the Sigvis dashboard.

---

## 9. Environment Variables and MQTT

Edit `docker-compose.yml` to configure the application. The `environment:` section maps directly to the server's environment variables.

```yaml
environment:
  PORT: "3000"
  MIN_PUSH_INTERVAL_MS: "30"
  MQTT_BROKER_URL: "mqtt://192.168.1.10:1883"
  MQTT_USERNAME: "myuser"
  MQTT_PASSWORD: "mypassword"
  MQTT_INGEST_TOPIC: "cmnd/sigvis/ingest"
```

After editing the file, apply the changes:

```bash
docker compose up -d
```

(Docker detects the config change and recreates the container automatically.)

You can also update MQTT settings **at runtime** without restarting — visit `http://<server>:3000/server-settings` in a browser.

---

## 10. Persistent Data

The container stores two kinds of data that must survive restarts and updates:

| Data | Location inside container | Where it actually lives |
|---|---|---|
| Saved dashboards | `/app/server/data/dashboards/` | Docker volume `sigvis-data` |
| Processor definitions | `/app/server/data/processors.json` | Docker volume `sigvis-data` |

The `docker-compose.yml` file already mounts this volume. **You do not need to do anything special** — data is preserved across `docker compose up --build` (updates) and `docker compose restart`.

To see where Docker stores the volume on disk:

```bash
docker volume inspect sigvis-data
```

To back up the volume:

```bash
docker run --rm \
  -v sigvis-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/sigvis-data-backup.tar.gz -C /data .
```

To restore from backup:

```bash
docker run --rm \
  -v sigvis-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/sigvis-data-backup.tar.gz -C /data
```

---

## 11. Day-to-Day Commands

All commands run from the `~/Sigvis` directory on the server.

| Task | Command |
|---|---|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Restart | `docker compose restart` |
| View live logs | `docker compose logs -f` |
| View last 100 log lines | `docker compose logs --tail=100` |
| Check status | `docker compose ps` |
| Open a shell inside the container | `docker compose exec sigvis sh` |
| Stop and remove everything (keeps volume) | `docker compose down` |
| Stop and remove everything **including data** | `docker compose down -v` ⚠️ |

---

## 12. Updating the Application

When you have new source code (after a `git pull` or `scp`):

```bash
cd ~/Sigvis
docker compose up --build -d
```

Docker rebuilds the image with the new code, stops the old container, and starts a new one. The data volume is untouched.

---

## 13. (Optional) Serve on Port 80/443 with Nginx

Running on port 3000 is fine for internal or development use, but production deployments usually go through a reverse proxy on the standard HTTP/HTTPS ports (80/443) with a TLS certificate.

### Install Nginx and Certbot

```bash
# Ubuntu / Debian
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx

# CentOS / RHEL
sudo dnf install -y nginx certbot python3-certbot-nginx
```

### Create a site configuration

Replace `sigvis.example.com` with your real domain name.

```bash
sudo nano /etc/nginx/sites-available/sigvis
```

Paste:

```nginx
server {
    listen 80;
    server_name sigvis.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Required for WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/sigvis /etc/nginx/sites-enabled/
sudo nginx -t          # check for syntax errors
sudo systemctl reload nginx
```

### Get a free TLS certificate

```bash
sudo certbot --nginx -d sigvis.example.com
```

Certbot automatically edits the Nginx config to add HTTPS and redirect HTTP to HTTPS. Certificates renew automatically every 90 days.

### Open ports 80 and 443

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

After this, the app is accessible at `https://sigvis.example.com` — no port number needed.

> **DNS requirement:** For Certbot to work, you must first create a DNS A record pointing your domain to your server's public IP address. Do this through your domain registrar's control panel.

---

## Quick Reference

```
Start:   docker compose up -d
Stop:    docker compose down
Logs:    docker compose logs -f
Update:  docker compose up --build -d
Health:  curl http://localhost:3000/api/health
```
