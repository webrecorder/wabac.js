
// ===========================================================================
class RxRewriter
{
  constructor(rules) {
    this.rules = rules || null;
    if (this.rules) {
      this.compileRules();
    } else {
      this.rx = null;
    }
  }

  compileRules() {
    let rxBuff = "";

    for (let rule of this.rules) {
      if (rxBuff) {
        rxBuff += "|";
      }
      rxBuff += `(${rule[0].source})`;
    }

    const rxString = `(?:${rxBuff})`;

    this.rx = new RegExp(rxString, "gm");
  }

  doReplace(params, opts) {
    const offset = params[params.length - 2];
    const string = params[params.length - 1];

    for (let i = 0; i < this.rules.length; i++) {
      const curr = params[i];
      if (!curr) {
        continue;
      }

      const result = this.rules[i][1].call(this, curr, offset, string, opts);
      if (result) {
        return result;
      }
    }
  }

  rewrite(text, opts) {
    if (!this.rx) {
      return text;
    }

    return text.replace(this.rx, (match, ...params) => this.doReplace(params, opts));
  }
}


export { RxRewriter };
