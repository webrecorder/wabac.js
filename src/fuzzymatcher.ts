import levenshtein from "js-levenshtein";
import { jsonToQueryParams } from "warcio";

type FuzzyRule = {
  match?: RegExp;
  fuzzyCanonReplace?: string;
  replace?: string;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any[][];
  split?: string;
  splitLast?: boolean;
  fuzzyArgs?: boolean;
  fuzzySet?: boolean;
  maxResults?: number;
};

type FuzzyResEntry = {
  url: string;
  status?: number | undefined;
  fuzzyMatchUrl?: string;
};

type KeySet = {
  found: Set<string>;
  value: string[];
};

type KeySets = Record<string, KeySet>;

function joinRx(rxStr: string[]) {
  return new RegExp(
    "[?&]" + rxStr.map((x: string) => "(" + x + ")").join("|"),
    "gi",
  );
}

const MAX_ARG_LEN = 1024;

const SPLIT_BASE_RX = /\[\d]+/;

const DEFAULT_RULES: FuzzyRule[] = [
  {
    match:
      /\/\/.*(?:gcs-vimeo|vod|vod-progressive|vod-adaptive)\.akamaized\.net.*?\/([\d/]+\.mp4)/,
    fuzzyCanonReplace: "//vimeo-cdn.fuzzy.replayweb.page/$1",
    split: ".net",
  },
  {
    match: /\/\/.*player.vimeo.com\/(video\/[\d]+)\?.*/i,
    fuzzyCanonReplace: "//vimeo.fuzzy.replayweb.page/$1",
  },
  {
    match: /www.\washingtonpost\.com\/wp-apps\/imrs.php/,
    args: [["src"]],
  },
  {
    match: /(static.wixstatic.com\/.*\.[\w]+\/v1\/fill\/)(w_.*)/,
    replace: "$1?_args=$2",
    split: "/v1/fill",
  },
  {
    match: /(twimg.com\/profile_images\/[^/]+\/[^_]+)_([\w]+\.[\w]+)/,
    replace: "$1=_args=$2",
    split: "_",
    splitLast: true,
  },
  // YouTube
  {
    match: /^https?:\/\/(?:www\.)?(youtube\.com\/embed\/[^?]+)[?].*/i,
    replace: "$1",
  },
  {
    match: /^(https?:\/\/(?:www\.)?)(youtube\.com\/@[^?]+)[?].*/i,
    fuzzyCanonReplace: "$1$2",
  },
  {
    match: /\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/(get_video_info)/i,
    fuzzyCanonReplace: "//youtube.fuzzy.replayweb.page/$1",
    args: [["video_id"]],
  },
  {
    match:
      /\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/(youtubei\/v1\/[^?]+\?).*(videoId[^&]+).*/i,
    fuzzyCanonReplace: "//youtube.fuzzy.replayweb.page/$1$2",
    args: [["videoId"]],
  },
  {
    match: /\/\/.*googlevideo.com\/(videoplayback)/i,
    fuzzyCanonReplace: "//youtube.fuzzy.replayweb.page/$1",
    args: [["id", "itag"], ["id"]],
    fuzzyArgs: true,
  },
  {
    match: /facebook\.com\/ajax\/pagelet\/generic.php\/photoviewerinitpagelet/i,
    args: [
      [{ arg: "data", keys: ["query_type", "fbid", "v", "cursor", "data"] }],
    ],
  },
  // Twitter/X
  {
    match: /((?:twitter|x)\.com\/[^/]+\/status\/[^?]+)(\?.*)/,
    fuzzyCanonReplace: "$1",
  },
  {
    match: /((?:twitter|x)\.com\/i\/api\/graphql\/.*)/,
    args: [["cursor"]],
    fuzzyArgs: true,
  },
  // Facebook
  {
    match: /facebook\.com\/ajax\//i,
    fuzzySet: true,
  },
  // {
  //   "match": /facebook\.com\/api\/graphql/i,
  //   "args": [["fb_api_req_friendly_name"]],
  //   //"args": [["variables", "doc_id"]],
  //   //"fuzzyArgs": true
  // },
  // {
  //   "match": /facebook\.com\/api\/graphqlbatch/i,
  //   "args": [["batch_name", "queries"], ["batch_name"]]
  // },
  // {
  //   "match": /facebook\.com\/ajax\/navigation/i,
  //   "args": [["route_url", "__user"], ["route_url"]]
  // },
  // {
  //   "match": /facebook\.com\/ajax\/route-definition/i,
  //   "args": [["route_url", "__user"], ["route_url"]]
  // },
  // {
  //   "match": /facebook\.com\/ajax\/bulk-route-definitions/i,
  //   "args": [["route_urls[0]", "__user"], ["route_urls[0]"]]
  // },
  // {
  //   "match": /facebook\.com\/ajax\/relay-ef/i,
  //   "args": [["queries[0]", "__user"], ["queries[0]"]]
  // },
  // {
  //   "match": /facebook\.com\/videos\/vodcomments/i,
  //   "args": [["eft_id"]],
  // },
  // {
  //   "match": /facebook\.com\/ajax\.*/i,
  //   "replaceQuery": /([?&][^_]\w+=[^&]+)/g,
  // },
  // {"match": /plus\.googleapis\.com\/u\/\/0\/_\/widget\/render\/comments/i,
  //   "args": [["href", "stream_id", "substream_id"]]
  // },

  // Generic Rules -- should be last
  {
    match: joinRx([
      "(callback=jsonp)[^&]+(?=&|$)",
      "((?:\\w+)=jquery)[\\d]+_[\\d]+",
      "utm_[^=]+=[^&]+(?=&|$)",
      "(_|cb|_ga|\\w*cache\\w*)=[\\d.-]+(?=$|&)",
    ]),
    replace: "",
  },
  {
    match: /(\.(?:js|webm|mp4|gif|jpg|png|css|json|m3u8))\?.*/i,
    replace: "$1",
    maxResults: 2,
  },
];

