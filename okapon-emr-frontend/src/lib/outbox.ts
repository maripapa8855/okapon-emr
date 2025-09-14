// okapon-emr-frontend/src/lib/outbox.ts
// Client-only utility: minimal offline outbox for POST-like requests.
//
// Usage (client component):
//   import { outbox } from "@/lib/outbox";
//   await outbox.postOrEnqueue(`/api/homecare/visits/${id}/checkin`, { at, lat, lng });
//   outbox.attachOnlineFlush(); // 画面マウント時に一度だけ

type Method = "POST" | "PUT" | "PATCH" | "DELETE";
type HeadersInitish = Record<string, string>;

export type OutboxEntry = {
  id: string; // uuid
  url: string;
  method: Method;
  headers?: HeadersInitish;
  body?: any; // JSON serializable
  createdAt: number;
  tries: number;
  maxTries: number;
  nextAt: number; // epoch ms for backoff
  idempotencyKey: string;
};

const DB_NAME = "okapon_outbox";
const STORE = "outbox";
const VERSION = 1;

function isClient(): boolean {
  return typeof window !== "undefined";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isClient()) return reject(new Error("Outbox is client-only"));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("nextAt", "nextAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T = unknown>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    Promise.resolve(fn(store))
      .then((val) => t.commit?.(), (err) => reject(err));
    t.oncomplete = () => resolve(undefined as unknown as T);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function uuid() {
  // crypto.randomUUID は一部古環境で未対応のためフォールバック
  if (isClient() && "randomUUID" in crypto) return (crypto as any).randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now();
}

function now() {
  return Date.now();
}

function backoffMs(tries: number) {
  // 0,1,2,... -> 0s, 2s, 5s, 10s, 20s, 40s (cap 60s)
  const seq = [0, 2000, 5000, 10000, 20000, 40000, 60000];
  return seq[Math.min(tries, seq.length - 1)];
}

async function add(entry: OutboxEntry) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).add(entry);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

async function remove(id: string) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

async function update(entry: OutboxEntry) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(entry);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

async function dueEntries(limit = 20): Promise<OutboxEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const list: OutboxEntry[] = [];
    const t = db.transaction(STORE, "readonly");
    const idx = t.objectStore(STORE).index("nextAt");
    const range = IDBKeyRange.upperBound(now());
    const req = idx.openCursor(range);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || list.length >= limit) return resolve(list);
      list.push(cur.value as OutboxEntry);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

async function _send(entry: OutboxEntry): Promise<Response> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "Idempotency-Key": entry.idempotencyKey,
    ...(entry.headers || {}),
  };
  return fetch(entry.url, {
    method: entry.method,
    headers,
    body: entry.body != null ? JSON.stringify(entry.body) : undefined,
    credentials: "include" as RequestCredentials, // 必要に応じて変更
  });
}

async function flushOnce(): Promise<boolean> {
  if (!isClient()) return false;
  const items = await dueEntries();
  if (items.length === 0) return false;

  for (const it of items) {
    try {
      const res = await _send(it);
      // 成功／重複（409/422想定）なら完了扱い
      if (res.ok || res.status === 409 || res.status === 422) {
        await remove(it.id);
        continue;
      }
      // 永続エラー（4xx）は破棄
      if (res.status >= 400 && res.status < 500) {
        await remove(it.id);
        continue;
      }
      // 一時エラー（5xx）は再試行
      it.tries += 1;
      if (it.tries >= it.maxTries) await remove(it.id);
      else {
        it.nextAt = now() + backoffMs(it.tries);
        await update(it);
      }
    } catch {
      // ネットワーク不可など → バックオフ
      it.tries += 1;
      if (it.tries >= it.maxTries) await remove(it.id);
      else {
        it.nextAt = now() + backoffMs(it.tries);
        await update(it);
      }
    }
  }
  return items.length > 0;
}

let onlineAttached = false;
function attachOnlineFlush() {
  if (!isClient() || onlineAttached) return;
  onlineAttached = true;
  window.addEventListener("online", () => void flushLoop());
}

async function flushLoop() {
  if (!isClient()) return;
  // 取りこぼしなく枯れるまで flush
  // 大量件数でも1ループ20件ずつ送る
  // eslint-disable-next-line no-constant-condition
  while (await flushOnce()) {
    // 次ループへ
  }
}

async function postOrEnqueue(
  url: string,
  body?: any,
  init?: { method?: Method; headers?: HeadersInitish; maxTries?: number }
) {
  if (!isClient()) throw new Error("postOrEnqueue is client-only");
  const method = init?.method ?? "POST";
  const idempotencyKey = uuid();
  const headers = { ...(init?.headers || {}), "Idempotency-Key": idempotencyKey };

  // オンライン判定 → 試行、失敗時はキュー
  if (navigator.onLine) {
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body != null ? JSON.stringify(body) : undefined,
        credentials: "include",
      });
      if (res.ok || res.status === 409 || res.status === 422) return res;
      // 4xx は即返し（アプリ側で扱う）
      if (res.status >= 400 && res.status < 500) return res;
      // 5xx はキューへ
    } catch {
      // ネットワーク不可 → キューへ
    }
  }

  const entry: OutboxEntry = {
    id: uuid(),
    url,
    method,
    headers,
    body,
    createdAt: now(),
    tries: 0,
    maxTries: init?.maxTries ?? 6,
    nextAt: now(),
    idempotencyKey,
  };
  await add(entry);
  return new Response(null, { status: 202 }); // 受理（後送）
}

export const outbox = {
  postOrEnqueue,
  flush: flushLoop,
  attachOnlineFlush,
};
