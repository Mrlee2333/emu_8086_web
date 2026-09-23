# Efficiency & Performance Audits

One report per shipped version: `audit/vX.Y.Z.md`.

## Rules (followed by agents and humans)

1. **One file per version**, named after `package.json`'s version at release time.
2. **Compare with the previous version only** — each report has a
   "vs vPrev" section so regressions are visible without reading history.
3. **Measure, don't guess.** Run the shared benchmark before writing numbers:
   - `bun test lib electron` (count + time)
   - Step throughput, snapshot cost, print-loop cost via the benchmark script
     kept next to the report (same workload every version).
   - Memory bounds are code constants — quote them, don't estimate.
4. **Environment matters.** Record machine, runtime (`bun --version`),
   and take the median of 3 runs for timing numbers.
5. **Write the audit before tagging the release**, commit it on the
   release branch so the tag includes it.

## Benchmark workload (frozen)

- Steps: `mov cx,0FFFFh / again: add ax,1 / loop again` (131072 steps)
- Snapshot: 200× `machine.capture()` on the halted loop machine
- Console: 3000-line `INT 21h AH=02` print loop (`X` + CR + LF per line)
- Search (v1.3.2+): `findNextMatch` over the full 64 KiB address space
