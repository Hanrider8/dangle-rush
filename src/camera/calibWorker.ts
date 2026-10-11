/** Worker samokalibrácie kamery: výpočet trvá desiatky ms, hlavné vlákno by stratilo snímky. */
import { calibrateStatic } from '../tracking/calibration';
import { PoseHistory } from '../tracking/poseHistory';
import type { CalibRequest, CalibResponse } from './protocol';

const scope = self as unknown as {
  postMessage(message: CalibResponse): void;
  onmessage: ((e: MessageEvent<CalibRequest>) => void) | null;
};

scope.onmessage = (e) => {
  const req = e.data;
  const t0 = performance.now();
  const poses = PoseHistory.fromArrays(req.poseTimes, req.poseData);
  const result = calibrateStatic(req.t, req.u, req.v, poses, req.init, req.planeY, req.config);
  scope.postMessage({ type: 'result', id: req.id, result, ms: performance.now() - t0 });
};
