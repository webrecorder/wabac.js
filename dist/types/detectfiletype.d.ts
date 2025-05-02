export declare function getKnownFileExtension(name: string): string | undefined;
export declare function checkMagicBytes(fileBytes: Uint8Array): ".warc" | ".warc.gz" | ".wacz" | undefined;
export declare function detectFileType(response: Response): Promise<string | undefined>;
//# sourceMappingURL=detectfiletype.d.ts.map