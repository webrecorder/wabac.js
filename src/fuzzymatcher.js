import levenshtein from 'js-levenshtein';

function joinRx(rxStr) {
  return new RegExp("[?&]" + rxStr.map(x => "(" + x + ")").join("|"), "gi");
}


const DEFAULT_RULES = 
[
  {
   "match": /\/\/.*gcs-vimeo|vod|vod-progressive\.akamaized\.net.*\/([\d]+)\/[\d]+(.mp4)/,
   "fuzzyCanonReplace": "//vimeo-cdn.fuzzy.replayweb.page/$1$2",
   "split": ".net",
  },
  {
   "match": /\/\/.*player.vimeo.com\/(video\/[\d]+)\?.*/i,
   "fuzzyCanonReplace": "//vimeo.fuzzy.replayweb.page/$1"
  },
  {
   "match": /www.\washingtonpost\.com\/wp-apps\/imrs.php/,
   "args": [["src"]],
  },
  {
    "match": /(static.wixstatic.com\/.*\.[\w]+\/v1\/fill\/)(w_.*)/,
    "replace": "$1?_args=$2",
    "split": "/v1/fill"
  },
  {
    "match": /(twimg.com\/profile_images\/[^/]+\/[^_]+)_([\w]+\.[\w]+)/,
    "replace": "$1=_args=$2",
    "split": "_",
    "splitLast": true
  },
  {
   "match": /^https?:\/\/(youtube\.com\/embed\/[^?]+)[?].*/i,
   "replace": "$1"
  },
  {
   "match": /\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/(get_video_info)/i,
   "fuzzyCanonReplace": "//youtube.fuzzy.replayweb.page/$1",
   "args": [["video_id"]],
  },
  {
   "match": /\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/(youtubei\/v1\/[^?]+\?).*(videoId[^,]+).*/i,
   "fuzzyCanonReplace": "//youtube.fuzzy.replayweb.page/$1?$2",
   "args": [["videoId"]]
  },
  {
   "match": /\/\/.*googlevideo.com\/(videoplayback)/i,
   "fuzzyCanonReplace": "//youtube.fuzzy.replayweb.page/$1",
   "args": [["id", "itag"],
            ["id"]],
   "fuzzyArgs": true
  },
  {
   "match": /facebook\.com\/ajax\/pagelet\/generic.php\/photoviewerinitpagelet/i,
   "args": [[{"arg": "data",
              "keys": ["query_type", "fbid", "v", "cursor", "data"]}]]
  },
  // Facebook
  {
   "match": /facebook\.com\/api\/graphql/i,
   "args": [["variables", "doc_id"]],
   "fuzzyArgs": true
  },
  {
   "match": /facebook\.com\/api\/graphqlbatch/i,
   "args": [["batch_name", "queries"], ["batch_name"]]
  },
  {
   "match": /facebook\.com\/ajax\/navigation/i,
   "args": [["route_url", "__user"], ["route_url"]]
  },
  {
   "match": /facebook\.com\/ajax\/route-definition/i,
   "args": [["route_url", "__user"], ["route_url"]]
  },
  {
   "match": /facebook\.com\/ajax\/bulk-route-definitions/i,
   "args": [["route_urls[0]", "__user"], ["route_urls[0]"]]
  },
  {
   "match": /facebook\.com\/ajax\/relay-ef/i,
   "args": [["queries[0]", "__user"], ["queries[0]"]]
  },
  {
   "match": /facebook\.com\/videos\/vodcomments/i,
   "args": [["eft_id"]],
  },
  {
    "match": /facebook\.com\/ajax\.*/i,
    "replaceQuery": /([?&][^_]\w+=[^&]+)/g,
  },
  {"match": /plus\.googleapis\.com\/u\/\/0\/_\/widget\/render\/comments/i,
   "args": [["href", "stream_id", "substream_id"]]
  },

  // Generic Rules -- should be last
  {
    "match": joinRx([
      "(callback=jsonp)[^&]+(?=&|$)",
      "((?:\\w+)=jquery)[\\d]+_[\\d]+",
      "utm_[^=]+=[^&]+(?=&|$)",
      "(_|cb|_ga|\\w*cache\\w*)=[\\d.-]+(?=$|&)"
    ]),
    "replace": ""
  },
  {
    "match": /(\.(?:php|js|webm|mp4|gif|jpg|png|css|json|m3u8))\?.*/i,
    "replace": "$1"
  }
];

// ===========================================================================
class FuzzyMatcher {;
  constructor(rules) {
    this.rules = rules || DEFAULT_RULES;
  }

