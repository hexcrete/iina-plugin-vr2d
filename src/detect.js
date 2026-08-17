"use strict";

/**
 * VR source detection.
 *
 * Works out, from the file name plus whatever the container told mpv, how a
 * video is packed:
 *
 *   - `layout`     how the two eyes are stored in the frame (sbs / tb / mono)
 *   - `swapEyes`   true when the right eye comes first (RL / BT)
 *   - `projection` how a single eye maps onto the sphere (he / e / fisheye / eac)
 *   - `inHFov`     horizontal field of view covered by the source, in degrees
 *   - `inVFov`     vertical field of view covered by the source, in degrees
 *
 * This module is deliberately free of any `iina` API use so it can be unit
 * tested with plain node (see `test/detect.test.js`).
 */

// ---------------------------------------------------------------------------
// Name tokenising
// ---------------------------------------------------------------------------

/** Strip a URL down to its file name, without query string or extension. */
function basename(url) {
  var s = String(url == null ? "" : url);
  var cut = s.indexOf("#");
  if (cut >= 0) s = s.slice(0, cut);
  cut = s.indexOf("?");
  if (cut >= 0) s = s.slice(0, cut);
  var slash = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  if (slash >= 0) s = s.slice(slash + 1);
  try {
    s = decodeURIComponent(s);
  } catch (e) {
    // Malformed percent-escapes: keep the raw name, it is still useful.
  }
  return s.replace(/\.[a-z0-9]{1,5}$/i, "");
}

/**
 * Split a file name into lowercase alphanumeric tokens.
 * `"Clip_180_180x180_3dh_LR.mp4"` becomes
 * `["clip", "180", "180x180", "3dh", "lr"]`.
 */
function tokenize(url) {
  return basename(url)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(function (t) {
      return t.length > 0;
    });
}

// ---------------------------------------------------------------------------
// Token vocabulary
// ---------------------------------------------------------------------------

// How the two eyes are laid out inside one frame.
var SBS_TOKENS = ["3dh", "sbs", "hsbs", "fsbs", "sbs2l", "lr", "leftright"];
var SBS_SWAPPED_TOKENS = ["rl", "sbs2r", "rightleft"];
var TB_TOKENS = ["3dv", "tb", "ou", "htb", "ftb", "ab2l", "overunder", "topbottom"];
var TB_SWAPPED_TOKENS = ["bt", "ab2r", "ut", "bottomtop"];
var MONO_TOKENS = ["mono", "2d", "monoscopic"];

// Lens / camera profiles. These names imply both a fisheye projection and,
// by near-universal convention, a side-by-side stereo pair.
var LENS_PROFILES = {
  mkx200: 200,
  mkx220: 220,
  vrca220: 220,
  rf52: 190,
  f180: 180,
};

// Projection named outright in the file name.
var EQUIRECT180_TOKENS = ["180x180", "vr180", "equirect180", "er180", "hequirect"];
var EQUIRECT360_TOKENS = ["360x180", "vr360", "equirect", "erp", "spherical"];
var EAC_TOKENS = ["eac", "equiangular"];

// Only a hint on its own — plenty of non-VR files contain a bare "180"/"360",
// and a headset name says nothing about the packing.
var WEAK_VR_TOKENS = [
  "vr",
  "oculus",
  "gearvr",
  "psvr",
  "daydream",
  "deovr",
  "smartphone",
  "vive",
  "quest",
  "headset",
];

// ---------------------------------------------------------------------------
// Aspect-ratio reasoning
// ---------------------------------------------------------------------------

// Aspect ratio of one eye once the frame has been split, keyed by layout.
function perEyeAspect(aspect, layout) {
  if (layout === "sbs") return aspect / 2;
  if (layout === "tb") return aspect * 2;
  return aspect;
}

function near(value, target, tolerance) {
  if (!(value > 0) || !(target > 0)) return false;
  return Math.abs(value - target) / target <= (tolerance || 0.08);
}

/** The shape one eye takes in each projection, as a width/height ratio. */
var PROJECTION_EYE_ASPECT = {
  he: 1, // a 180x180 hemisphere is square
  fisheye: 1, // so is a fisheye circle's bounding box
  e: 2, // a full sphere is 360x180
  eac: 1.5, // a cubemap's six faces packed 3x2
};

/**
 * Layouts whose per-eye aspect ratio would come out at a sane VR value
 * (1:1 for a 180° hemisphere, 2:1 for a full 360° sphere).
 * Ordered most to least likely.
 */
