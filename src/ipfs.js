// ===========================================================================
import { create } from "auto-js-ipfs";

let autoipfsAPI = null;

export async function initAutoIPFS(opts) {
  if (autoipfsAPI) {
    return autoipfsAPI;
  }

  const {api} = await create(opts);
  autoipfsAPI = api;
  return api;
}
