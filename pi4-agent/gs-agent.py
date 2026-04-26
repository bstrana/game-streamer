#!/usr/bin/env python3
"""Game Streamer – Raspberry Pi 4 streaming agent.

Polls the Game Streamer API heartbeat endpoint, drives FFmpeg for live
streaming via USB or RTSP camera, and executes remote commands from the
dashboard (start, stop, switch scene).
"""

import fcntl
import glob
import json
import logging
import os
import signal
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request

CONFIG_FILE = '/etc/gs-agent/config.json'
DEFAULT_CONFIG = {
    'appUrl': '',
    'apiSecret': '',
    'activeSource': 'usb',
    'usbDevice': '/dev/video0',
    'rtspUrl': '',
    'rtmpUrl': '',          # optional hard-coded RTMP URL override (incl. stream key)
    'resolution': '1280x720',
    'framerate': 25,
    'videoBitrate': 2500,
    'audioBitrate': 128,
    'audioDevice': 'none',
    'videoEncoder': 'h264_v4l2m2m',
}

CHROMA_GREEN = '0x00FF00'  # must match ?chromakey=1 background in Overlay.jsx


def _find_chromium():
    for name in ('chromium-browser', 'chromium'):
        try:
            subprocess.run(['which', name], check=True, capture_output=True)
            return name
        except subprocess.CalledProcessError:
            continue
    return None


