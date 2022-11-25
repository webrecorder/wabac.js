// ===========================================================================
import { create } from "auto-js-ipfs";

let autoipfsAPI = null;

export async function initAutoIPFS(opts) {
  if (!autoipfsAPI) {
    autoipfsAPI = await create(opts);
  }

  return autoipfsAPI;
}
