// Copyright 2026 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

/** Class for simplifying storing data in indexedDB */
export class IDBStorage {
  private readonly dbName = "FreeChessClubOpeningExplorerExample"; // The app's database
  private readonly version = 1; // Update this if we change the schema (add more stores etc).

  private db?: IDBDatabase;
  private opening?: Promise<IDBDatabase>;

  /**
   * Open and return the database
   */
  private async open(): Promise<IDBDatabase> {
    if(this.db) // Already open
      return this.db;

    if(this.opening) 
      return this.opening;
   
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = () => {
        const db = request.result;

        // Create object stores here as the schema evolves
        if(!db.objectStoreNames.contains("explorer")) 
          db.createObjectStore("explorer");
      };

      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => {
          db.close();
          this.db = undefined;
        };

        db.onclose = () => {
          this.db = undefined;
        };

        this.db = db;
        this.opening = undefined;

        resolve(db);
      };

      request.onerror = () => {
        this.opening = undefined;
        reject(request.error);
      };
    });

    return this.opening;
  }

  /** Get an item from the specified store */
  async get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    const [result] = await this.getMany<[T]>(storeName, [key]);
    return result;
  }

  /** 
   * Get multiple items from the specified store 
   * @param storeName the store to get from
   * @param keys an array of keys
   * @returns an array of items, the types of which are specified in the type argument
   */
  async getMany<T extends unknown[]>(storeName: string, keys: IDBValidKey[]): Promise<T> {
    const db = await this.open();

    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);

      const results = new Array(keys.length) as T;

      let remaining = keys.length;

      if(remaining === 0) {
        resolve(results);
        return;
      }

      keys.forEach((key, index) => {
        const request = store.get(key);

        request.onsuccess = () => {
          results[index] = request.result;

          remaining--;
          if(remaining === 0) 
            resolve(results);
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    });
  }

  /** Puts a key/value pair in the specified store */
  async put(storeName: string, key: IDBValidKey, value: unknown): Promise<void> {
    return this.putMany(storeName, [
      [key, value]
    ]);
  }

  /** Puts the entries (key/value pairs) in the specified store */
  async putMany(storeName: string, entries: [IDBValidKey, unknown][]): Promise<void> {
    const db = await this.open();

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      for (const [key, value] of entries) 
        store.put(value, key);

      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { reject(tx.error); };
      tx.onabort = () => { reject(tx.error); };
    });
  }

  /** Delete an entry from the specified store */
  async delete(storeName: string, key: IDBValidKey): Promise<void> {
    return this.deleteMany(storeName, [key]);
  }

  /** Deletes multiple entries from the specified store */
  async deleteMany(storeName: string, keys: IDBValidKey[]): Promise<void> {
    const db = await this.open();

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      for(const key of keys)
        store.delete(key);
      
      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { reject(tx.error); };
      tx.onabort = () => { reject(tx.error); };
    });
  }

  /** Close the database (usually we leave it open though) */
  close(): void {
    if(this.db) {
      this.db.close();
      this.db = undefined;
    }
  }

  /** Delete all keys from a store */
  async clear(storeName: string): Promise<void> {
    const db = await this.open();

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);

      store.clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /** Delete all keys with the given prefix from store */
  async deleteByPrefix(storeName: string, prefix: string): Promise<void> {
    const db = await this.open();

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);

      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;

        if (!cursor) {
          return;
        }

        if(typeof cursor.key === "string" && cursor.key.startsWith(prefix)) {
          cursor.delete();
        }

        cursor.continue();
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

/**
 * Wrapper for ByteReader which streams bytes from a file reader or sequentially from an array of 
 * file readers. Automatically handles stream chunk and file boundaries (in the case of reading from 
 * multiple files).
 */
export class ByteStreamReader {
  private fileIndex = 0; // Current file we're reading from
  private byteReader: ByteReader; // The ByteReader to stream bytes into
  private streamReaders: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>[]; // Array of file readers

