import { isEffort, type Effort } from './effort.js';
import { isModelName } from './providers.js';

export interface CliModel { model: string; efforts?: Effort[] }

/** Persist only model IDs and capability values, never account data or CLI descriptions. */
export function parseModelCatalog(value: unknown): CliModel[] {
  if (!Array.isArray(value) || value.length > 2000) throw new Error('AI_MODELS_UNAVAILABLE');
  const models = new Map<string, CliModel>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('AI_MODELS_UNAVAILABLE');
    const fields = item as Record<string, unknown>;
    if (Object.keys(fields).some(key => !['model', 'efforts'].includes(key)) || !isModelName(fields.model)
      || (fields.efforts !== undefined && (!Array.isArray(fields.efforts) || !fields.efforts.every(isEffort)))) {
      throw new Error('AI_MODELS_UNAVAILABLE');
    }
    models.set(fields.model, { model: fields.model,
      ...(fields.efforts !== undefined ? { efforts: [...new Set(fields.efforts as Effort[])] } : {}) });
  }
  return [...models.values()];
}
