import test from 'ava';

import { doRewrite } from './helpers';


// ===========================================================================
async function rewriteJS(t, content, expected, useBaseRules = false) {
  const actual = await doRewrite({content, contentType: "application/javascript", useBaseRules});

  if (!expected) {
    expected = content;
  }

  t.is(actual, wrapScript(expected));
}

rewriteJS.title = (providedTitle = 'HTML', input, expected) => `${providedTitle}: ${input} => ${expected}`.trim();


function wrapScript(text) {
return `\
    var _____WB$wombat$assign$function_____ = function(name) {return (self._wb_wombat && self._wb_wombat.local_init && self._wb_wombat.local_init(name)) || self[name]; };
    if (!self.__WB_pmw) { self.__WB_pmw = function(obj) { this.__WB_source = obj; return this; } }
    {    let window = _____WB$wombat$assign$function_____("window");
let self = _____WB$wombat$assign$function_____("self");
let document = _____WB$wombat$assign$function_____("document");
let location = _____WB$wombat$assign$function_____("location");
let top = _____WB$wombat$assign$function_____("top");
let parent = _____WB$wombat$assign$function_____("parent");
let frames = _____WB$wombat$assign$function_____("frames");
let opener = _____WB$wombat$assign$function_____("opener");
\n` + text + `\n\n}`;

}

// Rewritten
test(rewriteJS,
     "a = this;",
     "a = _____WB$wombat$check$this$function_____(this);");

test(rewriteJS,
     "return this.location",
     "return _____WB$wombat$check$this$function_____(this).location");

test(rewriteJS,
    'func(Function("return this"));',
    'func(Function("return _____WB$wombat$check$this$function_____(this)"));');

test(rewriteJS,
    "'a||this||that",
    "'a||_____WB$wombat$check$this$function_____(this)||that");

test(rewriteJS,
    "(a,b,Q.contains(i[t], this))",
    "(a,b,Q.contains(i[t], _____WB$wombat$check$this$function_____(this)))");

test(rewriteJS,
    "this. location = http://example.com/",
    "this. location = ((self.__WB_check_loc && self.__WB_check_loc(location)) || {}).href = http://example.com/");

test(rewriteJS,
    " eval(a)",
    " WB_wombat_runEval(function _____evalIsEvil(_______eval_arg$$) { return eval(_______eval_arg$$); }.bind(this)).eval(a)");

test(rewriteJS,
    "x = eval; x(a);",
    "x = WB_wombat_eval; x(a);");

test(rewriteJS,
    "window.eval(a)",
    "window.WB_wombat_runEval(function _____evalIsEvil(_______eval_arg$$) { return eval(_______eval_arg$$); }.bind(this)).eval(a)");

// Not Rewritten
test(rewriteJS, "return this.abc");

test(rewriteJS, "return this object");

test(rewriteJS, "a = 'some, this object'");

test(rewriteJS, "{foo: bar, this: other}");

test(rewriteJS, "this.$location = http://example.com/");

test(rewriteJS, "this.  $location = http://example.com/");

test(rewriteJS, "this. _location = http://example.com/");

test(rewriteJS, "this. alocation = http://example.com/");

test(rewriteJS, "this.location = http://example.com/");

test(rewriteJS, "this.$eval(a)");

test(rewriteJS, "x = $eval; x(a);");
