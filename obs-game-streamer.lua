--[[
  game-streamer OBS Script
  ========================
  Adds (or updates) a Browser Source for a WBSC game scoreboard overlay
  powered by the Game Streamer app.

  Setup:
    1. In OBS → Tools → Scripts → "+" → select this file.
    2. Enter the App URL and Game ID.
    3. Click "Fetch Settings from App" to auto-fill team details.
    4. Click "Add / Update Source".

  The script creates a browser source named "Game Streamer Scoreboard"
  in the current scene. Re-running with a different game ID updates
  the existing source rather than creating a duplicate.

  URL format used:
    {App URL}/overlay/game/{Game ID}
      ?away={Away abbr}&home={Home abbr}
      &awayColor={hex}&awayColor2={hex}
      &homeColor={hex}&homeColor2={hex}
      &awayLogo={public image URL}&homeLogo={public image URL}
      &replay={0|1}
]]

obs = obslua
local bit = require("bit")

-- Current settings reference — updated by script_update / script_load
local current_settings = nil

-- Streaming control state
local last_ack_id    = ""
local poll_running   = false   -- guard against overlapping polls

-- Platform-safe temp file for PUT request body
local IS_WIN = package.config:sub(1, 1) == "\\"
local function tmp_path()
  local t = os.getenv("TEMP") or os.getenv("TMPDIR") or "/tmp"
  t = t:gsub("[/\\]+$", "")
  return t .. (IS_WIN and "\\" or "/") .. "gs_obs_body.json"
end
local TMP_FILE = tmp_path()

-- ── Windows silent-process launcher (avoids CMD flash) ────────────────────────
-- On Windows, io.popen spawns cmd.exe which creates a visible console window.
-- Instead we use LuaJIT FFI to call CreateProcess with CREATE_NO_WINDOW.
local _ffi = nil
if IS_WIN then
  local ok, f = pcall(require, "ffi")
  if ok then
    -- pcall prevents errors if types are already defined from a previous load
    pcall(f.cdef, [[
      typedef void*          GS_HANDLE;
      typedef unsigned long  GS_DWORD;
      typedef unsigned short GS_WORD;
      typedef int            GS_BOOL;
      typedef struct { GS_DWORD n; GS_HANDLE sd; GS_BOOL inh; } GS_SA;
      typedef struct {
        GS_DWORD cb; char *r1, *desk, *title;
        GS_DWORD x, y, xs, ys, xcc, ycc, fill, fl;
        GS_WORD  show, r2; char *r3;
        GS_HANDLE hin, hout, herr;
      } GS_SI;
      typedef struct { GS_HANDLE proc, thr; GS_DWORD pid, tid; } GS_PI;
      GS_BOOL  CreatePipe(GS_HANDLE*, GS_HANDLE*, GS_SA*, GS_DWORD);
      GS_BOOL  SetHandleInformation(GS_HANDLE, GS_DWORD, GS_DWORD);
      GS_BOOL  CreateProcessA(const char*, char*, void*, void*, GS_BOOL, GS_DWORD,
                              void*, const char*, GS_SI*, GS_PI*);
      GS_DWORD WaitForSingleObject(GS_HANDLE, GS_DWORD);
      GS_BOOL  ReadFile(GS_HANDLE, void*, GS_DWORD, GS_DWORD*, void*);
      GS_BOOL  CloseHandle(GS_HANDLE);
    ]])
    _ffi = f
  end
end

