# Thanks

emu8086web stands on two other people's work. Both are credited here in full,
because both changed what this project is.

## 8086-ASSEMBLY-LANGUAGE-PROGRAMS

**[Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS](https://github.com/Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS)
— by [Amey Thakur](https://github.com/Amey-Thakur)** · MIT Licence

Around 500 worked 8086 programs across 38 topics, each one teaching a specific
idea: packed BCD addition, recursive factorial, a dispatch table indexed by a
register, a radix sort, an in-memory DOS file, a 32-bit shift through the carry,
a segment override on a string instruction.

This emulator is measurably better because of it. Every program in that
repository is assembled and run here, and the console output is compared
character for character with the output that project recorded for its own
simulator. That turned "probably right" into a number, and the number moved:

| | Programs matching byte for byte |
|---|---|
| v1.4.2 | 133 of 525 |
| v1.5.0 | **461 of 525** |

It paid for itself on the first run. Running other people's programs and
comparing the answers found defects that this project's own tests never had:

- **`CALL` never pushed a return address.** The return lived only in an internal
  list, so a `PUSH BP` / `MOV BP, SP` frame read the caller's argument where the
  return address belonged. 7 factorial came out as 1. Recursion scored 0 of 12
  programs; it now scores 12 of 12.
- **Shift and rotate lost the carry.** `SHL`, `SHR` and `SAR` set `CF` and then
  called the flag helper that clears it, so the bit that left was always zero.
  `SHL` also never set overflow, and `DAA` discarded the carry that packed BCD
  addition depends on.
- **`IMUL` with a byte operand multiplied 16-bit values**, so signed byte
  arithmetic came out unsigned, and the two- and three-operand forms did not
  exist.
- **`LAHF` loaded the flags into `AL` instead of `AH`**, and `PUSHF` left bits 12
  to 15 clear, which the 8086 reads as one.
- **A negative displacement was silently ignored** — `[DI-2]` read `[DI]`, which
  broke insertion sort, gnome sort and a dozen other programs.
- **A constant called `NOTHING` was read as `NOT HING`**, and `EACH EQU 4` was
  read as the hex number `0xEAC`, because every letter is a hex digit and the
  last one is the `H` suffix.
- **The polling services never set the zero flag**, so a program checking for a
  keystroke could not tell an empty queue from a full one.

A hundred and thirty-six of the programs are kept in
[`lib/emulator/corpus/`](../lib/emulator/corpus/) as test fixtures, copied
unmodified with their own headers and the MIT licence intact. They run as part of
`bun test` in about 0.2 seconds, and each one fails the build if the emulator
starts giving a different answer.

The full result, including the parts of the corpus we do not cover and why, is in
[corpus-coverage.md](corpus-coverage.md). Reproduce the whole run with:

```sh
git clone https://github.com/Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS /tmp/corpus
bun scripts/conformance-report.ts /tmp/corpus/Source Code
```

If you teach 8086 assembly, or are learning it, that repository is worth reading
on its own terms, whichever emulator you use. Thank you, Amey.

## emu8086

The classic [emu8086](https://emu8086-microprocessor-emulator.en.softonic.com/)
teaching tool set the shape of this one: the panel layout a student expects —
registers, flags, memory dump, stack, call stack, a CRT-style console — and the
workflow of compiling, stepping, running, and stepping back through a program.
This is a browser reimplementation of that idea, in TypeScript, for every
platform.

Not affiliated with either project. No endorsement is claimed or implied; these
are thanks, not partnerships.

## Licence note

The fixture programs under `lib/emulator/corpus/` remain under their author's
MIT licence, with the per-file headers left in place. Everything else in this
repository is MIT © Nafis Islam Kabbo — see [LICENSE](../LICENSE).
