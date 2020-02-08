const FUZZY_PREFIX = "http://fuzzy.example.com/";

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

  {"match": /plus\.googleapis\.com\/u\/\/0\/_\/widget\/render\/comments/i,
   "args": [["href", "stream_id", "substream_id"]]
  }
];

// ===========================================================================
class FuzzyMatcher {;



  constructor(rules) {
    this.rules = rules || DEFAULT_RULES;
  }

  *fuzzyUrls(url) {
    if (url.startsWith("//")) {
      yield "https:" + url;
      yield "http:" + url;
    } else {
      yield url;
    }

    if (url.indexOf("?") === -1) {
      url += "?";
    }

    for (let rule of this.rules) {
      if (rule.args === undefined && rule.replace !== undefined) {
        const newUrl = url.replace(rule.match, rule.replace);

        if (newUrl != url) {
          yield FUZZY_PREFIX + newUrl;
          url = newUrl;
        }
      } else if (rule.args !== undefined && url.match(rule.match)) {
        
        if (rule.replace !== undefined) {
          url = url.replace(rule.match, rule.replace);
        }

        for (let args of rule.args) {
          const newUrl = this.getQueryUrls(url, args);
          if (newUrl) {
            yield FUZZY_PREFIX + newUrl;
          }
        }
      }
    }
  }

  getQueryUrls(url, sigArgs) {
    try {
      url = new URL(url);
    } catch (e) {
      return null;
    }

    const query = new URLSearchParams(url.search);
    const newQuery = new URLSearchParams();

    for (let key of sigArgs) {
      const value = query.get(key);
      if (value) {
        newQuery.set(key, value);
      }
    }

    url.search = "?" + newQuery.toString();
    return url.toString();
  }
}

const fuzzyMatcher = new FuzzyMatcher();

export { FuzzyMatcher, fuzzyMatcher };