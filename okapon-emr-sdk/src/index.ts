export type Admission = { id: number; patient_id: number; admit_datetime: string };


export class OkaponEmrClient {
    constructor(private baseUrl: string, private token?: string) { }
    private headers() { return { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }; }
    async createAdmission(p: { patient_id: number; admit_datetime: string; planned_flag?: boolean }): Promise<Admission> {
        const r = await fetch(`${this.baseUrl}/api/inpatient/adt/admissions`, { method: 'POST', headers: this.headers(), body: JSON.stringify(p) });
        if (!r.ok) throw new Error(`createAdmission failed: ${r.status}`);
        return r.json();
    }
}