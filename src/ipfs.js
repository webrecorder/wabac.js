// ===========================================================================
let ipfs = null;
let initingIPFS = null;
let ipfsGC = null;

self.IpfsCore = null;

const GC_INTERVAL = 600000;

const IPFS_CORE_JS = __IPFS_CORE_URL__;


// ===========================================================================
async function initIPFS() {
  if (!ipfs) {
    try {
      if (!initingIPFS) {
        initingIPFS = doInitIPFS();
      }

      await initingIPFS;

    } catch (e) {
      console.warn(e);
    }
  }

  return ipfs;
}


// ===========================================================================
async function doInitIPFS() {
  if (!self.IpfsCore) {
    const resp = await fetch(IPFS_CORE_JS);
    eval(await resp.text());
  }

  ipfs = await self.IpfsCore.create({
    init: {emptyRepo: true},
    //preload: {enabled: false},
  });

  resetGC();
}


// ===========================================================================
async function runGC() {
  let count = 0;

  for await (const res of ipfs.repo.gc()) {
    count++;
  }
  console.log(`IPFS GC, Removed ${count} blocks`);
}


// ===========================================================================
async function resetGC() {
  if (ipfsGC) {
    clearInterval(ipfsGC);
  }

  ipfsGC = setInterval(runGC, GC_INTERVAL);
}


// ===========================================================================
async function rmAllPins(pinList) {
  if (pinList) {
    const ipfs = await initIPFS();
    for (const pin of pinList) {
      ipfs.pin.rm(pin.hash);
    }
    runGC();
  }
  return null;
}

// ===========================================================================
function addPin(pinList, hash, url, size) {
  if (!pinList) {
    pinList = [];
  }

  const ctime = new Date().getTime();

  pinList.push({hash, url, size, ctime});

  return pinList;
}

export { initIPFS, resetGC, runGC, addPin, rmAllPins };
