// ===========================================================================
import { create } from "auto-js-ipfs";

let autoipfsAPI = null;
let autoipfsOpts = {};

export async function setAutoIPFSOpts(opts) {
  autoipfsOpts = opts;
  // force recreation of auto-ipfs obj?
  autoipfsAPI = null;
}

export async function initAutoIPFS() {
  if (autoipfsAPI) {
    return autoipfsAPI;
  }

  const {api} = await create(autoipfsOpts);
  autoipfsAPI = api;
  return api;
}