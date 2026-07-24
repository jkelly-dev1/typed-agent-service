import { z } from 'zod';
import { defineTool } from './registry.js';

/**
 * Deterministic unit conversion over a fixed table. Length and mass convert
 * through a base unit (meter, kilogram); temperature uses affine formulas.
 */
const LENGTH_TO_METERS: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
  mi: 1609.344,
};

const MASS_TO_KG: Record<string, number> = {
  mg: 0.000001,
  g: 0.001,
  kg: 1,
  oz: 0.028349523125,
  lb: 0.45359237,
};

const TEMPERATURE_UNITS = ['c', 'f', 'k'] as const;

const ALL_UNITS = [
  'mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi',
  'mg', 'g', 'kg', 'oz', 'lb',
  'c', 'f', 'k',
] as const;

const UnitEnum = z.enum(ALL_UNITS);

function toCelsius(value: number, unit: string): number {
  switch (unit) {
    case 'c': return value;
    case 'f': return (value - 32) * (5 / 9);
    case 'k': return value - 273.15;
    default: throw new Error(`Not a temperature unit: ${unit}`);
  }
}

function fromCelsius(value: number, unit: string): number {
  switch (unit) {
    case 'c': return value;
    case 'f': return value * (9 / 5) + 32;
    case 'k': return value + 273.15;
    default: throw new Error(`Not a temperature unit: ${unit}`);
  }
}

export function convert(value: number, from: string, to: string): number {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  if (f in LENGTH_TO_METERS && t in LENGTH_TO_METERS) {
    return (value * (LENGTH_TO_METERS[f] as number)) / (LENGTH_TO_METERS[t] as number);
  }
  if (f in MASS_TO_KG && t in MASS_TO_KG) {
    return (value * (MASS_TO_KG[f] as number)) / (MASS_TO_KG[t] as number);
  }
  if (
    (TEMPERATURE_UNITS as readonly string[]).includes(f) &&
    (TEMPERATURE_UNITS as readonly string[]).includes(t)
  ) {
    return fromCelsius(toCelsius(value, f), t);
  }
  throw new Error(`Cannot convert between '${from}' and '${to}' (different quantities or unknown units)`);
}

export const unitConvertTool = defineTool({
  name: 'unit_convert',
  description:
    'Convert a value between units. Length: mm cm m km in ft yd mi. Mass: mg g kg oz lb. Temperature: c f k. Units of different quantities cannot be mixed.',
  schema: z.object({
    value: z.number().finite().describe('The numeric value to convert'),
    from: UnitEnum.describe('Source unit code, e.g. "km"'),
    to: UnitEnum.describe('Target unit code, e.g. "mi"'),
  }),
  execute({ value, from, to }) {
    const result = convert(value, from, to);
    const rounded = Math.round(result * 1e6) / 1e6;
    return `${value} ${from} = ${rounded} ${to}`;
  },
});
