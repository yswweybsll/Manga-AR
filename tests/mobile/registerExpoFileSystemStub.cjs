const Module = require('node:module');

const originalLoad = Module._load;

class Directory {
  constructor(...parts) {
    this.path = parts
      .map((part) => (typeof part === 'string' ? part : part.path))
      .join('/');
  }

  get exists() {
    return true;
  }

  create() {
    return undefined;
  }
}

class File {
  constructor(directory, name) {
    this.path = [directory.path, name].join('/');
  }

  get uri() {
    return this.path;
  }

  get exists() {
    return getFiles().has(this.path);
  }

  get size() {
    return getBytes(this.path).byteLength;
  }

  create() {
    getFiles().set(this.path, new Uint8Array());
  }

  write(text) {
    if (globalThis.__sceneDraftWriteError) {
      throw new Error('draft write failed');
    }

    globalThis.__sceneDraftWrites ??= [];
    globalThis.__sceneDraftWrites.push({ path: this.path, text });
    getFiles().set(this.path, textEncoder.encode(text));
  }

  textSync() {
    return textDecoder.decode(getBytes(this.path));
  }

  async bytes() {
    return getBytes(this.path);
  }

  delete() {
    getFiles().delete(this.path);
  }

  static async downloadFileAsync(url, target) {
    const downloads = globalThis.__expoFileSystemDownloads ?? {};
    if (!(url in downloads)) {
      throw new Error(`missing download fixture: ${url}`);
    }
    getFiles().set(target.path, toBytes(downloads[url]));
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function getFiles() {
  globalThis.__expoFileSystemFiles ??= new Map();
  return globalThis.__expoFileSystemFiles;
}

function getBytes(path) {
  return getFiles().get(path) ?? new Uint8Array();
}

function toBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (typeof value === 'string') {
    return textEncoder.encode(value);
  }

  return new Uint8Array(value);
}

Module._load = function loadWithExpoFileSystemStub(request, parent, isMain) {
  if (request === 'expo-file-system') {
    return {
      Directory,
      File,
      Paths: { document: 'memory://document' },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};
