const Module = require('node:module');

const originalLoad = Module._load;

class Directory {
  constructor(...parts) {
    this.path = parts
      .map((part) => (typeof part === 'string' ? part : part.path))
      .join('/');
    this.exists = true;
  }

  create() {
    this.exists = true;
  }
}

class File {
  constructor(directory, name) {
    this.path = [directory.path, name].join('/');
    this.exists = false;
  }

  create() {
    this.exists = true;
  }

  write(text) {
    if (globalThis.__sceneDraftWriteError) {
      throw new Error('draft write failed');
    }

    globalThis.__sceneDraftWrites ??= [];
    globalThis.__sceneDraftWrites.push({ path: this.path, text });
    this.exists = true;
  }

  textSync() {
    return '';
  }
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
