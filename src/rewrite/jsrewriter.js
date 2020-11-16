import { RxRewriter } from './rxrewriter';


// ===========================================================================
class JSRewriter extends RxRewriter {
  constructor(extraRules) {
    super();

    this.thisRw = '_____WB$wombat$check$this$function_____(this)';

    const checkLoc = '((self.__WB_check_loc && self.__WB_check_loc(location)) || {}).href = ';

    const localObjs = [
      'window',
      'self',
      'document',
      'location',
      'top',
      'parent',
      'frames',
      'opener'
    ];

    const propStr = localObjs.join('|');

    const evalStr = 'WB_wombat_runEval(function _____evalIsEvil(_______eval_arg$$) { return eval(_______eval_arg$$); }.bind(this)).';


    this.rules = [
      // rewriting 'eval(....)' - invocation
      [/[^$,]\beval\s*\(/, this.addPrefixAfter1(evalStr)],

      // rewriting 'x = eval' - no invocation
      [/[^$]\beval\b/, this.addPrefixAfter1('WB_wombat_')],

      // rewriting .postMessage -> __WB_pmw(self).postMessage
      [/\.postMessage\b\(/, this.addPrefix('.__WB_pmw(self)')],

      // rewriting 'location = ' to custom expression '(...).href =' assignment
      [/[^$.]\s*\blocation\b\s*[=]\s*(?![\s=])/, this.addSuffix(checkLoc)],

      // rewriting 'return this'
      [/\breturn\s+this\b\s*(?![\s\w.$])/, this.replaceThis()],

      // rewriting 'this.' special properties access on new line, with ; prepended
      // if prev char is '\n', or if prev is not '.' or '$', no semi
      [new RegExp(`[^$.]\\s*\\bthis\\b(?=(?:\\.(?:${propStr})\\b))`), this.replaceThisProp()],

      // rewrite '= this' or ', this'
      [/[=,]\s*\bthis\b\s*(?![\s\w:.$])/, this.replaceThis()],

      // rewrite '})(this)'
      [/\}(?:\s*\))?\s*\(this\)/, this.replaceThis()],

      // rewrite this in && or || expr?
      [/[^|&][|&]{2}\s*this\b\s*(?![|\s&.$](?:[^|&]|$))/, this.replaceThis()],
    ];

    if (extraRules) {
      this.rules = this.rules.concat(extraRules);
    }

    this.compileRules();

    this.firstBuff = this.initLocalDecl(localObjs);
    this.lastBuff = '\n\n}';
  }

  addPrefix(prefix) {
    return x => prefix + x;
  }

  addPrefixAfter1(prefix) {
    return x => x[0] + prefix + x.slice(1);
  }

  addSuffix(suffix) {
    return (x, offset, string) => {
      if (offset > 0) {
        const prev = string[offset - 1];
        if (prev === '.' || prev === '$') {
          return x;
        }
      }
      return x + suffix;
    }
  }

  replaceThis() {
    return x => x.replace('this', this.thisRw);
  }

  replaceThisProp() {
    return (x, offset, string) => {
      const prev = (offset > 0 ? string[offset - 1] : "");
      if (prev === '\n') {
        return x.replace('this', ';' + this.thisRw);
      } else if (prev !== '.' && prev !== '$') {
        return x.replace('this', this.thisRw);
      } else {
        return x;
      }
    };
  }

  initLocalDecl(localDecls) {
    const assignFunc = '_____WB$wombat$assign$function_____';
    
    let buffer = `\
    var ${assignFunc} = function(name) {return (self._wb_wombat && self._wb_wombat.local_init && self._wb_wombat.local_init(name)) || self[name]; };
    if (!self.__WB_pmw) { self.__WB_pmw = function(obj) { this.__WB_source = obj; return this; } }
    {\
    `;

    for (let decl of localDecls) {
      buffer += `let ${decl} = ${assignFunc}("${decl}");\n`;
    }

    return buffer + '\n';
  }

  rewrite(text, opts) {
    const newText = this.firstBuff + super.rewrite(text, opts) + this.lastBuff;
    return opts && opts.inline ? newText.replace(/\n/g, " ") : newText;
  }
}

export { JSRewriter };
