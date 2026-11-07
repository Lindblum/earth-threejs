// Options → Video → XR Resolution, as in grid-game-threejs: the headset's
// framebuffer scale (1 = the browser's recommended size). The browser fixes
// the framebuffer when an XR session starts, so a change takes a new session;
// turned down during one, it shows at once while dragging: each eye is drawn
// into that share of its part of the framebuffer (XRView.requestViewportScale,
// asked on every view three.js gets from the frame), from the next frame on.

/** The slider: 50% to 100% in steps of 5%. */
export const XR_RESOLUTION = Object.freeze({ min: 0.5, max: 1, step: 0.05, default: 1 });

let viewportScale = 1;
if (typeof XRFrame !== 'undefined' && XRFrame.prototype.getViewerPose) {
  const getViewerPose = XRFrame.prototype.getViewerPose;
  XRFrame.prototype.getViewerPose = function (space) {
    const pose = getViewerPose.call(this, space);
    if (pose && viewportScale < 1) for (const view of pose.views) view.requestViewportScale?.(viewportScale);
    return pose;
  };
}

/** XR Resolution `wanted` during a session started at `active` (null outside XR): each eye drawn into that share of it. */
export function setXRViewportScale(wanted, active) {
  viewportScale = active ? Math.min(1, wanted / active) : 1;
}
