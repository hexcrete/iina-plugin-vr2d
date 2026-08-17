"use strict";

/**
 * Viewing-frustum maths shared by the view controller and the filter builder.
 *
 * `v360` is driven by a *diagonal* field of view (`d_fov`), but panning limits
 * and drag sensitivity are much easier to reason about horizontally and
 * vertically, so most of this file converts between the two.
 *
 * Like `detect.js`, this module touches no `iina` API and is unit tested with
 * plain node.
 */

var DEG = 180 / Math.PI;
var RAD = Math.PI / 180;

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

/** Fold an angle into [-180, 180), the range `v360` accepts for `yaw`. */
function wrap180(deg) {
  var x = ((deg + 180) % 360 + 360) % 360;
  return x - 180;
}

/**
 * Split a diagonal FOV into its horizontal and vertical components for a
 * rectilinear (gnomonic) projection of the given pixel size.
 */
function fovComponents(dFov, width, height) {
  var diagonal = Math.hypot(width, height);
  var halfDiag = Math.tan(clamp(dFov, 1, 179) / 2 * RAD);
  return {
    h: 2 * Math.atan((width / diagonal) * halfDiag) * DEG,
    v: 2 * Math.atan((height / diagonal) * halfDiag) * DEG,
  };
}

/** Inverse of {@link fovComponents} for the horizontal axis. */
function diagonalFromHorizontal(hFov, width, height) {
  var diagonal = Math.hypot(width, height);
  return 2 * Math.atan((diagonal / width) * Math.tan(clamp(hFov, 1, 179) / 2 * RAD)) * DEG;
}

/** Inverse of {@link fovComponents} for the vertical axis. */
function diagonalFromVertical(vFov, width, height) {
  var diagonal = Math.hypot(width, height);
  return 2 * Math.atan((diagonal / height) * Math.tan(clamp(vFov, 1, 179) / 2 * RAD)) * DEG;
}

// Beyond this a rectilinear projection stretches the edges into mush.
var MAX_DIAGONAL_FOV = 150;
var MIN_DIAGONAL_FOV = 15;

/**
 * Widest diagonal FOV that still fits inside what the source actually covers,
 * so zooming out can never reveal the void outside a 180° hemisphere.
 */
function maxFov(source, width, height) {
  var limits = [MAX_DIAGONAL_FOV];
  if (source.inHFov < 360) {
    limits.push(diagonalFromHorizontal(Math.min(source.inHFov, 170), width, height));
  }
  limits.push(diagonalFromVertical(Math.min(source.inVFov, 170), width, height));
  return clamp(Math.min.apply(null, limits), MIN_DIAGONAL_FOV, MAX_DIAGONAL_FOV);
}

/**
 * Constrain a view so it always looks at real pixels: yaw wraps freely on a
 * full sphere but is fenced in on a hemisphere, and pitch never tips past the
 * poles.
 */
function clampView(view, source, width, height) {
  var fov = clamp(view.fov, MIN_DIAGONAL_FOV, maxFov(source, width, height));
  var parts = fovComponents(fov, width, height);

  var yaw;
  if (source.inHFov >= 359) {
    yaw = wrap180(view.yaw);
  } else {
    var yawLimit = Math.max(0, (source.inHFov - parts.h) / 2);
    yaw = clamp(view.yaw, -yawLimit, yawLimit);
  }

  var pitchLimit = Math.max(0, (source.inVFov - parts.v) / 2);
  var pitch = clamp(view.pitch, -pitchLimit, pitchLimit);

  return { yaw: yaw, pitch: pitch, fov: fov };
}

/**
 * Translate a mouse drag into a view change, so the image tracks the cursor:
 * dragging right swings the view left, dragging down tips it up.
 *
 * @param {object} view current view
 * @param {object} drag `{dx, dy, width, height}` in surface pixels
 * @param {number} sensitivity multiplier, 1 means 1:1 with the cursor
 */
function applyDrag(view, drag, sensitivity) {
  var parts = fovComponents(view.fov, drag.width, drag.height);
  var scale = sensitivity == null ? 1 : sensitivity;
  return {
    yaw: view.yaw - (drag.dx / drag.width) * parts.h * scale,
    pitch: view.pitch + (drag.dy / drag.height) * parts.v * scale,
    fov: view.fov,
  };
}

/**
 * Zoom by a number of notches. Multiplicative so each notch feels the same
 * whether you are wide open or zoomed right in.
 */
function applyZoom(view, notches) {
  return {
    yaw: view.yaw,
    pitch: view.pitch,
    fov: clamp(view.fov * Math.pow(1.1, notches), MIN_DIAGONAL_FOV, MAX_DIAGONAL_FOV),
  };
}

/**
 * Pan by a step expressed as a fraction of the visible field, so a keypress
 * moves the same *apparent* distance no matter the zoom level.
 */
function applyPanStep(view, dxDeg, dyDeg) {
  return { yaw: view.yaw + dxDeg, pitch: view.pitch + dyDeg, fov: view.fov };
}

module.exports = {
  clamp: clamp,
  wrap180: wrap180,
  fovComponents: fovComponents,
  diagonalFromHorizontal: diagonalFromHorizontal,
  diagonalFromVertical: diagonalFromVertical,
  maxFov: maxFov,
  clampView: clampView,
  applyDrag: applyDrag,
  applyZoom: applyZoom,
  applyPanStep: applyPanStep,
  MIN_DIAGONAL_FOV: MIN_DIAGONAL_FOV,
  MAX_DIAGONAL_FOV: MAX_DIAGONAL_FOV,
};
