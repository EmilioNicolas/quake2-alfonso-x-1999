const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createBrowser } = require('./helpers/browser.cjs');

function streamResponse(parts) {
    let index = 0;
    return {
        ok: true,
        headers: new Headers(),
        body: { getReader: () => ({
            read: async () => index < parts.length
                ? { done: false, value: parts[index++] }
                : { done: true },
            cancel: async () => {},
            releaseLock() {}
        }) }
    };
}

class UnexpectedBlob {
    constructor() { throw new Error('Archive assembly must not allocate a Blob'); }
}

// Exercise the write implementations shipped with this runtime. Copying their
// behavior into a mock would miss changes to Emscripten's ownership semantics.
function generatedFilesystem(Bytes = Uint8Array) {
    const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    const memfsStart = source.indexOf('var MEMFS=');
    const memfsEnd = source.indexOf(';var FS_modeStringToFlags', memfsStart);
    const writeStart = source.indexOf('write(stream,buffer,offset,length,position,canOwn){if(length<0');
    const writeEnd = source.indexOf(',mmap(', writeStart);
    assert.ok(memfsStart >= 0 && memfsEnd > memfsStart, 'Locate the generated MEMFS object');
    assert.ok(writeStart >= 0 && writeEnd > writeStart, 'Locate the generated FS.write method');
    const files = new Map();
    const FS = {
        isClosed: stream => stream.closed,
        isDir: mode => (mode & 61440) === 16384,
        ErrnoError: class extends Error {}
    };
    const context = vm.createContext({ FS, HEAP8: new Uint8Array(1), Uint8Array: Bytes });
    const MEMFS = vm.runInContext(source.slice(memfsStart, memfsEnd) + ';MEMFS', context);
    FS.write = vm.runInContext('({' + source.slice(writeStart, writeEnd) + '}).write', context);
    FS.open = (name, flags) => {
        assert.equal(flags, 'w');
        const stream = {
            node: { mode: 32768, contents: null, usedBytes: 0 },
            flags: 577, seekable: true, position: 0, closed: false,
            stream_ops: MEMFS.stream_ops
        };
        files.set(name, stream);
        return stream;
    };
    FS.close = stream => { stream.closed = true; };
    return { FS, files };
}

test('a one-part download reuses its byte view without a Blob or an extra byte copy', async () => {
    const part = new Uint8Array([90, 1, 2, 3, 91]).subarray(1, 4);
    const browser = createBrowser({ globals: {
        Blob: UnexpectedBlob,
        fetch: async () => streamResponse([part])
    } });
    const bytes = await browser.context.downloadOne('/small.pak', 0);
    assert.equal(bytes, part);
    assert.deepEqual([...bytes], [1, 2, 3]);
    assert.equal(browser.context._downloaded, 3);
    assert.equal(browser.timers.size, 0);
});

test('multipart downloads allocate one destination and copy each byte once without a Blob', async () => {
    const allocations = [];
    let copiedBytes = 0;
    class CountedBytes extends Uint8Array {
        constructor(value, ...args) {
            super(value, ...args);
            if (typeof value === 'number') allocations.push(value);
        }
        set(value, offset) {
            copiedBytes += value.length;
            return super.set(value, offset);
        }
    }
    const browser = createBrowser({ globals: {
        Blob: UnexpectedBlob,
        Uint8Array: CountedBytes,
        fetch: async () => streamResponse([
            new Uint8Array([90, 1, 2, 91]).subarray(1, 3),
            new Uint8Array([3]),
            new Uint8Array([4, 5])
        ])
    } });
    const bytes = await browser.context.downloadOne('/multipart.pak', 0);
    assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
    assert.deepEqual(allocations, [5]);
    assert.equal(copiedBytes, 5);
    assert.equal(browser.timers.size, 0);
});

