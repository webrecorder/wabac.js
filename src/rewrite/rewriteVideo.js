'use strict';

import XMLParser from 'fast-xml-parser';

const DEFAULT_MAX_BAND = 1000000;
const DEFAULT_MAX_RES = 860 * 480;
//const DEFAULT_MAX_BAND = 2000000;
//const DEFAULT_MAX_RES = 1280 * 720;


// ===========================================================================
//HLS
function rewriteHLS(text, isAjax, extraOpts) {
  const EXT_INF = /#EXT-X-STREAM-INF:(?:.*[,])?BANDWIDTH=([\d]+)/;
  const EXT_RESOLUTION = /RESOLUTION=([\d]+)x([\d]+)/;

  const maxRes = extraOpts && extraOpts["adaptive_max_resolution"] || DEFAULT_MAX_RES;
  const maxBand = extraOpts && extraOpts["adaptive_max_bandwidth"] || DEFAULT_MAX_BAND;

  let indexes = [];
  let count = 0;
  let bestIndex = null;

  let bestBand = 0;
  let bestRes = 0;

  let lines = text.trimEnd().split('\n');

  for (const line of lines) {
    const m = line.match(EXT_INF);
    if (!m) {
      count += 1;
      continue;
    }

    indexes.push(count);

    const currBand = Number(m[1]);

    const m2 = line.match(EXT_RESOLUTION);
    const currRes = m2 ? Number(m2[1]) * Number(m2[2]) : 0;

    if (maxRes && currRes) {
      if (currRes > bestRes && currRes < maxRes) {
        bestRes = currRes;
        bestBand = currBand;
        bestIndex = count;
      }
    } else if (currBand > bestBand && currBand <= maxBand) {
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

  return lines.join('\n');
}

// ===========================================================================
// DASH
const dashOutputOpts = {ignoreAttributes: false, ignoreNameSpace: false, format: false, supressEmptyNode: true};


function rewriteDASH(text, bestIds) {
  try {
    return _rewriteDASH(text, bestIds);
  } catch (e) {
    console.log(e);
    return text;
  }
}


function _rewriteDASH(text, bestIds) {
  const options = dashOutputOpts;
  const root = XMLParser.parse(text, options);

  const maxRes = DEFAULT_MAX_RES;
  const maxBand = DEFAULT_MAX_BAND;

  let best = null;
  let bestRes = 0;
  let bestBand = 0;

  let adaptSets = null;

  if (!Array.isArray(root.MPD.Period.AdaptationSet)) {
    adaptSets = [root.MPD.Period.AdaptationSet];
  } else {
    adaptSets = root.MPD.Period.AdaptationSet;
  }

  for (const adaptset of adaptSets) {
    best = null;
    bestRes = 0;
    bestBand = 0;

    let reps = null;

    if (!Array.isArray(adaptset.Representation)) {
      reps = [adaptset.Representation];
    } else {
      reps = adaptset.Representation;
    }

    for (const repres of reps) {
      const currRes = Number(repres['@_width'] || '0') * Number(repres['@_height'] || '0');
      const currBand = Number(repres['@_bandwidth'] || '0');

      if (currRes && maxRes) {
        if (currRes <= maxRes && currRes > bestRes) {
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
      bestIds.push(best['@_id']);
    }

    if (best) {
      adaptset.Representation = [best];
    }
  }

  const toXML = new XMLParser.j2xParser(options);
  const xml = toXML.parse(root);

  return "<?xml version='1.0' encoding='UTF-8'?>\n" + xml.trim();
}


// ===========================================================================
export { rewriteHLS, rewriteDASH, dashOutputOpts };

