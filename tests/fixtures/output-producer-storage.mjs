// Synthetic-owned, in-memory storage for the bounded producer qualification.
// No provider, network, filesystem, verifier, expected-key list or authority seam.

const HTTP_FIELDS = Object.freeze({
  contentType: 'content-type', contentLanguage: 'content-language',
  contentDisposition: 'content-disposition', contentEncoding: 'content-encoding',
  cacheControl: 'cache-control', cacheExpiry: 'expires',
});
const WRITE_METHODS = Object.freeze([
  'put', 'delete', 'copy', 'createMultipartUpload', 'resumeMultipartUpload',
  'uploadPart', 'completeMultipartUpload', 'abortMultipartUpload',
]);
const ownRecord = value => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  && Reflect.ownKeys(value).every(key => typeof key === 'string'
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));

function ownedArguments(args) {
  // Actual storage arguments are scalar values or string arrays. Do not retain
  // arbitrary invalid objects, including shared-memory views, in call history.
  return Object.fromEntries(Object.entries(args).map(([key, value]) => {
    if (value === null || ['string', 'number', 'boolean', 'undefined', 'bigint'].includes(typeof value)) return [key, value];
    if (Array.isArray(value)) {
      const entries = Object.getOwnPropertyDescriptors(value), strings = [];
      for (let index = 0; index < value.length; index++) {
        const entry = entries[index];
        if (!entry || !Object.hasOwn(entry, 'value') || typeof entry.value !== 'string') return [key, { invalidArgumentType: 'array' }];
        strings.push(entry.value);
      }
      return [key, strings];
    }
    return [key, { invalidArgumentType: typeof value }];
  }));
}

function listArguments(input) {
  if (input === null || typeof input !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new TypeError('Unsupported fixture list options');
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => !['prefix', 'cursor', 'limit', 'include'].includes(key)
    || !Object.hasOwn(descriptors[key], 'value'))) throw new TypeError('Unsupported fixture list options');
  // Include nonenumerable own options actually used by the operation; never
  // invoke an input accessor or an include array's getter/custom iterator.
  const captured = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  if (captured.include != null) {
    if (!Array.isArray(captured.include)) throw new TypeError('Unsupported fixture list metadata');
    const entries = Object.getOwnPropertyDescriptors(captured.include), ownKeys = Reflect.ownKeys(entries);
    const length = entries.length.value, include = [];
    if (ownKeys.some(key => typeof key !== 'string' || key !== 'length'
      && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length)
      || !Object.hasOwn(entries[key], 'value'))) throw new TypeError('Unsupported fixture list metadata');
    for (let index = 0; index < length; index++) {
      const entry = entries[index];
      if (!entry || !['customMetadata', 'httpMetadata'].includes(entry.value)) throw new TypeError('Unsupported fixture list metadata');
      include.push(entry.value);
    }
    captured.include = include;
  }
  return captured;
}

function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`Invalid fixture ${name}`);
  return value;
}
function keyValue(value) {
  if (typeof value !== 'string' || !value || new TextEncoder().encode(value).byteLength > 4096) {
    throw new TypeError('Fixture storage key must be a nonempty bounded string');
  }
  return value;
}
function bytesCopy(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  throw new TypeError('Fixture bytes must be an ArrayBuffer or byte view');
}
function customMetadata(value = {}) {
  if (!ownRecord(value) || Object.values(value).some(item => typeof item !== 'string')) {
    throw new TypeError('Fixture customMetadata must contain string values');
  }
  return Object.freeze({ ...value });
}
function httpMetadata(value = {}) {
  if (!ownRecord(value)) throw new TypeError('Fixture httpMetadata must be a record');
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(HTTP_FIELDS, key)) throw new TypeError(`Unsupported fixture HTTP metadata: ${key}`);
    if (key === 'cacheExpiry') {
      const date = item instanceof Date ? new Date(item.getTime()) : typeof item === 'string' ? new Date(item) : null;
      if (!date || !Number.isFinite(date.getTime())) throw new TypeError('Invalid fixture cacheExpiry');
      result[key] = date.toISOString(); // A primitive, not a mutable retained Date.
    } else {
      if (typeof item !== 'string') throw new TypeError(`Fixture HTTP metadata must be a string: ${key}`);
      result[key] = item;
    }
  }
  return Object.freeze(result);
}
function exposedHttpMetadata(record) {
  const result = { ...record.httpMetadata };
  if (result.cacheExpiry !== undefined) result.cacheExpiry = new Date(result.cacheExpiry);
  return result;
}
function ownedRecord(value) {
  if (!ownRecord(value) || Object.keys(value).some(key => !['key', 'bytes', 'customMetadata', 'httpMetadata'].includes(key))) {
    throw new TypeError('Fixture record accepts only key, bytes, customMetadata and httpMetadata');
  }
  // The byte copy is private to this module; every outward byte value is copied.
  return Object.freeze({ key: keyValue(value.key), bytes: bytesCopy(value.bytes),
    customMetadata: customMetadata(value.customMetadata), httpMetadata: httpMetadata(value.httpMetadata) });
}
function outwardRecord(record) {
  return { key: record.key, bytes: new Uint8Array(record.bytes), customMetadata: { ...record.customMetadata },
    httpMetadata: exposedHttpMetadata(record) };
}