class OverlayRenderer:
    """Renders the score overlay in a headless X display for FFmpeg compositing."""

    DISPLAY = ':99'

    def __init__(self):
        self._xvfb    = None
        self._browser = None

    def start(self, overlay_url, resolution):
        self.stop()
        w, h = resolution.split('x')
        self._xvfb = subprocess.Popen(
            ['Xvfb', self.DISPLAY, '-screen', '0', f'{w}x{h}x24', '-ac'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(1)

        browser = _find_chromium()
        if not browser:
            log.warning('chromium not found — overlay disabled. Install chromium-browser.')
            return

        env = {**os.environ, 'DISPLAY': self.DISPLAY, 'HOME': '/tmp'}
        self._browser = subprocess.Popen(
            [
                browser,
                '--no-sandbox', '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-dev-shm-usage',
                f'--window-size={w},{h}',
                '--window-position=0,0',
                '--noerrdialogs', '--disable-infobars',
                '--disable-extensions', '--disable-translate',
                '--app', overlay_url,
            ],
            env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(3)  # allow page to load before FFmpeg starts grabbing
        log.info('Overlay renderer started on %s', self.DISPLAY)

    def stop(self):
        for proc in (self._browser, self._xvfb):
            if proc:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
        self._browser = None
        self._xvfb    = None

    def running(self):
        return self._xvfb is not None and self._xvfb.poll() is None


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [gs-agent] %(levelname)s %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S',
    stream=sys.stdout,
)
log = logging.getLogger('gs-agent')


def load_config():
    with open(CONFIG_FILE, encoding='utf-8') as f:
        cfg = json.load(f)
    return {**DEFAULT_CONFIG, **cfg}


class StreamAgent:
    def __init__(self, cfg):
        self.cfg = cfg
        self._proc = None
        self._active_source = cfg.get('activeSource', cfg.get('usbDevice', '/dev/video0'))
        self._last_rtmp_url = ''
        self._last_overlay_url = ''
        self._ffmpeg_cmd_used = []
        self._overlay = OverlayRenderer()
        self._running = True

    # ── Source discovery ──────────────────────────────────────────────────────

    @staticmethod
    def _is_capture_device(path):
        """Return True only if the V4L2 node supports video capture.

        Pi4 creates many /dev/video* nodes for its codec and ISP pipeline;
        VIDIOC_QUERYCAP filters those out so we only list real cameras.
        """
        VIDIOC_QUERYCAP      = 0x80685600  # _IOR('V', 0, v4l2_capability)
        V4L2_CAP_VIDEO_CAPTURE = 0x00000001
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            try:
                buf    = fcntl.ioctl(fd, VIDIOC_QUERYCAP, b'\x00' * 104)
                caps   = struct.unpack_from('<I', buf, 84)[0]
                return bool(caps & V4L2_CAP_VIDEO_CAPTURE)
            finally:
                os.close(fd)
        except Exception:
            return False

    def _usb_devices(self):
        return [d for d in sorted(glob.glob('/dev/video[0-9]*'))
                if self._is_capture_device(d)]

    def scenes(self):
        sources = list(self._usb_devices())
        if self.cfg.get('rtspUrl'):
            sources.append('IP Camera')
        return sources or ['/dev/video0']

    def current_scene(self):
        return self._active_source

    # ── FFmpeg control ────────────────────────────────────────────────────────

    def streaming(self):
        if self._proc is None:
            return False
        if self._proc.poll() is not None:
            self._check_ffmpeg_exit()
            return False
        return True

    def _ffmpeg_cmd(self, rtmp_url):
        cfg = self.cfg
        resolution = cfg.get('resolution', '1280x720')
        width, height = resolution.split('x')
        fps = str(int(cfg.get('framerate', 30)))
        vbr = f"{int(cfg.get('videoBitrate', 2500))}k"
        abr = f"{int(cfg.get('audioBitrate', 128))}k"
        encoder = cfg.get('videoEncoder', 'h264_v4l2m2m')
        audio_dev = cfg.get('audioDevice', 'default')
        has_audio = bool(audio_dev and audio_dev not in ('', 'none'))

        if self._active_source == 'IP Camera':
            rtsp_url = cfg.get('rtspUrl', '')
            bitrate  = int(cfg.get('videoBitrate', 2500))
            use_overlay = self._overlay.running()

            encode_args = [
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-tune', 'zerolatency',
                '-profile:v', 'high',
                '-level:v', '4.0',
                '-b:v', vbr,
                '-maxrate', vbr,
                '-bufsize', f'{bitrate * 2}k',
                '-r', fps,
                '-g', str(int(cfg.get('framerate', 25)) * 2),
                '-keyint_min', fps,
                '-sc_threshold', '0',
                '-c:a', 'aac', '-b:a', '32k', '-ar', '44100',
                '-f', 'flv', rtmp_url,
            ]

            if use_overlay:
                # 3-input pipeline:
                #   0 = RTSP camera
                #   1 = x11grab (Xvfb running Chromium with overlay page)
                #   2 = silent audio
                # colorkey removes the green chroma background from the overlay
                fc = (
                    f'[0:v]scale={width}:{height},format=yuv420p[cam];'
                    f'[1:v]colorkey={CHROMA_GREEN}:0.3:0.1[ovl];'
                    f'[cam][ovl]overlay=0:0[out]'
                )
                cmd = [
                    'ffmpeg',
                    '-rtsp_transport', 'tcp',
                    '-fflags', '+genpts+discardcorrupt',
                    '-thread_queue_size', '512',
                    '-i', rtsp_url,
                    '-f', 'x11grab',
                    '-video_size', f'{width}x{height}',
                    '-framerate', '5',
                    '-thread_queue_size', '512',
                    '-i', f'{OverlayRenderer.DISPLAY}.0',
                    '-f', 'lavfi',
                    '-thread_queue_size', '512',
                    '-i', 'aevalsrc=0:s=44100:c=stereo',
                    '-filter_complex', fc,
                    '-map', '[out]',
                    '-map', '2:a:0',
                ] + encode_args
            else:
                cmd = [
                    'ffmpeg',
                    '-rtsp_transport', 'tcp',
                    '-fflags', '+genpts+discardcorrupt',
                    '-thread_queue_size', '512',
                    '-i', rtsp_url,
                    '-f', 'lavfi',
                    '-thread_queue_size', '512',
                    '-i', 'aevalsrc=0:s=44100:c=stereo',
                    '-map', '0:v:0',
                    '-map', '1:a:0',
                    '-vf', f'scale={width}:{height},format=yuv420p',
                ] + encode_args
        else:
            # V4L2 USB camera
            usb_dev = (
                self._active_source
                if self._active_source.startswith('/dev/')
                else cfg.get('usbDevice', '/dev/video0')
            )
            cmd = [
                'ffmpeg',
                '-f', 'v4l2',
                '-video_size', f'{width}x{height}',
                '-framerate', fps,
                '-i', usb_dev,
            ]
            if has_audio:
                cmd += ['-f', 'alsa', '-i', audio_dev]
            cmd += ['-vf', 'format=yuv420p', '-c:v', encoder, '-b:v', vbr]
            if has_audio:
                cmd += ['-c:a', 'aac', '-b:a', abr, '-ar', '44100']
            else:
                cmd += ['-an']
            cmd += ['-f', 'flv', rtmp_url]

        return cmd

    def start(self, rtmp_url, overlay_url=''):
        if self.streaming():
            log.info('Already streaming — ignoring start command')
            return
        if not rtmp_url:
            log.warning('start called with empty RTMP URL')
            return
        self._last_rtmp_url    = rtmp_url
        self._last_overlay_url = overlay_url
        if overlay_url:
            log.info('Starting overlay renderer...')
            self._overlay.start(overlay_url, self.cfg.get('resolution', '1280x720'))
        cmd = self._ffmpeg_cmd(rtmp_url)
        log.info('Starting FFmpeg: %s', ' '.join(cmd))
        self._proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        self._ffmpeg_cmd_used = cmd

    def _check_ffmpeg_exit(self):
        """Log FFmpeg output if process exited unexpectedly."""
        if self._proc and self._proc.poll() is not None:
            out = b''
            try:
                out = self._proc.stdout.read(4096)
            except Exception:
                pass
            code = self._proc.returncode
            if code not in (0, -15, -2):  # not clean exit or SIGTERM/SIGINT
                log.error('FFmpeg exited with code %d', code)
                if out:
                    for line in out.decode(errors='replace').splitlines()[-20:]:
                        log.error('ffmpeg: %s', line)
            self._proc = None

    def stop(self):
        if not self._proc:
            return
        log.info('Stopping FFmpeg')
        self._proc.terminate()
        try:
            self._proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self._proc.kill()
            self._proc.wait()
        self._proc = None
        self._overlay.stop()

    def switch_source(self, scene_name):
        was_streaming = self.streaming()
        self.stop()
        self._active_source = scene_name
        log.info('Switched source to: %s', scene_name)
        if was_streaming and self._last_rtmp_url:
            self.start(self._last_rtmp_url, self._last_overlay_url)

    # ── Heartbeat & command polling ───────────────────────────────────────────

    def _http_put(self, url, body):
        data = json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method='PUT')
        req.add_header('Content-Type', 'application/json')
        secret = self.cfg.get('apiSecret', '')
        if secret:
            req.add_header('Authorization', f'Bearer {secret}')
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())

    def poll(self):
        app_url = self.cfg['appUrl'].rstrip('/')
        url = f'{app_url}/api/obs/status'
        payload = {
            'streaming': self.streaming(),
            'recording': False,
            'scene':     self.current_scene(),
            'scenes':    self.scenes(),
            'agentType': 'pi4',
        }

        try:
            resp = self._http_put(url, payload)
        except Exception as exc:
            log.warning('Heartbeat failed: %s', exc)
            return

        cmd = resp.get('pendingCommand')
        if not cmd or not cmd.get('id'):
            return

        command = cmd.get('command', '')
        cmd_id  = cmd['id']
        log.info('Received command: %s (id=%s)', command, cmd_id)

        if command == 'start_streaming':
            rtmp_url    = cmd.get('rtmpUrl', '') or self.cfg.get('rtmpUrl', '')
            overlay_url = cmd.get('overlayUrl', '')
            log.info('RTMP URL: %s', rtmp_url[:40] + '...' if len(rtmp_url) > 40 else rtmp_url)
            if overlay_url:
                log.info('Overlay URL: %s', overlay_url)
            if rtmp_url:
                self.start(rtmp_url, overlay_url)
            else:
                log.warning('No RTMP URL — set rtmpUrl in /etc/gs-agent/config.json or connect YouTube in app settings')

        elif command == 'stop_streaming':
            self.stop()

        elif command == 'switch_scene':
            scene = cmd.get('scene', '')
            if scene:
                self.switch_source(scene)
            else:
                log.warning('switch_scene missing scene name')

        # Acknowledge — send updated state with ackCommandId so server clears the command
        try:
            ack_payload = {**payload, 'streaming': self.streaming(), 'ackCommandId': cmd_id}
            self._http_put(url, ack_payload)
        except Exception as exc:
            log.warning('Ack failed: %s', exc)

    # ── Main loop ─────────────────────────────────────────────────────────────

    def run(self):
        def _handle_signal(sig, _frame):
            log.info('Signal %s received, shutting down', sig)
            self._running = False
            self.stop()

        signal.signal(signal.SIGTERM, _handle_signal)
        signal.signal(signal.SIGINT, _handle_signal)

        log.info('Game Streamer Pi4 agent started')
        log.info('App URL: %s', self.cfg['appUrl'])
        log.info('Available sources: %s', self.scenes())
        log.info('Active source: %s', self._active_source)

        while self._running:
            self.poll()
            time.sleep(3)

        log.info('Agent stopped')


def main():
    if not os.path.exists(CONFIG_FILE):
        print(f'Config not found: {CONFIG_FILE}', file=sys.stderr)
        print('Run setup.sh first.', file=sys.stderr)
        sys.exit(1)
    cfg = load_config()
    if not cfg.get('appUrl') or not cfg.get('apiSecret'):
        print('Config is missing appUrl or apiSecret', file=sys.stderr)
        sys.exit(1)
    StreamAgent(cfg).run()


if __name__ == '__main__':
    main()
