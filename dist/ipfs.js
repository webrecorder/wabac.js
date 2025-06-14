// ===========================================================================
// @ts-expect-error no type info
import { create } from "auto-js-ipfs";
// [TODO]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let autoipfsAPI = null;
// [TODO]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initAutoIPFS(opts) {
    if (!autoipfsAPI) {
        autoipfsAPI = await create(opts);
    }
    return autoipfsAPI;
}
//# sourceMappingURL=ipfs.js.map