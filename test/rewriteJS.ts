import test from "ava";

import { doRewrite } from "./helpers/index.js";

// ===========================================================================
const rewriteJS = test.macro({
  async exec(
    t,
    content: string,
    expected: string,
    useBaseRules: boolean | undefined = false,
    url: string | undefined = "https://example.com/some/path/index.html",
  ): Promise<void> {
    const { text: actual } = await doRewrite({
      content,
      contentType: "application/javascript",
      useBaseRules,
      url,
    });

    if (!expected) {
      expected = content;
    }

    t.is(actual, expected);
  },

  title(providedTitle = "JS", input: string /*, expected*/) {
    return `${providedTitle}: ${input.replace(/\n/g, "\\n")}`.trim();
  },
});

// ===========================================================================
const rewriteJSWrapped = test.macro({
  async exec(
    t,
    content: string,
    expected: string,
    useBaseRules: boolean | undefined = false,
  ) {
    const { text: actual } = await doRewrite({
      content,
      contentType: "application/javascript",
      useBaseRules,
    });

    if (!expected) {
      expected = content;
    }

    t.is(actual, wrapScript(expected));
  },

  title(providedTitle = "JS Wrapped Globals", input: string /*, expected*/) {
    return `${providedTitle}: ${input.replace(/\n/g, "\\n")}`.trim();
  },
});

// ===========================================================================
const rewriteJSImport = test.macro({
  async exec(
    t,
    content: string,
    expected: string,
    useBaseRules: boolean | undefined = false,
  ) {
    const { text: actual } = await doRewrite({
      content,
      contentType: "application/javascript",
      useBaseRules,
    });

    if (!expected) {
      expected = content;
    }

    t.is(actual, wrapImport(expected));
  },

  title(providedTitle = "JS Module", input: string /*, expected*/) {
    return `${providedTitle}: ${input.replace(/\n/g, "\\n")}`.trim();
  },
});

function wrapScript(text: string) {
  return (
    `\
var _____WB$wombat$assign$function_____ = function(name) {return (self._wb_wombat && self._wb_wombat.local_init && self._wb_wombat.local_init(name)) || self[name]; };
if (!self.__WB_pmw) { self.__WB_pmw = function(obj) { this.__WB_source = obj; return this; } }
{
let window = _____WB$wombat$assign$function_____("window");
let globalThis = _____WB$wombat$assign$function_____("globalThis");
let self = _____WB$wombat$assign$function_____("self");
let document = _____WB$wombat$assign$function_____("document");
let location = _____WB$wombat$assign$function_____("location");
let top = _____WB$wombat$assign$function_____("top");
let parent = _____WB$wombat$assign$function_____("parent");
let frames = _____WB$wombat$assign$function_____("frames");
let opener = _____WB$wombat$assign$function_____("opener");
let arguments;
\n` +
    text +
    "\n\n}"
  );
}

function wrapImport(text: string) {
  return `\
import { window, globalThis, self, document, location, top, parent, frames, opener } from "http://localhost:8080/prefix/20201226101010mp_/__wb_module_decl.js";
${text}`;
}

// Rewritten
test(
  rewriteJS,
  "a = this;",
  "a = _____WB$wombat$check$this$function_____(this);",
);

// rewrite on ds-specific path that's not json
test(
  rewriteJS,
  "b = this;",
  "b = _____WB$wombat$check$this$function_____(this);",
  false,
  "https://player.vimeo.com/video/some/path.html",
);

test(
  rewriteJS,
  `a = 5

this.location = x;`,
  `a = 5

;_____WB$wombat$check$this$function_____(this).location = x;`,
);

test(
  rewriteJS,
  `a = 5

(this.location = x);`,
  `a = 5

(_____WB$wombat$check$this$function_____(this).location = x);`,
);

test(
  rewriteJS,
  "return this.location",
  "return _____WB$wombat$check$this$function_____(this).location",
);

