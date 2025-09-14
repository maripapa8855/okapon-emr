"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";   // 無ければ <button> に置換
import { Input } from "@/components/ui/input";     // 無ければ <input> に置換

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

type Visit = { id: number; patient_id: number; start_at: string; end_at?: string|null; status: "planned"|"in_progress"|"completed"|"canceled" };

type QueueItem = { url: string; method: string; headers: Record<string,string>; body: any };
const QKEY = "okapon_offline_queue_v1";
const loadQ = (): QueueItem[] => { try { return JSON.parse(localStorage.getItem(QKEY) || "[]"); } catch { return []; } };
const saveQ = (q: QueueItem[]) => localStorage.setItem(QKEY, JSON.stringify(q));

function genIdem(kind: "checkin"|"checkout", visitId: number, at: string, note?: string) {
  return `auto:${kind}:${visitId}:${at}:${(note||"").length}`;
}

export default function TodayHomecarePage() {
  const [items, setItems] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<Record<number,string>>({});
  const [msg, setMsg] = useState<string>("");

  const base = useMemo(() => (API_BASE || window.location.origin), []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/homecare/visits/today`);
      const j = await res.json();
      setItems(j.items || []);
    } catch (e:any) {
      setMsg(`読み込み失敗: ${e?.message || e}`);
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, [base]);

  // オフライン後送
  useEffect(() => {
    async function flush() {
      if (!navigator.onLine) return;
      const q = loadQ(); if (q.length===0) return;
      const remain: QueueItem[] = [];
      for (const it of q) {
        try {
          const r = await fetch(it.url, { method: it.method, headers: it.headers, body: JSON.stringify(it.body) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
        } catch { remain.push(it); }
      }
      saveQ(remain);
      if (q.length !== remain.length) {
        setMsg(`後送 ${q.length-remain.length} 件送信しました`);
        refresh();
      }
    }
    window.addEventListener("online", flush);
    flush();
    return () => window.removeEventListener("online", flush);
  }, []);

  async function postWithQueue(path: string, body: any, idem: string) {
    const url = `${base}${path}`;
    const headers = { "Content-Type": "application/json; charset=utf-8", "Idempotency-Key": idem };
    if (!navigator.onLine) {
      const q = loadQ(); q.push({ url, method: "POST", headers, body }); saveQ(q);
      setMsg("オフラインのため後送キューに登録しました");
      return { queued: true };
    }
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j?.message || `HTTP ${res.status}`);
      return { queued: false, data: j };
    } catch (e:any) {
      const q = loadQ(); q.push({ url, method: "POST", headers, body }); saveQ(q);
      setMsg(`送信失敗のため後送に回しました: ${e?.message || e}`);
      return { queued: true };
    }
  }

  async function doCheckin(v: Visit) {
    const at   = new Date().toISOString();
    const note = notes[v.id] || "";
    const idem = genIdem("checkin", v.id, at, note);
    await postWithQueue(`/api/homecare/visits/${v.id}/checkin`, { at, note }, idem);
    await refresh();
  }

  async function doCheckout(v: Visit) {
    const at   = new Date().toISOString();
    const note = notes[v.id] || "";
    const idem = genIdem("checkout", v.id, at, note);
    await postWithQueue(`/api/homecare/visits/${v.id}/checkout`, { at, note }, idem);
    await refresh();
  }

  return (
    <div className="max-w-screen-sm mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-semibold">本日の在宅予定</h1>
      {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
      <div className="flex gap-2">
        <Button onClick={refresh} disabled={loading}>{loading ? "更新中..." : "再読み込み"}</Button>
      </div>

      <div className="grid gap-3">
        {items.map(v => (
          <div key={v.id} className="rounded-2xl border p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <div className="text-lg font-medium">訪問ID #{v.id}</div>
              <span className="text-xs px-2 py-1 rounded-full bg-gray-100">{v.status}</span>
            </div>
            <div className="text-sm">
              <div>開始: {new Date(v.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              {v.end_at && <div>終了: {new Date(v.end_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>}
              <div>患者ID: {v.patient_id}</div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="メモ（任意）"
                value={notes[v.id] || ""}
                onChange={(e) => setNotes(s => ({ ...s, [v.id]: e.target.value }))}
              />
              <Button onClick={() => doCheckin(v)} disabled={v.status!=="planned"}>チェックイン</Button>
              <Button onClick={() => doCheckout(v)} disabled={!(v.status==="in_progress" || v.status==="planned")}>チェックアウト</Button>
            </div>
          </div>
        ))}
        {items.length===0 && <div className="text-sm text-muted-foreground">本日の予定はありません。</div>}
      </div>
    </div>
  );
}