test('the generated FS and MEMFS adopt complete archive buffers and preserve chunk order', async () => {
    const { FS, files } = generatedFilesystem();
    let nextFile = 0;
    const browser = createBrowser({ globals: {
        FS,
        fetch: async () => {
            const firstByte = ++nextFile * 10;
            if (nextFile === 5) {
                return streamResponse([new Uint8Array([90, firstByte, firstByte + 1, 91]).subarray(1, 3)]);
            }
            return streamResponse([new Uint8Array([firstByte]), new Uint8Array([firstByte + 1])]);
        }
    } });
    await browser.context.startGame();
    assert.equal(browser.context.gameState, 'starting');
    const originals = browser.context._pakFiles.map(file => ({ name: file.name, data: file.data }));
    browser.context.Module.onRuntimeInitialized();
    assert.deepEqual([...files.get('/baseq2/pak0.pak').node.contents], [10, 11, 20, 21, 30, 31, 40, 41]);
    assert.deepEqual([...files.get('/baseq2/pak1.pak').node.contents], [50, 51]);
    for (const original of originals) {
        const stream = files.get(original.name);
        assert.equal(stream.node.contents.buffer, original.data.buffer, 'MEMFS must reuse the archive backing buffer');
        assert.equal(stream.node.contents.byteOffset, original.data.byteOffset);
        assert.equal(stream.node.usedBytes, original.data.length);
        assert.equal(stream.closed, true);
    }
    assert.equal(browser.context._pakFiles, undefined);
});

test('stream timeout handling does not accumulate subscriptions to one promise for every read', async () => {
    const subscriptions = [];
    class CountedPromise extends Promise {
        constructor(executor) {
            super(executor);
            this.counter = { count: 0 };
            subscriptions.push(this.counter);
        }
        then(...args) {
            this.counter.count++;
            return super.then(...args);
        }
    }
    const parts = Array.from({ length: 1000 }, () => new Uint8Array([1]));
    const browser = createBrowser({ globals: {
        Promise: CountedPromise,
        fetch: async () => streamResponse(parts)
    } });
    const bytes = await browser.context.downloadOne('/many-parts.pak', 0);
    assert.equal(bytes.length, 1000);
    const maximumSubscriptions = Math.max(...subscriptions.map(counter => counter.count));
    // One pending deadline raced against every read accumulated 1,002 callbacks
    // for this fixture, retaining settled read results until the attempt ended.
    assert.ok(maximumSubscriptions <= 2, `A promise accumulated ${maximumSubscriptions} subscriptions`);
    assert.equal(browser.timers.size, 0);
});

test('single-part archive installation stays within one pak0-length byte-copy budget', async () => {
    let copiedBytes = 0;
    let allocatedBytes = 0;
    class CountedBytes extends Uint8Array {
        constructor(value, ...args) {
            super(value, ...args);
            if (typeof value === 'number') allocatedBytes += value;
        }
        set(value, offset) {
            copiedBytes += value.length;
            return super.set(value, offset);
        }
        slice(start, end) {
            const result = super.slice(start, end);
            copiedBytes += result.length;
            return result;
        }
    }
    class CountedBlob extends Blob {
        constructor(parts, ...args) {
            super(parts, ...args);
            copiedBytes += this.size;
        }
        async arrayBuffer() {
            copiedBytes += this.size;
            return super.arrayBuffer();
        }
    }
    const { FS, files } = generatedFilesystem(CountedBytes);
    let nextFile = 0;
    const browser = createBrowser({ globals: {
        FS, Uint8Array: CountedBytes, Blob: CountedBlob,
        fetch: async () => streamResponse([new Uint8Array(++nextFile === 5 ? 2 : 10)])
    } });
    await browser.context.startGame();
    browser.context.Module.onRuntimeInitialized();
    assert.equal(files.get('/baseq2/pak0.pak').node.usedBytes, 40);
    assert.equal(files.get('/baseq2/pak1.pak').node.usedBytes, 2);
    // The baseline copied 166 bytes for these 42 input bytes: 42 into Blob,
    // 42 out of Blob, 40 merging pak0, and 42 into MEMFS. This counts explicit
    // loader/runtime copies, not browser process memory or physical peak RAM.
    assert.ok(copiedBytes <= 40, `Copied ${copiedBytes} bytes for 42 input bytes`);
    assert.ok(allocatedBytes <= 40, `Allocated ${allocatedBytes} typed-array bytes`);
});
