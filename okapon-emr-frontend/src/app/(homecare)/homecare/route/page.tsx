export default async function HomecareRoutePage() {
    const date = new Date().toISOString().slice(0, 10);
    return (
        <main className="max-w-4xl mx-auto p-6">
            <h1 className="text-2xl font-bold mb-4">在宅巡回（サンプル）</h1>
            <p className="text-gray-600">{date} の巡回ルートを表示（API接続は今後）。</p>
        </main>
    );
}