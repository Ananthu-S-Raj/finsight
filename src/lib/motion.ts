export const HAPTIC = {
  light: [6],
  toggle: [10],
  fab: [12, 40, 16],
  success: [16, 50, 24],
  warning: [18, 60, 18, 60, 30],
} as const;

export type HapticKind = keyof typeof HAPTIC;
