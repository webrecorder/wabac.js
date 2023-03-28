import { RxRewriter } from "./rxrewriter.js";

const IMPORT_RX = /^\s*?import\s*?[{"'*]/;
const EXPORT_RX = /^\s*?export\s*?({([\s\w,$\n]+?)}[\s;]*|default|class)\s+/m;

const IMPORT_MATCH_RX =  /^\s*?import(?:['"\s]*(?:[\w*${}\s,]+from\s*)?['"\s]?['"\s])(?:.*?)['"\s]/;

const IMPORT_HTTP_RX = /(import(?:['"\s]*(?:[\w*${}\s,]+from\s*)?['"\s]?['"\s]))((?:https?|[./]).*?)(['"\s])/;


const GLOBAL_OVERRIDES = [
  "window",
  "globalThis",
  "self",
  "document",
  "location",
  "top",
  "parent",
  "frames",
  "opener"
];

const GLOBALS_CONCAT_STR = GLOBAL_OVERRIDES.map((x) => `(?:^|[^$.])\\b${x}\\b(?:$|[^$])`).join("|");

const GLOBALS_RX = new RegExp(`(${GLOBALS_CONCAT_STR})`);

// ===========================================================================
const createJSRules = () => {

  const thisRw = "_____WB$wombat$check$this$function_____(this)";

  const checkLoc = "((self.__WB_check_loc && self.__WB_check_loc(location, arguments)) || {}).href = ";

  const evalStr = "WB_wombat_runEval2((_______eval_arg, isGlobal) => { var ge = eval; return isGlobal ? ge(_______eval_arg) : eval(_______eval_arg); }).eval(this, (function() { return arguments })(),";

  function addPrefix(prefix) {
    return x => prefix + x;
  }

  function replacePrefixFrom(prefix, match) {
    return (x) => {
      const start = x.indexOf(match);
      if (start === 0) {
        return prefix;
      } else {
        return x.slice(0, start) + prefix;
      }
    };
  }

  function addSuffix(suffix) {
    return (x, _opts, offset, string) => {
      if (offset > 0) {
        const prev = string[offset - 1];
        if (prev === "." || prev === "$") {
          return x;
        }
      }
      return x + suffix;
    };
  }

  function replaceThis() {
    return x => x.replace("this", thisRw);
  }

  function replace(src, target) {
    return x => x.replace(src, target);
  }

  function replaceThisProp() {
    return (x, _opts, offset, string) => {
      const prev = (offset > 0 ? string[offset - 1] : "");
      if (prev === "\n") {
        return x.replace("this", ";" + thisRw);
      } else if (prev !== "." && prev !== "$") {
        return x.replace("this", thisRw);
      } else {
        return x;
      }
    };
  }

  function replaceImport(src, target) {
    return (x, opts) => {
      let res = x.replace(src, target);
      // if not module, add empty string, otherwise, import.meta.url
      res += (opts.isModule ? "import.meta.url, " : "\"\", ");
      return res;
    };
  }

  return [
    // rewriting 'eval(...)' - invocation
    [/(?:^|\s)\beval\s*\(/, replacePrefixFrom(evalStr, "eval")],

    // rewriting 'x = eval' - no invocation
    [/[=]\s*\beval\b(?![(:.$])/, replace("eval", "self.eval")],

    // rewriting .postMessage -> __WB_pmw(self).postMessage
    [/\.postMessage\b\(/, addPrefix(".__WB_pmw(self)")],

    // rewriting 'location = ' to custom expression '(...).href =' assignment
    [/[^$.]?\s?\blocation\b\s*[=]\s*(?![\s=])/, addSuffix(checkLoc)],

    // rewriting 'return this'
    [/\breturn\s+this\b\s*(?![\s\w.$])/, replaceThis()],

    // rewriting 'this.' special properties access on new line, with ; prepended
    // if prev char is '\n', or if prev is not '.' or '$', no semi
    [new RegExp(`[^$.]\\s?\\bthis\\b(?=(?:\\.(?:${GLOBAL_OVERRIDES.join("|")})\\b))`), replaceThisProp()],

    // rewrite '= this' or ', this'
    [/[=,]\s*\bthis\b\s*(?![\s\w:.$])/, replaceThis()],

    // rewrite '})(this)'
    [/\}(?:\s*\))?\s*\(this\)/, replaceThis()],

    // rewrite this in && or || expr?
    [/[^|&][|&]{2}\s*this\b\s*(?![|\s&.$](?:[^|&]|$))/, replaceThis()],

    // esm dynamic import, if found, mark as module
    [/[^$.]\bimport\s*\(/, replaceImport("import", "____wb_rewrite_import__")]
  ];
};

// ===========================================================================
const DEFAULT_RULES = createJSRules();


// ===========================================================================
class JSRewriter extends RxRewriter {
  constructor(extraRules) {
    super();
    this.extraRules = extraRules;

    this.firstBuff = this.initLocalDecl(GLOBAL_OVERRIDES);
    this.lastBuff = "\n\n}";
  }

  initLocalDecl(localDecls) {
    const assignFunc = "_____WB$wombat$assign$function_____";
    
    let buffer = `\
var ${assignFunc} = function(name) {return (self._wb_wombat && self._wb_wombat.local_init && self._wb_wombat.local_init(name)) || self[name]; };
if (!self.__WB_pmw) { self.__WB_pmw = function(obj) { this.__WB_source = obj; return this; } }
{
`;

    for (let decl of localDecls) {
      buffer += `let ${decl} = ${assignFunc}("${decl}");\n`;
    }
    buffer += "let arguments;\n";

    return buffer + "\n";
  }

  getModuleDecl(localDecls, prefix) {
    return `import { ${localDecls.join(", ")} } from "${prefix}__wb_module_decl.js";\n`;
  }

  detectIsModule(text) {
    if (text.indexOf("import") >= 0 && text.match(IMPORT_RX)) {
      return true;
    }

    if (text.indexOf("export") >= 0 && text.match(EXPORT_RX)) {
      return true;
    }

    return false;
  }

  rewrite(text, opts) {
    opts = opts || {};
    if (opts.isModule === undefined || opts.isModule === null) {
      opts.isModule = this.detectIsModule(text, opts);
    }

    let rules = DEFAULT_RULES;

    if (opts.isModule) {
      rules = [...rules, this.getESMImportRule()];
    }

    if (this.extraRules && this.extraRules.length) {
      this.rules = [...rules, ...this.extraRules];
    } else {
      this.rules = rules;
    }

    this.compileRules();

    let newText = super.rewrite(text, opts);

    if (opts.isModule) {
      return this.getModuleDecl(GLOBAL_OVERRIDES, opts.prefix) + newText;
    }

    const wrapGlobals = GLOBALS_RX.exec(text);

    if (wrapGlobals) {
      newText = this.firstBuff + newText + this.lastBuff;
    }

    if (opts && opts.inline) {
      newText = newText.replace(/\n/g, " ") ;
    }

    return newText;
  }

  getESMImportRule() {
    // mark as module side-effect + rewrite if http[s] url
    function rewriteImport() {
      return (x, opts) => {
        const prefix = opts.prefix.replace("mp_/", "esm_/");

        return x.replace(IMPORT_HTTP_RX, (_, g1, g2, g3) => {
          try {
            g2 = new URL(g2, opts.baseUrl).href;
            g2 = prefix + g2;
          } catch (e) {
            // ignore, keep same url
          }
          return g1 + g2 + g3;
        });
      };
    }

    // match and rewrite import statements
    return [IMPORT_MATCH_RX, rewriteImport()];
  }
}

export { JSRewriter };