  getRuleFor(reqUrl) {
    let rule;

    const matchUrl = reqUrl.indexOf("?") === -1 ? reqUrl + "?" : reqUrl;

    for (const testRule of this.rules) {
      if (matchUrl.match(testRule.match)) {
        rule = testRule;
        break;
      }
    }

    let fuzzyCanonUrl = reqUrl;

    if (rule && rule.fuzzyCanonReplace) {
      fuzzyCanonUrl = reqUrl.replace(rule.match, rule.fuzzyCanonReplace);
    }

    const split = rule && rule.split || "?";
    const inx = rule && rule.splitLast ? reqUrl.lastIndexOf(split) : reqUrl.indexOf(split);
    const prefix = inx > 0 ? reqUrl.slice(0, inx + split.length) : reqUrl;

    return {prefix, rule, fuzzyCanonUrl};
  }

  getFuzzyCanonWithArgs(reqUrl) {
    let { fuzzyCanonUrl, prefix, rule } = this.getRuleFor(reqUrl);

    if (fuzzyCanonUrl === reqUrl) {
      fuzzyCanonUrl = prefix;
    }

    if (rule && rule.args) {
      const fuzzUrl = new URL(fuzzyCanonUrl);
      const origUrl = new URL(reqUrl);
      const query = new URLSearchParams();
      for (const arg of rule.args[0]) {
        query.set(arg, origUrl.searchParams.get(arg) || "");
      }
      fuzzUrl.search = query.toString();
      return fuzzUrl.href;
    }

    return fuzzyCanonUrl;
  }

  fuzzyCompareUrls(reqUrl, results, matchedRule) {
    if (!results || !results.length) {
      return null;
    }

    if (matchedRule && matchedRule.replace !== undefined && matchedRule.match !== undefined) {
      const match = matchedRule.match;
      const replace = matchedRule.replace;
      const fuzzyReqUrl = reqUrl.replace(match, replace);

      const newResults = [];
  
      // find best match by regex
      for (const result of results) {
        const url = (typeof result === "string" ? result : result.url);
  
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

  fuzzyBestMatchQuery(reqUrl, results, rule) {
    try {
      reqUrl = new URL(reqUrl);
    } catch (e) {
      return 0.0;
    }

    const reqArgs = rule && rule.args && !rule.fuzzyArgs ? new Set(rule.args[0]) : null;

    let bestTotal = 0;
    let bestResult = null;

    const reqQuery = new URLSearchParams(reqUrl.search);

    for (const result of results) {
      // skip 204s and 304s from fuzzy matching (todo: reexamine)
      if (result.status === 204 || result.status === 304) {
        continue;
      }

      let url = (typeof result === "string" ? result : result.fuzzyMatchUrl || result.url);

      try {
        url = new URL(url);
      } catch (e) {
        continue;
      }

      const foundQuery = new URLSearchParams(url.search);
      let total = this.getMatch(reqQuery, foundQuery, reqArgs);
      total += this.getMatch(foundQuery, reqQuery, reqArgs);
      total /= 2.0;

      // subtract points for non-200 status codes to prefer 200
      if (result.status > 200) {
        total -= 0.01 * (result.status - 200);
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

  getMatch(reqQuery, foundQuery, reqArgs) {
    let score = 1.0;
    let total = 1.0;

    for (const [key, value] of reqQuery) {
      const foundValue = foundQuery.get(key);

      // if key is required, return a large negative to skip this match
      if (reqArgs && reqArgs.has(key) && foundValue !== value) {
        return -1000;
      }

      let weight;

      if (key[0] === '_') {
        weight = 1.0;
      } else {
        weight = 10.0;
      }

      if (foundValue !== null) {
        score += weight * 0.5;
      }

      const numValue = Number(value);
      const numFoundValue = Number(foundValue);

      total += weight;

      if (foundValue === value) {
        score += weight * value.length;
      } else if (foundValue === null) {
        score += 0.0;
      } else if (!isNaN(numValue) && !isNaN(numFoundValue)) {
        score += 10.0 - Math.log(Math.abs(numValue - numFoundValue) + 1);
      } else {
        // if (foundValue.length > value.length && foundValue.indexOf(",") >= 0 && foundValue.indexOf(value) >= 0) {
        //   score += weight * value.length * 0.5;
        // }
        const minLen = Math.min(foundValue.length, value.length);
        const lev = levenshtein(foundValue, value);
        if (lev < minLen) {
          score += weight * (minLen - lev);
        }
      }
    }

    const result = score / total;
    //console.log('score: ' + result + " " + reqQuery + " <-> " + foundQuery);
    return result;
  }
}

const fuzzyMatcher = new FuzzyMatcher();

export { FuzzyMatcher, fuzzyMatcher };