test(
  rewriteJS,
  'func(Function("return this"));',
  'func(Function("return _____WB$wombat$check$this$function_____(this)"));',
);

test(
  rewriteJS,
  "'a||this||that",
  "'a||_____WB$wombat$check$this$function_____(this)||that",
);

test(
  rewriteJS,
  "(a,b,Q.contains(i[t], this))",
  "(a,b,Q.contains(i[t], _____WB$wombat$check$this$function_____(this)))",
);

test(rewriteJS, `const a = "{\\"some data\\": \\"foo = this\\"};"`, "");

test(
  rewriteJSWrapped,
  "location = http://example.com/",
  "location = ((self.__WB_check_loc && self.__WB_check_loc(location, arguments)) || {}).href = http://example.com/",
);

// acorn fails here, but is ignorable
test(
  rewriteJSWrapped,
  " location = http://example.com/2",
  " location = ((self.__WB_check_loc && self.__WB_check_loc(location, arguments)) || {}).href = http://example.com/2",
);

test(
  rewriteJS,
  " eval(a)",
  " WB_wombat_runEval2((_______eval_arg, isGlobal) => { var ge = eval; return isGlobal ? ge(_______eval_arg) : eval(_______eval_arg); }).eval(this, (function() { return arguments })(),a)",
);

test(rewriteJS, "x = eval; x(a);", "x = self.eval; x(a);");

test(
  rewriteJS,
  "a = this.location.href; exports.Foo = Foo; /* export className */",
  "a = _____WB$wombat$check$this$function_____(this).location.href; exports.Foo = Foo; /* export className */",
);

test(rewriteJS, "$eval = eval; $eval(a);", "$eval = self.eval; $eval(a);");

test(
  rewriteJS,
  "foo(a, eval(data));",
  "foo(a, WB_wombat_runEval2((_______eval_arg, isGlobal) => { var ge = eval; return isGlobal ? ge(_______eval_arg) : eval(_______eval_arg); }).eval(this, (function() { return arguments })(),data));",
);

test(
  rewriteJS,
  "return(1, eval)(data);",
  "return WB_wombat_runEval2((_______eval_arg, isGlobal) => { var ge = eval; return isGlobal ? ge(_______eval_arg) : eval(_______eval_arg); }).eval(this, (function() { return arguments })(),data);",
);

test(
  rewriteJS,
  "somewindow.postMessage({'a': 'b'})",
  "somewindow.__WB_pmw(self).postMessage({'a': 'b'})",
);

// add global injection
test(
  rewriteJSWrapped,
  "let a = document.location.href; var b = 5; const foo = 4;",
  "let a = document.location.href; var b = 5; const foo = 4;\nself.a = a;\nself.foo = foo;",
);

// import rewrite
test(
  rewriteJSImport,
  `\

import "foo";

a = this.location`,

  `\

import "foo";

a = _____WB$wombat$check$this$function_____(this).location\
`,
);

// dynamic import rewrite (non-module)
test(
  rewriteJS,
  "await import (somefile);",
  "await ____wb_rewrite_import__ (null, somefile);",
);

// dynamic import rewrite (non-module)
test(
  rewriteJS,
  `\
class X {
  import(a, b, c) {
    await import (somefile);
  }
}`,
  `\
class X {
  import(a, b, c) {
    await ____wb_rewrite_import__ (null, somefile);
  }
}`,
);

// import/export module rewrite
test(
  rewriteJSImport,
  `\
a = this.location

export { a };
`,

  `\
a = _____WB$wombat$check$this$function_____(this).location

export { a };
`,
);

// rewrite ESM module import
test(
  rewriteJSImport,
  'import "https://example.com/file.js"',
  'import "http://localhost:8080/prefix/20201226101010esm_/https://example.com/file.js"',
);

test(
  rewriteJSImport,
  `
import {A, B}
 from
 "https://example.com/file.js"`,
  `
import {A, B}
 from
 "http://localhost:8080/prefix/20201226101010esm_/https://example.com/file.js"`,
);

