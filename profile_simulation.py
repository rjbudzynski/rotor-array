import argparse
import time

import numpy as np

from simulation import NUMBA_AVAILABLE, SimulationEngine, SimulationParams


def run_profile(
    l_side: int,
    steps: int,
    dt: float,
    seed: int,
    adaptive: bool,
    substeps: int,
    use_numba: bool,
) -> dict[str, float]:
    params = SimulationParams(l_side=l_side, j_coupling=1.0, m_field=0.5)
    engine = SimulationEngine(params, use_numba=use_numba)
    engine.adaptive_substepping = adaptive
    if not adaptive:
        engine.substeps = substeps

    rng = np.random.default_rng(seed)
    n = params.n_rotors
    y0 = rng.uniform(-np.pi, np.pi, 2 * n)
    engine.set_state(y0)

    # Warm up a few steps to stabilize caches and JIT (if any)
    warmup_steps = max(1, steps // 10)
    for _ in range(warmup_steps):
        engine.step(dt)

    start = time.perf_counter()
    for _ in range(steps):
        engine.step(dt)
    end = time.perf_counter()

    elapsed = end - start
    steps_total = steps
    return {
        "l_side": float(l_side),
        "n_rotors": float(n),
        "steps": float(steps_total),
        "dt": float(dt),
        "elapsed_s": float(elapsed),
        "ms_per_step": float(elapsed / steps_total * 1000.0),
        "steps_per_s": float(steps_total / elapsed),
        "adaptive": 1.0 if adaptive else 0.0,
        "substeps": float(engine.substeps),
        "numba": 1.0 if use_numba else 0.0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Profile SimulationEngine step() performance across lattice sizes."
    )
    parser.add_argument("--max-l", type=int, default=400, help="Maximum lattice side length.")
    parser.add_argument("--min-l", type=int, default=20, help="Minimum lattice side length.")
    parser.add_argument("--step-l", type=int, default=20, help="Increment in L between runs.")
    parser.add_argument("--steps", type=int, default=50, help="Number of steps per L.")
    parser.add_argument("--dt", type=float, default=0.02, help="Simulation timestep.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for init state.")
    parser.add_argument(
        "--no-adaptive",
        action="store_true",
        help="Disable adaptive substepping (uses --substeps).",
    )
    parser.add_argument(
        "--substeps",
        type=int,
        default=10,
        help="Fixed substeps when adaptive is disabled.",
    )
    parser.add_argument(
        "--numba",
        action="store_true",
        help="Enable numba acceleration if available.",
    )

    args = parser.parse_args()
    adaptive = not args.no_adaptive
    if args.numba and not NUMBA_AVAILABLE:
        raise SystemExit("Numba not available. Install numba in this environment to use --numba.")

    header = [
        "L",
        "N",
        "steps",
        "dt",
        "elapsed_s",
        "ms_per_step",
        "steps_per_s",
        "adaptive",
        "substeps",
        "numba",
    ]
    print(",".join(header))

    for l_side in range(args.min_l, args.max_l + 1, args.step_l):
        stats = run_profile(
            l_side=l_side,
            steps=args.steps,
            dt=args.dt,
            seed=args.seed,
            adaptive=adaptive,
            substeps=args.substeps,
            use_numba=args.numba,
        )
        row = [
            f"{int(stats['l_side'])}",
            f"{int(stats['n_rotors'])}",
            f"{int(stats['steps'])}",
            f"{stats['dt']:.4f}",
            f"{stats['elapsed_s']:.6f}",
            f"{stats['ms_per_step']:.3f}",
            f"{stats['steps_per_s']:.2f}",
            f"{int(stats['adaptive'])}",
            f"{int(stats['substeps'])}",
            f"{int(stats['numba'])}",
        ]
        print(",".join(row))


if __name__ == "__main__":
    main()
