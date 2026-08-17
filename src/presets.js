"use strict";

/** Projection choices offered in the menu, and what they mean to `v360`. */
var PROJECTIONS = [
  { id: "auto", title: "Auto" },
  { id: "he180", title: "180° Equirectangular", projection: "he", hFov: 180, vFov: 180 },
  { id: "e360", title: "360° Equirectangular", projection: "e", hFov: 360, vFov: 180 },
  { id: "eac", title: "Equi-Angular Cubemap", projection: "eac", hFov: 360, vFov: 180 },
  { id: "fish180", title: "Fisheye 180°", projection: "fisheye", hFov: 180, vFov: 180 },
  { id: "fish190", title: "Fisheye 190° (RF5.2)", projection: "fisheye", hFov: 190, vFov: 190 },
  { id: "fish200", title: "Fisheye 200° (MKX200)", projection: "fisheye", hFov: 200, vFov: 200 },
  { id: "fish220", title: "Fisheye 220° (MKX220)", projection: "fisheye", hFov: 220, vFov: 220 },
];

/** Stereo layout choices offered in the menu. */
var LAYOUTS = [
  { id: "auto", title: "Auto" },
  { id: "sbs", title: "Side-by-Side", layout: "sbs", swapEyes: false },
  { id: "rl", title: "Side-by-Side (Right Eye First)", layout: "sbs", swapEyes: true },
  { id: "tb", title: "Over-Under", layout: "tb", swapEyes: false },
  { id: "bt", title: "Over-Under (Bottom Eye First)", layout: "tb", swapEyes: true },
  { id: "mono", title: "Monoscopic", layout: "mono", swapEyes: false },
];

/** Reprojection output heights. Cost scales with output pixels, not source. */
var QUALITIES = [
  { id: 720, title: "720p — lightest" },
  { id: 1080, title: "1080p — balanced" },
  { id: 1440, title: "1440p" },
  { id: 2160, title: "2160p — heaviest" },
];

function byId(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].id) === String(id)) return list[i];
  }
  return null;
}

module.exports = {
  PROJECTIONS: PROJECTIONS,
  LAYOUTS: LAYOUTS,
  QUALITIES: QUALITIES,
  byId: byId,
};