function layoutsMatchingAspect(aspect) {
  var out = [];
  ["sbs", "tb", "mono"].forEach(function (layout) {
    var eye = perEyeAspect(aspect, layout);
    if (near(eye, 2)) out.push({ layout: layout, projection: "e" });
    else if (near(eye, 1)) out.push({ layout: layout, projection: "he" });
  });
  return out;
}

/**
 * Whether the frame's shape is consistent with what we believe it holds.
 *
 * When the projection is known, ask that projection directly instead of going
 * through the table of common shapes — an equi-angular cubemap is 3:2 per eye,
 * which is not a shape the table lists, so a file whose name said "eac" outright
 * was judged impossible and never turned VR2D on.
 *
 * When the projection is *not* known, only the common shapes are safe to accept:
 * inferring from an unusual aspect ratio alone would start flattening ordinary
 * videos that happen to carry a stereo-sounding word in their name.
 */
function aspectAgrees(aspect, layout, projection, candidates) {
  var expected = projection ? PROJECTION_EYE_ASPECT[projection] : null;
  if (expected) {
    return ["sbs", "tb", "mono"].some(function (candidate) {
      if (layout && candidate !== layout) return false;
      return near(perEyeAspect(aspect, candidate), expected, 0.12);
    });
  }
  return candidates.some(function (c) {
    return !layout || c.layout === layout;
  });
}

// ---------------------------------------------------------------------------
// Container metadata
// ---------------------------------------------------------------------------

/**
 * Interpret mpv's `video-params/stereo-in`, which surfaces the container's
 * stereoscopic flag (Matroska StereoMode, MP4 `st3d`).
 */
