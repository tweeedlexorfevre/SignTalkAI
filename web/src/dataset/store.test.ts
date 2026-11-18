import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { DatasetStore } from './store';
import { sample } from '../test-support/dataset';

it('persists after reopening and updates labels and retakes without duplicating examples', async () => {
  const factory = new IDBFactory();
  const store = new DatasetStore(factory);
  const original = sample();
  await store.save(original);
  const reopened = new DatasetStore(factory);
  expect(await reopened.load()).toEqual([original]);
  await reopened.save({ ...original, label: { ...original.label, ru: 'Здравствуйте' } });
  const saved = await store.load();
  expect(saved).toHaveLength(1);
  expect(saved[0]?.label.ru).toBe('Здравствуйте');
  expect(saved[0]?.participantId).toBe('P01');
  await store.remove(original.id);
  expect(await reopened.load()).toEqual([]);
});

it('refuses invalid replacement without destroying the existing example', async () => {
  const store = new DatasetStore(new IDBFactory());
  const original = sample();
  await store.save(original);
  await expect(store.save({ ...original, frames: [] })).rejects.toThrow();
  expect(await store.load()).toEqual([original]);
});

it('commits writes atomically and permits replacements when the dataset is full', async () => {
  const store = new DatasetStore(new IDBFactory());
  const original = sample();
  for (let i = 0; i < 200; i++) await store.save({ ...original, id: `sample-${i}` });
  await expect(store.save({ ...original, id: 'overflow' })).rejects.toThrow();
  await store.save({ ...original, id: 'sample-0', label: { ...original.label, ru: 'Исправлено' } });
  expect(await store.load()).toHaveLength(200);
});
