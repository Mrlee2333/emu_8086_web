/**
 * Copy a curated slice of a third-party 8086 corpus into
 * `lib/emulator/corpus/`, together with the output each program must print.
 *
 * The corpus is Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS (MIT). Clone it
 * somewhere outside this repository, then:
 *
 *   bun scripts/corpus-fixtures.ts <path-to-corpus> [--update]
 *
 * The selection below is the set of programs the emulator is expected to run
 * correctly. Each one is deterministic, prints its own result, and finishes on
 * its own, so a failure always means the emulator changed behaviour.
 *
 * Without `--update` the script only checks the fixtures against a fresh run,
 * which is what the test suite does. With it, `expected.json` is rewritten
 * from the upstream recorded output.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "../lib/emulator/assemble";
import { createMachine } from "../lib/emulator/machine";

/** Keystrokes offered to any program that reads, matching the corpus harness. */
export const INPUT = "5\r3\rAMEY\r" + "A".repeat(40) + "\r";

const BUDGET = 2_000_000;

/**
 * One entry per topic, chosen to cover the instruction groups and the DOS and
 * BIOS services a student meets first. Paths are the corpus's own.
 */
const SELECTION: Record<string, string[]> = {
  "addressing-modes": [
    "Addressing Modes/register_indirect_addressing_mode.asm",
    "Addressing Modes/based_indexed_with_displacement.asm",
    "Addressing Modes/string_addressing_mode.asm",
    "Addressing Modes/comprehensive_8086_addressing_modes_reference.asm",
  ],
  arithmetic: [
    "Arithmetic/addition_16bit_with_carry_detection.asm",
    "Arithmetic/decimal_adjust_after_addition_demo.asm",
    "Arithmetic/division_16bit_dividend_by_8bit_divisor.asm",
    "Arithmetic/calculate_sum_of_first_n_natural_numbers.asm",
  ],
  "array-operations": [
    "Array Operations/find_maximum_element_in_array.asm",
    "Array Operations/maximum_subarray_sum.asm",
    "Array Operations/prefix_sums.asm",
    "Array Operations/insert_element_into_array_at_index.asm",
  ],
  "bios-services": [
    "BIOS Services/bios_teletype_output.asm",
    "BIOS Services/bios_video_mode_query.asm",
    "BIOS Services/bios_versus_dos_output.asm",
  ],
  "bit-manipulation": [
    "Bit Manipulation/count_set_bits_kernighan.asm",
    "Bit Manipulation/reverse_bits_in_word.asm",
    "Bit Manipulation/extract_bit_field.asm",
  ],
  "bitwise-operations": [
    "Bitwise Operations/bitwise_field_packing.asm",
    "Bitwise Operations/bitwise_rotate_right_circular_shift.asm",
    "Bitwise Operations/bitwise_xor_logic_demonstration.asm",
  ],
  "conditional-jumps": [
    "Conditional Jumps/signed_versus_unsigned_trap.asm",
    "Conditional Jumps/jump_on_carry_flag.asm",
    "Conditional Jumps/unsigned_comparison_family.asm",
    "Conditional Jumps/indirect_jump_through_register.asm",
  ],
  "control-flow": [
    "Control Flow/computed_jump_into_a_table.asm",
    "Control Flow/switch_case_multiway_branching_logic.asm",
    "Control Flow/nested_loops_with_early_exit.asm",
  ],
  conversion: [
    "Conversion/binary_to_decimal.asm",
    "Conversion/decimal_to_any_base.asm",
    "Conversion/number_to_words.asm",
    "Conversion/ascii_to_integer.asm",
  ],
  "data-structures": [
    "Data Structures/circular_queue.asm",
    "Data Structures/deque_double_ended.asm",
    "Data Structures/evaluate_postfix.asm",
    "Data Structures/linked_list_in_memory.asm",
  ],
  "data-transfer": [
    "Data Transfer/mov_immediate_forms.asm",
    "Data Transfer/in_out_port_transfer.asm",
    "Data Transfer/lds_les_far_pointers.asm",
    "Data Transfer/lea_versus_offset.asm",
  ],
  "dos-services": [
    "DOS Services/dos_buffered_input_0ah.asm",
    "DOS Services/dos_menu_driven_program.asm",
    "DOS Services/dos_password_masking.asm",
    "DOS Services/dos_write_to_handle.asm",
  ],
  expression: [
    "Expression/factorial.asm",
    "Expression/fibonacci.asm",
    "Expression/prime_number_check.asm",
    "Expression/substring_search.asm",
  ],
  "file-operations": [
    "File Operations/write_file.asm",
    "File Operations/read_file.asm",
    "File Operations/file_size_by_seek.asm",
    "File Operations/copy_file_contents.asm",
  ],
  flags: [
    "Flags/carry_versus_overflow.asm",
    "Flags/direction_flag_and_strings.asm",
    "Flags/flag_table_after_addition.asm",
    "Flags/sign_flag_and_true_sign.asm",
  ],
  graphics: [
    "Graphics/draw_rectangle.asm",
    "Graphics/text_mode_bar_chart.asm",
    "Graphics/bresenham_line_algorithm.asm",
  ],
  "input-output": [
    "Input Output/display_binary.asm",
    "Input Output/print_signed_numbers.asm",
    "Input Output/read_and_validate_digits.asm",
    "Input Output/read_number.asm",
  ],
  interrupts: [
    "Interrupts/dos_display_string.asm",
    "Interrupts/bios_versus_dos_output.asm",
    "Interrupts/interrupt_error_conventions.asm",
  ],
  introduction: [
    "Introduction/hello_world_dos.asm",
    "Introduction/display_string_direct.asm",
    "Introduction/print_alphabets.asm",
  ],
  loops: [
    "Loops/loop_counted_with_cx.asm",
    "Loops/loopne_search_until_found.asm",
    "Loops/loope_repeat_while_equal.asm",
    "Loops/loop_over_two_arrays.asm",
  ],
  mathematics: [
    "Mathematics/square_root.asm",
    "Mathematics/fixed_point_eight_eight.asm",
    "Mathematics/wide_addition_and_subtraction.asm",
  ],
  matrix: [
    "Matrix/matrix_multiplication.asm",
    "Matrix/matrix_transpose.asm",
    "Matrix/matrix_determinant_3x3.asm",
  ],
  "memory-operations": [
    "Memory Operations/block_copy.asm",
    "Memory Operations/overlapping_block_move.asm",
    "Memory Operations/hexadecimal_and_ascii_dump.asm",
    "Memory Operations/word_pattern_fill.asm",
  ],
  "number-theory": [
    "Number Theory/sieve_of_eratosthenes.asm",
    "Number Theory/prime_factorisation.asm",
    "Number Theory/collatz_sequence_length.asm",
  ],
  patterns: [
    "Patterns/pascal_triangle.asm",
    "Patterns/diamond_pattern.asm",
    "Patterns/floyd_triangle.asm",
  ],
  "port-programming": [
    "Port Programming/led_running_light.asm",
    "Port Programming/traffic_light_state_table.asm",
    "Port Programming/seven_segment_display.asm",
  ],
  procedures: [
    "Procedures/local_variables.asm",
    "Procedures/procedure_parameters.asm",
    "Procedures/procedure_dispatch_table.asm",
    "Procedures/variable_argument_count.asm",
  ],
  recursion: [
    "Recursion/factorial_recursive_frames.asm",
    "Recursion/fibonacci_recursive.asm",
    "Recursion/gcd_recursive.asm",
    "Recursion/tower_of_hanoi.asm",
  ],
  searching: [
    "Searching/binary_search.asm",
    "Searching/ternary_search.asm",
    "Searching/search_in_sorted_matrix.asm",
  ],
  "shift-and-rotate": [
    "Shift and Rotate/rotate_right_through_carry.asm",
    "Shift and Rotate/shift_left_to_multiply.asm",
    "Shift and Rotate/overflow_flag_on_single_shift.asm",
    "Shift and Rotate/arithmetic_shift_signed_divide.asm",
  ],
  "signed-arithmetic": [
    "Signed Arithmetic/signed_multiply_imul.asm",
    "Signed Arithmetic/signed_divide_idiv.asm",
    "Signed Arithmetic/signed_sorting_by_value.asm",
    "Signed Arithmetic/sign_extension_cbw_cwd.asm",
  ],
  simulation: [
    "Simulation/vending_machine.asm",
    "Simulation/lift_controller.asm",
    "Simulation/parking_lot_occupancy.asm",
  ],
  sorting: [
    "Sorting/quick_sort.asm",
    "Sorting/merge_sort_bottom_up.asm",
    "Sorting/heap_sort.asm",
    "Sorting/radix_sort.asm",
    "Sorting/selection_sort_word_array.asm",
  ],
  "stack-operations": [
    "Stack Operations/stack_frame_with_bp.asm",
    "Stack Operations/passing_arguments_on_stack.asm",
    "Stack Operations/stack_depth_measurement.asm",
    "Stack Operations/swap_using_stack.asm",
  ],
  "string-instructions": [
    "String Instructions/movsb_copy_a_string.asm",
    "String Instructions/cmpsb_compare_strings.asm",
    "String Instructions/stosb_fill_a_buffer.asm",
    "String Instructions/scasb_find_a_character.asm",
  ],
  "string-operations": [
    "String Operations/palindrome_check.asm",
    "String Operations/caesar_cipher.asm",
    "String Operations/run_length_encoding.asm",
    "String Operations/longest_common_prefix.asm",
  ],
  utilities: [
    "Utilities/checksum_and_parity_byte.asm",
    "Utilities/thousand_separators.asm",
    "Utilities/leap_year_and_day_count.asm",
  ],
  "external-devices": [
    "External Devices/seven_segment_multiplexed_display.asm",
    "External Devices/relay_bank_bit_control.asm",
  ],
};

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(here, "..", "lib", "emulator", "corpus");