function layoutFromStereoIn(stereoIn) {
  if (!stereoIn || stereoIn === "mono" || stereoIn === "unknown") return null;
  var s = String(stereoIn).toLowerCase();
  if (s.indexOf("sbs") === 0) return { layout: "sbs", swapEyes: s === "sbs2r" };
  if (s.indexOf("ab") === 0) return { layout: "tb", swapEyes: s === "ab2r" };
  return null;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

var PROJECTION_FOV = {
  he: { h: 180, v: 180 },
  e: { h: 360, v: 180 },
  eac: { h: 360, v: 180 },
  fisheye: { h: 180, v: 180 },
};

/**
 * Analyse a video.
 *
 * @param {object} info
 * @param {string} info.url        file path or URL
 * @param {number} info.width      decoded frame width in pixels
 * @param {number} info.height     decoded frame height in pixels
 * @param {string} [info.stereoIn] mpv's `video-params/stereo-in`
 * @param {boolean} [info.aggressive] treat weak hints as enough to auto-enable
 * @returns {object} descriptor, see module docblock
 */
function detect(info) {
  var tokens = tokenize(info.url);
  var has = function (t) {
    return tokens.indexOf(t) >= 0;
  };
  var hasAny = function (list) {
    return list.some(has);
  };

  var aspect = info.width > 0 && info.height > 0 ? info.width / info.height : 0;

  var strong = []; // evidence good enough to turn VR2D on by itself
  var weak = []; // evidence that only counts alongside a plausible aspect

  var layout = null;
  var swapEyes = false;
  var projection = null;
  var hFov = null;
  var vFov = null;

  // --- container metadata: the most trustworthy source we have -------------
  var fromContainer = layoutFromStereoIn(info.stereoIn);
  if (fromContainer) {
    layout = fromContainer.layout;
    swapEyes = fromContainer.swapEyes;
    strong.push("container stereo flag (" + info.stereoIn + ")");
  }

  // --- explicit stereo layout in the name ---------------------------------
  if (hasAny(SBS_SWAPPED_TOKENS)) {
    layout = "sbs";
    swapEyes = true;
    strong.push("name says side-by-side, right eye first");
  } else if (hasAny(SBS_TOKENS)) {
    layout = "sbs";
    swapEyes = false;
    strong.push("name says side-by-side");
  } else if (hasAny(TB_SWAPPED_TOKENS)) {
    layout = "tb";
    swapEyes = true;
    strong.push("name says over-under, bottom eye first");
  } else if (hasAny(TB_TOKENS)) {
    layout = "tb";
    swapEyes = false;
    strong.push("name says over-under");
  } else if (hasAny(MONO_TOKENS)) {
    layout = "mono";
    strong.push("name says monoscopic");
  }

  // --- lens profile: implies fisheye, and conventionally side-by-side ------
  var lensToken = tokens.filter(function (t) {
    return Object.prototype.hasOwnProperty.call(LENS_PROFILES, t);
  })[0];
  var fisheyeToken = tokens.filter(function (t) {
    return /^fisheye\d{2,3}$/.test(t);
  })[0];

  if (lensToken) {
    projection = "fisheye";
    hFov = vFov = LENS_PROFILES[lensToken];
    strong.push("lens profile " + lensToken.toUpperCase() + " (" + hFov + "° fisheye)");
    if (!layout) layout = "sbs";
  } else if (fisheyeToken) {
    projection = "fisheye";
    hFov = vFov = parseInt(fisheyeToken.slice("fisheye".length), 10);
    strong.push("name says " + hFov + "° fisheye");
    if (!layout) layout = "sbs";
  } else if (has("fisheye")) {
    projection = "fisheye";
    hFov = vFov = 180;
    strong.push("name says fisheye");
    if (!layout) layout = "sbs";
  }

  // --- projection named in the file name ----------------------------------
  if (!projection) {
    if (hasAny(EQUIRECT180_TOKENS)) {
      projection = "he";
      strong.push("name says 180° equirectangular");
    } else if (hasAny(EAC_TOKENS)) {
      projection = "eac";
      strong.push("name says equi-angular cubemap");
    } else if (hasAny(EQUIRECT360_TOKENS)) {
      projection = "e";
      strong.push("name says 360° equirectangular");
    }
  }

  // --- weak hints ---------------------------------------------------------
  if (!projection && has("180")) {
    projection = "he";
    weak.push('bare "180" in the name');
  } else if (!projection && has("360")) {
    projection = "e";
    weak.push('bare "360" in the name');
  }
  var weakVr = tokens.filter(function (t) {
    return WEAK_VR_TOKENS.indexOf(t) >= 0;
  })[0];
  if (weakVr) weak.push('"' + weakVr + '" in the name');

  // --- fill the gaps from the frame geometry ------------------------------
  var candidates = layoutsMatchingAspect(aspect);
  var aspectFits = aspectAgrees(aspect, layout, projection, candidates);

  if (!layout) {
    // Nothing said how the eyes are packed, so let the frame's shape decide —
    // but only among the packings that agree with the projection we already
    // believe in. A 2:1 frame is 180° side-by-side or 360° monoscopic; knowing
    // which projection it is settles it.
    var matching = projection
      ? candidates.filter(function (c) {
          return c.projection === projection;
        })
      : [];
    if (matching.length === 0) {
      // Still ambiguous: read the frame as a single image rather than
      // inventing a stereo pair.
      matching = candidates.filter(function (c) {
        return c.layout === "mono";
      });
    }
    layout = matching.length ? matching[0].layout : candidates.length ? candidates[0].layout : "mono";
  }

  if (!projection) {
    var eye = perEyeAspect(aspect, layout);
    projection = near(eye, 2, 0.25) ? "e" : "he";
  }

  var defaults = PROJECTION_FOV[projection] || PROJECTION_FOV.he;
  if (hFov == null) hFov = defaults.h;
  if (vFov == null) vFov = defaults.v;

  // A 360° source stored as a single hemisphere-shaped eye is a contradiction;
  // trust the geometry over a bare "360" in the name.
  if (projection === "e" && near(perEyeAspect(aspect, layout), 1, 0.12)) {
    projection = "he";
    hFov = vFov = 180;
  }

  var auto =
    strong.length > 0
      ? aspectFits || aspect === 0
      : weak.length > 0 && aspectFits && !!info.aggressive;

  return {
    layout: layout,
    swapEyes: swapEyes,
    projection: projection,
    inHFov: hFov,
    inVFov: vFov,
    aspect: aspect,
    auto: auto,
    strong: strong,
    weak: weak,
    summary: summarize(layout, projection, hFov),
  };
}

/** Short human-readable description, e.g. `"180° equirect, side-by-side"`. */
function summarize(layout, projection, hFov) {
  var proj;
  if (projection === "fisheye") proj = hFov + "° fisheye";
  else if (projection === "he") proj = "180° equirect";
  else if (projection === "eac") proj = "equi-angular cubemap";
  else proj = "360° equirect";

  var stereo =
    layout === "sbs" ? "side-by-side" : layout === "tb" ? "over-under" : "monoscopic";

  return proj + ", " + stereo;
}

module.exports = {
  detect: detect,
  summarize: summarize,
  tokenize: tokenize,
  basename: basename,
  perEyeAspect: perEyeAspect,
  layoutFromStereoIn: layoutFromStereoIn,
};
