// Copyright 2026 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

//! Exports an explorer file from the lila-openingexplorer masters database.
//! The explorer file will contain all positions with number of games >= 2 and only includes
//! moves in a position if that move has number of games >= 2. 
//!
//! Command line options
//! --output <OUTPUT FILE NAME> - The file name to output, e.g masters.oe
//! --key-size <KEY_SIZE>       - The size of the truncated zobrist hash (default: 8 bytes, max: 12)
//! --include-rating-avg        - Include rating average for each move (default: not included) 
//! --no-last-year              - Include last year played for each move (default: included)
//! The format of the explorer file is as follows:
//! [metadata]
//! [record size][record: [record key][move data][move data]... ]
//! [record size][record: [record key][move data][move data]... ]
//! ...  
//! All fixed width fields are stored little-endian
//! varints are stored as ULEB128
//! Records are sorted by the record key in lexicographical byte ordering
//! The record key is a truncated zobrist128 hash of the position fen, 8 bytes by default.
//! Move data for each move is in the form:
//! [uci move:2 bytes][last year played (offset)?:varint][average rating?:varint]
//! [white wins + 6:varint][draws:varint][black wins:varint] 
//! uci move is encoded as follows:
//! [from square:bits 0-5][to square:bits 6-11][promotion piece:bits 12-15]
//! square: 0 = a1, 1 = b1, ..., 63 = h8
//! promotion (or piece placement): 0 = none (or pawn), 1 = knight, 2 = bishop, 3 = rook, 4 = queen, 5 = king 
//! Last year played is relative to base_year in the metadata which is the year the 
//! file was exported, e.g. if base_year is 2026 then 2023 is encoded as 3. 
//! For the white/draws/black stats. There is compressed form when number of games played = 2. In that
//! case only the first byte is used and is encoded as follows:
//! [2, 0, 0] = 0 // [wins, draws, losses]
//! [0, 2, 0] = 1
//! [0, 0, 2] = 2
//! [1, 1, 0] = 3
//! [1, 0, 1] = 4
//! [0, 1, 1] = 5
//! Therefore in the uncompressed case the number of white wins is the first varint - 6
//! Metadata has the form
//! [Magic number:"FCOE"]       -- Free Chess Club Opening Explorer format *.oe
//! [Format version:2 bytes]    -- Currently 1
//! [Flags:2 bytes]             -- [include average rating:bit0:default 0]
//!                                [include last year played:bit1:default 1]
//! [Key Size Bytes:1 byte]     -- Zobrist hash key size: Default 8
//! [Revision Number:8 bytes]   -- The UNIX time the file was generated
//! [Number of Records:4 bytes] -- Number of position records
//! [Base Year:2 bytes]         -- The year the file was generated

use lila_openingexplorer::{
  db::{Database, DbOpt},
  model::{KeyPrefix, MastersEntry, Stats, write_uint, RawUciMove, GameId},
};
use clap::Parser;
use std::fs::File;
use std::io::{Write, Seek, SeekFrom};
use bytes::{Buf, BufMut};
use std::time::{SystemTime, UNIX_EPOCH};
use time::OffsetDateTime;

const FLAG_RATING_AVG: u16 = 1 << 0;
const FLAG_LAST_YEAR: u16 = 1 << 1;

#[derive(Parser)]
struct Opt {
  #[command(flatten)]
  db: DbOpt,

  /// Output file name
  #[arg(long, default_value = "masters.oe")]
  output: String,

  /// File format version
  #[arg(long, default_value_t = 1)]
  format_version: u16,

  /// Include rating avgs
  #[arg(long)]
  include_rating_avg: bool,

  /// Do not include last year information
  #[arg(long)]
  no_last_year: bool,

  /// Output key size in bytes
  #[arg(long, default_value_t = 8)]
  key_size: usize,
}

struct ExportConfig {
  format_version: u16,
  flags: u16,
  key_size: usize,
  include_rating_avg: bool,
  include_last_year: bool,
}

