# Corpus coverage: 8086-ASSEMBLY-LANGUAGE-PROGRAMS

Every program in [Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS](https://github.com/Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS)
(MIT), run through this emulator, with the console output compared against the
output that repository recorded for its own simulator.

```sh
git clone https://github.com/Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS /tmp/corpus
bun scripts/conformance-report.ts /tmp/corpus/Source Code
```

Each program is offered the same keystrokes the corpus harness uses
(`5\r3\rAMEY\r` then 40 `A`s and Enter) and given two million instructions.
"Match" means the output was identical, character for character.

## Result

| | Programs |
|---|---|
| Matched exactly | **461 of 525 (87.8%)** |
| Ran, output differs | 33 |
| Stopped on an error | 18 |
| Would not assemble | 10 |
| Never finished | 3 |

The first run of this report, before any of the fixes below, matched 133. 19 of
the 39 topics now match on every program in them; before, 6 topics did.

## What the differences are

Of the 64 programs that do not match, 45 cannot be made to match, because the
recorded output is not something a program can be held to:

| Count | Why |
|---|---|
| 17 | The recorded output is a screen dump of raw memory. These programs overwrite their own message strings; the corpus simulator printed the bytes, and this emulator prints the text. |
| 14 | The recorded output uses pseudo-instructions that are not 8086: `PRINT_STR`, `SAY`, `TRACE`, `COUNT`, `ROW`, `CLEAR`, `CHECK`, `TRIPLE`, `DOUBLE`, `ADD_VALUES`, `DIS`, `PRNSTR`. There is no `MACRO` or `ENDM` in the sources, so these are that simulator's own mnemonics. |
| 7 | The source uses `#...#` comments, which is that project's syntax. Six of the seven are continuous hardware controllers. |
| 4 | The recorded output holds the clock or the calendar of the day it was recorded (a June 2021 date, a tick count, a time of day). |
| 2 | The recorded output holds real segment values, which a flat model has no way to produce. |
| 1 | The recorded output keeps a tab unexpanded, where the console here advances to the next eight-column stop. |

That leaves 19 programs where this emulator disagrees, 13 of them differing
output and 6 not assembling or finishing:

| Count | Why |
|---|---|
| 2 | An unsupported service: `INT 33h` (mouse), `INT 21h AH=56h` (rename). |
| 3 | Never finishes: two continuous keyboard and traffic-light controllers, and a delay loop that needs 35 million instructions. The corpus lists the first two as programs that are not meant to stop. |
| 2 | The program declares a `db` and then continues it with `dw`, which is an error in MASM too. |
| 1 | `.FARDATA`, a directive this assembler does not have. |
| 13 | Genuine output differences, listed below. |

## The genuine differences

| Program | Recorded | Here |
|---|---|---|
| `BIOS Services/bios_cursor_control`, `Interrupts/bios_cursor_position`, `Graphics/colour_attribute_table` | Text appended to the log | The same text, at the row and column the program asked for with `INT 10h AH=02h` |
| `BIOS Services/bios_scan_code_table` | Scan code 28 | ASCII 0, because INT 16h returns a character, not a scancode |
| `Data Structures/stack_array` | A null byte | Nothing: a null byte in a DOS string ends the string |
| `Graphics/bitmap_sprite_drawing`, `Graphics/vga_mode_13h_pixels` | A sprite and a picture described in words | The pixel services (`INT 10h AH=0Ch`/`0Dh`) are accepted and draw nothing, because a text console has no pixels, so the program runs and prints its own text |
| `Input Output/read_key_without_echo` | `What was actually typed: 53` | A carriage return returns to column 0 and the character overwrites the line, as on a real screen |
| `Interrupts/bios_system_time` | `00097F39` | `00000030`: nothing advances the tick counter here |
| `Interrupts/interrupt_vector_table` | `F000H:0163H` | The interrupt vector table is empty in a flat model |
| `Port Programming/port_word_versus_byte` | A word write to port 40 shows up at port 41 | Ports are a plain latch: one port number, one value |

## Topics

| Topic | Matching |
|---|---|
| Addressing Modes | 12/12 |
| Arithmetic | 13/14 |
| Array Operations | 18/20 |
| BIOS Services | 8/12 |
| Bit Manipulation | 13/13 |
| Bitwise Operations | 12/12 |
| Conditional Jumps | 12/12 |
| Control Flow | 12/12 |
| Conversion | 18/23 |
| DOS Services | 10/12 |
| Data Structures | 13/15 |
| Data Transfer | 11/12 |
| Expression | 13/14 |
| External Devices | 3/12 |
| File Operations | 11/12 |
| Flags | 12/12 |
| Graphics | 8/12 |
| Input Output | 11/12 |
| Interrupts | 8/12 |
| Introduction | 9/15 |
| Loops | 12/12 |
| Macros | 0/12 |
| Mathematics | 12/12 |
| Matrix | 15/15 |
| Memory Operations | 12/12 |
| Number Theory | 13/13 |
| Patterns | 16/16 |
| Port Programming | 11/12 |
| Procedures | 11/12 |
| Recursion | 12/12 |
| Searching | 15/16 |
| Shift and Rotate | 12/12 |
| Signed Arithmetic | 12/12 |
| Simulation | 12/12 |
| Sorting | 20/20 |
| Stack Operations | 10/12 |
| String Instructions | 12/12 |
| String Operations | 18/18 |
| Utilities | 9/13 |

`External Devices`, `Graphics` and `Port Programming` are the topics that drive
hardware: a keypad matrix, a VGA pixel, an analogue-to-digital converter. They
run as far as the arithmetic and print correctly, and stop at the instruction
that talks to a device.

`Macros` is zero because the twelve sources call that simulator's own
pseudo-instructions. This assembler has no macro expander, and would need one
before it could run them.

## What the corpus found

Every one of these was a defect, found by running programs written by somebody
else and comparing the answers:

- `CALL` did not push the return address. Any program with a `PUSH BP` /
  `MOV BP, SP` frame read the wrong word at `[BP+4]`, so recursion, stack
  arguments and stack measurement were all wrong. Recursion went from 0 of 12
  programs to 12 of 12.
- `SHL`, `SHR` and `SAR` set the carry and then cleared it, because the flag
  helper they shared also cleared it. A `RCR` multiword shift, and any program
  that saved a carry with `PUSHF`, was wrong.
- `SHL` never set overflow.
- A shift or rotate count of a whole operand width or more moved bits that
  should not have moved.
- `IMUL` with a byte operand multiplied 16-bit values, so signed byte
  arithmetic came out unsigned. The two- and three-operand forms were missing.
- `LAHF` loaded the flags into `AL` instead of `AH`.
- `PUSHF` did not set bits 12 to 15, which read as one on the 8086.
- `DAA` and `DAS` cleared the carry they had just produced, so packed BCD
  addition lost its carry into the next byte.
- A negative displacement in brackets, `[DI-2]`, was silently ignored.
- A bare label with a displacement and no brackets, `SEEN+2`, was not an operand.
- `INT 21h AH=06h` and `INT 16h AH=01h` never set the zero flag, so a program
  polling for a keystroke could not tell an empty queue from a full one.
- `EQU` was not supported at all, which is 293 of the programs the first run
  could not assemble.
- `LEA` of a label plus a constant, `LEA SI, BUFFER + 2`, was rejected.
- Numbers in octal (`101Q`) and `NOT` in an operand were not read.
- `NOT` matched the first three letters of any name, so a constant called
  `NOTHING` was read as `NOT HING` and evaluated to nothing.
- A symbol spelled like a number was read as one: `EACH EQU 4` came out as
  0xEAC, because every letter in `EACH` is a hex digit and the last one is the
  `H` suffix. A defined name now wins over a number.

## What the committed suite checks

`lib/emulator/corpus.test.ts` keeps 136 of these programs as fixtures, chosen
so that every topic has at least one and each runs unattended: it prints what
it computed, it finishes on its own, and it does not depend on the clock, the
video mode, or a device. `lib/emulator/corpus/expected.json` holds the output
recorded upstream, not output this emulator produced, so a test passing means
the two agree.

The suite runs in about 0.2 s as part of `bun test`, and it fails loudly if a
fixture is added without a recorded output, or a topic folder is emptied.

Alongside it, `lib/emulator/extended-syntax.test.ts` and
`lib/emulator/dos-services.test.ts` cover the features the corpus exercised, in
small pieces that name the behaviour: 37 tests for the assembler and the
interpreter, 19 for the DOS and BIOS services.

## What the review found

A review of this work, with every claim reproduced against the branch rather
than read off it, turned up nine more defects the corpus did not reach. They are
listed here because the corpus is not the only way this engine gets tested:

- **`RCL` / `RCR` on a word used the byte's cycle.** A rotate through carry
  turns the value plus the carry, so the cycle is nine steps for a byte and
  seventeen for a word. A nine-step `RCR AX` had been treated as a whole turn.
- **A shift of one whole width was a no-op.** `SHL AX, 16` leaves `AX` at zero
  on hardware, with the carry holding the last bit to leave; only a rotate comes
  full circle. The test written for this release had enshrined the no-op.
- **`IRET` popped only the call-stack mirror.** `INT` pushes nothing in this
  model, so an `IRET` has to read the memory stack the way `RET` does; as it
  was, a `CALL` → `INT` → `IRET` sequence left the mirror and `SP` disagreeing.
- **`RET n` ignored a constant.** `RET TWO` with `TWO EQU 2` behaved as `RET`,
  silently leaving the caller's arguments on the stack.
- **`CALL` moved the stack before resolving its destination**, so a call to a
  bad label left half a frame behind for Step Back to restore.
- **The polling services ate the key they reported.** `INT 16h AH=01h` is a
  check, not a read: a program that polls before reading lost the first
  character it found.
- **`AH=3Bh` was not "open an existing file".** It is `CHDIR`; `AH=3Dh` is the
  open, with the access mode in bits 1 to 0 of `AL`. Reading the sharing bits
  as if they were the access mode meant `AL=10h` — compatibility sharing, read
  only — opened for writing.
- **The pixel and palette services halted the program.** `INT 10h AH=0Ch`,
  `0Dh` and `10h` are graphics-only, and a text console cannot do them, but
  accepting and ignoring them is what lets a plotting program finish and say
  what it plotted.
- **A constant expression could not fail.** `5 / 0` folded to zero instead of
  being reported, and an undefined name with parentheses — `LENGHT(ARR)` —
  evaluated to its argument, so a misspelt `LENGTH` looked like a number.
