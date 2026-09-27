# Emulator engine reference

The interpretive 8086 engine lives in `lib/emulator/`. Framework-agnostic TypeScript — no React.

## Public API

```typescript
import { assemble, createMachine, SAMPLES } from "@/lib/emulator";

const program = assemble(source);
const machine = createMachine(program);

while (!machine.halted) {
  machine.step();
}

console.log(machine.output);
```

## Memory model

- 64 KiB flat `Uint8Array`
- Data variables from offset 0
- Code is an instruction array (not machine opcodes in memory)
- `@data` / `offset label` resolve to data addresses
- Stack: `SP` starts at `0xFFFE`, grows downward
- `SEG label` and a bare `DATA` are 0: one segment, so every segment value is zero

## Assembler

Directives: `.model`, `.stack`, `.data`, `.code`, `ORG`, `EQU` (and `=`).

- `NAME EQU value` defines a constant, which may be an expression over other
  constants: `N EQU 4`, `CELLS EQU N * N`, `HOWMANY EQU SPAN / 2`
- `$` is the location counter, so `SPAN EQU $ - TABLE` measures a block
- Constants work as values, as `DUP` counts, and inside data and operands
- A data table may name code labels: `HANDLERS DW ADD_IT, SUB_IT`
- `db` / `dw` are accepted in the code section, which is how a COM program
  keeps its data beside its code after a jump over it
- `ORG` is accepted: it moves the location counter in data, and is a no-op in
  code, where a program origin does not apply

Expressions take `+ - * / mod << >> & | ^`, parentheses, `not` / `~`, character
constants, and the number suffixes `h` `d` `b` `o`/`q` and `0x`.

Operand forms: `label`, `label+expr`, `[reg+label-const]`, `word ptr name`,
`offset label`. Effective addresses may mix registers, labels, and signed
constants in any order.

Source is read twice: the first pass finds the code labels so a data table can
hold them, the second pass does the work and reports errors.

## Instructions (v1.0)

### Data transfer
`mov`, `xchg`, `lea`, `lds`, `les`, `push`, `pop`, `pushf`, `popf`, `xlat`/`xlatb`, `in`, `out`

`in` / `out` address a port latch: a byte or word written to a port reads back
from it, which is what lets an `OUT`/`IN` pair be followed. Ports with a device
behind them on real hardware are not emulated.

### Arithmetic
`add`, `adc`, `sub`, `sbb`, `inc`, `dec`, `mul`, `imul`, `div`, `idiv`, `neg`, `cmp`, `test`, `aaa`, `aas`, `daa`, `das`, `aam`, `aad`, `cbw`, `cwd`

`imul` has the one-operand form (`AL` or `AX` by a signed operand), and the
later two- and three-operand forms (`imul ax, bx` / `imul ax, bx, 3`).

### Logic / shift
`and`, `or`, `xor`, `not`, `shl`/`sal`, `shr`, `sar`, `rol`, `ror`, `rcl`, `rcr`

A count of zero leaves the operand and every flag alone. Past that the three
families differ:

- A **shift** keeps going: `SHL AX, 16` leaves `AX` at zero with the carry
  holding the last bit to leave, bit 0. `SAR` fills with the sign instead, and
  the carry ends as the sign.
- A **rotate** comes full circle, so a count of one width leaves the value
  where it was and still updates the carry.
- A **rotate through carry** turns the value plus the carry, so its cycle is
  one wider than the operand: nine steps for a byte, seventeen for a word.

`shl` sets overflow from the old sign bit against the bit that left, which is
the one case where a shift is a signed operation.

The 8086 manual calls a count larger than the operand undefined. The
behaviour above is what current hardware does, and it is what
`lib/emulator/extended-syntax.test.ts` pins.

### Control flow
`jmp`, `je`/`jz`, `jne`/`jnz`, `jg`/`jnle`, `jge`/`jnl`, `jl`/`jnge`, `jle`/`jng`, `ja`/`jnbe`, `jae`/`jnb`/`jnc`, `jb`/`jnae`/`jc`, `jbe`/`jna`, `js`, `jns`, `jo`, `jno`, `jp`/`jpe`, `jnp`/`jpo`, `jcxz`, `loop`, `loope`/`loopz`, `loopne`/`loopnz`, `call`, `ret`, `iret`

`jmp` and `call` take a label, a register, or a memory word, so a dispatch table
is indexed and jumped through: `jmp [handlers + bx]`.

`call` pushes the return address onto the memory stack, which is where a
`push bp` / `mov bp, sp` frame reads it at `[BP+2]`, and `ret n` removes the
arguments the caller left behind. The count may be a constant: `ret TWO` where
`TWO EQU 2` works. A call whose destination cannot be resolved leaves the stack
untouched, and a `ret` with no call outstanding ends the run.

`iret` is the same return as `ret` here. `int` pushes nothing in this flat
model, so there is no interrupt frame to unwind; an `iret` returns to whatever
word is on top of the stack, and the call stack stays its mirror rather than
drifting from `SP`.

### String (optional `rep` / `repe` / `repne`)
`movsb`, `movsw`, `stosb`, `stosw`, `lodsb`, `lodsw`, `cmpsb`, `cmpsw`, `scasb`, `scasw`

### Flags / system
`clc`, `stc`, `cmc`, `cld`, `std`, `cli`, `sti`, `lahf`, `sahf`, `nop`, `hlt`, `wait`, `lock`, `int`, `into`