  constructor(
    readers:
      | ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>
      | ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>[]
  ) {
    this.streamReaders = Array.isArray(readers) ? readers : [readers];
    this.byteReader = new ByteReader(new Uint8Array(0));
  }

  /** Append the next stream chunk onto the end of the ByteReader's buffer (enlarging the buffer) */
  private appendBuffer(value: Uint8Array<ArrayBufferLike>) {
    const remaining =
      this.byteReader.readBytes(this.byteReader.available) ??
      new Uint8Array(0);

    if (remaining.length === 0) {
      this.byteReader = new ByteReader(value);
      return;
    }

    const combined = new Uint8Array(
      remaining.length + value.length
    );

    combined.set(remaining);
    combined.set(value, remaining.length);

    this.byteReader = new ByteReader(combined);
  }

  /* Keep fetching chunks from the stream until we have enough bytes to fulfill the current read 
   * operation on ByteReader 
   */
  private async fillBuffer(count: number): Promise<boolean> {
    while (this.byteReader.available < count) {
      const streamReader = this.streamReaders[this.fileIndex];

      if (!streamReader)
        return false;

      const { done, value } = await streamReader.read();

      if (done) {
        this.fileIndex++;
        continue;
      }

      this.appendBuffer(value);
    }

    return true;
  }

  /** The remaining bytes in the ByteReader */
  get available(): number {
    return this.byteReader.available;
  }

  /** 
   * Try to read a byte from the ByteReader synchronously (fast path). If this returns undefined
   * then you should use readByte() instead, which reads more bytes from the stream.
   */
  readByteSync(): number | undefined {
    return this.byteReader.readByte();
  }

  /**
   * Read the next byte from the reader/stream 
   */
  async readByte(): Promise<number> {
    const value = this.readByteSync();

    if (value !== undefined)
      return value;

    if (!(await this.fillBuffer(1)))
      throw new EndOfStreamError();

    return this.readByteSync()!;
  }

  /** 
   * Try to read count bytes from the ByteReader synchronously (fast path). If this returns undefined
   * then you should use readBytes() instead, which reads more bytes from the stream.
   */
  readBytesSync(count: number): Uint8Array | undefined {
    return this.byteReader.readBytes(count);
  }

  /**
   * Reads count bytes from the reader/stream 
   */
  async readBytes(count: number): Promise<Uint8Array> {
    const value = this.readBytesSync(count);

    if (value !== undefined)
      return value;

    if (!(await this.fillBuffer(count)))
      throw new EndOfStreamError();

    return this.readBytesSync(count)!;
  }

  /** Try to read a varint from the Bytereader synchronously (fast path) */
  readUintSync(): number | undefined {
    return this.byteReader.readUint();
  }

  /** Reads a varint from the reader/stream */
  async readUint(): Promise<number> {
    const value = this.readUintSync();

    if (value !== undefined)
      return value;

    while (true) {
      if (!(await this.fillBuffer(1)))
        throw new EndOfStreamError();

      const value = this.readUintSync();

      if (value !== undefined)
        return value;
    }
  }

  /** Close the file readers */
  async close() {
    for (const streamReader of this.streamReaders) {
      try {
        await streamReader.cancel();
      }
      catch {
        // ignore cancellation errors
      }
    }
  }
}

export class EndOfStreamError extends Error {
  constructor() {
    super('End of stream');
    this.name = 'EndOfStreamError';
  }
}

/** 
 * Helper class for reading data from a buffer and incrementing the current read offset / position 
 */
export class ByteReader {
  private offset = 0; // Current read offset

  constructor(private buffer: Uint8Array<ArrayBufferLike>) {}

  /** The number of unread bytes left in the buffer */
  get available(): number {
    return this.buffer.length - this.offset;
  }

  /** The current read offset */
  get position(): number {
    return this.offset;
  }

  /** Read the next byte from the buffer */
  readByte(): number | undefined {
    if (this.offset >= this.buffer.length)
      return undefined;

    return this.buffer[this.offset++];
  }