-- Run a curl command and return stdout. No visible window on Windows.
local function run_curl(cmd)
  if IS_WIN and _ffi then
    local C  = _ffi.C
    local rd = _ffi.new("GS_HANDLE[1]")
    local wr = _ffi.new("GS_HANDLE[1]")
    local sa = _ffi.new("GS_SA")
    sa.n = _ffi.sizeof("GS_SA"); sa.inh = 1
    if C.CreatePipe(rd, wr, sa, 0) == 0 then return nil end
    C.SetHandleInformation(rd[0], 1, 0)  -- clear HANDLE_FLAG_INHERIT on read-end
    local si = _ffi.new("GS_SI")
    si.cb   = _ffi.sizeof("GS_SI")
    si.fl   = 0x100  -- STARTF_USESTDHANDLES
    si.hin  = _ffi.cast("GS_HANDLE", 0)
    si.hout = wr[0]; si.herr = wr[0]
    local pi  = _ffi.new("GS_PI")
    local buf = _ffi.new("char[?]", #cmd + 1, cmd)
    local ok  = C.CreateProcessA(nil, buf, nil, nil, 1, 0x08000000, nil, nil, si, pi)
    C.CloseHandle(wr[0])
    if ok == 0 then C.CloseHandle(rd[0]); return nil end
    local parts = {}
    local b = _ffi.new("char[4096]")
    local n = _ffi.new("GS_DWORD[1]")
    while C.ReadFile(rd[0], b, 4096, n, nil) ~= 0 and n[0] > 0 do
      parts[#parts + 1] = _ffi.string(b, n[0])
    end
    C.WaitForSingleObject(pi.proc, 8000)
    C.CloseHandle(pi.proc); C.CloseHandle(pi.thr); C.CloseHandle(rd[0])
    return table.concat(parts)
  else
    local h = io.popen(cmd)
    local r = h and h:read("*a") or nil
    if h then h:close() end
    return r
  end
end

-- ── Helpers ───────────────────────────────────────────────────────────────────
-- OBS stores colours as ARGB: bits 24-31 = alpha, 16-23 = red, 8-15 = green, 0-7 = blue.
-- Uses LuaJIT bit library (Lua 5.1 — OBS does not support Lua 5.3 bitwise ops).

-- Convert OBS ARGB int → 6-char rrggbb hex string (without #)
local function color_to_hex(argb)
  local r = bit.band(bit.rshift(argb, 16), 0xFF)
  local g = bit.band(bit.rshift(argb,  8), 0xFF)
  local b = bit.band(argb, 0xFF)
  return string.format("%02x%02x%02x", r, g, b)
end

-- Convert a CSS #rrggbb hex string → OBS ARGB int (alpha = 0xFF)
local function hex_to_obs(hex)
  hex = (hex or ""):gsub("^#", ""):lower()
  if #hex < 6 then return 0xFF808080 end
  local r = tonumber(hex:sub(1, 2), 16) or 128
  local g = tonumber(hex:sub(3, 4), 16) or 128
  local b = tonumber(hex:sub(5, 6), 16) or 128
  return 0xFF000000 + r * 65536 + g * 256 + b
end

-- Extract a string value from a flat JSON object
local function json_str(s, key)
  local val = (s:match('"' .. key .. '"%s*:%s*"(.-)"') or ""):gsub("\\/", "/")
  return val  -- explicit single-value return (gsub returns 2 values; we discard the count)
end

-- Extract a boolean value from a flat JSON object
local function json_bool(s, key)
  return s:match('"' .. key .. '"%s*:%s*(true)') == "true"
end

-- Percent-encode a string for use as a URL query parameter value
local function url_encode(str)
  if str == nil or str == "" then return "" end
  return str:gsub("([^%w%-%.%_%~])", function(c)
    return string.format("%%%02X", string.byte(c))
  end)
end

-- ── Fetch game settings from the Game Streamer app ────────────────────────────
local function fetch_game_settings()
  if not current_settings then return end
  local base    = obs.obs_data_get_string(current_settings, "app_url"):gsub("/+$", "")
  local game_id = obs.obs_data_get_string(current_settings, "game_id")
  if game_id == "" then
    obs.script_log(obs.LOG_WARNING, "Game Streamer: enter a Game ID before fetching.")
    return
  end

  local url  = base .. "/api/game-settings/" .. game_id
  local resp = run_curl(string.format('curl -s --max-time 8 "%s"', url))
  if not resp then
    obs.script_log(obs.LOG_WARNING,
      "Game Streamer: curl not available — install curl to use Fetch Settings.")
    return
  end

  if not resp or resp == "" or resp:find('"error"') then
    obs.script_log(obs.LOG_WARNING,
      "Game Streamer: no settings for game " .. game_id
      .. " — save the match in the app first.")
    return
  end

  local away = json_str(resp, "away")
  local home = json_str(resp, "home")
  if away ~= "" then obs.obs_data_set_string(current_settings, "away", away) end
  if home ~= "" then obs.obs_data_set_string(current_settings, "home", home) end
  obs.obs_data_set_int(current_settings,    "away_color",  hex_to_obs(json_str(resp, "awayColor")))
  obs.obs_data_set_int(current_settings,    "away_color2", hex_to_obs(json_str(resp, "awayColor2")))
  obs.obs_data_set_string(current_settings, "away_logo",   json_str(resp, "awayLogo"))
  obs.obs_data_set_int(current_settings,    "home_color",  hex_to_obs(json_str(resp, "homeColor")))
  obs.obs_data_set_int(current_settings,    "home_color2", hex_to_obs(json_str(resp, "homeColor2")))
  obs.obs_data_set_string(current_settings, "home_logo",   json_str(resp, "homeLogo"))
  obs.obs_data_set_bool(current_settings,   "replay",      json_bool(resp, "replay"))
  obs.script_log(obs.LOG_INFO, "Game Streamer: loaded settings for game " .. game_id)
end

-- ── Build overlay URL ─────────────────────────────────────────────────────────
local function build_url(s)
  local base      = obs.obs_data_get_string(s, "app_url"):gsub("/+$", "")
  local game_id   = url_encode(obs.obs_data_get_string(s, "game_id"))
  local away      = url_encode(obs.obs_data_get_string(s, "away"))
  local home      = url_encode(obs.obs_data_get_string(s, "home"))
  local c1        = color_to_hex(obs.obs_data_get_int(s, "away_color"))
  local c2        = color_to_hex(obs.obs_data_get_int(s, "away_color2"))
  local away_logo = url_encode(obs.obs_data_get_string(s, "away_logo"))
  local c3        = color_to_hex(obs.obs_data_get_int(s, "home_color"))
  local c4        = color_to_hex(obs.obs_data_get_int(s, "home_color2"))
  local home_logo = url_encode(obs.obs_data_get_string(s, "home_logo"))
  local replay    = obs.obs_data_get_bool(s, "replay") and "1" or "0"

  local url = string.format(
    "%s/overlay/game/%s?away=%s&home=%s&awayColor=%s&awayColor2=%s&homeColor=%s&homeColor2=%s&replay=%s",
    base, game_id, away, home, c1, c2, c3, c4, replay
  )

  if away_logo ~= "" then url = url .. "&awayLogo=" .. away_logo end
  if home_logo ~= "" then url = url .. "&homeLogo=" .. home_logo end

  return url
end

-- ── Create / update the OBS browser source ───────────────────────────────────
local SOURCE_NAME = "Game Streamer Scoreboard"

local function add_or_update_source()
  if not current_settings then return end

  local game_id = obs.obs_data_get_string(current_settings, "game_id")
  if game_id == "" then
    obs.script_log(obs.LOG_WARNING, "Game Streamer: Game ID is empty.")
    return
  end

  local url    = build_url(current_settings)
  local width  = obs.obs_data_get_int(current_settings, "width")
  local height = obs.obs_data_get_int(current_settings, "height")
  local base   = obs.obs_data_get_string(current_settings, "app_url"):gsub("/+$", "")
  obs.script_log(obs.LOG_INFO, string.format(
    "Game Streamer: %s/overlay/game/%s  [%dx%d]", base, game_id, width, height))

  local browser_settings = obs.obs_data_create()
  obs.obs_data_set_string(browser_settings, "url",    url)
  obs.obs_data_set_int(browser_settings,    "width",  width)
  obs.obs_data_set_int(browser_settings,    "height", height)
  obs.obs_data_set_bool(browser_settings,   "shutdown_on_scene_switch", false)

  local existing = obs.obs_get_source_by_name(SOURCE_NAME)
  if existing then
    obs.obs_source_update(existing, browser_settings)
    obs.obs_source_release(existing)
    obs.script_log(obs.LOG_INFO, "Game Streamer: updated existing source.")
  else
    local source = obs.obs_source_create("browser_source", SOURCE_NAME, browser_settings, nil)
    local scene_src = obs.obs_frontend_get_current_scene()
    if scene_src then
      local scene = obs.obs_scene_from_source(scene_src)
      obs.obs_scene_add(scene, source)
      obs.obs_source_release(scene_src)
    end
    obs.obs_source_release(source)
    obs.script_log(obs.LOG_INFO, "Game Streamer: created new source in current scene.")
  end

  obs.obs_data_release(browser_settings)
end

-- ── Streaming control (polls app server every 3 s) ───────────────────────────

-- Write body to temp file and PUT it; returns response string or nil
local function http_put_json(url, body)
  local f = io.open(TMP_FILE, "w")
  if not f then return nil end
  f:write(body)
  f:close()
  return run_curl(string.format(
    'curl -s --max-time 2 -X PUT -H "Content-Type: application/json" --data-binary "@%s" "%s"',
    TMP_FILE, url
  ))
end

-- Execute a command received from the app server
local function execute_command(command, broadcast_id)
  if command == "start_streaming" then
    if not obs.obs_frontend_streaming_active() then
      if broadcast_id and broadcast_id ~= "" then
        local service = obs.obs_frontend_get_streaming_service()
        if service then
          local sdata = obs.obs_service_get_settings(service)
          if sdata then
            obs.obs_data_set_string(sdata, "broadcast_id", broadcast_id)
            obs.obs_service_update(service, sdata)
            obs.obs_frontend_save_streaming_service()
            obs.obs_data_release(sdata)
          end
          obs.obs_service_release(service)
        end
      end
      obs.obs_frontend_start_streaming()
      obs.script_log(obs.LOG_INFO, "Game Streamer: started streaming via remote command")
    end
  elseif command == "stop_streaming" then
    if obs.obs_frontend_streaming_active() then
      obs.obs_frontend_stop_streaming()
      obs.script_log(obs.LOG_INFO, "Game Streamer: stopped streaming via remote command")
    end
  end
end

-- Timer callback — reports current OBS state and picks up pending commands
local function poll_streaming_control()
  if poll_running or not current_settings then return end
  local base = obs.obs_data_get_string(current_settings, "app_url"):gsub("/+$", "")
  if base == "" or base:find("example%.com") then return end

  poll_running = true

  -- Build status JSON
  local streaming = obs.obs_frontend_streaming_active()
  local recording = obs.obs_frontend_recording_active()
  local scene_src = obs.obs_frontend_get_current_scene()
  local scene = ""
  if scene_src then
    scene = (obs.obs_source_get_name(scene_src) or ""):gsub('\\', '\\\\'):gsub('"', '\\"')
    obs.obs_source_release(scene_src)
  end

  local body = string.format(
    '{"streaming":%s,"recording":%s,"scene":"%s"%s}',
    streaming and "true" or "false",
    recording and "true" or "false",
    scene,
    last_ack_id ~= "" and (',"ackCommandId":"' .. last_ack_id .. '"') or ""
  )
  last_ack_id = ""

  local resp = http_put_json(base .. "/api/obs/status", body)
  poll_running = false

  if not resp or resp == "" then return end

  -- Parse pendingCommand from response (minimal JSON extraction)
  local cmd_id   = resp:match('"id"%s*:%s*"([^"]+)"')
  local cmd_name = resp:match('"command"%s*:%s*"([^"]+)"')
  local cmd_bid  = resp:match('"broadcastId"%s*:%s*"([^"]+)"') or ""
  if cmd_id and cmd_name and cmd_id ~= "" then
    execute_command(cmd_name, cmd_bid)
    last_ack_id = cmd_id
  end
end

-- ── OBS script callbacks ──────────────────────────────────────────────────────
function script_description()
  return [[<h3>Game Streamer Scoreboard</h3>
<p>Creates or updates a Browser Source for a WBSC baseball scoreboard overlay.</p>
<ol>
  <li>Enter the <b>App URL</b> and <b>Game ID</b>.</li>
  <li>Click <b>Fetch Settings from App</b> to auto-fill team names, colours, and logos
      (the game must have been saved in the Game Streamer app first).</li>
  <li>Click <b>Add / Update Source</b> to apply.</li>
</ol>]]
end

function script_properties()
  local props = obs.obs_properties_create()

  obs.obs_properties_add_text(props, "app_url",  "App URL",  obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_text(props, "game_id",  "Game ID",  obs.OBS_TEXT_DEFAULT)

  obs.obs_properties_add_button(props, "btn_fetch", "↓  Fetch Settings from App",
    function(_, _)
      fetch_game_settings()
      return true  -- signals OBS to re-read settings and refresh the UI
    end)

  obs.obs_properties_add_text(props,  "away",       "Away abbreviation",    obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_text(props,  "home",       "Home abbreviation",    obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_color(props, "away_color",  "Away primary colour")
  obs.obs_properties_add_color(props, "away_color2", "Away secondary colour")
  obs.obs_properties_add_text(props,  "away_logo",  "Away logo URL",        obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_color(props, "home_color",  "Home primary colour")
  obs.obs_properties_add_color(props, "home_color2", "Home secondary colour")
  obs.obs_properties_add_text(props,  "home_logo",  "Home logo URL",        obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_bool(props,  "replay",     "Replay mode")
  obs.obs_properties_add_int(props,   "width",      "Width",  320, 3840, 1)
  obs.obs_properties_add_int(props,   "height",     "Height", 100, 2160, 1)

  obs.obs_properties_add_button(props, "btn_add", "Add / Update Source",
    function(_, _)
      add_or_update_source()
      return true
    end)

  return props
end

function script_defaults(settings)
  obs.obs_data_set_default_string(settings, "app_url",     "https://gamestreamer.example.com")
  obs.obs_data_set_default_string(settings, "game_id",     "")
  obs.obs_data_set_default_string(settings, "away",        "Away")
  obs.obs_data_set_default_string(settings, "home",        "Home")
  obs.obs_data_set_default_int(settings,    "away_color",  0xFFC0392B)  -- #c0392b
  obs.obs_data_set_default_int(settings,    "away_color2", 0xFF7B241C)  -- #7b241c
  obs.obs_data_set_default_string(settings, "away_logo",   "")
  obs.obs_data_set_default_int(settings,    "home_color",  0xFF2471A3)  -- #2471a3
  obs.obs_data_set_default_int(settings,    "home_color2", 0xFF1A5276)  -- #1a5276
  obs.obs_data_set_default_string(settings, "home_logo",   "")
  obs.obs_data_set_default_bool(settings,   "replay",      false)
  obs.obs_data_set_default_int(settings,    "width",       800)
  obs.obs_data_set_default_int(settings,    "height",      240)
end

function script_update(settings)
  current_settings = settings
end

function script_load(settings)
  current_settings = settings
  obs.obs_frontend_add_event_callback(function(event)
    if event == obs.OBS_FRONTEND_EVENT_FINISHED_LOADING then
      if obs.obs_frontend_add_tools_menu_item then
        obs.obs_frontend_add_tools_menu_item(
          "Game Streamer: Update Scoreboard", add_or_update_source)
      end
    end
  end)
  -- Start streaming-control heartbeat (reports status + picks up commands)
  obs.timer_add(poll_streaming_control, 3000)
end

function script_unload()
  obs.timer_remove(poll_streaming_control)
end