fn main() -> std::io::Result<()> {
  const MAGIC: &[u8; 4] = b"FCOE";

  let opt = Opt::parse();

  if opt.key_size == 0 || opt.key_size > 12 {
      panic!("key size must be between 1 and 12 bytes");
  }

  let include_last_year = !opt.no_last_year;

  let mut flags = 0u16;

  if opt.include_rating_avg {
    flags |= FLAG_RATING_AVG;
  }

  if include_last_year {
    flags |= FLAG_LAST_YEAR;
  }

  let config = ExportConfig {
    format_version: opt.format_version,
    flags,
    key_size: opt.key_size,
    include_rating_avg: opt.include_rating_avg,
    include_last_year,
  };

  let revision_id = generate_revision_id();

  let db = Database::open(opt.db).expect("db");
  let masters_db = db.masters();

  let mut record_count = 0;
  let mut pos_count = 0;

  let base_year = OffsetDateTime::now_utc().year() as u16; // Stored 'last year played' value is relative to base year
  let mut file = File::create(&opt.output)?;
  // Write header
  file.write_all(MAGIC)?;
  file.write_all(&config.format_version.to_le_bytes())?;
  file.write_all(&config.flags.to_le_bytes())?;
  file.write_all(&(config.key_size as u8).to_le_bytes())?;
  file.write_all(&revision_id.to_le_bytes())?;
  let num_entries_pos = file.stream_position()?; 
  file.write_all(&0u32.to_le_bytes())?; // Leave room for # entries, write it at the end
  file.write_all(&base_year.to_le_bytes())?;

  let mut written_count: u32 = 0;

  const FLUSH_SIZE: usize = 8 * 1024 * 1024;
  let mut buf = Vec::with_capacity(FLUSH_SIZE);

  let mut curr_prefix: Option<[u8; KeyPrefix::SIZE]> = None;
  let mut curr_entry: Option<MastersEntry> = None;

  for (key, value) in masters_db.iter() { // Iterate all records (positions)
    let prefix: [u8; KeyPrefix::SIZE] =
      key[..KeyPrefix::SIZE].try_into().unwrap(); // Extract the truncated zobrist hash from the key

    let year = u16::from_be_bytes(                // Extract the year from the key
      key[KeyPrefix::SIZE..KeyPrefix::SIZE + 2]
          .try_into()
          .unwrap()
    );

    // Note that lila stores records like:
    // [key: <12-byte truncated zobrist hash><year>][data: [move data][top games]]
    // Whereas we want to store all years under the same combined record for a position
    // Therefore combine all records that have the same zobrist hash (but different years) into a 
    // single output record with the stats summed together

    if curr_prefix != Some(prefix) {
      // New hash reached, so write the previous record to the out buffer
      if let Some(entry) = curr_entry.take() {
        write_pos(
          curr_prefix.as_ref().unwrap(),
          &entry,
          &mut buf,
          base_year,
          &config,
          &mut pos_count,
          &mut written_count,
        );

        if buf.len() >= FLUSH_SIZE {
          file.write_all(&buf)?; // flush the buffer to disk
          buf.clear();
        }
      }

      curr_entry = Some(MastersEntry::default());
      curr_prefix = Some(prefix);
    }

    // Aggregate this input record into our output record
    if let Some(entry) = curr_entry.as_mut() {
      let mut value = &value[..];
      extend_entry_from_reader(entry, &mut value, year);
    }

    record_count += 1;
  }

  // Write the final record
  if let (Some(prefix), Some(entry)) = (curr_prefix.as_ref(), curr_entry) {
    write_pos(
      prefix,
      &entry,
      &mut buf,
      base_year,
      &config,
      &mut pos_count,
      &mut written_count,
    );
  }

  if !buf.is_empty() {
    file.write_all(&buf)?;
  }
  
  // Write the number of records into the metadata
  file.seek(SeekFrom::Start(num_entries_pos))?;
  file.write_all(&written_count.to_le_bytes())?;

  println!("Input Entries: {}", record_count);
  println!("Input Positions: {}", pos_count);
  println!("Output Positions: {}", written_count);

  Ok(())
}

/// Write a record to the out buffer
fn write_pos(
  prefix: &[u8; KeyPrefix::SIZE],
  entry: &MastersEntry,
  buf: &mut Vec<u8>,
  base_year: u16,
  config: &ExportConfig,
  pos_count: &mut usize,
  written_count: &mut u32,
) {
  *pos_count += 1;

  let mut total = Stats::default();

  for group in entry.groups.values() {
    if group.stats.total() >= 2 {
      total += &group.stats;
    }
  }

  // No moves with number of games >= 2 so exclude this position
  if total.total() == 0 {
    return;
  }

  let mut record = Vec::new();

  // Write shortened key
  record.extend_from_slice(&prefix[..config.key_size]);

  for (uci, group) in &entry.groups {
    if group.stats.total() >= 2 { // Excluse moves with only 1 game
      uci.write(&mut record); // Write the UCI move 

      // Write the last year (as an offset from base yaear)
      if config.include_last_year { 
        write_uint(
          &mut record,
          (base_year - group.last_year) as u64
        );
      }

      // Write the stats
      write_stats(
        &group.stats,
        &mut record,
        config.include_rating_avg,
      );
    }
  }

  // Write record size then record data
  write_uint(buf, record.len() as u64);
  buf.extend_from_slice(&record);

  *written_count += 1;
}

/// Give the file a unique id
fn generate_revision_id() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("System time is before UNIX epoch")
    .as_millis() as u64
}

/// Write move's stats to the output buffer
fn write_stats<B: BufMut>(
  stats: &Stats,
  buf: &mut B,
  include_rating_avg: bool,
) {
  if include_rating_avg {
    write_uint(buf, stats.average_rating().unwrap() as u64);
  }

  let white: u64 = stats.white();
  let draws: u64 = stats.draws();
  let black: u64 = stats.black();

  let compressed = match (white, draws, black) {
    (2, 0, 0) => Some(0),
    (0, 2, 0) => Some(1),
    (0, 0, 2) => Some(2),
    (1, 1, 0) => Some(3),
    (1, 0, 1) => Some(4),
    (0, 1, 1) => Some(5),
    _ => None,
  };

  if let Some(value) = compressed {
    write_uint(buf, value);
  } else {
    write_uint(buf, white + 6);
    write_uint(buf, draws);
    write_uint(buf, black);
  }
}

/// Aggregates records together
fn extend_entry_from_reader<B: Buf>(
  entry: &mut MastersEntry,
  buf: &mut B,
  year: u16,
) {
  while buf.has_remaining() {
    let uci = RawUciMove::read(buf);
    let group = entry.groups.entry(uci).or_default();
    group.stats += &Stats::read(buf);
    let num_games = usize::from(buf.get_u8());
    group
      .games
      .extend(
        (0..num_games)
          .map(|_| (buf.get_u16_le(), GameId::read(buf)))
      );

    group.last_year = year;
  }
}