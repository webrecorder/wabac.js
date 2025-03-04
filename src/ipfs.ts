// ===========================================================================
// @ts-expect-error no type info
import { create } from "auto-js-ipfs";

// [TODO]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let autoipfsAPI: any = null;

// [TODO]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initAutoIPFS(opts: Record<string, any>) {
  if (!autoipfsAPI) {
    autoipfsAPI = await create(opts);
  }

  return autoipfsAPI as {
    get: (
      url: string,
      opts: {
        start?: number;
        offset?: number;
        end?: number;
        signal?: AbortSignal | null;
      },
    ) => AsyncIterable<Uint8Array>;
    getSize: (url: string) => number | null;
  };
}