// ===========================================================================
export class FuzzyMatcher {
  rules: FuzzyRule[];
  constructor(rules?: FuzzyRule[]) {
    this.rules = rules || DEFAULT_RULES;
  }

  getRuleFor(reqUrl: string) {
    let rule;

    const matchUrl = reqUrl.indexOf("?") === -1 ? reqUrl + "?" : reqUrl;

    for (const testRule of this.rules) {
      // very large URLs likely do not match any of our existing rules, so just skip
      if (
        matchUrl.length < MAX_ARG_LEN * 4 &&
        matchUrl.match(testRule.match!)
      ) {
        rule = testRule;
        break;
      }
    }

    let fuzzyCanonUrl = reqUrl;

    if (rule?.fuzzyCanonReplace) {
      fuzzyCanonUrl = reqUrl.replace(rule.match!, rule.fuzzyCanonReplace);
    }

    const split = rule?.split || "?";
    const inx = rule?.splitLast
      ? reqUrl.lastIndexOf(split)
      : reqUrl.indexOf(split);
    const prefix = inx > 0 ? reqUrl.slice(0, inx + split.length) : reqUrl;

    return { prefix, rule, fuzzyCanonUrl };
  }

  getFuzzyCanonsWithArgs(reqUrl: string) {
    // eslint-disable-next-line prefer-const
    let { fuzzyCanonUrl, prefix, rule } = this.getRuleFor(reqUrl);

    if (fuzzyCanonUrl === reqUrl) {
      fuzzyCanonUrl = prefix;
    }

    const urls: string[] = [];

    if (rule?.args) {
      const fuzzUrl = new URL(fuzzyCanonUrl);
      const origUrl = new URL(reqUrl);

      for (const args of rule.args) {
        const query = new URLSearchParams();

        for (const arg of args) {
          // [TODO]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          query.set(arg, origUrl.searchParams.get(arg) || "");
        }
        fuzzUrl.search = query.toString();
        urls.push(fuzzUrl.href);
      }
      return urls;
    }

    return [fuzzyCanonUrl];
  }

  fuzzyCompareUrls(
    reqUrl: string,
    results: FuzzyResEntry[] | undefined,
    matchedRule?: FuzzyRule,
  ) {
    if (!results?.length) {
      return null;
    }

    if (
      matchedRule?.replace !== undefined &&
      matchedRule.match !== undefined &&
      // if limit exists, only apply if < limit results
      (!matchedRule.maxResults || results.length <= matchedRule.maxResults)
    ) {
      const match = matchedRule.match;
      const replace = matchedRule.replace;
      const fuzzyReqUrl = reqUrl.replace(match, replace);

      const newResults: FuzzyResEntry[] = [];

      // find best match by regex
      for (const result of results) {
        const url = result.url;

        const fuzzyMatchUrl = url.replace(match, replace);

        if (fuzzyReqUrl === fuzzyMatchUrl) {
          // exact match, return
          return result;
        }

        result.fuzzyMatchUrl = fuzzyMatchUrl;
        newResults.push(result);
      }

      results = newResults;
      reqUrl = fuzzyReqUrl;
    }

    return this.fuzzyBestMatchQuery(reqUrl, results, matchedRule);
  }

  fuzzyBestMatchQuery(
    reqUrlStr: string,
    results: FuzzyResEntry[],
    rule?: FuzzyRule,
  ): FuzzyResEntry | null {
    let reqUrl: URL;

    try {
      reqUrl = new URL(reqUrlStr);
    } catch (_e) {
      return null;
    }

    const reqArgs: Set<string> | null =
      rule?.args && !rule.fuzzyArgs ? new Set<string>(rule.args[0]) : null;

    let bestTotal = 0;
    let bestResult = null;

    const reqQuery = new URLSearchParams(reqUrl.search);

    for (const result of results) {
      // skip 204s and 304s from fuzzy matching (todo: reexamine)
      if (result.status === 204 || result.status === 304) {
        continue;
      }

      let url: URL;

      try {
        url = new URL(result.fuzzyMatchUrl || result.url);
      } catch (_e) {
        continue;
      }

      const foundQuery = new URLSearchParams(url.search);
      let total = this.getMatch(reqQuery, foundQuery, reqArgs, rule?.fuzzySet);
      total += this.getMatch(foundQuery, reqQuery, reqArgs);
      total /= 2.0;

      // lower total score for status >200
      if (result.status! > 200) {
        total *= 10 ** ((200 - result.status!) * 0.0001);
      }

      //console.log('total: ' + total + ' ' + url.href + ' <=> ' + reqUrl);

      if (total > bestTotal) {
        bestTotal = total;
        bestResult = result;
      }
    }

    //console.log("best: " + bestResult.url);

    //return {"score": bestTotal, "result": bestResult};
    return bestResult;
  }

