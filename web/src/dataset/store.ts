import { MAX_SAMPLES, readSample, type DatasetSample } from './schema';

export class DatasetStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private readonly factory: IDBFactory = globalThis.indexedDB) {}
  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open('signtalk-dataset', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('samples', { keyPath: 'id' });
      req.onsuccess = () => {
        resolve(req.result);
      };
      req.onerror = () => {
        reject(req.error ?? Error('Storage unavailable'));
      };
    });
    return this.db;
  }
  async load(): Promise<DatasetSample[]> {
    const db = await this.open();
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const req = db.transaction('samples').objectStore('samples').getAll();
      req.onsuccess = () => {
        resolve(req.result as unknown[]);
      };
      req.onerror = () => {
        reject(req.error ?? Error('Read failed'));
      };
    });
    const samples = values.map(readSample);
    if (samples.some((s) => s === null) || samples.length > MAX_SAMPLES)
      throw Error('Invalid stored dataset');
    return (samples as DatasetSample[]).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }
  async save(sample: DatasetSample): Promise<void> {
    if (!readSample(sample)) throw Error('Invalid sample');
    await this.write((store) => {
      // Count and put in the same transaction, including across browser tabs.
      const count = store.count();
      const existing = store.getKey(sample.id);
      existing.onsuccess = () => {
        if (count.result >= MAX_SAMPLES && existing.result === undefined) {
          store.transaction.abort();
          return;
        }
        store.put(sample);
      };
    });
  }
  async remove(id: string): Promise<void> {
    await this.write((store) => store.delete(id));
  }
  private async write(run: (store: IDBObjectStore) => void): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('samples', 'readwrite');
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = tx.onabort = () => {
        reject(tx.error ?? Error('Write aborted / dataset limit'));
      };
      run(tx.objectStore('samples'));
    });
  }
}
