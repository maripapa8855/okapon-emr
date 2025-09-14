export default async function WardsBoardPage() {
    const res = await fetch(process.env.NEXT_PUBLIC_API_URL + "/api/inpatient/wards/board", { cache: "no-store" });
    const rows = await res.json();
    return (
        <main className="max-w-5xl mx-auto p-6">
            <h1 className="text-2xl font-bold mb-4">ベッドボード</h1>
            <table className="w-full text-sm">
                <thead><tr><th className="text-left">病棟</th><th>総床</th><th>稼働</th></tr></thead>
                <tbody>
                    {rows.map((r: any) => (
                        <tr key={r.ward_id} className="border-b">
                            <td>{r.ward_name}</td>
                            <td className="text-center">{r.beds_total}</td>
                            <td className="text-center">{r.beds_occupied}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </main>
    );
}