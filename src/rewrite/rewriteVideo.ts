import { XMLParser, XMLBuilder } from "fast-xml-parser";

// orig pywb defaults
const OLD_DEFAULT_MAX_BAND = 2000000;
const OLD_DEFAULT_MAX_RES = 1280 * 720;

// lower defaults
const DEFAULT_MAX_BAND = 1000000;
const DEFAULT_MAX_RES = 860 * 480;

// ===========================================================================
// [TODO]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMaxResAndBand(opts: Record<string, any> = {}) {
  // read opts from warc, if any
  let maxRes, maxBand;

  // @ts-expect-error [TODO] - TS4111 - Property 'response' comes from an index signature, so it must be accessed with ['response'].
  const extraOpts = opts.response?.extraOpts;

  if (extraOpts) {
    maxRes = extraOpts.adaptive_max_resolution || extraOpts.maxRes;
    maxBand = extraOpts.adaptive_max_bandwidth || extraOpts.maxBand;
    if (maxRes && maxBand) {
      return { maxRes, maxBand };
    }
  }

  // @ts-expect-error [TODO] - TS4111 - Property 'response' comes from an index signature, so it must be accessed with ['response']. | TS4111 - Property 'response' comes from an index signature, so it must be accessed with ['response'].
  const isReplay = opts.response && !opts.response.isLive;
  let res;

  // if not replay, or unknown, use new lower setting
  if (!isReplay) {
    res = { maxRes: DEFAULT_MAX_RES, maxBand: DEFAULT_MAX_BAND };
  } else {
    // use existing pywb defaults
    res = { maxRes: OLD_DEFAULT_MAX_RES, maxBand: OLD_DEFAULT_MAX_BAND };
  }

  // @ts-expect-error [TODO] - TS4111 - Property 'save' comes from an index signature, so it must be accessed with ['save'].
  if (opts.save) {
    // @ts-expect-error [TODO] - TS4111 - Property 'save' comes from an index signature, so it must be accessed with ['save'].
    opts.save.maxRes = res.maxRes;
    // @ts-expect-error [TODO] - TS4111 - Property 'save' comes from an index signature, so it must be accessed with ['save'].
    opts.save.maxBand = res.maxBand;
  }

  return res;
}

// ===========================================================================
//HLS
// [TODO]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rewriteHLS(text: string, opts: Record<string, any>) {
  const EXT_INF = /#EXT-X-STREAM-INF:(?:.*[,])?BANDWIDTH=([\d]+)/;
  const EXT_RESOLUTION = /RESOLUTION=([\d]+)x([\d]+)/;

  const { maxRes, maxBand } = getMaxResAndBand(opts);

  const indexes: number[] = [];
  let count = 0;
  let bestIndex: number | null = null;

  let bestBand = 0;
  let bestRes = 0;

  const lines = text.trimEnd().split("\n");

  for (const line of lines) {
    const m = line.match(EXT_INF);
    if (!m) {
      // if has rewriteUrl (not-ajax), then rewrite HLS urls
      // @ts-expect-error [TODO] - TS4111 - Property 'rewriteUrl' comes from an index signature, so it must be accessed with ['rewriteUrl'].
      if (opts.rewriteUrl && !line.startsWith("#")) {
        // @ts-expect-error [TODO] - TS4111 - Property 'rewriteUrl' comes from an index signature, so it must be accessed with ['rewriteUrl'].
        lines[count] = opts.rewriteUrl(line);
      }
      count += 1;
      continue;
    }

    indexes.push(count);

    const currBand = Number(m[1]);

    const m2 = line.match(EXT_RESOLUTION);
    const currRes = m2 ? Number(m2[1]) * Number(m2[2]) : 0;

    if (currRes && maxRes) {
      if (currRes <= maxRes && currRes > bestRes) {
        bestRes = currRes;
        bestBand = currBand;
        bestIndex = count;
      }
    } else if (currBand <= maxBand && currBand > bestBand) {
      bestRes = currRes;
      bestBand = currBand;
      bestIndex = count;
    }

    count += 1;
  }

  indexes.reverse();

  for (const inx of indexes) {
    if (inx !== bestIndex) {
      lines.splice(inx, 2);
    }
  }

  return lines.join("\n");
}

// ===========================================================================
// DASH
export const xmlOpts = {
  ignoreAttributes: false,
  removeNSPrefix: false,
  format: false,
  suppressEmptyNode: true,
  suppressBooleanAttributes: false,
};

export function rewriteDASH(
  text: string,
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opts: Record<string, any>,
  bestIds?: string[],
) {
  try {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return _rewriteDASH(text, opts, bestIds);
  } catch (e) {
    console.log(e);
    return text;
  }
}

function _rewriteDASH(
  text: string,
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opts: Record<string, any>,
  bestIds?: string[],
) {
  const parser = new XMLParser(xmlOpts);
  const root = parser.parse(text);

  const { maxRes, maxBand } = getMaxResAndBand(opts);

  let best = null;
  let bestRes = 0;
  let bestBand = 0;

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adaptSets: any[];

  if (!Array.isArray(root.MPD.Period.AdaptationSet)) {
    adaptSets = [root.MPD.Period.AdaptationSet];
  } else {
    adaptSets = root.MPD.Period.AdaptationSet;
  }

  for (const adaptset of adaptSets) {
    best = null;
    bestRes = 0;
    bestBand = 0;

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let reps: any[];

    if (!Array.isArray(adaptset.Representation)) {
      reps = [adaptset.Representation];
    } else {
      reps = adaptset.Representation;
    }

    for (const repres of reps) {
      const currRes =
        Number(repres["@_width"] || "0") * Number(repres["@_height"] || "0");
      const currBand = Number(repres["@_bandwidth"] || "0");

      if (currRes && maxRes && currRes <= maxRes) {
        if (currRes > bestRes) {
          bestRes = currRes;
          bestBand = currBand;
          best = repres;
        }
      } else if (currBand <= maxBand && currBand > bestBand) {
        bestRes = currRes;
        bestBand = currBand;
        best = repres;
      }
    }

    if (best && Array.isArray(bestIds)) {
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      bestIds.push(best["@_id"]);
    }

    if (best) {
      adaptset.Representation = [best];
    }
  }

  const toXML = new XMLBuilder(xmlOpts);
  const xml = toXML.build(root);

  const xmlOutput = xml.trim();
  if (!xmlOutput.slice(0, 5).toLowerCase().startsWith("<?xml")) {
    return "<?xml version='1.0' encoding='UTF-8'?>\n" + xmlOutput;
  } else {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return xmlOutput;
  }
}
