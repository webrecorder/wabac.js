export type Rule = [
  RegExp,
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (x: string, opts: Record<string, any>, offset: number, str: string) => string,
];

// ===========================================================================
export class RxRewriter {
  rules: Rule[] | null;
  rx: RegExp | null = null;

  constructor(rules?: Rule[]) {
    this.rules = rules || null;
    if (this.rules) {
      this.compileRules();
    }
  }

  compileRules() {
    let rxBuff = "";

    if (!this.rules) {
      return;
    }

    for (const rule of this.rules) {
      if (rxBuff) {
        rxBuff += "|";
      }
      rxBuff += `(${rule[0].source})`;
    }

    const rxString = `(?:${rxBuff})`;

    this.rx = new RegExp(rxString, "gm");
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doReplace(match: string, params: any[], opts: Record<string, any>) {
    const offset = params[params.length - 2];
    const str = params[params.length - 1];

    for (let i = 0; i < this.rules!.length; i++) {
      const curr = params[i];
      if (!curr) {
        continue;
      }

      // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
      // [TODO]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const result = this.rules![i][1].call(this, curr, opts, offset, str);
      if (result) {
        return result;
      }
    }

    console.warn(
      `rx no match found for ${match} - rx rule contains extra matching group?`,
    );
    return match;
  }

  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rewrite(text: string, opts: Record<string, any>) {
    if (!this.rx) {
      return text;
    }

    return text.replace(this.rx, (match, ...params) =>
      this.doReplace(match, params, opts),
    );
  }
}
