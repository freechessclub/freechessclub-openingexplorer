# Free Chess Club Opening Explorer

A tool for creating a chess opening explorer file from a PGN file, along with a web client for importing and retrieving entries from that file. 

> Used by [Free Chess Club](http://freechess.org/play) · [GitHub repository](https://github.com/FreeChessClub/freechessclub-app)

The export tool is a fork of Lichess' **lila-openingexplorer** database server, with an additional Rust binary, `masters-dump.rs`, for generating the explorer file.

The web-client is a typescript module for retrieving positions from the explorer file.

## Creating an Explorer File

### 1. Build and run lila-openingexplorer

From the project directory:

```bash
cd lila-opening-explorer
set -a && source .env && set +a
ulimit -n 131072 && EXPLORER_LOG=lila_openingexplorer=info cargo run --bin lila-openingexplorer --release -- --db-compaction-readahead
```

### 2. Import games from a PGN file

In a separate terminal:

```bash
python3 import-master.py <pgn-file>
```

### 3. Output the Explorer file

First terminate `lila-openingexplorer`.

Then, from the same folder, run:

```bash
cargo run --bin masters-dump --release -- --output masters.oe
```

#### Command-line options

| Option                  | Description                                       | Default            |
| ----------------------- | ------------------------------------------------- | ------------------ |
| `--output <OUTPUT>`     | Output file name                                  | `masters.oe`       |
| `--key-size <KEY_SIZE>` | Size of the truncated Zobrist hash in bytes       | `8` (maximum `12`) |
| `--include-rating-avg`  | Include the average rating for each move          | Not included       |
| `--no-last-year`        | Do not include the last year played for each move | Included           |

For example:

```bash
cargo run --bin masters-dump --release -- \
    --output masters.oe \
    --key-size 12 \
    --include-rating-avg
```

### Splitting the Explorer file

The output file can optionally be split into multiple parts. The web client supports fetching a split explorer file.

For example, to split `masters.oe` into four parts:

```bash
split -n 4 -d masters.oe masters.oe.
```


## Web Client

The web client consists of a TypeScript class called `Explorer`, which can be used to fetch the explorer file and retrieve position records from it.

For memory efficiency, the web client streams the Explorer file(s) and stores them as indexed data blocks in IndexedDB. By default, the file is divided into 128 blocks.

See `index.html` in the example web app for usage.

### Running the Example Web App

```bash
cd web-client
npm install
npm run dev
```

By default, the example web app uses the `masters.oe` file(s) in `data/`, which are automatically copied to `web-client/public/data/`.

Alternatively, you can place your own data file(s) in `web-client/public/data/` and modify the parameters passed to `Explorer()` in `index.html`.


## Explorer File Format

For details on the `.oe` Explorer file format, see the comments at the top of:

```text
lila-openingexplorer/src/bin/masters-dump.rs
```