function slug(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base
    .replace(/\.asm$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function runSource(src: string): { output: string; err: string | null } {
  let program;
  try {
    program = assemble(src);
  } catch (e) {
    return { output: "", err: `assembly: ${(e as Error).message}` };
  }
  const m = createMachine(program);
  m.enqueueInput(INPUT);
  let n = 0;
  while (!m.halted && !m.err) {
    if (m.waitingForInput) break;
    if (n++ >= BUDGET) return { output: m.output, err: "instruction budget" };
    m.step();
  }
  return { output: m.output, err: m.err };
}

function main(): void {
  const args = process.argv.slice(2);
  const corpus = args.find((a) => !a.startsWith("--"));
  const updating = args.includes("--update");
  if (!corpus || !existsSync(corpus)) {
    console.error(
      "usage: bun scripts/corpus-fixtures.ts <path-to-8086-ASSEMBLY-LANGUAGE-PROGRAMS> [--update]",
    );
    process.exit(2);
  }

  const goldenPath = join(
    corpus,
    "8086 Microprocessor Simulator/js/test/expected-output.json",
  );
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as Record<
    string,
    { output: string; finished: boolean }
  >;

  const manifest: Record<string, string> = {};
  const mismatches: string[] = [];
  let count = 0;

  for (const [topic, files] of Object.entries(SELECTION)) {
    mkdirSync(join(CORPUS_DIR, topic), { recursive: true });
    for (const file of files) {
      const from = join(corpus, file);
      if (!existsSync(from)) {
        console.error(`missing in corpus: ${file}`);
        process.exit(2);
      }
      const to = join(CORPUS_DIR, topic, `${slug(file)}.asm`);
      copyFileSync(from, to);
      const key = `${topic}/${slug(file)}.asm`;
      manifest[key] = topic;
      count++;
      if (updating) continue;
      const want = golden[file]?.output;
      const got = runSource(readFileSync(to, "utf8"));
      if (got.err) mismatches.push(`${key}: ${got.err}`);
      else if (got.output !== want) mismatches.push(`${key}: output differs`);
    }
  }

  if (updating) {
    const expected: Record<string, string> = {};
    for (const [topic, files] of Object.entries(SELECTION)) {
      for (const file of files) {
        const key = `${topic}/${slug(file)}.asm`;
        expected[key] = golden[file]!.output;
      }
    }
    writeFileSync(
      join(CORPUS_DIR, "expected.json"),
      JSON.stringify(expected, null, 2) + "\n",
    );
    console.log(`wrote ${count} programs and their expected output`);
    return;
  }

  console.log(`${count} programs checked`);
  if (mismatches.length > 0) {
    for (const m of mismatches) console.error(`  FAIL ${m}`);
    process.exit(1);
  }
  console.log("all match the recorded output");
}

main();

/** Topics the corpus directory holds, for the test that guards coverage. */
export function corpusTopics(): string[] {
  return readdirSync(CORPUS_DIR)
    .filter((e) => statSync(join(CORPUS_DIR, e)).isDirectory())
    .sort();
}
