#!/usr/bin/env bash
# Game Streamer – Raspberry Pi 4 agent one-time setup
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/bstrana/game-streamer/main/pi4-agent"
INSTALL_DIR="/usr/local/lib/gs-agent"

echo "========================================"
echo "  Game Streamer Pi4 Agent Setup"
echo "========================================"
echo ""

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root:"
  echo "  sudo bash setup.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Install system dependencies ───────────────────────────────────────────────
echo "[1/5] Installing dependencies (ffmpeg, v4l-utils, python3)..."
apt-get update -qq
apt-get install -y ffmpeg v4l-utils python3 curl

# ── Detect cameras ────────────────────────────────────────────────────────────
echo ""
echo "[2/5] Detected video devices:"
if ls /dev/video* 2>/dev/null | head -10; then
  true
else
  echo "  (none detected — you can still configure one manually)"
fi

# ── Collect configuration ─────────────────────────────────────────────────────
echo ""
echo "[3/5] Configuration"
echo ""

read -rp "Game Streamer App URL (e.g. https://myapp.example.com): " APP_URL
APP_URL="${APP_URL%/}"
if [[ -z "$APP_URL" ]]; then
  echo "App URL is required." >&2
  exit 1
fi

read -rsp "API Secret (copy from YouTube Settings → OBS section): " API_SECRET
echo ""
if [[ -z "$API_SECRET" ]]; then
  echo "API Secret is required." >&2
  exit 1
fi

echo ""
echo "Camera type:"
echo "  1) USB / V4L2 camera  (/dev/videoX)"
echo "  2) IP camera (RTSP)"
read -rp "Select [1]: " CAM_TYPE
CAM_TYPE="${CAM_TYPE:-1}"

USB_DEVICE="/dev/video0"
RTSP_URL=""
ACTIVE_SOURCE=""

if [[ "$CAM_TYPE" == "2" ]]; then
  read -rp "RTSP URL (e.g. rtsp://192.168.1.100:554/stream): " RTSP_URL
  ACTIVE_SOURCE="IP Camera"
else
  echo ""
  echo "Available video devices:"
  ls /dev/video* 2>/dev/null || echo "  (none)"
  read -rp "USB device path [/dev/video0]: " USB_DEVICE_IN
  USB_DEVICE="${USB_DEVICE_IN:-/dev/video0}"
  ACTIVE_SOURCE="$USB_DEVICE"
fi

echo ""
read -rp "Resolution [1920x1080]: " RESOLUTION
RESOLUTION="${RESOLUTION:-1920x1080}"

read -rp "Framerate [25]: " FRAMERATE
FRAMERATE="${FRAMERATE:-25}"

read -rp "Video bitrate kbps [2500]: " VIDEO_BITRATE
VIDEO_BITRATE="${VIDEO_BITRATE:-2500}"

echo ""
echo "Audio device (ALSA device name, or 'none' to stream without audio):"
echo "  Examples: default  hw:0  hw:1  none"
read -rp "Audio device [none]: " AUDIO_DEVICE
AUDIO_DEVICE="${AUDIO_DEVICE:-none}"

# ── Write config ──────────────────────────────────────────────────────────────
echo ""
echo "[4/5] Writing config to /etc/gs-agent/config.json..."
mkdir -p /etc/gs-agent
cat > /etc/gs-agent/config.json <<JSON
{
  "appUrl":        "$APP_URL",
  "apiSecret":     "$API_SECRET",
  "activeSource":  "$ACTIVE_SOURCE",
  "usbDevice":     "$USB_DEVICE",
  "rtspUrl":       "$RTSP_URL",
  "resolution":    "$RESOLUTION",
  "framerate":     $FRAMERATE,
  "videoBitrate":  $VIDEO_BITRATE,
  "audioBitrate":  128,
  "audioDevice":   "$AUDIO_DEVICE",
  "videoEncoder":  "h264_v4l2m2m"
}
JSON
chmod 600 /etc/gs-agent/config.json

# ── Install agent files ───────────────────────────────────────────────────────
echo "[5/5] Installing agent and enabling service..."
mkdir -p "$INSTALL_DIR"

# Use local files if running from a cloned repo (both files present), otherwise download
if [[ -f "$SCRIPT_DIR/gs-agent.py" && -f "$SCRIPT_DIR/gs-agent.service" ]]; then
  cp "$SCRIPT_DIR/gs-agent.py"      "$INSTALL_DIR/gs-agent.py"
  cp "$SCRIPT_DIR/gs-agent.service" /etc/systemd/system/gs-agent.service
else
  echo "  Downloading from GitHub..."
  curl -fsSL "$REPO_RAW/gs-agent.py"      -o "$INSTALL_DIR/gs-agent.py"
  curl -fsSL "$REPO_RAW/gs-agent.service" -o /etc/systemd/system/gs-agent.service
fi
chmod 755 "$INSTALL_DIR/gs-agent.py"

# ── Enable and start service ──────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable gs-agent
systemctl restart gs-agent

echo ""
echo "========================================"
echo "  Setup complete!"
echo "========================================"
echo ""
echo "  Status : systemctl status gs-agent"
echo "  Logs   : journalctl -u gs-agent -f"
echo "  Config : /etc/gs-agent/config.json"
echo ""
echo "  Update agent anytime:"
echo "  sudo curl -fsSL $REPO_RAW/gs-agent.py -o $INSTALL_DIR/gs-agent.py && sudo systemctl restart gs-agent"
echo ""
echo "Turn on the Pi4 at the field — the agent will appear as connected"
echo "in the Game Streamer dashboard (OBS bar shows 'Pi4')."
echo ""
