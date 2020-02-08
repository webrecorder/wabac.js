'use strict';

import XMLParser from 'fast-xml-parser';


// ===========================================================================
//HLS
function rewriteHLS(text) {
  const EXT_INF = /#EXT-X-STREAM-INF:(?:.*[,])?BANDWIDTH=([\d]+)/;
  const EXT_RESOLUTION = /RESOLUTION=([\d]+)x([\d]+)/;

  const maxRes = 0;
  const maxBand = 1000000000;

  let indexes = [];
  let count = 0;
  let bestIndex = null;

  let bestBand = 0;
  let bestRes = 0;

  let lines = text.trimEnd().split('\n');

  for (let line of lines) {
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

  for (let inx of indexes) {
    if (inx !== bestIndex) {
      lines.splice(inx, 2);
    }
  }

  return lines.join('\n');
}

// ===========================================================================
// DASH
function rewriteDASH(text, bestIds) {
  const options = {ignoreAttributes: false, ignoreNameSpace: false, format: true, supressEmptyNode: true};
  const root = XMLParser.parse(text, options);

  //console.log(util.inspect(root, {depth: null}));

  const maxRes = 0;
  const maxBand = 1000000000;

  let best = null;
  let bestRes = 0;
  let bestBand = 0;

  for (let adaptset of root.MPD.Period.AdaptationSet) {
    //console.log(adaptset);

    best = null;
    bestRes = 0;
    bestBand = 0;

    if (!Array.isArray(adaptset.Representation)) {
      if (Array.isArray(bestIds) && typeof(adaptset.Representation) === 'object' && adaptset.Representation["@_id"]) {
        bestIds.push(adaptset.Representation["@_id"]);
      }
      continue;
    }

    for (let repres of adaptset.Representation) {
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
export { rewriteHLS, rewriteDASH };

