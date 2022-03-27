function promisify<T = undefined>(request: IDBRequest<T> | IDBTransaction) {
  return new Promise<T>((resolve, reject) => {
    // @ts-ignore
    request.oncomplete = request.onsuccess = () => resolve(request.result);
    // @ts-ignore
    request.onabort = request.onerror = () => reject(request.error);
  });
}
export interface IDBStoreOptions extends IDBObjectStoreParameters {
  keyPath?: string;
  indexes?: Parameters<IDBObjectStore['createIndex']>[];
}

export class IDBStore<V> {

  private store: <T>(
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => T,
  ) => T = () => {
    throw new Error(`IDBStore ${this.name} is not initialized`);
  };

  private storeIndex: <T>(
    mode: IDBTransactionMode,
    indexName: string,
    callback: (index: IDBIndex) => T,
  ) => T = () => {
    throw new Error(`IDBStoreIndex ${this.name} is not initialized`);
  };

  constructor(
    public readonly name: string,
    public readonly options: IDBStoreOptions,
  ) { }

  public upgrade(request: IDBOpenDBRequest) {
    const { options, name } = this;
    const db = request.result;
    const upgradeTransaction = request.transaction;

    let store: IDBObjectStore;
    if (!db.objectStoreNames.contains(name)) {
      store = db.createObjectStore(name);
    } else {
      store = upgradeTransaction!.objectStore(name);
    }

    if (options && options.indexes) {
      for (let i = 0; i < options.indexes.length; i++) {
        const index = options.indexes[i];
        if (!store.indexNames.contains(index[0])) {
          store.createIndex(...index);
        }
      }
    }
  }

  public register(db: globalThis.IDBDatabase) {
    const { name } = this;

    const store = this.store = (mode, callback) =>
      callback(db.transaction(name, mode).objectStore(name));

    this.storeIndex = (mode, indexName, callback) => 
        store(mode, s => callback(s.index(indexName)));
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
   * Get one
   * @param indexName 
   * @param indexValue 
   */
  public getByIndex(indexName: string, indexValue: any): Promise<V | undefined> {
    return this.storeIndex(
      'readonly',
      indexName,
      index => promisify(index.get(indexValue)))
    ;
  }

  /**
   * Add a record with key and value
   * @param key 
   * @param value 
   * @returns 
   */
  public set(value: V, key?: IDBValidKey) {
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
  public update(value: Partial<V>) {
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
  public cursor(callback: (cursor: IDBCursorWithValue) => void, keyRangeValue?: IDBKeyRange) {
    return this.store('readonly', store => new Promise<void>((resolve, reject) => {
      const request = store.openCursor(keyRangeValue);
      request.onsuccess = function() {
        const cursor = this.result;
        if (!cursor) {
          return resolve();
        }
        callback(cursor);
        cursor.continue();
      };
      request.onerror = reject;
    }));
  }

  public cursorIndex(indexName: string, callback: (cursor: IDBCursorWithValue) => void, keyRangeValue?: IDBKeyRange) {
    return this.storeIndex('readonly', indexName, index => new Promise<void>((resolve, reject) => {
      const request = index.openCursor(keyRangeValue);
      request.onsuccess = function() {
        const cursor = this.result;
        if (!cursor) {
          return resolve();
        }
        callback(cursor);
        cursor.continue();
      };
      request.onerror = reject;
    }));
  }

  /**
   * Get all records
   * @returns 
   */
  public async getAll(keyRangeValue?: IDBKeyRange): Promise<V[]> {
    const items: V[] = [];
    await this.cursor(cursor => items.push(cursor.value), keyRangeValue);
    return items;
  }

  /**
   * Get all records that matches the index and it's filter
   * For keyRangeValue usage, refer to https://developer.mozilla.org/en-US/docs/Web/API/IDBKeyRange
   * @param indexName 
   * @param keyRangeValue  ig. IDBKeyRange.only(value);
   * @returns 
   */
  public async getAllByIndex(indexName: string, keyRangeValue?: IDBKeyRange): Promise<V[]> {
    const items: any[] = [];
    await this.cursorIndex(indexName, cursor => items.push(cursor.value), keyRangeValue);
    return items;
  }
}

function iterate<T>(obj: Record<string, T>, cb: (key: string, v: T) => void) {
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    cb(key, obj[key]);
  }
}

export type Migration = (db: globalThis.IDBDatabase) => void;

export class IDBDatabase<T extends { [storeName: string]: IDBStore<unknown> }> {
  constructor(
    public readonly dbName: string,
    public readonly version: number,
    public readonly stores: T,
    private self: WindowOrWorkerGlobalScope = window,
  ) { }

  public async init() {
    const { dbName, stores, self, version } = this;
    const request = self.indexedDB.open(dbName, version);

    // for further updates
    request.onupgradeneeded = event => {
      console.log(`IndexedDB is upgrading from ${event.oldVersion} to ${event.newVersion}`)
      iterate(stores, (_, store) => {
        store.upgrade(request);
      });
    };

    // register each objectStore
    const db = await promisify(request);
    iterate(stores, (_, store) => store.register(db));
  }
}