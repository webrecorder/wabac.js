import { type WARCExtraOpts, type ArchiveResponse } from "../response";

export type RwOpts = {
  response?: ArchiveResponse;
  save?: WARCExtraOpts;
  prefix?: string;
  baseUrl?: string;
  isModule?: boolean | null;
  inline?: boolean;
  rewriteUrl?: (x: string) => string;
};

export type Rule = [
  RegExp,
  (x: string, opts: RwOpts, offset: number, str: string) => string,
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doReplace(match: string, params: any[], opts: RwOpts) {
    const offset = params[params.length - 2] as number;
    const str = params[params.length - 1] as string;

    for (let i = 0; i < this.rules!.length; i++) {
      const curr = params[i] as string;
      if (!curr) {
        continue;
      }

      const result = this.rules![i]![1].call(this, curr, opts, offset, str);
      if (result) {
        return result;
      }
    }

    console.warn(
      `rx no match found for ${match} - rx rule contains extra matching group?`,
    );
    return match;
  }

  rewrite(text: string, opts: RwOpts) {
    if (!this.rx) {
      return text;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return text.replace(this.rx, (match, ...params: any[]) =>
      this.doReplace(match, params, opts),
    );
  }
}
