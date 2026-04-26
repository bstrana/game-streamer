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
    'resolution': '1280x720',
    'framerate': 30,
    'videoBitrate': 2500,
    'audioBitrate': 128,
    'audioDevice': 'default',
    'videoEncoder': 'h264_v4l2m2m',
}

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
            self._proc = None
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
            # RTSP IP camera — audio comes from the stream itself
            rtsp_url = cfg.get('rtspUrl', '')
            cmd = [
                'ffmpeg', '-re',
                '-i', rtsp_url,
                '-c:v', encoder,
                '-b:v', vbr,
                '-s', f'{width}x{height}',
                '-r', fps,
                '-c:a', 'aac',
                '-b:a', abr,
                '-ar', '44100',
                '-f', 'flv',
                rtmp_url,
            ]
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
            cmd += ['-c:v', encoder, '-b:v', vbr]
            if has_audio:
                cmd += ['-c:a', 'aac', '-b:a', abr, '-ar', '44100']
            else:
                cmd += ['-an']
            cmd += ['-f', 'flv', rtmp_url]

        return cmd

    def start(self, rtmp_url):
        if self.streaming():
            log.info('Already streaming — ignoring start command')
            return
        if not rtmp_url:
            log.warning('start called with empty RTMP URL')
            return
        self._last_rtmp_url = rtmp_url
        cmd = self._ffmpeg_cmd(rtmp_url)
        log.info('Starting FFmpeg: %s', ' '.join(cmd))
        self._proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

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

    def switch_source(self, scene_name):
        was_streaming = self.streaming()
        self.stop()
        self._active_source = scene_name
        log.info('Switched source to: %s', scene_name)
        if was_streaming and self._last_rtmp_url:
            self.start(self._last_rtmp_url)

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
            rtmp_url = cmd.get('rtmpUrl', '')
            if rtmp_url:
                self.start(rtmp_url)
            else:
                log.warning('start_streaming missing rtmpUrl — check YouTube connection on server')

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