  getMatch(
    reqQuery: URLSearchParams,
    foundQuery: URLSearchParams,
    reqArgs: Set<string> | null = null,
    fuzzySet = false,
  ) {
    let score = 1.0;
    let total = 1.0;

    const keySets: KeySets = {};

    // eslint-disable-next-line prefer-const
    for (let [key, value] of reqQuery) {
      let foundValue = foundQuery.get(key);

      // if key is required, return a large negative to skip this match
      if (reqArgs && reqArgs.has(key) && foundValue !== value) {
        return -1000;
      }

      let weight;

      if (key.startsWith("_")) {
        weight = 0.1;
      } else {
        weight = 10.0;
      }

      if (foundValue !== null) {
        score += weight * 0.5;

        if (foundValue.length > MAX_ARG_LEN) {
          foundValue = foundValue.slice(0, MAX_ARG_LEN);
        }
      }

      if (value && value.length > MAX_ARG_LEN) {
        value = value.slice(0, MAX_ARG_LEN);
      }

      const numValue = Number(value);
      const numFoundValue = Number(foundValue);

      total += weight;

      if (fuzzySet && foundValue) {
        this.addSetMatch(keySets, key, value, foundValue);
      }

      if (foundValue === value) {
        score += weight * value.length;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      } else if (foundValue === null || value === null) {
        score += 0.0;
      } else if (!isNaN(numValue) && !isNaN(numFoundValue)) {
        score += 10.0 - Math.log(Math.abs(numValue - numFoundValue) + 1);
      } else if (value.startsWith("{") && foundValue.startsWith("{")) {
        try {
          const rQ = jsonToQueryParams(value);
          const fQ = jsonToQueryParams(foundValue);

          score += this.getMatch(rQ, fQ) * weight * 2;
        } catch (_e) {
          score += 0.5 * weight * this.levScore(value, foundValue);
        }
      } else {
        // if (foundValue.length > value.length && foundValue.indexOf(",") >= 0 && foundValue.indexOf(value) >= 0) {
        //   score += weight * value.length * 0.5;
        // }
        if (!fuzzySet) {
          score += weight * this.levScore(value, foundValue);
        }
      }
    }

    const result =
      score / total + (fuzzySet ? this.paramSetMatch(keySets, 100) : 0);
    //console.log('score: ' + result + " " + reqQuery + " <-> " + foundQuery);
    return result;
  }

  addSetMatch(
    keySets: KeySets,
    key: string,
    value: string,
    foundValue: string,
  ) {
    if (
      !value ||
      !foundValue ||
      !value.startsWith("/") ||
      !foundValue.startsWith("/")
    ) {
      return;
    }

    const keyParts = key.split(SPLIT_BASE_RX);

    if (keyParts.length <= 1) {
      return;
    }

    // compare set matches instead of by string
    const valueQ = value.indexOf("?");
    const foundQ = foundValue.indexOf("?");

    const keyBase = keyParts[0];

    const valueNoQ = valueQ > 0 ? value.slice(0, valueQ) : value;
    const foundNoQ = foundQ > 0 ? foundValue.slice(0, foundQ) : foundValue;

    // @ts-expect-error [TODO] - TS2538 - Type 'undefined' cannot be used as an index type.
    if (!keySets[keyBase]) {
      // @ts-expect-error [TODO] - TS2538 - Type 'undefined' cannot be used as an index type.
      keySets[keyBase] = { value: [], found: new Set() };
    }

    // @ts-expect-error [TODO] - TS2538 - Type 'undefined' cannot be used as an index type.
    keySets[keyBase].value.push(valueNoQ);
    // @ts-expect-error [TODO] - TS2538 - Type 'undefined' cannot be used as an index type.
    keySets[keyBase].found.add(foundNoQ);
  }

  paramSetMatch(keySets: KeySets, weight: number) {
    let score = 0;

    for (const keySet of Object.values(keySets)) {
      let currWeight = weight;

      for (const obj of keySet.value) {
        if (keySet.found.has(obj)) {
          score += currWeight;
        }
        currWeight *= 0.33;
      }
    }

    return score;
  }

  levScore(val1: string, val2: string) {
    const minLen = Math.min(val1.length, val2.length);
    const lev = levenshtein(val1, val2);
    return lev < minLen ? minLen - lev : 0;
  }
}

export const fuzzyMatcher = new FuzzyMatcher();
