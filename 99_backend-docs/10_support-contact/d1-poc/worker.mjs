import { handleNoteRequest } from './atomicNote.mjs';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const SYNTHETIC_ACTORS = ['operator-a', 'operator-b'];
const SYNTHETIC_CASE_ID = 'case-local-1';
const raceBarriers = new Map();

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function isLoopback(request) {
  const hostname = new URL(request.url).hostname;
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

function waitAtRaceBarrier(name) {
  return new Promise((resolve, reject) => {
    const waiting = raceBarriers.get(name) || [];
    const entry = { resolve, reject, timer: null };
    entry.timer = setTimeout(() => {
      const current = raceBarriers.get(name) || [];
      raceBarriers.set(name, current.filter(candidate => candidate !== entry));
      reject(new Error('race barrier timeout'));
    }, 5_000);
    waiting.push(entry);
    raceBarriers.set(name, waiting);
    if (waiting.length === 2) {
      raceBarriers.delete(name);
      waiting.forEach(candidate => {
        clearTimeout(candidate.timer);
        candidate.resolve();
      });
    }
  });
}

async function resetDatabase(db) {
  await db.batch([
    db.prepare('UPDATE poc_cases SET last_request_id = NULL'),
    db.prepare('DELETE FROM poc_events'),
    db.prepare('DELETE FROM poc_requests'),
    db.prepare('DELETE FROM poc_cases'),
    db.prepare('DELETE FROM poc_operators'),
    db.prepare('DELETE FROM poc_faults'),
    db.prepare('INSERT INTO poc_operators (actor_id, active) VALUES (?, 1)').bind(SYNTHETIC_ACTORS[0]),
    db.prepare('INSERT INTO poc_operators (actor_id, active) VALUES (?, 1)').bind(SYNTHETIC_ACTORS[1]),
    db.prepare(`
      INSERT INTO poc_cases (case_id, status, version, last_request_id, updated_at)
      VALUES (?, '未対応', 1, NULL, ?)
    `).bind(SYNTHETIC_CASE_ID, '2026-09-06T00:00:00.000Z'),
  ]);
  return { ok: true };
}

async function snapshotDatabase(db) {
  const [cases, requests, events, faults] = await db.batch([
    db.prepare('SELECT * FROM poc_cases ORDER BY case_id'),
    db.prepare('SELECT * FROM poc_requests ORDER BY request_id'),
    db.prepare('SELECT * FROM poc_events ORDER BY event_id'),
    db.prepare('SELECT * FROM poc_faults ORDER BY fault'),
  ]);
  return {
    cases: cases.results,
    requests: requests.results,
    events: events.results,
    faults: faults.results,
  };
}

async function configureFault(request, db) {
  const body = await request.json();
  if (body.enabled === true) {
    await db.prepare("INSERT OR IGNORE INTO poc_faults (fault) VALUES ('event_insert')").run();
  } else if (body.enabled === false) {
    await db.prepare("DELETE FROM poc_faults WHERE fault = 'event_insert'").run();
  } else {
    return jsonResponse({ ok: false, error: 'enabled must be boolean' }, 400);
  }
  return jsonResponse({ ok: true, enabled: body.enabled });
}

export default {
  async fetch(request, env) {
    if (env.POC_LOCAL_ONLY !== 'true' || !isLoopback(request)) {
      return jsonResponse({ ok: false, error: 'local PoC only' }, 403);
    }

    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/__test/reset') {
      return jsonResponse(await resetDatabase(env.DB));
    }
    if (request.method === 'GET' && url.pathname === '/__test/snapshot') {
      return jsonResponse(await snapshotDatabase(env.DB));
    }
    if (request.method === 'POST' && url.pathname === '/__test/fault') {
      return configureFault(request, env.DB);
    }

    const actorId = request.headers.get('x-poc-actor');
    const principal = SYNTHETIC_ACTORS.includes(actorId) ? { actorId } : null;
    const barrierName = request.headers.get('x-poc-race-barrier');
    const hooks = barrierName
      ? { afterPreflight: () => waitAtRaceBarrier(barrierName) }
      : {};
    const response = await handleNoteRequest(request, env.DB, principal, hooks);
    if (request.headers.get('x-poc-drop-ack') === '1' && response.status === 200) {
      return jsonResponse({ ok: false, error: 'simulated acknowledgement loss' }, 503);
    }
    return response;
  },
};
