import { rewriteDASH, DEFAULT_MAX_BAND } from './rewriteVideo';
import unescapeJs from 'unescape-js';


// ===========================================================================
const DEFAULT_RULES = [
  {
    contains: ["youtube.com", "youtube-nocookie.com"],
    rxRules: [
      [/ytplayer.load\(\);/, ruleReplace('ytplayer.config.args.dash = "0"; ytplayer.config.args.dashmpd = ""; {0}')],
      [/yt\.setConfig.*PLAYER_CONFIG.*args":\s*{/, ruleReplace('{0} "dash": "0", dashmpd: "", ')],
      [/(?:"player":|ytplayer\.config).*"args":\s*{/, ruleReplace('{0}"dash":"0","dashmpd":"",')],
      [/yt\.setConfig.*PLAYER_VARS.*?{/, ruleReplace('{0}"dash":"0","dashmpd":"",')]
    ]
  },
  {
    contains: ["vimeo.com/video"],
    rxRules: [
      [/\"dash\"[:]/, ruleReplace('"__dash":')],
      [/\"hls\"[:]/, ruleReplace('"__hls":')],
    ]
  },
  {
    contains: ["facebook.com/"],
    rxRules: [
      //[/"dash_manifest":"?.*dash_prefetched_representation_ids"?:(\[.*\]|[^,]+)/, ruleRewriteFBDash],
      //[/"dash_manifest":"?.*?dash_prefetched_representation_ids"?:(?:null|(?:.+?\]))/, ruleRewriteFBDash],

      [/"dash_/, ruleReplace('"__nodash__')],
      [/_dash"/, ruleReplace('__nodash__"')],
      [/_dash_/, ruleReplace('__nodash__')],
    ]
  },

  {
    contains: ["api.twitter.com/2/", "twitter.com/i/api/2/"],
    rxRules: [
      [/"video_info".*?}]}/, ruleRewriteTwitterVideo]
    ]
  }
];


// ===========================================================================
function ruleReplace(string) {
  return x => string.replace('{0}', x); 
}


// ===========================================================================
// For older captures, no longer applicable
function ruleRewriteFBDash(string) {
  let dashManifest = null;

  try {
    dashManifest = unescapeJs(string.match(/dash_manifest":"(.*?)","/)[1]);
    dashManifest = dashManifest.replace(/\\\//g, '/');
  } catch (e) {
    console.warn(e);
    return string;
  }

  let bestIds;

  if (string.endsWith("null")) {
    bestIds = null;
  } else {
    bestIds = [];
  }

  const newDashManifest = rewriteDASH(dashManifest, null, bestIds) + "\n";

  if (bestIds != null && !bestIds.length) {
    return string;
  }

  const resultJSON = {"dash_manifest": newDashManifest, "dash_prefetched_representation_ids": bestIds};   

  const result = JSON.stringify(resultJSON).replace(/</g, "\\u003C").slice(1, -1);

  return result + ', "';
}

// ===========================================================================
function ruleRewriteTwitterVideo(string, opts) {
  if (!opts) {
    return string;
  }

  if (!opts.live && !(opts.response && opts.response.extraOpts && opts.response.extraOpts.rewritten)) {
    return string;
  }

  const origString = string;

  try {
    const prefix = `"video_info":`;

    string = string.slice(prefix.length);

    const data = JSON.parse(string);

    let bestVariant = null;
    let bestBitrate = 0;

    for (const variant of data.variants) {
      if (variant.content_type !== "video/mp4") {
        continue;
      }

      if (variant.bitrate && variant.bitrate > bestBitrate && variant.bitrate <= DEFAULT_MAX_BAND) {
        bestVariant = variant;
        bestBitrate = variant.bitrate;
      }
    }

    if (bestVariant) {
      data.variants = [bestVariant];
    }

    return prefix + JSON.stringify(data);

  } catch (e) {
    return origString;
  }
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

