import re

INPUT_FILE = "src/zobrist.rs"
OUTPUT_FILE = "zobrist.ts"

rust = open(INPUT_FILE, "r", encoding="utf-8").read()

def extract_array(name):
    pattern = rf"const {name}: \[u128;.*?\] = \[(.*?)\];"
    match = re.search(pattern, rust, re.S)

    if not match:
        raise RuntimeError(f"Could not find array {name}")

    values = re.findall(
        r"0x[0-9a-fA-F_]+",
        match.group(1)
    )

    return [
        value.replace("_", "") + "n"
        for value in values
    ]


def extract_value(name):
    pattern = rf"const {name}: u128 = (0x[0-9a-fA-F_]+);"
    match = re.search(pattern, rust)

    if not match:
        raise RuntimeError(f"Could not find value {name}")

    return match.group(1).replace("_", "") + "n"


with open(OUTPUT_FILE, "w", encoding="utf-8") as out:

    out.write("// Generated from Lichess zobrist.rs\n\n")

    arrays = [
        "PIECE_MASKS",
        "CASTLING_RIGHT_MASKS",
        "EN_PASSANT_FILE_MASKS",
        # For variants uncomment these
        # "REMAINING_CHECKS_MASKS",
        # "PROMOTED_MASKS",
        # "POCKETS_MASKS",
    ]

    for name in arrays:
        values = extract_array(name)

        out.write(
            f"export const {name}: bigint[] = [\n"
        )

        for value in values:
            out.write(f"    {value},\n")

        out.write("];\n\n")

    value = extract_value("WHITE_TURN_MASK")

    out.write(
        f"export const WHITE_TURN_MASK: bigint = {value};\n"
    )

print(f"Written {OUTPUT_FILE}")