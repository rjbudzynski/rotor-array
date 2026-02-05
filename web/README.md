# Rotor Array Web Simulation

Browser-based port of the Rotor Array simulation.

## Setup

1. Install Deno.
2. Run `deno task serve` in this directory.
3. Open `http://localhost:8000`.

## Development

- `deno task dev`: Serve with watch rebuilds.
- `deno task test`: Run tests.
- `deno task build`: Generates `public/` artifacts (HTML, JS, CSS bundles).
- `deno task stress`: Runs headless physics benchmark and reports max lattice sizes for 60/30 Hz.
