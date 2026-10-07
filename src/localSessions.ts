type Entry<T> = { key: string; value: T }
let database: Promise<IDBDatabase> | undefined

function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('prebi-local-sessions', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'key' })
    request.onsuccess = () => {
      const connection = request.result
      connection.onversionchange = () => { connection.close(); database = undefined }
      resolve(connection)
    }
    request.onerror = () => { database = undefined; reject(request.error) }
    request.onblocked = () => { database = undefined; reject(new Error('Schließen Sie andere PReBi-Fenster, um den lokalen Speicher zu öffnen.')) }
  })
  return database
}

export async function readSession<T>(key: string): Promise<T | undefined> {
  const connection = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction('sessions', 'readonly')
    const request = transaction.objectStore('sessions').get(key)
    transaction.oncomplete = () => resolve((request.result as Entry<T> | undefined)?.value)
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}

export async function writeSession(key: string, value: unknown): Promise<void> {
  const connection = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction('sessions', 'readwrite')
    transaction.objectStore('sessions').put({ key, value })
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}

export async function listSessions<T>(prefix: string): Promise<Array<Entry<T>>> {
  const connection = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction('sessions', 'readonly')
    const request = transaction.objectStore('sessions').getAll()
    transaction.oncomplete = () => resolve((request.result as Array<Entry<T>>).filter(entry => entry.key.startsWith(prefix)))
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}