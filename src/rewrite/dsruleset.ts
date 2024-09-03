import { type RxRewriter, type Rule } from "./rxrewriter";

//import unescapeJs from "unescape-js";
const MAX_BITRATE = 5000000;

type Rules = {
  contains: string[];
  rxRules: Rule[];
};

// ===========================================================================
export const DEFAULT_RULES: Rules[] = [
  {
    contains: ["youtube.com", "youtube-nocookie.com"],
    rxRules: [
      [
        /ytplayer.load\(\);/,
        ruleReplace(
          'ytplayer.config.args.dash = "0"; ytplayer.config.args.dashmpd = ""; {0}',
        ),
      ],
      [
        /yt\.setConfig.*PLAYER_CONFIG.*args":\s*{/,
        ruleReplace('{0} "dash": "0", dashmpd: "", '),
      ],
      [
        /(?:"player":|ytplayer\.config).*"args":\s*{/,
        ruleReplace('{0}"dash":"0","dashmpd":"",'),
      ],
      [
        /yt\.setConfig.*PLAYER_VARS.*?{/,
        ruleReplace('{0}"dash":"0","dashmpd":"",'),
      ],
      [
        /ytplayer.config={args:\s*{/,
        ruleReplace('{0}"dash":"0","dashmpd":"",'),
      ],
      [/"0"\s*?==\s*?\w+\.dash&&/m, ruleReplace("1&&")],
    ],
  },
  {
    contains: ["player.vimeo.com/video/"],
    rxRules: [[/^\{.+\}$/, ruleRewriteVimeoConfig]],
  },
  {
    contains: ["master.json?query_string_ranges=0", "master.json?base64"],
    rxRules: [[/^\{.+\}$/, ruleRewriteVimeoDashManifest]],
  },
  {
    contains: ["facebook.com/", "fbsbx.com/"],
    rxRules: [
      //[/"dash_prefetch_experimental.*"playlist".*?(?=["][,]["]dash)/, ruleRewriteFBDash],
      [/"dash_/, ruleReplace('"__nodash__')],
      [/_dash"/, ruleReplace('__nodash__"')],
      [/_dash_/, ruleReplace("__nodash__")],
      [/"playlist/, ruleReplace('"__playlist__')],
      [
        /"debugNoBatching\s?":(?:false|0)/,
        ruleReplace('"debugNoBatching":true'),
      ],
      [
        /"bulkRouteFetchBatchSize\s?":(?:[^{},]+)/,
        ruleReplace('"bulkRouteFetchBatchSize":1'),
      ],
      [/"maxBatchSize\s?":(?:[^{},]+)/, ruleReplace('"maxBatchSize":1')],
    ],
  },
  {
    contains: ["instagram.com/"],
    rxRules: [
      [
        /"is_dash_eligible":(?:true|1)/,
        ruleReplace('"is_dash_eligible":false'),
      ],
      [
        /"debugNoBatching\s?":(?:false|0)/,
        ruleReplace('"debugNoBatching":true'),
      ],
    ],
  },

  {
    contains: [
      "api.twitter.com/2/",
      "twitter.com/i/api/2/",
      "twitter.com/i/api/graphql/",
      "api.x.com/2/",
      "x.com/i/api/2/",
      "x.com/i/api/graphql/",
    ],
    rxRules: [
      [/"video_info":.*?}]}/, ruleRewriteTwitterVideo('"video_info":')],
    ],
  },

  {
    contains: ["cdn.syndication.twimg.com/tweet-result"],
    rxRules: [
      [/"video":.*?viewCount":\d+}/, ruleRewriteTwitterVideo('"video":')],
    ],
  },

  {
    contains: ["/vqlweb.js"],
    rxRules: [
      [
        /\b\w+\.updatePortSize\(\);this\.updateApplicationSize\(\)(?![*])/gim,
        ruleReplace("/*{0}*/"),
      ],
    ],
  },
];

export const HTML_ONLY_RULES: Rules[] = [
  {
    contains: ["youtube.com", "youtube-nocookie.com"],
    rxRules: [[/[^"]<head.*?>/, ruleDisableMediaSourceTypeSupported()]],
  },
  ...DEFAULT_RULES,
];

// ===========================================================================
function ruleReplace(str: string) {
  return (x: string) => str.replace("{0}", x);
}

// ===========================================================================
function ruleDisableMediaSourceTypeSupported() {
  return (x: string) => `
    ${x}<script>window.MediaSource.isTypeSupported = () => false;</script>
  `;
}

// ===========================================================================
function setMaxBitrate(opts: any) {
  let maxBitrate = MAX_BITRATE;
  const extraOpts = opts.response?.extraOpts;

  if (opts.save) {
    opts.save.maxBitrate = maxBitrate;
  } else if (extraOpts?.maxBitrate) {
    maxBitrate = extraOpts.maxBitrate;
  }

  return maxBitrate;
}

// ===========================================================================
function ruleRewriteTwitterVideo(prefix: string) {
  return (str: string, opts: Record<string, any>) => {
    if (!opts) {
      return str;
    }

    const origString = str;

    try {
      const W_X_H = /([\d]+)x([\d]+)/;

      const maxBitrate = setMaxBitrate(opts);

      str = str.slice(prefix.length);

      const data = JSON.parse(str);

      let bestVariant = null;
      let bestBitrate = 0;

      for (const variant of data.variants) {
        if (
          (variant.content_type && variant.content_type !== "video/mp4") ||
          (variant.type && variant.type !== "video/mp4")
        ) {
          continue;
        }

        if (
          variant.bitrate &&
          variant.bitrate > bestBitrate &&
          variant.bitrate <= maxBitrate
        ) {
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
function ruleRewriteVimeoConfig(str: string) {
  let config;
  try {
    config = JSON.parse(str);
  } catch (e) {
    return str;
  }

  if (config?.request?.files) {
    const files = config.request.files;
    if (typeof files.progressive === "object" && files.progressive.length) {
      if (files.dash) {
        files.__dash = files.dash;
        delete files.dash;
      }
      if (files.hls) {
        files.__hls = files.hls;
        delete files.hls;
      }
      return JSON.stringify(config);
    }
  }

  return str.replace(/query_string_ranges=1/g, "query_string_ranges=0");
}

// ===========================================================================
function ruleRewriteVimeoDashManifest(str: string, opts: Record<string, any>) {
  if (!opts) {
    return str;
  }

  let vimeoManifest: any = null;

  const maxBitrate = setMaxBitrate(opts);

  try {
    vimeoManifest = JSON.parse(str);
    console.log("manifest", vimeoManifest);
  } catch (e) {
    return str;
  }

  function filterByBitrate(
    array: { mime_type: string; bitrate: number }[],
    max: number,
    mime: string,
  ) {
    if (!array) {
      return null;
    }

    let bestVariant: { mime_type: string; bitrate: number } | null = null;
    let bestBitrate = 0;

    for (const variant of array) {
      if (
        variant.mime_type == mime &&
        variant.bitrate > bestBitrate &&
        variant.bitrate <= max
      ) {
        bestBitrate = variant.bitrate;
        bestVariant = variant;
      }
    }

    return bestVariant ? [bestVariant] : array;
  }

  vimeoManifest.video = filterByBitrate(
    vimeoManifest.video,
    maxBitrate,
    "video/mp4",
  );
  vimeoManifest.audio = filterByBitrate(
    vimeoManifest.audio,
    maxBitrate,
    "audio/mp4",
  );

  return JSON.stringify(vimeoManifest);
}

// ===========================================================================
type T = typeof RxRewriter;

// ===========================================================================
export class DomainSpecificRuleSet {
  rwRules: Rules[];
  RewriterCls: T;
  rewriters = new Map();
  defaultRewriter!: RxRewriter;

  constructor(RewriterCls: T, rwRules?: Rules[]) {
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

  getCustomRewriter(url: string) {
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

    return null;
  }

  getRewriter(url: string) {
    return this.getCustomRewriter(url) || this.defaultRewriter;
  }
}