  /** Read count bytes from the buffer */
  readBytes(count: number): Uint8Array | undefined {
    if(this.offset + count > this.buffer.length)
      return undefined;

    const result = this.buffer.subarray(this.offset, this.offset + count);
    this.offset += count;

    return result;
  }

  /** 
   * Read a uint or varint from the buffer 
   * @param bytes The size of the uint in bytes (e.g. 4 = uint32) or if undefined then reads a varint.
   * Max size 4, use readBigUint64 to read an 8 byte number.
   */
  readUint(bytes?: number): number | undefined {
    if(bytes) {
      const data = this.readBytes(bytes);

      if(!data)
        return undefined;

      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

      switch(bytes) {
        case 1:
          return view.getUint8(0);
        case 2:
          return view.getUint16(0, true);
        case 4:
          return view.getUint32(0, true);
        default:
          throw new Error(`Unsupported size: ${bytes}`);
      }
    }

    let value = 0;
    let shift = 0;

    while(true) {
      const b = this.readByte();

      if(b === undefined)
        return undefined;

      value += (b & 0x7f) * Math.pow(2, shift);

      if((b & 0x80) === 0)
        return value;

      shift += 7;
    }
  }

  /** Read a uint64 from the buffer */
  readBigUint64(): bigint | undefined {
    const data = this.readBytes(8);

    if(!data)
      return undefined;

    let value = 0n;

    for(let i = 0; i < 8; i++) {
      value |= BigInt(data[i]) << BigInt(i * 8);
    }

    return value;
  }
}

/** 
 * Helper class for writing data to a buffer, incrementing the current write offset / position
 * and enlarging the buffer when necessary. 
 */
export class ByteWriter {
  private buffer: Uint8Array;
  private offset = 0; // Current write offset

  constructor(initialSize = 1024) {
    this.buffer = new Uint8Array(initialSize);
  }

  /** Enlarge the buffer if necessary */
  private ensureCapacity(size: number) {
    const required = this.offset + size;

    if(required <= this.buffer.length) 
      return;

    let newSize = this.buffer.length * 2;

    while(newSize < required) 
      newSize *= 2;

    const newBuffer = new Uint8Array(newSize);
    newBuffer.set(this.buffer);

    this.buffer = newBuffer;
  }

  /** Write bytes to the buffer */
  writeBytes(bytes: Uint8Array) {
    this.ensureCapacity(bytes.length);

    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  /** 
   * Write a uint or varint to the buffer.
   * @param bytes The size of the uint in bytes (e.g. 4 = uint32) or if undefined then writes a varint.
   * Max size 4, use writeBigUint64 to write an 8 byte number.
   */
  writeUint(value: number, bytes?: number) {
    if(!bytes) { 
      while (value >= 0x80) {
        this.ensureCapacity(1);
        this.buffer[this.offset++] = (value & 0x7f) | 0x80;
        value >>>= 7;
      }

      this.ensureCapacity(1);
      this.buffer[this.offset++] = value;
    }
    else {
      const buffer = new ArrayBuffer(bytes);
      const view = new DataView(buffer);

      switch (bytes) {
        case 1:
          view.setUint8(0, value);
          break;
        case 2:
          view.setUint16(0, value, true);
          break;
        case 4:
          view.setUint32(0, value, true);
          break;
        default:
          throw new Error(`Unsupported size: ${bytes}`);
      }

      this.writeBytes(new Uint8Array(buffer));
    }
  }

  /** Writes a uint64 to the buffer */
  writeBigUint64(value: bigint) {
    const buffer = new Uint8Array(8);

    for(let i = 0; i < 8; i++) {
      buffer[i] = Number(value & 0xffn);
      value >>= 8n;
    }

    this.writeBytes(buffer);
  }

  /** Get the bytes written to the buffer */
  getBytes(): Uint8Array {
    return this.buffer.subarray(0, this.offset);
  }

  /** Get the number of bytes that have been written so far */
  get length(): number {
    return this.offset;
  }
}