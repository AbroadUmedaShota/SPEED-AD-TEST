import { parentPort, workerData } from 'node:worker_threads';
import { appendNote } from '../../99_backend-docs/10_support-contact/d1-poc/atomicNote.mjs';
import { openSqlite } from './support-contact-sqlite.mjs';

const gate = new Int32Array(workerData.gate);
const { sqlite, adapter } = openSqlite(workerData.path, false, () => {
  Atomics.add(gate, 0, 1);
  Atomics.notify(gate, 0);
  while (Atomics.load(gate, 0) < 2) {
    if (Atomics.wait(gate, 0, 1, 5000) === 'timed-out') throw new Error('Race barrier timeout');
  }
});
try {
  parentPort.postMessage(await appendNote(adapter, workerData.actor, workerData.command));
} finally {
  sqlite.close();
}
