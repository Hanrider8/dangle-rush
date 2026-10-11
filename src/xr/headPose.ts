/**
 * Póza hlavy priamo z XRFrame. Kameru three.js nepoužívame: jej svetová matica sa v XR
 * aktualizuje až počas `renderer.render()`, takže by mala pózu o snímok neskôr.
 */
import type { HeadSample } from '../core/types';

/** Zapíše pózu do `out` bez alokácií na našej strane. */
export function readHeadPose(
  frame: XRFrame | undefined,
  space: XRReferenceSpace | null,
  out: HeadSample,
): void {
  const pose = frame && space ? frame.getViewerPose(space) : undefined;
  if (!pose) {
    out.valid = false;
    return;
  }
  const { position: p, orientation: o } = pose.transform;
  out.px = p.x;
  out.py = p.y;
  out.pz = p.z;
  out.qx = o.x;
  out.qy = o.y;
  out.qz = o.z;
  out.qw = o.w;
  // emulatedPosition = Quest stratil polohový tracking a odhaduje len rotáciu.
  out.valid = !pose.emulatedPosition;
}
