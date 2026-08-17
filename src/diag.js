"use strict";

/**
 * Tracing for filter-state bugs. Off by default; flip `ENABLED` to switch it on.
 *
 * The plugin has no file-system access and its own console is not readable from
 * a shell, so everything here goes through mpv. `log-file` captures mpv's
 * internal messages — libavfilter graph construction, chain reconfigures,
 * decoder format changes — at debug level, and `print-text` interleaves our own
 * state with them on the same timeline. That pairing is what identified the
 * panning bug: it showed a graph rebuild happening 29 ms after a decoder
 * re-initialisation, with no event reaching the plugin until after the view had
 * already been thrown away.
 *
 * `shot()` writes a post-filter frame with the view the plugin believed at the
 * time encoded in the file name, so a reference render built from those numbers
 * can be compared against it. That is the only way to tell "the picture moved"
 * apart from "our state moved", and the two disagreeing is the whole bug class.
 * Chroma read out of a screenshot is *not* a reliable substitute — the colour
 * matrix does not survive the round trip, and it reads a 30° pan as 23°.
 */

var mpv = iina.mpv;

var ENABLED = false;

// More than one IINA can be running — an installed build and a development
// build both load this plugin — and they would otherwise truncate each other's
// log and interleave screenshots. One tag per plugin instance keeps them apart.
var TAG = Math.random().toString(36).slice(2, 8);
var LOG_PATH = "/private/tmp/vr2d-mpv-" + TAG + ".log";
// Must already exist: mpv will not create it.
var SHOT_DIR = "/private/tmp/vr2d-shots";
var BEAT_MS = 250;

var t0 = Date.now();
var started = false;
var shotSeq = 0;

function start() {
  if (!ENABLED || started) return;
  started = true;
  try {
    mpv.set("log-file", LOG_PATH);
  } catch (e) {
    // Nothing else to try; the print-text lines will simply go nowhere.
  }
  log("diag-start", LOG_PATH);
}

function log(tag, detail) {
  if (!ENABLED) return;
  try {
    mpv.command("print-text", [
      "VR2D-DIAG " + (Date.now() - t0) + " " + tag + (detail ? " " + detail : ""),
    ]);
  } catch (e) {
    // Ignore; tracing must never break playback.
  }
}

function v(view) {
  if (!view) return "null";
  return "y" + Math.round(view.yaw * 10) / 10 + "/p" + Math.round(view.pitch * 10) / 10 +
    "/f" + Math.round(view.fov * 10) / 10;
}

/** Post-filter frame, named with the view the plugin thinks it is showing. */
function shot(view) {
  if (!ENABLED) return;
  shotSeq += 1;
  // Tenths of a degree, so the frame can be checked against a reference render
  // built from exactly the numbers the plugin believed at that moment.
  var name =
    SHOT_DIR + "/" + TAG + "_" + pad(shotSeq) + "_t" + (Date.now() - t0) +
    "_y" + Math.round(view.yaw * 10) +
    "_p" + Math.round(view.pitch * 10) +
    "_f" + Math.round(view.fov * 10) + ".png";
  try {
    // "window" is post-filter; "video" would be the untouched source.
    mpv.command("screenshot-to-file", [name, "window"]);
  } catch (e) {
    log("shot-failed", String(e));
  }
}

function pad(n) {
  return n < 10 ? "00" + n : n < 100 ? "0" + n : String(n);
}

/**
 * Sample the session's state, the view baked into the filter string, and what
 * mpv reports coming out of the chain, alongside a periodic frame capture.
 */
function startHeartbeat(session) {
  if (!ENABLED) return;
  var beats = 0;
  setInterval(function () {
    if (!session.state.enabled) return;
    beats += 1;

    var out = "?";
    try {
      var params = mpv.getNative("video-out-params");
      if (params) out = params.w + "x" + params.h + "/" + params.pixelformat;
    } catch (e) {
      // Property unreadable; the rest of the line is still worth having.
    }

    log(
      "beat",
      "view=" + v(session.state.view) +
        " string=" + v(session.attachedView()) +
        " sent=y" + session.pushed.yaw + "/p" + session.pushed.pitch +
        " out=" + out
    );
    if (beats % 2 === 0) shot(session.state.view);
  }, BEAT_MS);
}

module.exports = {
  ENABLED: ENABLED,
  SHOT_DIR: SHOT_DIR,
  start: start,
  startHeartbeat: startHeartbeat,
  log: log,
  v: v,
  shot: shot,
};
