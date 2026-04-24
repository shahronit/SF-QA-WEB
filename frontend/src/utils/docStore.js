// Tiny dependency-free IndexedDB sidecar for uploaded documents.
//
// Goal: keep a copy of every file the user attaches (project library or
// per-run picker) in their browser so the file is never lost when the
// backend storage hiccups, and so it persists across reloads/tabs/sessions
// until the user explicitly removes it.
//
// One database, one object store. Records are keyed by `${scope}::${name}`.
// Scope is e.g. `project:<slug>` so different projects don't collide.

const DB_NAME = 'qa-studio-docs'
const DB_VERSION = 1
const STORE = 'files'

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available in this browser'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('by_scope', 'scope', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'))
  })
}

function tx(db, mode) {
  const t = db.transaction(STORE, mode)
  return { store: t.objectStore(STORE), done: new Promise((res, rej) => {
    t.oncomplete = () => res()
    t.onabort = () => rej(t.error)
    t.onerror = () => rej(t.error)
  }) }
}

function makeKey(scope, name) {
  return `${scope}::${name}`
}

function safeError(prefix, err) {
  // Swallow IndexedDB failures so the rest of the app keeps working in
  // private-browsing modes / locked-down environments. Caller can decide
  // whether to surface a toast.
  // eslint-disable-next-line no-console
  console.warn(`[docStore] ${prefix}:`, err)
}

// Persist a File/Blob under `scope`. Existing entries with the same name
// are overwritten (treat as "latest version wins").
export async function putFile(scope, file, extra = {}) {
  if (!scope || !file || !file.name) return false
  try {
    const db = await openDb()
    const { store, done } = tx(db, 'readwrite')
    store.put({
      key: makeKey(scope, file.name),
      scope,
      name: file.name,
      size: typeof file.size === 'number' ? file.size : null,
      mime: file.type || '',
      blob: file,
      addedAt: new Date().toISOString(),
      ...extra,
    })
    await done
    db.close()
    return true
  } catch (err) {
    safeError(`putFile(${scope}, ${file.name})`, err)
    return false
  }
}

export async function listFiles(scope) {
  if (!scope) return []
  try {
    const db = await openDb()
    const { store, done } = tx(db, 'readonly')
    const out = []
    const idx = store.index('by_scope')
    const req = idx.openCursor(IDBKeyRange.only(scope))
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      const v = cursor.value
      // strip blob from listing payload — we only need metadata for the UI
      out.push({
        name: v.name,
        size: v.size,
        mime: v.mime,
        addedAt: v.addedAt,
        uploadedBy: v.uploadedBy || '',
        uploadedAt: v.uploadedAt || '',
      })
      cursor.continue()
    }
    await done
    db.close()
    return out
  } catch (err) {
    safeError(`listFiles(${scope})`, err)
    return []
  }
}

export async function getFile(scope, name) {
  if (!scope || !name) return null
  try {
    const db = await openDb()
    const { store, done } = tx(db, 'readonly')
    const req = store.get(makeKey(scope, name))
    let value = null
    req.onsuccess = () => { value = req.result || null }
    await done
    db.close()
    return value
  } catch (err) {
    safeError(`getFile(${scope}, ${name})`, err)
    return null
  }
}

export async function deleteFile(scope, name) {
  if (!scope || !name) return false
  try {
    const db = await openDb()
    const { store, done } = tx(db, 'readwrite')
    store.delete(makeKey(scope, name))
    await done
    db.close()
    return true
  } catch (err) {
    safeError(`deleteFile(${scope}, ${name})`, err)
    return false
  }
}

export async function hasFile(scope, name) {
  const rec = await getFile(scope, name)
  return !!rec
}

// Convenience helper for callers that already have a list of File objects.
export async function putMany(scope, files, extra = {}) {
  const ok = []
  for (const f of files || []) {
    if (await putFile(scope, f, extra)) ok.push(f.name)
  }
  return ok
}

// Build a stable scope string for project-attached docs so different
// callers agree on the key.
export function projectScope(slug) {
  return slug ? `project:${slug}` : ''
}
