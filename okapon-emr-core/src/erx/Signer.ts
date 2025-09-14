// okapon-emr-core/src/erx/Signer.ts
// eRx Signer SPI: 本番では HPKI/HSM 実装に差し替え。
// ここでは "署名っぽいもの" を返すダミー（SHA-256ハッシュ）を提供。

import { createHash } from "node:crypto";

export type Signed = {
  algorithm: string; // e.g. "SHA256-DUMMY"
  signature: string; // hex
  signerId: string;  // who signed (operator id / device id)
};

export interface Signer {
  id(): string; // signer identity
  sign(payload: Buffer | string): Promise<Signed>;
}

export class DummySigner implements Signer {
  private _id: string;
  constructor(signerId = "dummy-signer") {
    this._id = signerId;
  }
  id() {
    return this._id;
  }
  async sign(payload: Buffer | string): Promise<Signed> {
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
    const h = createHash("sha256").update(buf).digest("hex");
    return { algorithm: "SHA256-DUMMY", signature: h, signerId: this._id };
  }
}
