import { type RWOpts } from "../types";
import { type Rule, RxRewriter } from "./rxrewriter";
import * as acorn from "acorn";

const IMPORT_RX = /^\s*?import\s*?[{"'*]/;
const EXPORT_RX = /^\s*?export\s*?({([\s\w,$\n]+?)}[\s;]*|default|class)\s+/m;

const IMPORT_EXPORT_MATCH_RX =
  /(^|;)\s*?(?:im|ex)port(?:['"\s]*(?:[\w*${}\s,]+from\s*)?['"\s]?['"\s])(?:.*?)['"\s]/;

const IMPORT_EXPORT_HTTP_RX =
  /((?:im|ex)port(?:['"\s]*(?:[\w*${}\s,]+from\s*)?['"\s]?['"\s]))((?:https?|[./]).*?)(['"\s])/;

const GLOBAL_OVERRIDES = [
  "window",
  "globalThis",
  "self",
  "document",
  "location",
  "top",
  "parent",
  "frames",
  "opener",
];

const WORKER_GLOBAL_OVERRIDES = ["globalThis", "self", "location"];

const GLOBALS_CONCAT_STR = GLOBAL_OVERRIDES.map(
  (x) => `(?:^|[^$.])\\b${x}\\b(?:$|[^$])`,
).join("|");

const GLOBALS_RX = new RegExp(`(${GLOBALS_CONCAT_STR})`);

// ===========================================================================
const createJSRules: () => Rule[] = () => {
  const thisRw = "_____WB$wombat$check$this$function_____(this)";

  const checkLoc =
    "((self.__WB_check_loc && self.__WB_check_loc(location, arguments)) || {}).maybeHref =  ";

  const evalStr =
    "WB_wombat_runEval2((_______eval_arg, isGlobal) => { var ge = eval; return isGlobal ? ge(_______eval_arg) : eval(_______eval_arg); }).eval(this, (function() { return arguments })(),";

  function isInString(str: string, offset: number) {
    // partial detection when inside a string,
    // check if nearest " are actually \"
    // detects a subset of matches inside longer strings
    let inx = str.lastIndexOf('"', offset);
    if (inx < 0) {
      inx = str.indexOf('"', offset);
    }
    if (inx > 0 && str[inx - 1] === "\\") {
      // last " was a \", so likely inside string, don't rewrite
      return true;
    }
    return false;
  }

  function removeArgsIfStrict(
    target: string,
    opts: RWOpts,
    offset: number,
    fullString: string,
  ) {
    if (opts.isStrict === undefined) {
      // mark as strict if has a class, not 100%, but probably good enough here
      opts.isStrict = fullString.slice(0, offset).indexOf("class ") >= 0;
    }
    if (opts.isStrict) {
      return target.replace("arguments", "[]");
    }
    return target;
  }

  function addPrefix(prefix: string) {
    return (x: string) => prefix + x;
  }

  function replacePrefixFrom(prefix: string, match: string) {
    return (x: string) => {
      const start = x.indexOf(match);
      if (start === 0) {
        return prefix;
      } else {
        return x.slice(0, start) + prefix;
      }
    };
  }

  function addSuffix(suffix: string) {
    return (x: string, opts: RWOpts, offset: number, fullString: string) => {
      if (offset > 0) {
        const prev = fullString[offset - 1];
        if (prev === "." || prev === "$") {
          return x;
        }
      }
      return x + removeArgsIfStrict(suffix, opts, offset, fullString);
    };
  }

  function replaceThis() {
    return (x: string, _opts: RWOpts, offset: number, fullString: string) => {
      if (isInString(fullString, offset)) {
        return x;
      }
      return x.replace("this", thisRw);
    };
  }

  function replace(src: string, target: string) {
    return (x: string) => x.replace(src, target);
  }

  function replaceThisProp() {
    return (x: string, _opts: RWOpts, offset: number, str: string) => {
      const firstChar = str[offset];
      if (firstChar === "\n") {
        return x.replace("this", ";" + thisRw);
      } else if (firstChar !== "." && firstChar !== "$") {
        return x.replace("this", thisRw);
      } else {
        return x;
      }
    };
  }

  function replaceImport(src: string, target: string) {
    return (x: string, opts: RWOpts) => {
      let res = x.replace(src, target);
      // if not module, add empty string, otherwise, import.meta.url
      res += opts.isModule ? "import.meta.url, " : "null, ";
      return res;
    };
  }

  return [
    // rewriting 'eval(...)' - invocation
    [
      /(?<!static|function|})(?:^|\s)\beval\s*\(/,
      replacePrefixFrom(evalStr, "eval"),
    ],

    [/\([\w]+,\s*eval\)\(/, () => " " + evalStr],

    // rewriting 'x = eval' - no invocation
    [/[=]\s*\beval\b(?![(:.$])/, replace("eval", "self.eval")],

    [/var\s+self/, replace("var", "let")],

    // rewriting .postMessage -> __WB_pmw(self).postMessage
    [/\.postMessage\b\(/, addPrefix(".__WB_pmw(self)")],

    // rewriting 'location = ' to custom expression '(...).href =' assignment
    [
      /(?:^|[^$.+*/%^-])\s?\blocation\b\s*[=]\s*(?![\s\d=>])/,
      addSuffix(checkLoc),
    ],

    // rewriting 'return this'
    [/\breturn\s+this\b\s*(?![\s\w.$])/, replaceThis()],

    // rewriting 'this.' special properties access on new line, with ; prepended
    // if prev char is '\n', or if prev is not '.' or '$', no semi
    [
      new RegExp(
        `[^$.]\\s?\\bthis\\b(?=(?:\\.(?:${GLOBAL_OVERRIDES.join("|")})\\b))`,
      ),
      replaceThisProp(),
    ],

    // rewrite '= this' or ', this'
    [/[=,]\s*\bthis\b\s*(?![\s\w:.$])/, replaceThis()],

    // rewrite '})(this)'
    [/\}(?:\s*\))?\s*\(this\)/, replaceThis()],

    // rewrite this in && or || expr?
    [/[^|&][|&]{2}\s*this\b\s*(?![|\s&.$](?:[^|&]|$))/, replaceThis()],

    // ignore 'async import', custom function
    [/async\s+import\s*\(/, (x: string) => x],

    [/[^$.]\bimport\s*\([^)]*\)\s*\{/, (x: string) => x],

    // esm dynamic import, if found, mark as module
    [/[^$.]\bimport\s*\(/, replaceImport("import", "____wb_rewrite_import__")],
  ];
};

// ===========================================================================
const DEFAULT_RULES = createJSRules();

// ===========================================================================
class JSRewriter extends RxRewriter {
  extraRules: Rule[];
  firstBuff: string;
  lastBuff: string;

  constructor(extraRules: Rule[] = []) {
    super();
    this.extraRules = extraRules;

    this.firstBuff = this.initLocalDecl(GLOBAL_OVERRIDES);
    this.lastBuff = "\n\n}";
  }

  initLocalDecl(localDecls: string[]) {
    const assignFunc = "_____WB$wombat$assign$function_____";

    let buffer = `\
var ${assignFunc} = function(name) {return (self._wb_wombat && self._wb_wombat.local_init && self._wb_wombat.local_init(name)) || self[name]; };
if (!self.__WB_pmw) { self.__WB_pmw = function(obj) { this.__WB_source = obj; return this; } }
{
`;

    for (const decl of localDecls) {
      buffer += `let ${decl} = ${assignFunc}("${decl}");\n`;
    }
    buffer += "let arguments;\n";

    return buffer + "\n";
  }

  getModuleDecl(localDecls: string[], prefix: string) {
    return `import { ${localDecls.join(", ")} } from "${prefix}__wb_module_decl.js";\n`;
  }

  detectModuleOrStrict(text: string): "module" | "strict" | "lax" {
    if (text.indexOf("import") >= 0 && text.match(IMPORT_RX)) {
      return "module";
    }

    if (text.indexOf(`"use strict";`) >= 0) {
      return "strict";
    }

    if (text.indexOf("export") >= 0 && text.match(EXPORT_RX)) {
      return "module";
    }

    return "lax";
  }

  parseGlobals(
    text: string,
    overrides: string[],
  ): { names: { name: string; kind: string }[]; letOffsets: number[] } {
    const res = acorn.parse(text, { ecmaVersion: "latest" });

    let hasDocWrite = false;

    const names: { name: string; kind: string }[] = [];

    const excludeOverrides = new Set();

    const letOffsets: number[] = [];
    let lastStart = -1;

    for (const expr of res.body) {
      const { type, start } = expr;
      // Check global variable declarations
      if (type === "VariableDeclaration") {
        const { kind, declarations } = expr;
        for (const decl of declarations) {
          if (decl.id.type === "Identifier") {
            const name = decl.id.name;

            if (overrides.includes(name)) {
              excludeOverrides.add(name);
            } else if (kind === "const" || kind === "let") {
              names.push({ name, kind });
              if (kind === "let") {
                if (lastStart !== start) {
                  letOffsets.unshift(start);
                }
                lastStart = start;
              }
            }
          }
        }
        // Check for class declarations
      } else if (type === "ClassDeclaration") {
        if (expr.id.name) {
          const name = expr.id.name;
          names.push({ name, kind: "const" });
        }
        // Check for document.write() calls
      } else if (!hasDocWrite && type === "ExpressionStatement") {
        const { expression } = expr;
        if (expression.type === "CallExpression") {
          const { callee } = expression;
          if (callee.type === "MemberExpression") {
            const { object, property } = callee;
            if (
              object.type === "Identifier" &&
              object.name === "document" &&
              property.type === "Identifier" &&
              property.name === "write"
            ) {
              hasDocWrite = true;
            }
          }
        }
      }
    }

    if (excludeOverrides.size) {
      const filteredGlobals = GLOBAL_OVERRIDES.filter(
        (x) => !excludeOverrides.has(x),
      );
      this.firstBuff = this.initLocalDecl(filteredGlobals);
    }

    // top-level document.write(), add document.close()
    if (hasDocWrite) {
      this.lastBuff = ";document.close();" + this.lastBuff;
    }

    return { names, letOffsets };
  }

  override rewrite(text: string, opts: RWOpts) {
    if (opts.isModule === undefined) {
      switch (this.detectModuleOrStrict(text)) {
        case "module":
          opts.isModule = true;
          opts.isStrict = true;
          break;

        case "strict":
          opts.isModule = false;
          opts.isStrict = true;
          break;

        default:
          break;
      }
    } else if (opts.isModule) {
      opts.isStrict = true;
    }

    let rules = DEFAULT_RULES;

    if (opts.isModule) {
      rules = [...rules, this.getESMImportRule()];
    }

    if (this.extraRules.length) {
      this.rules = [...rules, ...this.extraRules];
    } else {
      this.rules = rules;
    }

    this.compileRules();

    let newText = super.rewrite(text, opts);

    if (opts.isModule) {
      return (
        this.getModuleDecl(GLOBAL_OVERRIDES, opts.prefix || "") +
        (opts.moduleInsert || "") +
        newText
      );
    }

    const wrapGlobals = !!GLOBALS_RX.exec(text);

    if (opts.inline) {
      newText = newText.replace(/\n/g, " ");
    }

    const isWorker = opts.isWorker;

    if (isWorker) {
      // only do further rewriting if "location" is used in the worker script
      if (text.indexOf("location") === -1) {
        return newText;
      }
    }

    if (wrapGlobals) {
      let firstBuff = this.firstBuff;
      let overrides = GLOBAL_OVERRIDES;

      if (isWorker) {
        firstBuff = `{ const location = self._WB_wombat_location || self.location;\n`;
        overrides = WORKER_GLOBAL_OVERRIDES;
      }
      let preScopeGlobals = "";
      let inScopeGlobals = "";
      let postScopeGlobals = "";
      if (newText) {
        try {
          const { names: globalNames, letOffsets } = this.parseGlobals(
            newText,
            overrides,
          );

          for (const value of letOffsets) {
            // remove "let" at each index
            newText = newText.slice(0, value) + newText.slice(value + 3);
          }

          // set directly on global scope to avoid discrepancies between 'const X' and 'self.X' checks
          for (const { name, kind } of globalNames) {
            if (kind === "const") {
              const varname = `self.___WB_const_${name}`;
              inScopeGlobals += `${varname} = ${name};\n`;
              postScopeGlobals += `${kind} ${name} = ${varname}; delete ${varname};\n`;
            } else if (kind === "let") {
              preScopeGlobals += `let ${name};\n`;
              //newText = newText.replace(new RegExp("let\\s+" + name + "\\b"), name);
            }
          }
          if (inScopeGlobals) {
            inScopeGlobals = "\n;" + inScopeGlobals;
          }
          if (postScopeGlobals) {
            postScopeGlobals = "\n" + postScopeGlobals;
          }
        } catch (_) {
          console.warn(`acorn parsing failed, script len ${newText.length}`);
        }
      }

      newText =
        preScopeGlobals +
        firstBuff +
        newText +
        inScopeGlobals +
        this.lastBuff +
        postScopeGlobals;
      if (opts.inline) {
        newText = newText.replace(/\n/g, " ");
      }
    }

    return newText;
  }

  getESMImportRule(): Rule {
    // mark as module side-effect + rewrite if http[s] url
    function rewriteImport() {
      return (x: string, opts: RWOpts) => {
        const prefix = (opts.prefix || "").replace("mp_/", "esm_/");

        return x.replace(
          IMPORT_EXPORT_HTTP_RX,
          (_, g1: string, g2: string, g3: string) => {
            try {
              g2 = new URL(g2, opts.baseUrl).href;
              g2 = prefix + g2;
            } catch (_) {
              // ignore, keep same url
            }
            return g1 + g2 + g3;
          },
        );
      };
    }

    // match and rewrite import statements
    return [IMPORT_EXPORT_MATCH_RX, rewriteImport()];
  }
}

export { JSRewriter };
