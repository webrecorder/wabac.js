// ===========================================================================
export class RxRewriter {
    rules;
    rx = null;
    constructor(rules) {
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
    doReplace(match, params, opts) {
        const offset = params[params.length - 2];
        const str = params[params.length - 1];
        for (let i = 0; i < this.rules.length; i++) {
            const curr = params[i];
            if (!curr) {
                continue;
            }
            // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
            // [TODO]
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            const result = this.rules[i][1].call(this, curr, opts, offset, str);
            if (result) {
                return result;
            }
        }
        console.warn(`rx no match found for ${match} - rx rule contains extra matching group?`);
        return match;
    }
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rewrite(text, opts) {
        if (!this.rx) {
            return text;
        }
        return text.replace(this.rx, (match, ...params) => this.doReplace(match, params, opts));
    }
}
//# sourceMappingURL=rxrewriter.js.map