test(
  rewriteJSImport,
  `
import * from "https://example.com/file.js"
import A from "http://example.com/path/file2.js";

import {C, D} from "./abc.js";
import {X, Y} from "../parent.js";
import {E, F, G} from "/path.js";
import { Z } from "../../../path.js";

B = await import(somefile);
`,
  `
import * from "http://localhost:8080/prefix/20201226101010esm_/https://example.com/file.js"
import A from "http://localhost:8080/prefix/20201226101010esm_/http://example.com/path/file2.js";

import {C, D} from "http://localhost:8080/prefix/20201226101010esm_/https://example.com/some/path/abc.js";
import {X, Y} from "http://localhost:8080/prefix/20201226101010esm_/https://example.com/some/parent.js";
import {E, F, G} from "http://localhost:8080/prefix/20201226101010esm_/https://example.com/path.js";
import { Z } from "http://localhost:8080/prefix/20201226101010esm_/https://example.com/path.js";

B = await ____wb_rewrite_import__(import.meta.url, somefile);
`,
);

// Not Rewritten
test(
  rewriteJS,
  `\
(function() { return "export class foo"; })
`,
  "",
);

test(rewriteJS, "return this.abc", "");

test(rewriteJS, "return this object", "");

test(rewriteJS, "a = 'some, this object'", "");

test(rewriteJS, "{foo: bar, this: other}", "");

test(rewriteJS, "this.$location = http://example.com/", "");

test(rewriteJS, "this.  $location = http://example.com/", "");

test(rewriteJS, "this. _location = http://example.com/", "");

test(rewriteJS, "this. alocation = http://example.com/", "");

test(rewriteJS, "this.location = http://example.com/", "");

test(rewriteJS, ",eval(a)", "");

test(rewriteJS, "this.$eval(a)", "");

test(rewriteJS, "x = $eval; x(a);", "");

test(rewriteJSWrapped, "window.eval(a)", "");

test(rewriteJSWrapped, "x = window.eval; x(a);", "");

test(rewriteJSWrapped, "this. location = 'http://example.com/'", "");

test(rewriteJSWrapped, "abc-location = http://example.com/", "");

test(rewriteJSWrapped, "func(location = 0)", "");

test(rewriteJS, "obj = { eval : 1 }", "");

test(rewriteJS, "x = obj.eval", "");

test(rewriteJS, "x = obj.eval(a)", "");

test(rewriteJS, "x = obj._eval(a)", "");

test(rewriteJS, "x = obj.$eval(a)", "");

test(rewriteJSWrapped, "if (self.foo) { console.log('blah') }", "");

test(rewriteJS, "if (a.self.foo) { console.log('blah') }", "");

test(rewriteJSWrapped, "window.x = 5", "");

test(rewriteJS, "a.window.x = 5", "");

test(rewriteJS, "  postMessage({'a': 'b'})", "");

test(rewriteJS, "simport(5);", "");

test(rewriteJS, "a.import(5);", "");

test(rewriteJS, "$import(5);", "");

test(rewriteJS, " import() {", "");

test(rewriteJS, " import(a, b, c) {", "");

test(rewriteJS, "async import(val) { ... }", "");

test(
  rewriteJSImport,
  '\
import"import.js";import{A, B, C} from"test.js";(function() => { frames[0].href = "/abc"; })',
  "",
);

test(
  rewriteJS,
  `
function blah() {
  const text = "text: import a from B.js";
}
`,
  "",
);

test(
  rewriteJS,
  `
function blah() {
  const text = \`
import a from "https://example.com/B.js"
\`;
}

`,
  "",
);

test(
  rewriteJSImport,
  `\
a = location

export{ a, $ as b };
`,
  "",
);

// no wrap, no global injection
test(rewriteJS, "let a = 7; var b = 5; const foo = 4;\n\n", "");
