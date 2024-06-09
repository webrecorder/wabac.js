
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

  doReplace(match, params, opts) {
    const offset = params[params.length - 2];
    const string = params[params.length - 1];

    for (let i = 0; i < this.rules.length; i++) {
      const curr = params[i];
      if (!curr) {
        continue;
      }

      const result = this.rules[i][1].call(this, curr, opts, offset, string);
      if (result) {
        return result;
      }
    }
    console.warn(`rx no match found for ${match} - rx rule contains extra matching group?`);
    return match;
  }

  rewrite(text, opts) {
    if (!this.rx) {
      return text;
    }

    return text.replace(this.rx, (match, ...params) => this.doReplace(match, params, opts));
  }
}


export { RxRewriter };