## Interrupts

### INT 21h (DOS)

| AH | Function |
|----|----------|
| 00 / 4Ch | Terminate |
| 01 | Read char + echo |
| 02 | Write char (`DL`) |
| 05 | Printer (→ console) |
| 06 | Direct console I/O |
| 07 / 08 | Read char (no echo) |
| 09 | Write `$`-terminated string |
| 0Ah | Buffered input |
| 0Bh | Input status |
| 0Ch | Flush + input |
| 25h / 35h | Set/get vector (stub) |
| 2Ah / 2Ch | Date / time |
| 30h | DOS version |
| 36h | Free disk space |
| 39h | Create a directory (name checked; one flat volume) |
| 3Bh | Change directory (name checked; one flat volume) |
| 3Ch | Create a file (truncates) |
| 3Dh | Open a file, access mode in bits 1 to 0 of AL (0 read, 1 write, 2 both) |
| 3Eh | Close a handle |
| 3Fh / 40h | Read / write a handle (stdin, stdout, or a file) |
| 41h | Delete a file |
| 42h | Seek |
| 4Bh | Exit with a code |
| 4Ch | Terminate |

Errors follow the DOS convention: carry set, and the reason in `AX`
(2 not found, 3 bad path, 4 too many open files, 5 access denied, 6 bad handle).

The sharing mode in bits 5 to 4 of AL is ignored, which leaves DOS's default:
compatibility, so a program may hold one file open more than once. A file opened
read-only refuses a write, with error 5.

Files live in memory for the life of the machine (`lib/emulator/dos-files.ts`).
Nothing reaches the host: the emulator has no filesystem of its own. Names are
8.3 without a path, each open gets a handle and a cursor of its own, and a file
opened read-only refuses a write.

### INT 10h (BIOS video — text)

| AH | Function |
|----|----------|
| 00 | Set mode (clears the screen) |
| 02 / 03 | Set / read cursor position |
| 05 | Select page (one page) |
| 06 / 07 | Scroll, and clear when AL=0 |
| 09 / 0A | Write char |
| 0Ch / 0Dh | Write a graphics pixel (accepted, nothing drawn: a text console has no pixels) |
| 0Eh | Teletype |
| 0Fh | Read mode, page size, cursor |
| 10h | Set / read palette (accepted; a text console has none) |
| 13h | Write string |
| 1Ah | Display combination code |

### INT 16h (keyboard)

| AH | Function |
|----|----------|
| 00 / 10h | Read key |
| 01 / 11h | Check key, setting ZF when there is none |
| 02 / 12h | Shift key state (clear: no key is held) |

### INT 1Ah (timer)

| AH | Function |
|----|----------|
| 00h | Read the tick counter |
| 01h | Set the tick counter |

Nothing advances the counter, so it reads zero and the midnight flag stays
clear. A program that wants time passes the time in.

### INT 15h

| AH | Function |
|----|----------|
| 86h | Wait (returns at once: time here is the step count) |
| 88h | Extended memory size (none) |

### INT 03h
Software breakpoint. With no debugger under it, the program carries on.

### INT 20h
Program terminate.

## Console output

- Bytes from INT 21h / 10h are mapped through **IBM PC Code Page 437** (classic DOS glyphs).
- `0Ah` (LF) moves the cursor **down one row** and keeps the column.
- `0Dh` (CR) moves the cursor to **column 0** without changing the row (can overwrite the line).
- Together (`LF+CR` or `CR+LF`) they form a normal new line.
- INT 21h AH=01 echoes the character as-is: Enter is CR only (not LF). Programs that `call newline` after a line of input print one new line.
- `07h` BEL is silent; `08h` BS backs up one column; `09h` TAB expands to 8-column stops.

Memory operand size follows an 8-bit or 16-bit register: `mov [si], bl` writes one byte. Use `byte ptr` / `word ptr` when both operands are memory or immediate.

A program that positions the cursor with INT 10h AH=02h and then writes lands
where it asked to, so the log shows the text at that row and column rather than
at the end of the line.

Opcodes, registers, directives, labels, and number suffixes are case-insensitive (`MOV`/`mov`, `[SI]`/`[si]`, `ARR[SI]`/`arr[si]`, `09H`/`09h`, `DUP`/`dup`, `OFFSET`/`offset`, `@DATA`/`@data`).

## Conformance

`lib/emulator/corpus/` holds 136 worked programs across 38 topics, copied from
[Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS](https://github.com/Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS)
(MIT). `corpus.test.ts` runs each to completion and compares the console output
with the output recorded when the corpus was published, so a change in an answer
is a failing test. `docs/corpus-coverage.md` records what the whole 500-program
corpus does, including the parts it does not cover.

## Extending

1. Add a `case` in `Machine.executeInstruction()` (`machine.ts`)
2. For DOS/BIOS, extend `dos.ts`
3. Update this matrix
4. Add a sample in `samples.ts` when useful
5. If the change alters an answer, `lib/emulator/corpus.test.ts` will say which
   programs moved

## Errors

- `AsmError` may include a source `line`
- Runtime errors set `machine.err` (includes `(line N)`) and halt
- Instruction limit (2M) stops infinite Run loops

## Share encoding

```typescript
import { encodeProgramToShare, decodeProgramFromShare } from "@/lib/emulator";
```

Programs are base64-encoded in `?p=` query params.
