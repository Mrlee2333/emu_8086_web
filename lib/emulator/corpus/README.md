# Corpus conformance fixtures

The `.asm` files here are third-party programs, copied in unmodified from

- **Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS** — <https://github.com/Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS>
- Licence: MIT (see the repository's `LICENSE`)

They are the subject of `lib/emulator/corpus.test.ts`, which runs each one to
completion and compares the console output with the output recorded when the
corpus was published. A failure means the emulator changed the answer, so these
files are test data, not sample content: do not edit them by hand.

## Layout

```
corpus/<topic>/<program>.asm   the program, renamed to a flat file name
corpus/expected.json           "<topic>/<program>.asm": "<exact console output>"
```

`expected.json` is the corpus's own recorded output, not output this emulator
produced, so a passing test means the two agree.

Every program here is chosen to be safe to run unattended:

- it prints what it computed, so the test can check the answer
- it terminates on its own, with no input beyond the fixed keystrokes
- it does not depend on the wall clock, the video mode, or a hardware device

## Running

```sh
bun test lib/emulator/corpus.test.ts   # the 136 programs, ~0.2 s
```

## Regenerating

Clone the corpus elsewhere, then:

```sh
bun scripts/corpus-fixtures.ts <path>/Source Code            # verify
bun scripts/corpus-fixtures.ts <path>/Source Code --update   # re-copy and re-record
```

The selection list lives in `scripts/corpus-fixtures.ts`. The `--update` run
rewrites `expected.json` from the corpus's own `expected-output.json`, so the
expected output stays the upstream record rather than this emulator's opinion.

## The whole corpus

The upstream repository holds about 500 programs, including continuous
hardware controllers and programs written against that project's own
pseudo-instructions. To measure the emulator against all of them:

```sh
git clone https://github.com/Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS /tmp/corpus
bun scripts/conformance-report.ts /tmp/corpus/Source Code
```

The report groups every program by topic and by how it failed.
`docs/corpus-coverage.md` records the last run.
