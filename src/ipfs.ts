// ===========================================================================
  // @ts-expect-error no type info
import { create } from "auto-js-ipfs";

let autoipfsAPI : any = null;

export async function initAutoIPFS(opts: Record<string, any>) {
  if (!autoipfsAPI) {
    autoipfsAPI = await create(opts);
  }

  return autoipfsAPI;
}
