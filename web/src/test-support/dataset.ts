import {
  CAPTURE_MS,
  CONSENT_VERSION,
  HandCapture,
  SCHEMA_VERSION,
  assessQuality,
  type DatasetSample,
} from '../dataset/schema';
import { LEFT_HAND_START, emptyFrame } from '../ml/landmarks';

export function sample(): DatasetSample {
  const frame = emptyFrame();
  for (let i = 0; i < 21; i++) frame.set([0.3 + i / 100, 0.5, -0.02], (LEFT_HAND_START + i) * 3);
  const capture = new HandCapture(1000);
  for (let i = 0; i < 60; i++) capture.add(frame, 1000 + i * 40, 1);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'test-sample',
    recordedAt: '2026-11-17T00:00:00.000Z',
    label: { language: 'krsl', classId: 'salem', ru: 'Привет', kk: 'Сәлем' },
    participantId: 'P01',
    sessionId: 'session-1',
    source: 'camera',
    camera: { width: 640, height: 480, frameRate: 30 },
    consent: {
      version: CONSENT_VERSION,
      acceptedAt: '2026-11-16T23:59:00.000Z',
      scope: 'local-landmarks-and-export',
    },
    tracker: {
      library: '@mediapipe/tasks-vision',
      version: '1.2.2',
      featureSet: 'hands_pose_lips',
      delegate: 'CPU',
      landmarkModel: 'holistic_landmarker.task',
    },
    coordinates: 'mediapipe-normalized-xyz-unmirrored',
    featureVersion: 'raw-hands-xyz-v1',
    durationMs: CAPTURE_MS,
    frames: capture.frames,
    quality: assessQuality(capture.frames, CAPTURE_MS),
  };
}
