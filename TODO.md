# Web Performance Plan (`web/`)

## Goals
- Reduce CPU usage and frame-time jitter in active simulation.
- Preserve simulation correctness (energy behavior and dynamics).
- Keep UI responsive at higher lattice sizes.

## Success Metrics
- Stable frame pacing (lower 95th/99th percentile frame time).
- Lower worker CPU utilization during steady-state runs.
- No regressions in existing test suite and energy drift behavior.

## Prioritized Work

### P0 (High impact, lower risk)
1. Reduce chart update frequency and batch points
- Lower `uPlot` updates (e.g., 5 Hz) and append batched samples.
- Confirm readability and interaction remain acceptable.

### P1 (High impact, moderate risk)
2. Replace per-frame `createImageBitmap` path with persistent offscreen presentation path
- Evaluate worker-side `OffscreenCanvas` rendering pipeline to reduce allocation/GC churn.
- Benchmark frame-time variance and memory behavior.

3. Lower-frequency order parameter computation
- Compute order stats every N frames and reuse latest result for UI frames.
- Verify monitor values remain stable/useful for users.

4. Adaptive frame emission target under load
- Introduce dynamic FPS target (e.g., 60 -> 45 -> 30) when worker falls behind.
- Keep physics step integrity independent from render cadence.

5. Skip overlay work entirely when arrows are off
- Avoid per-frame `clearRect`/overlay path when `showArrows === false`.
- Ensure toggling arrows on/off remains immediate and correct.

### P2 (Targeted micro-optimizations)
6. Quantize arrow transfer payload
- Explore `Int16` angle bins instead of Float32 for arrow overlay data.
- Measure quality impact and transfer-cost reduction.

7. WASM visualizer hot-path specialization
- Special-case common upsample values; reduce branch/mask overhead.
- Re-benchmark stress sizes and compare throughput.

8. Throttle arrow overlay rendering cadence (optional / low priority)
- Render arrows at 10-20 Hz while lattice bitmap remains at display cadence.
- Keep last arrow frame between updates.
- Treat as optional since arrows are already gated to low `L`.

## Execution Sequence
1. Land P0 items first (smallest risk, immediate wins).
2. Benchmark before/after each item using repeatable scenarios.
3. Proceed to P1 only after P0 measurements confirm bottleneck shifts.
4. Use P2 items only if profiling still indicates visualizer/transfer hot spots.

## Validation Checklist (Per Item)
- `deno task lint`
- `deno task test`
- Manual run (`deno task dev`) with:
  - Arrows off/on
  - Small/medium/large `L`
  - Start/stop/reset cycles
- Compare frame pacing and CPU behavior against baseline.

## Suggested Benchmark Scenarios
- Scenario A: `L=80`, arrows off, 2 minutes steady-state.
- Scenario B: `L=60`, arrows on, 2 minutes steady-state.
- Scenario C: `L=120`, arrows off, stress interaction (slider adjustments).

## Risks and Guardrails
- Do not alter physics integrator behavior for render optimizations.
- Keep worker protocol changes backward-consistent within same release.
- Prefer feature flags for larger pipeline changes (P1/P2) to simplify rollback.
