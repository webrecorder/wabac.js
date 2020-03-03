//const FUZZY_PREFIX = "http://fuzzy.example.com/";

const DEFAULT_RULES = 
[
  {"match": /[?&](_|cb|\w*cache\w*)=[\d]+(?=$|&)/i,
   "replace": ""},

  {"match": /([?&])utm_[^=]+=[^&]+(?=&|$)/g,
   "replace": ""},

  {"match": /[?&](callback=jsonp)[^&]+(?=&|$)/i,
   "replace": "",
  },

  {"match": /[?&]((?:\w+)=jquery)[\d]+_[\d]+/i,
   "replace": "",
  },

  {"match": /\/\/.*(?:gcs-vimeo|vod)\.akamized\.net\.*([/\d]+\.mp4)$/,
   "replace": "video.vimeo.net$1"
  },

  {"match": /(\.(?:php|js|webm|mp4))\?.*/i,
   "replace": "$1"},

  {"match": /(www\.)?youtube(-nocookie)?\.com\/get_video_info/i,
   "args": [["video_id", "html5"]],
  },

  {"match": /\/\/.*(googlevideo.com\/videoplayback)/i,
   "replace": "server.$1",
   "args": [["id", "itag"],
            ["id"]],
  },

  {"match": /facebook\.com\/ajax\/pagelet\/generic.php\/photoviewerinitpagelet/i,
   "args": [[{"arg": "data",
              "keys": ["query_type", "fbid", "v", "cursor", "data"]}]]
  },

  {"match": /facebook\.com\/videos\/vodcomments/i,
   "args": [["eft_id"]],
  },
  {
    "match": /facebook\.com\/ajax\.*/i,
    "replaceQuery": /([?&][^_]\w+=[^&]+)/g,
  },

  {"match": /plus\.googleapis\.com\/u\/\/0\/_\/widget\/render\/comments/i,
   "args": [["href", "stream_id", "substream_id"]]
  },
];

// ===========================================================================
class FuzzyMatcher {;
  constructor(rules) {
    this.rules = rules || DEFAULT_RULES;
  }

  *fuzzyUrls(url) {
    if (url.indexOf("?") === -1) {
      url += "?";
    }

    for (const rule of this.rules) {
      const matched = url.match(rule.match);

      if (!matched) {
        continue;
      }

      if (rule.args === undefined && rule.replace !== undefined) {
        const newUrl = url.replace(rule.match, rule.replace);

        if (newUrl != url) {
          yield newUrl;
          url = newUrl;
        }
        //break;

      } else if (rule.args !== undefined) {
        
        if (rule.replace !== undefined) {
          url = url.replace(rule.match, rule.replace);
        }

        for (let args of rule.args) {
          const newUrl = this.getQueryUrl(url, args);
          if (url != newUrl) {
            yield newUrl;
          }
        }
        break;

      } else if (rule.replaceQuery) {
        const results = url.match(rule.replaceQuery);
        const newUrl = this.getQueryUrl(url, results ? results.join("") : "");
        if (newUrl != url) {
          yield newUrl;
        }
        break;
      }
    }
  }

  getQueryUrl(url, sigArgs) {
    try {
      url = new URL(url);
    } catch (e) {
      return null;
    }

    if (typeof(sigArgs) === "string") {
      url.search = sigArgs;
      return url.toString();
    }

    const query = new URLSearchParams(url.search);
    const newQuery = new URLSearchParams();

    for (const key of sigArgs) {
      if (typeof(key) === "string") {
        const value = query.get(key);
        if (value) {
          newQuery.set(key, value);
        }
      } else if (typeof(key) === "object") {
        this.setQueryJsonArg(query, newQuery, key);
      }
    }

    url.search = "?" + newQuery.toString();
    return url.toString();
  }

  setQueryJsonArg(query, newQuery, jsonDef) {
    let currValue;

    try {
      currValue = query.get(jsonDef.arg);
      currValue = JSON.parse(currValue);
    } catch (e) {
      console.log("JSON parse error: " + currValue);
      return;
    }

    let newValue = {};

    for (const sigKey of jsonDef.keys) {
      const res = currValue[sigKey];
      if (res != undefined) {
        newValue[sigKey] = res;
      }
    }

    newQuery.set(jsonDef.arg, JSON.stringify(newValue));
  }
}

function fuzzyCompareUrls(reqUrl, results) {
  try {
    reqUrl = new URL(reqUrl);
  } catch (e) {
    return 0.0;
  }

  let bestTotal = 0;
  let bestResult = null;

  const reqQuery = new URLSearchParams(reqUrl.search);

  for (const result of results) {
    let url = (typeof result === "string" ? result : result.url);

    try {
      url = new URL(url);
    } catch (e) {
      continue;
    }

    const foundQuery = new URLSearchParams(url.search);
    let total = getMatch(reqQuery, foundQuery);
    total += getMatch(foundQuery, reqQuery);
    total /= 2.0;
    //console.log('total: ' + total + ' ' + result + ' <=> ' + reqUrl);

    if (total > bestTotal) {
      bestTotal = total;
      bestResult = result;
    }
  }


  return {"score": bestTotal, "result": bestResult};
}

function getMatch(reqQuery, foundQuery) {
  let score = 1.0;
  let total = 1.0;

  for (const [key, value] of reqQuery) {
    const foundValue = foundQuery.get(key);
    let weight;

    if (key[0] === '_') {
      total += 1.0;
      score += 1.0;
      weight = 1.0;
    } else {
      weight = 10.0;
    }

    total += weight;

    if (foundValue === value) {
      score += weight;
    } else if (foundValue === null) {
      score -= 1.0;
    } else {
      if (foundValue.length > value.length && foundValue.indexOf(",") >= 0 && foundValue.indexOf(value) >= 0) {
        score += weight * 0.8;
      }
    }
  }

  const result = score / total;
  //console.log('score: ' + result + " " + reqQuery + " <-> " + foundQuery);
  return result;
}

const fuzzyMatcher = new FuzzyMatcher();

export { FuzzyMatcher, fuzzyMatcher, fuzzyCompareUrls };
