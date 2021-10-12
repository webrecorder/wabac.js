import { RxRewriter } from "./rxrewriter";

const IMPORT_RX = /^\s*?import\s*?[{"']/;
const EXPORT_RX = /export\s*?({([\s\w,$\n]+?)}[\s;]*|default|class)\s+/;


// ===========================================================================
class JSRewriter extends RxRewriter {
  constructor(extraRules) {
    super();

    const thisRw = "_____WB$wombat$check$this$function_____(this)";

    const checkLoc = "((self.__WB_check_loc && self.__WB_check_loc(location)) || {}).href = ";

    const localObjs = [
      "window",
      "self",
      "document",
      "location",
      "top",
      "parent",
      "frames",
      "opener"
    ];

    const propStr = localObjs.join("|");

    const evalStr = "WB_wombat_runEval(function _____evalIsEvil(_______eval_arg$$) { return eval(_______eval_arg$$); }.bind(this)).";

    function addPrefix(prefix) {
      return x => prefix + x;
    }
  
    function addPrefixAfter1(prefix) {
      return x => x[0] + prefix + x.slice(1);
    }
  
    function addSuffix(suffix) {
      return (x, offset, string) => {
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
      return (x, offset, string) => {
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

    this.rules = [
      // rewriting 'eval(...)' - invocation
      [/(?:^|\s)eval\s*\(/, addPrefixAfter1(evalStr)],

      // rewriting 'x = eval' - no invocation
      [/[=]\s*\beval\b(?![(:.$])/, replace("eval", "self.eval")],

      // rewriting .postMessage -> __WB_pmw(self).postMessage
      [/\.postMessage\b\(/, addPrefix(".__WB_pmw(self)")],

      // rewriting 'location = ' to custom expression '(...).href =' assignment
      [/[^$.]\s?\blocation\b\s*[=]\s*(?![\s=])/, addSuffix(checkLoc)],

      // rewriting 'return this'
      [/\breturn\s+this\b\s*(?![\s\w.$])/, replaceThis()],

      // rewriting 'this.' special properties access on new line, with ; prepended
      // if prev char is '\n', or if prev is not '.' or '$', no semi
      [new RegExp(`[^$.]\\s?\\bthis\\b(?=(?:\\.(?:${propStr})\\b))`), replaceThisProp()],

      // rewrite '= this' or ', this'
      [/[=,]\s*\bthis\b\s*(?![\s\w:.$])/, replaceThis()],

      // rewrite '})(this)'
      [/\}(?:\s*\))?\s*\(this\)/, replaceThis()],

      // rewrite this in && or || expr?
      [/[^|&][|&]{2}\s*this\b\s*(?![|\s&.$](?:[^|&]|$))/, replaceThis()],
    ];

    if (extraRules) {
      this.rules = this.rules.concat(extraRules);
    }

    this.compileRules();

    this.localObjs = localObjs;
    this.firstBuff = this.initLocalDecl(localObjs);
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

    return buffer + "\n";
  }

  getModuleDecl(localDecls, prefix) {
    return `import { ${localDecls.join(", ")} } from "${prefix}__wb_module_decl.js";\n`;
  }

  rewrite(text, opts) {
    let newText;

    if ((text.indexOf("import") >= 0 && text.match(IMPORT_RX)) ||
        (text.indexOf("export") >= 0 && text.match(EXPORT_RX))) {
      newText = this.getModuleDecl(this.localObjs, opts.prefix) + super.rewrite(text, opts);
    } else {
      newText = this.firstBuff + super.rewrite(text, opts) + this.lastBuff;
    }

    return opts && opts.inline ? newText.replace(/\n/g, " ") : newText;
  }
}

export { JSRewriter };
