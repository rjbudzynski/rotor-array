/**
 * Application-wide constants for the Rotor Array Simulation.
 *
 * All time-related constants are in seconds unless otherwise noted.
 * All angles are in radians unless otherwise noted.
 */

// ============================================================================
// SIMULATION PHYSICS
// ============================================================================

/**
 * Simulation timestep in seconds.
 * @remarks Default 0.016s ≈ 60 physics steps per second at 1x time scale
 */
export const SIMULATION_TIMESTEP = 0.016;

/**
 * Maximum timestep accumulator to prevent spiral of death.
 * @remarks Caps dt at 0.1s to avoid large time jumps
 */
export const MAX_ACCUMULATOR = 0.1;

// ============================================================================
// RENDERING & DISPLAY
// ============================================================================

/**
 * Minimum interval between frame emissions in milliseconds.
 * @remarks 16.6ms ≈ 60 FPS target
 */
export const FRAME_EMIT_INTERVAL_MS = 16.6;

/**
 * UI update throttle interval in milliseconds.
 * @remarks Limits plot/order parameter updates to 10 Hz
 */
export const UI_UPDATE_INTERVAL_MS = 100;

/**
 * Plot flush interval in milliseconds.
 * @remarks Batches chart points and updates uPlot at 10 Hz
 */
export const PLOT_UPDATE_INTERVAL_MS = 100;

/**
 * Default plot window duration in seconds.
 */
export const PLOT_WINDOW_SECONDS = 10;

// ============================================================================
// COLOR LUT (Look-Up Table)
// ============================================================================

/**
 * Number of discrete angle steps for color LUT (hue).
 * @remarks 360 steps provides 1° resolution
 */
export const LUT_ANGLE_STEPS = 360;

/**
 * Number of discrete energy steps for color LUT (value).
 * @remarks 64 steps provides smooth luminosity transitions
 */
export const LUT_ENERGY_STEPS = 64;

/**
 * Maximum energy value for LUT normalization.
 * @remarks Used to scale omega² to [0, 1] range
 */
export const LUT_MAX_ENERGY = 10;

/**
 * Hue offset for angle-to-color mapping.
 * @remarks 0.666 ≈ 240° shifts blue to θ=0 for better aesthetics
 */
export const HUE_OFFSET = 0.666;

/**
 * Energy scaling factor for value calculation.
 * @remarks Higher values = slower saturation curve
 */
export const ENERGY_SCALE_FACTOR = 5.0;

// ============================================================================
// DATA MANAGEMENT
// ============================================================================

/**
 * Maximum dead elements before array compaction in OrderPlot.
 * @remarks Compacts when >1000 stale data points
 */
export const MAX_DEAD_ELEMENTS = 1000;

/**
 * Waste ratio threshold for array compaction.
 * @remarks Compacts when >50% of array is stale
 */
export const COMPACTION_WASTE_THRESHOLD = 0.5;

// ============================================================================
// UI DEFAULTS
// ============================================================================

/**
 * Default lattice side length.
 */
export const DEFAULT_LATTICE_SIZE = 20;

/**
 * Maximum lattice side length allowed.
 */
export const MAX_LATTICE_SIZE = 500;

/**
 * Minimum lattice side length allowed.
 */
export const MIN_LATTICE_SIZE = 2;

/**
 * Canvas padding in pixels.
 * @remarks Subtracts 40px from container dimensions
 */
export const CANVAS_PADDING = 40;
