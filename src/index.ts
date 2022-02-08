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

  private storeIndex: <T>(
    mode: IDBTransactionMode,
    indexName: string,
    callback: (index: IDBIndex) => T | PromiseLike<T>,
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
    const store = this.store = (mode, callback) =>
      promisedIDB.then(db =>
        callback(db.transaction(storeName, mode).objectStore(storeName)));

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
    return this.store('readonly', store => {
      store.openCursor(keyRangeValue).onsuccess = function onsuccess() {
        if (!this.result) {
          return;
        }
        callback(this.result);
        this.result.continue();
      };
    });
  }

  public cursorIndex(indexName: string, callback: (cursor: IDBCursorWithValue) => void, keyRangeValue?: IDBKeyRange) {
    return this.storeIndex('readonly', indexName, index => {
      index.openCursor(keyRangeValue).onsuccess = function onsuccess() {
        if (!this.result) {
          return;
        }
        callback(this.result);
        this.result.continue();
      };
    });
  }

  /**
   * Get all records
   * @returns 
   */
  public getAll(keyRangeValue?: IDBKeyRange): Promise<V[]> {
    const items: any[] = [];
    return this.cursor(cursor => items.push(cursor), keyRangeValue).then(() => items);
  }

  public async getAllByIndex(indexName: string, keyRangeValue?: IDBKeyRange): Promise<V[]> {
    const items: any[] = [];
    return this.cursorIndex(indexName, value => items.push(value), keyRangeValue).then(() => items);
  }
}