/**
 * Explicit fixture mutations publish a new private map. Producer methods capture
 * one version and only read it. Lists derive from all seeded records, never from
 * consumer expectations. pageSize models metadata pages shorter than `limit`.
 */
export function createOutputProducerStorage(records = [], options = {}) {
  if (!ownRecord(options) || Object.keys(options).some(key => !['pageSize', 'maxRecords', 'maxBytes'].includes(key))) {
    throw new TypeError('Invalid fixture storage options');
  }
  const pageSize = integer(options.pageSize ?? 1000, 1, 1000, 'pageSize');
  const maxRecords = integer(options.maxRecords ?? 4096, 1, 16384, 'maxRecords');
  const maxBytes = integer(options.maxBytes ?? 32 * 1024 * 1024, 1, 64 * 1024 * 1024, 'maxBytes');
  const counts = Object.fromEntries(['list', 'head', 'get', 'writeHttpMetadata', ...WRITE_METHODS].map(key => [key, 0]));
  const calls = [], mutations = [];
  let disposed = false, ordinal = 0, current;

  function versionFrom(values, version) {
    if (!Array.isArray(values) || values.length > maxRecords) throw new TypeError('Fixture record capacity exceeded');
    const map = new Map(); let totalBytes = 0;
    for (const value of values) {
      const record = ownedRecord(value);
      if (map.has(record.key)) throw new TypeError('Duplicate fixture storage key');
      totalBytes += record.bytes.byteLength;
      if (totalBytes > maxBytes) throw new TypeError('Fixture byte capacity exceeded');
      map.set(record.key, record);
    }
    return Object.freeze({ version, map, totalBytes,
      keys: Object.freeze([...map.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) });
  }
  current = versionFrom(records, 1);
  mutations.push({ operation: 'initialize', version: 1, recordCount: current.map.size, totalBytes: current.totalBytes });
  function active() { if (disposed) throw new Error('Fixture storage is disposed'); }
  function call(operation, args, work) {
    const state = current, version = state.version;
    counts[operation]++;
    const entry = { ordinal: ++ordinal, operation, version, arguments: { invalid: true }, outcome: 'pending' };
    calls.push(entry);
    try {
      const captured = operation === 'list' ? listArguments(args) : args;
      entry.arguments = ownedArguments(captured);
      active(); const result = work(state, captured); entry.outcome = 'returned'; return result;
    }
    catch (error) { entry.outcome = 'threw'; entry.error = String(error?.message ?? error); throw error; }
  }
  function objectMetadata(record, version) {
    return { key: record.key, version: `fixture:${version}`, size: record.bytes.byteLength,
      customMetadata: { ...record.customMetadata }, httpMetadata: exposedHttpMetadata(record),
      writeHttpMetadata(headers) {
        return call('writeHttpMetadata', { key: record.key, objectVersion: version }, () => {
          if (!(headers instanceof Headers)) throw new TypeError('writeHttpMetadata requires Headers');
          for (const [key, value] of Object.entries(record.httpMetadata)) {
            headers.set(HTTP_FIELDS[key], key === 'cacheExpiry' ? new Date(value).toUTCString() : value);
          }
        });
      },
    };
  }
  const cursorFor = (version, prefix, offset) => `fixture-storage-v1:${encodeURIComponent(JSON.stringify([version, prefix, offset]))}`;
  function cursorOffset(cursor, version, prefix, length) {
    if (cursor === undefined) return 0;
    if (typeof cursor !== 'string' || !cursor.startsWith('fixture-storage-v1:')) throw new TypeError('Invalid fixture storage cursor');
    let parsed;
    try { parsed = JSON.parse(decodeURIComponent(cursor.slice('fixture-storage-v1:'.length))); }
    catch { throw new TypeError('Invalid fixture storage cursor'); }
    if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== version || parsed[1] !== prefix
      || !Number.isSafeInteger(parsed[2]) || parsed[2] < 1 || parsed[2] > length
      || cursorFor(...parsed) !== cursor) throw new TypeError('Stale or mismatched fixture storage cursor');
    return parsed[2];
  }
  const MEDIA = {
    async list(input = {}) {
      return call('list', input, (state, input) => {
        const prefix = input.prefix ?? '';
        if (typeof prefix !== 'string') throw new TypeError('Fixture list prefix must be a string');
        const limit = integer(input.limit ?? 1000, 1, 1000, 'list limit');
        const include = input.include ?? [];
        if (!Array.isArray(include) || include.some(key => !['customMetadata', 'httpMetadata'].includes(key))) {
          throw new TypeError('Unsupported fixture list metadata');
        }
        const keys = state.keys.filter(key => key.startsWith(prefix));
        const offset = cursorOffset(input.cursor, state.version, prefix, keys.length);
        const next = Math.min(keys.length, offset + Math.min(limit, pageSize));
        const objects = keys.slice(offset, next).map(key => {
          const record = state.map.get(key);
          return { key, size: record.bytes.byteLength,
            ...(include.includes('customMetadata') ? { customMetadata: { ...record.customMetadata } } : {}),
            ...(include.includes('httpMetadata') ? { httpMetadata: exposedHttpMetadata(record) } : {}) };
        });
        const truncated = next < keys.length;
        return { objects, truncated, ...(truncated ? { cursor: cursorFor(state.version, prefix, next) } : {}) };
      });
    },
    async head(key) {
      return call('head', { key }, state => {
        keyValue(key); const record = state.map.get(key);
        return record ? objectMetadata(record, state.version) : null;
      });
    },
    async get(key) {
      return call('get', { key }, state => {
        keyValue(key); const record = state.map.get(key);
        if (!record) return null;
        // Real web Body consumption, with a fresh owned byte copy per get.
        const response = new Response(new Uint8Array(record.bytes));
        return { ...objectMetadata(record, state.version), body: response.body,
          get bodyUsed() { return response.bodyUsed; },
          arrayBuffer: () => response.arrayBuffer(), text: () => response.text(),
          json: () => response.json(), blob: () => response.blob(),
          bytes: async () => new Uint8Array(await response.arrayBuffer()) };
      });
    },
  };
  for (const method of WRITE_METHODS) MEDIA[method] = function (...args) {
    return call(method, { firstArgument: typeof args[0] === 'string' ? args[0] : null, argumentCount: args.length }, () => {
      throw new Error(`Forbidden fixture producer storage write: ${method}`);
    });
  };
  Object.freeze(MEDIA); // Enumerable own methods survive `{ ...env.MEDIA }`.

  function publish(values, operation, key = null) {
    active(); const next = versionFrom(values, current.version + 1);
    current = next;
    mutations.push({ operation, key, version: next.version, recordCount: next.map.size, totalBytes: next.totalBytes });
    return next.version;
  }
  return Object.freeze({ MEDIA,
    set(record) {
      active(); const normalized = ownedRecord(record);
      const records = [...current.map.values()].filter(item => item.key !== normalized.key).map(outwardRecord);
      records.push(outwardRecord(normalized));
      return publish(records, 'set', normalized.key);
    },
    remove(key) {
      active(); keyValue(key);
      return publish([...current.map.values()].filter(record => record.key !== key).map(outwardRecord), 'remove', key);
    },
    replace(records) { return publish(records, 'replace'); },
    snapshot() {
      return { disposed, version: current.version, pageSize, maxRecords, maxBytes,
        recordCount: current.map.size, totalBytes: current.totalBytes, counts: { ...counts },
        calls: structuredClone(calls), mutations: structuredClone(mutations),
        records: current.keys.map(key => outwardRecord(current.map.get(key))) };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      current = versionFrom([], current.version + 1);
      mutations.push({ operation: 'dispose', version: current.version, recordCount: 0, totalBytes: 0 });
      // No timers, network tasks, file handles or pending fixture work exist.
    },
  });
}
