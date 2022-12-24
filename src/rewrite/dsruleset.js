//import unescapeJs from "unescape-js";


// ===========================================================================
const DEFAULT_RULES = [
  {
    contains: ["youtube.com", "youtube-nocookie.com"],
    rxRules: [
      [/ytplayer.load\(\);/, ruleReplace("ytplayer.config.args.dash = \"0\"; ytplayer.config.args.dashmpd = \"\"; {0}")],
      [/yt\.setConfig.*PLAYER_CONFIG.*args":\s*{/, ruleReplace("{0} \"dash\": \"0\", dashmpd: \"\", ")],
      [/(?:"player":|ytplayer\.config).*"args":\s*{/, ruleReplace("{0}\"dash\":\"0\",\"dashmpd\":\"\",")],
      [/yt\.setConfig.*PLAYER_VARS.*?{/, ruleReplace("{0}\"dash\":\"0\",\"dashmpd\":\"\",")],
      [/ytplayer.config={args:\s*{/, ruleReplace("{0}\"dash\":\"0\",\"dashmpd\":\"\",")],
      [/"0"\s*?==\s*?\w+\.dash&&/m, ruleReplace("1&&")],
    ]
  },
  // {
  //   contains: ["vimeo.com/video"],
  //   rxRules: [
  //     [/"dash"[:]/, ruleReplace("\"__dash\":")],
  //     [/"hls"[:]/, ruleReplace("\"__hls\":")],
  //   ]
  // },
  {
    contains: ["facebook.com/"],
    rxRules: [
      //[/"dash_manifest":"?.*dash_prefetched_representation_ids"?:(\[.*\]|[^,]+)/, ruleRewriteFBDash],
      //[/"dash_manifest":"?.*?dash_prefetched_representation_ids"?:(?:null|(?:.+?\]))/, ruleRewriteFBDash],

      [/"dash_/, ruleReplace("\"__nodash__")],
      [/_dash"/, ruleReplace("__nodash__\"")],
      [/_dash_/, ruleReplace("__nodash__")],
    ]
  },

  {
    contains: ["instagram.com/"],
    rxRules: [
      [/"is_dash_eligible":(?:true|1)/, ruleReplace("\"is_dash_eligible\":false")]
    ]
  },

  {
    contains: ["api.twitter.com/2/", "twitter.com/i/api/2/", "twitter.com/i/api/graphql/"],
    rxRules: [
      [/"video_info":.*?}]}/, ruleRewriteTwitterVideo("\"video_info\":")]
    ]
  },

  {
    contains: ["cdn.syndication.twimg.com/tweet-result"],
    rxRules: [
      [/"video":.*?viewCount":\d+}/, ruleRewriteTwitterVideo("\"video\":")]
    ]
  },

  {
    contains: ["/vqlweb.js"],
    rxRules: [
      [/\b\w+\.updatePortSize\(\);this\.updateApplicationSize\(\)(?![*])/img,  ruleReplace("/*{0}*/")]
    ]
  }
];


// ===========================================================================
function ruleReplace(string) {
  return x => string.replace("{0}", x); 
}


// ===========================================================================
// For older captures, no longer applicable
// function ruleRewriteFBDash(string) {
//   let dashManifest = null;

//   try {
//     dashManifest = unescapeJs(string.match(/dash_manifest":"(.*?)","/)[1]);
//     dashManifest = dashManifest.replace(/\\\//g, "/");
//   } catch (e) {
//     console.warn(e);
//     return string;
//   }

//   let bestIds;

//   if (string.endsWith("null")) {
//     bestIds = null;
//   } else {
//     bestIds = [];
//   }

//   const newDashManifest = rewriteDASH(dashManifest, null, bestIds) + "\n";

//   if (bestIds != null && !bestIds.length) {
//     return string;
//   }

//   const resultJSON = {"dash_manifest": newDashManifest, "dash_prefetched_representation_ids": bestIds};   

//   const result = JSON.stringify(resultJSON).replace(/</g, "\\u003C").slice(1, -1);

//   return result + ", \"";
// }

// ===========================================================================
function ruleRewriteTwitterVideo(prefix) {

  return (string, opts) => {
    if (!opts) {
      return string;
    }

    // if (!opts.live && !(opts.response && opts.response.extraOpts && opts.response.extraOpts.rewritten)) {
    //   return string;
    // }

    const origString = string;

    try {
      const MAX_BITRATE = 5000000;

      const W_X_H = /([\d]+)x([\d]+)/;

      const extraOpts = opts.response && opts.response.extraOpts;

      let maxBitrate = MAX_BITRATE;

      if (opts.save) {
        opts.save.maxBitrate = maxBitrate;
      } else if (extraOpts && extraOpts.maxBitrate) {
        maxBitrate = extraOpts.maxBitrate;
      }

      string = string.slice(prefix.length);

      const data = JSON.parse(string);

      let bestVariant = null;
      let bestBitrate = 0;

      for (const variant of data.variants) {
        if ((variant.content_type && variant.content_type !== "video/mp4") ||
            (variant.type && variant.type !== "video/mp4")) {
          continue;
        }

        if (variant.bitrate && variant.bitrate > bestBitrate && variant.bitrate <= maxBitrate) {
          bestVariant = variant;
          bestBitrate = variant.bitrate;
        } else if (variant.src) {
          const matched = W_X_H.exec(variant.src);
          if (matched) {
            const bitrate = Number(matched[1]) * Number(matched[2]);
            if (bitrate > bestBitrate) {
              bestBitrate = bitrate;
              bestVariant = variant;
            }
          }
        }
      }

      if (bestVariant) {
        data.variants = [bestVariant];
      }

      return prefix + JSON.stringify(data);

    } catch (e) {
      console.warn("rewriter error: ", e);
      return origString;
    }
  };
}

// ===========================================================================

// ===========================================================================
class DomainSpecificRuleSet
{

  constructor(RewriterCls, rwRules) {
    this.rwRules = rwRules || DEFAULT_RULES;
    this.RewriterCls = RewriterCls;

    this._initRules();
  }

  _initRules() {
    this.rewriters = new Map();

    for (const rule of this.rwRules) {
      if (rule.rxRules) {
        this.rewriters.set(rule, new this.RewriterCls(rule.rxRules));
      }
    }
    this.defaultRewriter = new this.RewriterCls();
  }

  getRewriter(url) {
    for (const rule of this.rwRules) {
      if (!rule.contains) {
        continue;
      }

      for (const containsStr of rule.contains) {
        if (url.indexOf(containsStr) >= 0) {
          const rewriter = this.rewriters.get(rule);
          if (rewriter) {
            return rewriter;
          }
        }
      }
    }

    return this.defaultRewriter;
  }
}

export { DomainSpecificRuleSet };

