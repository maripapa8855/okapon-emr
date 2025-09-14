"use client";
import { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

type Encounter = {
  id: number;
  patient_id: number;
  start_at: string;
  end_at?: string|null;
  status: "planned"|"in_progress"|"completed"|"canceled";
  appointment_key: string;
};

type QueueItem = { url:string; method:string; headers:Record<string,string>; body:any };
const QKEY="okapon_offline_queue_enc_v1";
const loadQ = ():QueueItem[] => { try { return JSON.parse(localStorage.getItem(QKEY)||"[]"); } catch { return []; } };
const saveQ = (q:QueueItem[]) => localStorage.setItem(QKEY, JSON.stringify(q));
const genIdem = (k:"start"|"complete", id:number, at:string, note?:string) => `auto:enc:${k}:${id}:${at}:${(note||"").length}`;

export default function TodayClinicPage() {
  const [items, setItems] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<Record<number,string>>({});
  const [msg, setMsg] = useState("");

  const base = useMemo(()=> (API_BASE || window.location.origin), []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/clinic/encounters/today`);
      const j = await res.json();
      setItems(j.items || []);
    } catch (e:any) {
      setMsg(`読み込み失敗: ${e?.message || e}`);
    } finally { setLoading(false); }
  }
  useEffect(()=>{ refresh(); }, [base]);

  useEffect(() => {
    async function flush() {
      if (!navigator.onLine) return;
      const q = loadQ(); if (q.length===0) return;
      const remain:QueueItem[] = [];
      for (const it of q) {
        try {
          const r = await fetch(it.url, { method: it.method, headers: it.headers, body: JSON.stringify(it.body) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
        } catch { remain.push(it); }
      }
      saveQ(remain);
      if (q.length !== remain.length) { setMsg(`後送 ${q.length-remain.length} 件送信`); refresh(); }
    }
    window.addEventListener("online", flush);
    flush(); return () => window.removeEventListener("online", flush);
  }, []);

  async function postWithQueue(path:string, body:any, idem:string) {
    const url = `${base}${path}`;
    const headers = { "Content-Type":"application/json; charset=utf-8", "Idempotency-Key": idem };
    if (!navigator.onLine) {
      const q = loadQ(); q.push({ url, method:"POST", headers, body }); saveQ(q);
      setMsg("オフライン: 後送に登録しました"); return { queued:true };
    }
    try {
      const res = await fetch(url, { method:"POST", headers, body: JSON.stringify(body) });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j?.message || `HTTP ${res.status}`);
      return { queued:false, data:j };
    } catch (e:any) {
      const q = loadQ(); q.push({ url, method:"POST", headers, body }); saveQ(q);
      setMsg(`送信失敗→後送: ${e?.message || e}`); return { queued:true };
    }
  }

  async function doStart(e:Encounter) {
    const at = new Date().toISOString();
    const note = notes[e.id] || "";
    const idem = genIdem("start", e.id, at, note);
    await postWithQueue(`/api/clinic/encounters/${e.id}/start`, { at, note }, idem);
    await refresh();
  }
  async function doComplete(e:Encounter) {
    const at = new Date().toISOString();
    const note = notes[e.id] || "";
    const idem = genIdem("complete", e.id, at, note);
    await postWithQueue(`/api/clinic/encounters/${e.id}/complete`, { at, note }, idem);
    await refresh();
  }

  return (
    <div className="max-w-screen-sm mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-semibold">本日の外来</h1>
      {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
      <button className="border rounded px-3 py-1" onClick={refresh} disabled={loading}>
        {loading ? "更新中..." : "再読み込み"}
      </button>

      <div className="grid gap-3">
        {items.map(e => (
          <div key={e.id} className="rounded-2xl border p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <div className="text-lg font-medium">Encounter #{e.id}</div>
              <span className="text-xs px-2 py-1 rounded-full bg-gray-100">{e.status}</span>
            </div>
            <div className="text-sm">
              <div>開始: {new Date(e.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              <div>患者ID: {e.patient_id}</div>
              <div className="text-xs text-gray-500">予約キー: {e.appointment_key}</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="border rounded px-2 py-1 flex-1"
                placeholder="メモ（任意）"
                value={notes[e.id] || ""}
                onChange={ev => setNotes(s => ({ ...s, [e.id]: ev.target.value }))}
              />
              <button className="border rounded px-3 py-1" onClick={() => doStart(e)} disabled={e.status!=="planned"}>
                受付開始
              </button>
              <button className="border rounded px-3 py-1" onClick={() => doComplete(e)} disabled={!(e.status==="in_progress" || e.status==="planned")}>
                診療完了
              </button>
            </div>
          </div>
        ))}
        {items.length===0 && <div className="text-sm text-muted-foreground">本日の外来はありません。</div>}
      </div>
    </div>
  );
}
