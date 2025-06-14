type VerifySigData = {
    hash: string;
    signature: string;
    publicKey: string;
    domain: string;
    domainCert: string;
    created: string;
    software: string;
};
type VerifyResult = {
    id: string;
    expected: any;
    matched: any | null;
};
export declare function verifyWACZSignature({ hash, signature, publicKey, domain, domainCert, created, software, }: VerifySigData): Promise<VerifyResult[]>;
export {};
//# sourceMappingURL=certutils.d.ts.map