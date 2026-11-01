/**
 * Unit conversion from the reference engine (Quake-family units) to metres.
 * 1 unit ~= 1 inch (2.54 cm) is the common convention; it is an approximation
 * used only to translate reference constants into SI defaults.
 */
export const REFERENCE_UNIT_METRES = 0.0254;
export const refToMetres = (units: number): number => units * REFERENCE_UNIT_METRES;
