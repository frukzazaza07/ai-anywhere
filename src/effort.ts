import { type ProviderId } from './providers.js';

export const effortLevels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type Effort = typeof effortLevels[number];

export function effortChoices(provider: ProviderId, model?: string): readonly Effort[] {
  if (provider === 'codex') return effortLevels;
  if (provider === 'claude') return ['low', 'medium', 'high', 'xhigh', 'max'];
  if (/^gemini-2\.5-(pro|flash)(?:$|-)/.test(model ?? '')) return ['low', 'medium', 'high'];
  if (/^gemini-3-pro(?:$|-)/.test(model ?? '')) return ['low', 'high'];
  if (/^gemini-3\.1-pro(?:$|-)/.test(model ?? '')) return ['low', 'medium', 'high'];
  if (/^gemini-3\.8-flash(?:$|-)/.test(model ?? '')) return ['low', 'medium', 'high'];
  if (/^gemini-3\.1-flash-lite-image(?:$|-)/.test(model ?? '')) return ['minimal', 'high'];
  if (/^gemini-(3-flash|3\.5-flash-lite|3\.6-flash)(?:$|-)/.test(model ?? '')) return ['minimal', 'low', 'medium', 'high'];
  return [];
}

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && effortLevels.some(level => level === value);
}

export function validateEffort(provider: ProviderId, model: string | undefined, value: unknown): Effort | undefined {
  if (value === undefined) return undefined;
  if (!isEffort(value) || !effortChoices(provider, model).includes(value)) throw new Error('AI_EFFORT_INVALID');
  return value;
}
