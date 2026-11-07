import { useEffect } from 'react';
import { advance, useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';

// The see-through face looks (Glass, Water, Soap, Frosted) are
// costly: three.js draws the scene a second time, per eye, for them to
// refract. While one is showing:
//   - that extra render is drawn at half resolution (a quarter of the pixels);
//     the blurred, bent view through the faces looks the same
//   - frames are paced at about 72 per second instead of the display's
//     fastest, so each has more time. In XR the headset is asked for its
//     lowest refresh rate of at least 72 Hz (72 on Quest); missed frames
//     there show as judder. Outside XR, renders are skipped on displays
//     faster than that (120/144 Hz); at 60 Hz nothing changes.
//
// Options → Video → VSync, as in grid-game-threejs. On: a frame per display
// refresh. Off (outside XR): the next frame starts as soon as one is done (a
// message loop), so the frame rate isn't capped at the refresh rate, nor at
// the see-through looks' ~72; the browser still shows them at its own
// refreshes. An XR session, or a hidden page, always waits for its frames.

const SEE_THROUGH_FPS = 72;
const TRANSMISSION_SCALE = 0.5;

/** Paces rendering for the current face look and VSync; mount inside the Canvas. */
export function FramePacing({ seeThrough, vsync }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const session = useXR((s) => s.session);

  useEffect(() => {
    gl.transmissionResolutionScale = seeThrough ? TRANSMISSION_SCALE : 1;
  }, [gl, seeThrough]);

  // XR: the headset's refresh rate
  useEffect(() => {
    const rates = session?.supportedFrameRates;
    if (!session?.updateTargetFrameRate || !rates?.length) return;
    const sorted = [...rates].sort((a, b) => a - b);
    const fastest = sorted[sorted.length - 1];
    const target = seeThrough ? (sorted.find((r) => r >= SEE_THROUGH_FPS - 0.5) ?? fastest) : fastest;
    session.updateTargetFrameRate(target).catch((e) => console.warn('[earth] frame rate not changed:', e?.message ?? e));
  }, [session, seeThrough]);

  // VSync off, outside XR: a frame as soon as the last is done. "Done" is the
  // GPU's: a fence after each frame, and the next waits for the one before
  // last, so no more than two are in flight. (Started as fast as JavaScript
  // can, frames pile up in the GPU's queue faster than it draws them: the
  // page stops repainting, and doesn't recover when VSync comes back on.)
  useEffect(() => {
    if (vsync || session) return;
    const context = gl.getContext();
    if (!context.fenceSync) return; // (WebGL 1: VSync stays on)
    setFrameloop('never');
    const loop = new MessageChannel();
    const fences = [];
    let running = true;
    loop.port1.onmessage = () => {
      if (!running) return;
      if (document.hidden) return void requestAnimationFrame(() => loop.port2.postMessage(0)); // (rests while hidden)
      if (fences.length >= 2) {
        if (context.clientWaitSync(fences[0], 0, 0) === context.TIMEOUT_EXPIRED) return void loop.port2.postMessage(0);
        context.deleteSync(fences.shift());
      }
      advance(performance.now());
      fences.push(context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0));
      context.flush();
      loop.port2.postMessage(0);
    };
    loop.port2.postMessage(0);
    return () => {
      running = false;
      loop.port1.close();
      for (const fence of fences) context.deleteSync(fence);
      setFrameloop('always');
    };
  }, [vsync, session, gl, setFrameloop]);

  // outside XR, VSync on: render on demand, asking for at most ~72 frames a second
  useEffect(() => {
    if (!seeThrough || session || !vsync) return;
    setFrameloop('demand');
    const interval = 1000 / SEE_THROUGH_FPS - 2; // slack, so a 60 Hz display still gets every frame
    let last = -Infinity;
    let frame = requestAnimationFrame(function tick(now) {
      if (now - last >= interval) {
        last = now;
        invalidate();
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      setFrameloop('always');
    };
  }, [seeThrough, session, vsync, invalidate, setFrameloop]);

  return null;
}
