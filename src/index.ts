function promisify<T = undefined>(request: IDBRequest<T> | IDBTransaction) {
  return new Promise<T>((resolve, reject) => {
    // @ts-ignore
    request.oncomplete = request.onsuccess = () => resolve(request.result);
    // @ts-ignore
    request.onabort = request.onerror = () => reject(request.error);
  });
}

export interface IDBStoreOptions extends IDBObjectStoreParameters {
  indexes?: Parameters<IDBObjectStore['createIndex']>[];
}

export interface IDBStoreConfig {
  options?: IDBStoreOptions;
  defaultValue: Record<string, any>;
}

export default class IDBStore<V> {
  public readonly name: string;

  private store: <T>(
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => T | PromiseLike<T>,
  ) => Promise<T>;

  constructor(spec: {
    dbName: string;
    storeName: string;
    version: number;
    options?: IDBStoreOptions;
    self?: WindowOrWorkerGlobalScope;
  }) {
    const { dbName, version, storeName, options } = spec;
    this.name = storeName;
    const self = spec.self || window;

    const request = self.indexedDB.open(dbName, version);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, options);
      if (options && options.indexes) {
        for (let i = 0; i < options.indexes.length; i++) {
          const index = options.indexes[i];
          store.createIndex(...index);
        }
      }
    };
    const promisedIDB = promisify(request);
    this.store = (mode, callback) =>
      promisedIDB.then(db =>
        callback(db.transaction(storeName, mode).objectStore(storeName)));
  }

  /**
   * Get an existing record by provided key
   * @param key 
   * @returns 
   */
  public get(key: IDBValidKey): Promise<V | undefined> {
    return this.store('readonly', store => promisify(store.get(key)));
  }

  /**
   * Add a record with key and value
   * @param key 
   * @param value 
   * @returns 
   */
  public set(key: IDBValidKey, value: V) {
    return this.store('readwrite', store => {
      store.put(value, key);
      return promisify<void>(store.transaction);
    });
  }

  /**
   * Get multiple records by provided keys
   * @param keys 
   * @returns 
   */
  public getMany(keys: IDBValidKey[]): Promise<V[]> {
    return this.store('readonly', store => Promise.all(keys.map(key => promisify(store.get(key)))));
  }

  /**
   * Update multiple existing records
   * @param values 
   * @returns 
   */
  public setMany(values: V[]) {
    return this.store('readwrite', store => {
      values.forEach(entry => store.put(entry));
      return promisify<void>(store.transaction);
    });
  }

  /**
   * Update an existing record
   * @param value 
   * @returns 
   */
  public update(value: V) {
    return this.store('readwrite', store => {
      store.put(value);
      return promisify<void>(store.transaction);
    });
  }

  /**
   * Delete the store object
   * @param key 
   * @returns 
   */
  public del(key: IDBValidKey) {
    return this.store('readwrite', store => {
      store.delete(key);
      return promisify<void>(store.transaction);
    });
  }

  /**
   * Clear all records
   * @returns 
   */
  public clear() {
    return this.store('readwrite', store => {
      store.clear();
      return promisify<void>(store.transaction);
    });
  }

  /**
   * Iterate the records
   */
  public cursor(callback: (cursor: IDBCursorWithValue) => void) {
    return this.store('readonly', store => {
      store.openCursor().onsuccess = function onsuccess() {
        if (!this.result) {
          return;
        }
        callback(this.result);
        this.result.continue();
      };
      return promisify(store.transaction);
    });
  }

  /**
   * Get all records
   * @returns 
   */
  public getAll(): Promise<V[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = [];
    return this.cursor(cursor => items.push(cursor)).then(() => items);
  }
}