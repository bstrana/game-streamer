--[[
  game-streamer OBS Script
  ========================
  Adds (or updates) a Browser Source for a WBSC game scoreboard overlay
  powered by the Game Streamer app.

  Setup:
    1. In OBS → Tools → Scripts → "+" → select this file.
    2. Fill in the App URL and click "Add / Update Source".

  The script creates a browser source named "Game Streamer Scoreboard"
  in the current scene. Re-running with a different game ID updates
  the existing source rather than creating a duplicate.

  URL format used:
    {App URL}/overlay/game/{Game ID}
      ?away={Away abbr}&home={Home abbr}
      &awayColor={hex}&awayColor2={hex}
      &homeColor={hex}&homeColor2={hex}
      &awayLogo={url}&homeLogo={url}
      &replay={0|1}
]]

obs = obslua
local bit = require("bit")

-- ── Script description shown in the Scripts panel ────────────────────────────
function script_description()
  return [[<h3>Game Streamer Scoreboard</h3>
<p>Creates or updates a Browser Source for a WBSC baseball scoreboard overlay.</p>
<p>Fill in the fields below and click <b>Add / Update Source</b>.</p>]]
end

-- ── Settings definition ───────────────────────────────────────────────────────
function script_properties()
  local props = obs.obs_properties_create()

  obs.obs_properties_add_text(props, "app_url",    "App URL",              obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_text(props, "game_id",    "Game ID",              obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_text(props, "away",       "Away abbreviation",    obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_text(props, "home",       "Home abbreviation",    obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_color(props, "away_color",  "Away primary colour")
  obs.obs_properties_add_color(props, "away_color2", "Away secondary colour")
  obs.obs_properties_add_path(props, "away_logo", "Away logo file",
    obs.OBS_PATH_FILE, "Image files (*.png *.jpg *.jpeg *.gif *.svg *.webp)", nil)
  obs.obs_properties_add_color(props, "home_color",  "Home primary colour")
  obs.obs_properties_add_color(props, "home_color2", "Home secondary colour")
  obs.obs_properties_add_path(props, "home_logo", "Home logo file",
    obs.OBS_PATH_FILE, "Image files (*.png *.jpg *.jpeg *.gif *.svg *.webp)", nil)
  obs.obs_properties_add_bool(props,  "replay",    "Replay mode")
  obs.obs_properties_add_int(props,   "width",     "Width",  320, 3840, 1)
  obs.obs_properties_add_int(props,   "height",    "Height", 100, 2160, 1)

  obs.obs_properties_add_button(props, "btn_add", "Add / Update Source",
    function(p, prop)
      add_or_update_source()
      return true
    end)

  return props
end

-- ── Default values ────────────────────────────────────────────────────────────
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

-- Keep a reference to current settings
local current_settings = nil
function script_update(settings)
  current_settings = settings
end

-- Called when the Tools menu item is clicked
local function on_tools_menu()
  add_or_update_source()
end

function script_load(settings)
  current_settings = settings
  -- Defer menu registration until OBS has finished building its frontend.
  -- Calling obs_frontend_add_tools_menu_item too early (before
  -- OBS_FRONTEND_EVENT_FINISHED_LOADING) results in a no-op.
  obs.obs_frontend_add_event_callback(function(event)
    if event == obs.OBS_FRONTEND_EVENT_FINISHED_LOADING then
      obs.obs_frontend_add_tools_menu_item(
        "Game Streamer: Update Scoreboard", on_tools_menu)
    end
  end)
end

-- ── Helpers ───────────────────────────────────────────────────────────────────
-- Convert OBS ABGR int to a 6-char hex string (without #)
-- Uses LuaJIT bit library (Lua 5.1 — OBS does not support Lua 5.3 bitwise ops)
local function color_to_hex(abgr)
  local r = bit.band(abgr, 0xFF)
  local g = bit.band(bit.rshift(abgr, 8),  0xFF)
  local b = bit.band(bit.rshift(abgr, 16), 0xFF)
  return string.format("%02x%02x%02x", r, g, b)
end

-- Percent-encode a string for use inside a URL query parameter value
local function url_encode(str)
  if str == nil or str == "" then return "" end
  return str:gsub("([^%w%-%.%_%~])", function(c)
    return string.format("%%%02X", string.byte(c))
  end)
end

-- ── Base64 encoder ───────────────────────────────────────────────────────────
-- OBS uses LuaJIT (Lua 5.1) — uses bit library for bitwise ops.
local _b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

local function base64_encode(data)
  local out = {}
  local n = #data
  local i = 1
  while i <= n - 2 do
    local a, b, c = data:byte(i, i + 2)
    local v = a * 65536 + b * 256 + c
    out[#out+1] = _b64chars:sub(bit.rshift(v, 18)                    + 1, bit.rshift(v, 18)                    + 1)
    out[#out+1] = _b64chars:sub(bit.band(bit.rshift(v, 12), 63)      + 1, bit.band(bit.rshift(v, 12), 63)      + 1)
    out[#out+1] = _b64chars:sub(bit.band(bit.rshift(v,  6), 63)      + 1, bit.band(bit.rshift(v,  6), 63)      + 1)
    out[#out+1] = _b64chars:sub(bit.band(v, 63)                      + 1, bit.band(v, 63)                      + 1)
    i = i + 3
  end
  if i == n then          -- 1 remaining byte
    local v = data:byte(i) * 65536
    out[#out+1] = _b64chars:sub(bit.rshift(v, 18)               + 1, bit.rshift(v, 18)               + 1)
    out[#out+1] = _b64chars:sub(bit.band(bit.rshift(v, 12), 63) + 1, bit.band(bit.rshift(v, 12), 63) + 1)
    out[#out+1] = '=='
  elseif i == n - 1 then  -- 2 remaining bytes
    local v = data:byte(i) * 65536 + data:byte(i + 1) * 256
    out[#out+1] = _b64chars:sub(bit.rshift(v, 18)               + 1, bit.rshift(v, 18)               + 1)
    out[#out+1] = _b64chars:sub(bit.band(bit.rshift(v, 12), 63) + 1, bit.band(bit.rshift(v, 12), 63) + 1)
    out[#out+1] = _b64chars:sub(bit.band(bit.rshift(v,  6), 63) + 1, bit.band(bit.rshift(v,  6), 63) + 1)
    out[#out+1] = '='
  end
  return table.concat(out)
end

local _mime = { png='image/png', jpg='image/jpeg', jpeg='image/jpeg',
                gif='image/gif', svg='image/svg+xml', webp='image/webp' }

-- Read a local image file and return a data: URL encoded for a query param.
-- OBS browser source (CEF) blocks file:// URLs, but data: URLs work fine.
local function path_to_logo_param(path)
  if path == nil or path == "" then return "" end
  local f = io.open(path, "rb")
  if not f then
    obs.script_log(obs.LOG_WARNING, "Game Streamer: logo file not found: " .. path)
    return ""
  end
  local data = f:read("*a")
  f:close()
  local ext  = (path:match("%.(%w+)$") or "png"):lower()
  local mime = _mime[ext] or "image/png"
  local data_url = "data:" .. mime .. ";base64," .. base64_encode(data)
  return url_encode(data_url)
end

local function build_url(s)
  local base      = obs.obs_data_get_string(s, "app_url"):gsub("/+$", "")
  local game_id   = url_encode(obs.obs_data_get_string(s, "game_id"))
  local away      = url_encode(obs.obs_data_get_string(s, "away"))
  local home      = url_encode(obs.obs_data_get_string(s, "home"))
  local c1        = color_to_hex(obs.obs_data_get_int(s, "away_color"))
  local c2        = color_to_hex(obs.obs_data_get_int(s, "away_color2"))
  local away_logo = path_to_logo_param(obs.obs_data_get_string(s, "away_logo"))
  local c3        = color_to_hex(obs.obs_data_get_int(s, "home_color"))
  local c4        = color_to_hex(obs.obs_data_get_int(s, "home_color2"))
  local home_logo = path_to_logo_param(obs.obs_data_get_string(s, "home_logo"))
  local replay    = obs.obs_data_get_bool(s, "replay") and "1" or "0"

  local url = string.format(
    "%s/overlay/game/%s?away=%s&home=%s&awayColor=%s&awayColor2=%s&homeColor=%s&homeColor2=%s&replay=%s",
    base, game_id, away, home, c1, c2, c3, c4, replay
  )

  if away_logo ~= "" then url = url .. "&awayLogo=" .. away_logo end
  if home_logo ~= "" then url = url .. "&homeLogo=" .. home_logo end

  return url
end

local SOURCE_NAME = "Game Streamer Scoreboard"

function add_or_update_source()
  if not current_settings then return end

  local game_id = obs.obs_data_get_string(current_settings, "game_id")
  if game_id == "" then
    obs.script_log(obs.LOG_WARNING, "Game ID is empty — enter a game ID first.")
    return
  end

  local url    = build_url(current_settings)
  local width  = obs.obs_data_get_int(current_settings, "width")
  local height = obs.obs_data_get_int(current_settings, "height")

  -- Log a readable summary (skip logo data blobs which can be hundreds of KB)
  local base = obs.obs_data_get_string(current_settings, "app_url"):gsub("/+$", "")
  local gid  = obs.obs_data_get_string(current_settings, "game_id")
  obs.script_log(obs.LOG_INFO, string.format(
    "Game Streamer: %s/overlay/game/%s  [%dx%d]", base, gid, width, height))

  -- Build browser-source settings
  local browser_settings = obs.obs_data_create()
  obs.obs_data_set_string(browser_settings, "url",    url)
  obs.obs_data_set_int(browser_settings,    "width",  width)
  obs.obs_data_set_int(browser_settings,    "height", height)
  obs.obs_data_set_bool(browser_settings,   "shutdown_on_scene_switch", false)

  -- Try to find an existing source with this name
  local existing = obs.obs_get_source_by_name(SOURCE_NAME)
  if existing then
    obs.obs_source_update(existing, browser_settings)
    obs.obs_source_release(existing)
    obs.script_log(obs.LOG_INFO, "Game Streamer: updated existing source.")
  else
    -- Create new source and add to current scene
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
