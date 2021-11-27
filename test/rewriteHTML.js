"use strict";

import test from "ava";

import { doRewrite } from "./helpers";


// ===========================================================================
async function rewriteHtml(t, content, expected, {useBaseRules = true, url = "", headInsertText} = {}) {
  const rwArgs = {content, contentType: "text/html", useBaseRules};

  if (url) {
    rwArgs.url = url;
  }

  if (headInsertText) {
    rwArgs.headInsertFunc = () => { return headInsertText; };
  }

  let actual = await doRewrite(rwArgs);

  actual = Buffer.from(actual, "latin1").toString("utf8");

  t.is(actual, expected);
}

rewriteHtml.title = (providedTitle = "HTML", input, expected) => `${providedTitle}: ${input} => ${expected}`.trim();


// ===========================================================================


// ===========================================================================
function wrapScript(text) {
  return `\
var _____WB$wombat$assign$function_____ = function(name) {return (self._wb_wombat && self._wb_wombat.local_init && self._wb_wombat.local_init(name)) || self[name]; };
if (!self.__WB_pmw) { self.__WB_pmw = function(obj) { this.__WB_source = obj; return this; } }
{
let window = _____WB$wombat$assign$function_____("window");
let self = _____WB$wombat$assign$function_____("self");
let document = _____WB$wombat$assign$function_____("document");
let location = _____WB$wombat$assign$function_____("location");
let top = _____WB$wombat$assign$function_____("top");
let parent = _____WB$wombat$assign$function_____("parent");
let frames = _____WB$wombat$assign$function_____("frames");
let opener = _____WB$wombat$assign$function_____("opener");
let arguments;
\n` + text + "\n\n}";

}


// ===========================================================================
test(rewriteHtml,
  "<a href=\"https://example.com/some/path\"></a>",
  "<a href=\"http://localhost:8080/prefix/20201226101010/https://example.com/some/path\"></a>");

test(rewriteHtml,
  "<HTML><A Href=\"page.html\">Text</a></hTmL>",
  "<html><a href=\"page.html\">Text</a></html>");

test(rewriteHtml, 
  "<body x=\"y\"><img src=\"../img.gif\"/><br/></body>",
  "<body x=\"y\"><img src=\"http://localhost:8080/prefix/20201226101010/https://example.com/some/img.gif\"/><br/></body>");

test(rewriteHtml, 
  "<table background=\"/img.gif\">",
  "<table background=\"/prefix/20201226101010/https://example.com/img.gif\">");

// Base
test("BASE tag", rewriteHtml,
  "<html><head><base href=\"http://example.com/diff/path/file.html\"/>",
  "<html><head><base href=\"http://localhost:8080/prefix/20201226101010/http://example.com/diff/path/file.html\"/>");

// Full Path Scheme Rel Base
test("BASE tag", rewriteHtml,
  "<base href=\"//example.com\"/><img src=\"/foo.gif\"/>",
  "<base href=\"//localhost:8080/prefix/20201226101010///example.com/\"/><img src=\"/prefix/20201226101010/https://example.com/foo.gif\"/>");

test("BASE tag", rewriteHtml,
  "<html><head><base href=\"/other/file.html\"/>",
  "<html><head><base href=\"/prefix/20201226101010/https://example.com/other/file.html\"/>");

// Rel Base + example
test("BASE tag", rewriteHtml,
  "<html><head><base href=\"/other/file.html\"/><a href=\"/path.html\">",
  "<html><head><base href=\"/prefix/20201226101010/https://example.com/other/file.html\"/><a href=\"/prefix/20201226101010/https://example.com/path.html\">");

test("BASE tag", rewriteHtml,
  "<base href=\"./static/\"/><img src=\"image.gif\"/>",
  "<base href=\"./static/\"/><img src=\"image.gif\"/>");

// Rel Base
test("BASE tag", rewriteHtml,
  "<base href=\"./static/\"/><a href=\"/static/\"/>",
  "<base href=\"./static/\"/><a href=\"/prefix/20201226101010/https://example.com/static/\"/>");

// Ensure trailing slash
test("BASE tag", rewriteHtml,
  "<base href=\"http://example.com\"/>",
  "<base href=\"http://localhost:8080/prefix/20201226101010/http://example.com/\"/>");

test("BASE tag", rewriteHtml,
  "<base href=\"//example.com?foo\"/>",
  "<base href=\"//localhost:8080/prefix/20201226101010///example.com/?foo\"/>");

// Base relative
test("BASE tag", rewriteHtml,
  "<base href=\"static/\"/><img src=\"image.gif\"/>",
  "<base href=\"static/\"/><img src=\"image.gif\"/>");

// Empty url
test("BASE tag", rewriteHtml,
  "<base href=\"\">",
  "<base href=\"\">");

test("BASE tag", rewriteHtml,
  "<base href>",
  "<base href=\"\">");

// href on other tags
test("href=", rewriteHtml,
  "<HTML><div Href=\"page.html\">Text</div></hTmL>",
  "<html><div href=\"page.html\">Text</div></html>");

// HTML Entities
test("HTML Entities", rewriteHtml,
  "<a href=\"\">&rsaquo; &nbsp; &#62; &#63</div>",
  "<a href=\"\">&rsaquo; &nbsp; &#62; &#63</div>");

test("HTML Entities", rewriteHtml,
  "<div>X&Y</div> </div>X&Y;</div>",
  "<div>X&Y</div> </div>X&Y;</div>");

test("HTML Entities", rewriteHtml,
  "<input value=\"&amp;X&amp;&quot;\">X</input>",
  "<input value=\"&amp;X&amp;&quot;\">X</input>");

// don't rewrite hashtags
test("skip hashtag", rewriteHtml,
  "<HTML><A Href=\"#abc\">Text</a></hTmL>",
  "<html><a href=\"#abc\">Text</a></html>");


// diff from pywb: decoded
test("HTML Entities", rewriteHtml,
  "<a href=\"http&#x3a;&#x2f;&#x2f;example.com&#x2f;path&#x2f;\">",
  "<a href=\"http://localhost:8080/prefix/20201226101010/http://example.com/path/\">");

// diff from pywb: no empty attr
test("empty attr", rewriteHtml,
  "<input name=\"foo\" value>",
  "<input name=\"foo\" value=\"\">");

test("unicode", rewriteHtml,
  "<a href=\"http://испытание.испытание/\">испытание</a>",
  "<a href=\"http://localhost:8080/prefix/20201226101010/http://испытание.испытание/\">испытание</a>");

//#<a href="/prefix/20201226101010/http://%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5.%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/">испытание</a>

//#(u'<a href="http://испытание.испытание/">испытание</a>', urlrewriter=urlrewriter_pencode)
//#<a href="/prefix/20201226101010/http://испытание.испытание/">испытание</a>


// diff from pywb: decoded
test("HTML Unescape URL", rewriteHtml,
  "<a href=\"http&#x3a;&#x2f;&#x2f;www&#x2e;example&#x2e;com&#x2f;path&#x2f;file.html\">",
  "<a href=\"http://localhost:8080/prefix/20201226101010/http://www.example.com/path/file.html\">");

// diff from pywb: decoded
test("HTML Unescape URL", rewriteHtml,
  "<a href=\"&#x2f;&#x2f;www&#x2e;example&#x2e;com&#x2f;path&#x2f;file.html\">",
  "<a href=\"//localhost:8080/prefix/20201226101010///www.example.com/path/file.html\">");

// META tag

test("<meta> tag", rewriteHtml,
  "<META http-equiv=\"refresh\" content=\"10; URL=/abc/def.html\">",
  "<meta http-equiv=\"refresh\" content=\"10; URL=/prefix/20201226101010/https://example.com/abc/def.html\">");

test("<meta> tag", rewriteHtml,
  "<meta http-equiv=\"Content-type\" content=\"text/html; charset=utf-8\" />",
  "<meta http-equiv=\"Content-type\" content=\"text/html; charset=utf-8\"/>");

test("<meta> tag", rewriteHtml,
  "<meta http-equiv=\"refresh\" content=\"text/html; charset=utf-8\" />",
  "<meta http-equiv=\"refresh\" content=\"text/html; charset=utf-8\"/>");

test("<meta> tag", rewriteHtml,
  "<META http-equiv=\"refresh\" content>",
  "<meta http-equiv=\"refresh\" content=\"\">");

test("<meta> tag", rewriteHtml,
  "<meta property=\"og:image\" content=\"http://example.com/example.jpg\">",
  "<meta property=\"og:image\" content=\"http://localhost:8080/prefix/20201226101010/http://example.com/example.jpg\">");

test("<meta> tag", rewriteHtml,
  "<meta property=\"og:image\" content=\"example.jpg\">",
  "<meta property=\"og:image\" content=\"example.jpg\">");

test("<meta> tag", rewriteHtml,
  "<meta name=\"referrer\" content=\"origin\">",
  "<meta name=\"referrer\" content=\"no-referrer-when-downgrade\">");

test("<meta> tag", rewriteHtml,
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src http://example.com\"/>",
  "<meta http-equiv=\"Content-Security-Policy\" _content=\"default-src http://example.com\"/>");

test("data attr", rewriteHtml,
  "<div data-url=\"http://example.com/a/b/c.html\" data-some-other-value=\"http://example.com/img.gif\">",
  "<div data-url=\"http://localhost:8080/prefix/20201226101010/http://example.com/a/b/c.html\" data-some-other-value=\"http://localhost:8080/prefix/20201226101010/http://example.com/img.gif\">");

test("param tag", rewriteHtml,
  "<param value=\"http://example.com/\"/>",
  "<param value=\"http://localhost:8080/prefix/20201226101010/http://example.com/\"/>");

test("param tag", rewriteHtml,
  "<param value=\"foo bar\"/>",
  "<param value=\"foo bar\"/>");

// srcset attrib: simple
test("srcset", rewriteHtml,
  "<img srcset=\"http://example.com\">",
  "<img srcset=\"http://localhost:8080/prefix/20201226101010/http://example.com\">");

// srcset attrib: single comma-containing
test("srcset", rewriteHtml,
  "<img srcset=\"http://example.com/123,foo\">",
  "<img srcset=\"http://localhost:8080/prefix/20201226101010/http://example.com/123,foo\">");

// srcset attrib: single comma-containing plus descriptor
test("srcset", rewriteHtml,
  "<img srcset=\"http://example.com/123,foo 2w\">",
  "<img srcset=\"http://localhost:8080/prefix/20201226101010/http://example.com/123,foo 2w\">");

// srcset attrib: comma-containing absolute url and relative url, separated by comma and space
test("srcset", rewriteHtml,
  "<img srcset=\"http://example.com/123,foo, /bar,bar 2w\">",
  "<img srcset=\"http://localhost:8080/prefix/20201226101010/http://example.com/123,foo, /prefix/20201226101010/https://example.com/bar,bar 2w\">");

// srcset attrib: comma-containing relative url and absolute url, separated by comma and space
test("srcset", rewriteHtml,
  "<img srcset=\"/bar,bar 2w, http://example.com/123,foo\">",
  "<img srcset=\"/prefix/20201226101010/https://example.com/bar,bar 2w, http://localhost:8080/prefix/20201226101010/http://example.com/123,foo\">");

// srcset attrib: absolute urls with descriptors, separated by comma (no space)
test("srcset", rewriteHtml,
  "<img srcset=\"http://example.com/123 2w,http://example.com/ 4w\">",
  "<img srcset=\"http://localhost:8080/prefix/20201226101010/http://example.com/123 2w, http://localhost:8080/prefix/20201226101010/http://example.com/ 4w\">");

// srcset attrib: absolute url with descriptor, separated by comma (no space) from absolute url without descriptor
test("srcset", rewriteHtml,
  "<img srcset=\"http://example.com/123 2x,http://example.com/\">",
  "<img srcset=\"http://localhost:8080/prefix/20201226101010/http://example.com/123 2x, http://localhost:8080/prefix/20201226101010/http://example.com/\">");

// srcset attrib: absolute url without descriptor, separated by comma (no space) from absolute url with descriptor
test("srcset", rewriteHtml,
  "<img srcset=\"http://example.com/123,http://example.com/ 2x\">",
  "<img srcset=\"http://localhost:8080/prefix/20201226101010/http://example.com/123, http://localhost:8080/prefix/20201226101010/http://example.com/ 2x\">");

// complex srcset attrib
// diff: enforce scheme-rel
test("srcset", rewriteHtml,
  "<img srcset=\"//example.com/1x,1x 2w, //example1.com/foo 2x, http://example.com/bar,bar 4x\">",
  "<img srcset=\"//localhost:8080/prefix/20201226101010///example.com/1x,1x 2w, //localhost:8080/prefix/20201226101010///example1.com/foo 2x, http://localhost:8080/prefix/20201226101010/http://example.com/bar,bar 4x\">");

// empty srcset attrib
test("srcset", rewriteHtml,
  "<img srcset=\"\">",
  "<img srcset=\"\">");

// SCRIPT Tag
// pywb diff: no script url rewriting!
test("script proxy wrapped", rewriteHtml,
  "<script>window.location = \"http://example.com/a/b/c.html\"</script>",
  `<script>${wrapScript("window.location = \"http://example.com/a/b/c.html\"")}</script>`,
  {useBaseRules: false});

// pywb diff: no script url rewriting!
test("script not wrapped", rewriteHtml,
  "<script>window.location = \"http://example.com/a/b/c.html\"</script>",
  "<script>window.location = \"http://example.com/a/b/c.html\"</script>");

// no rewriting if no props
test("script", rewriteHtml,
  "<script>var foo = \"http://example.com/a/b/c.html\"</script>",
  "<script>var foo = \"http://example.com/a/b/c.html\"</script>");

// SCRIPT tag with json
test("script", rewriteHtml,
  "<script type=\"application/json\">{\"embed top test\": \"http://example.com/a/b/c.html\"}</script>",
  "<script type=\"application/json\">{\"embed top test\": \"http://example.com/a/b/c.html\"}</script>");

// Script tag with super relative src
test("script", rewriteHtml,
  "<script src=\"js/func.js\"></script>",
  "<script src=\"http://localhost:8080/prefix/20201226101010/https://example.com/some/path/js/func.js\" __wb_orig_src=\"js/func.js\"></script>");

test("script", rewriteHtml,
  "<script src=\"https://example.com/some/path/js/func.js\"></script>",
  "<script src=\"http://localhost:8080/prefix/20201226101010/https://example.com/some/path/js/func.js\"></script>");

test("object pdf", rewriteHtml,
  "<object type=\"application/pdf\" data=\"https://example.com/some/file.pdf\">",
  "<iframe type=\"application/pdf\" src=\"https://example.com/some/file.pdf\">");


test("textarea text", rewriteHtml,
  "<textarea>&quot;loadOrderID&#x3d;0&amp;&quot;</textarea>",
  "<textarea>&quot;loadOrderID&#x3d;12&amp;&quot;</textarea>",
  {url: "https://example.com/foo/bar?a=b&:loadOrderID=12&some=param"});

test("textarea text 2", rewriteHtml,
  "<textarea>&quot;loadOrderID&quot;&#x3d;0&amp;&quot;</textarea>",
  "<textarea>&quot;loadOrderID&quot;&#x3d;12&amp;&quot;</textarea>",
  {url: "https://example.com/foo/bar?a=b&:loadOrderID=12&some=param"});

test("head insert with head", rewriteHtml,
  "<html><head></head><body></body></html>",
  "<html><head><!-- head insert --></head><body></body></html>",
  {headInsertText: "<!-- head insert -->"}
);

test("head insert with html", rewriteHtml,
  "<html><body>content</body></html>",
  "<html><!-- head insert --><body>content</body></html>",
  {headInsertText: "<!-- head insert -->"}
);

test("head insert body only", rewriteHtml,
  "<body>content</body>",
  "<!-- head insert --><body>content</body>",
  {headInsertText: "<!-- head insert -->"}
);

test("head insert no tags", rewriteHtml,
  "content",
  "<!-- head insert -->content",
  {headInsertText: "<!-- head insert -->"}
);






/*
# Script tag + crossorigin + integrity
>>> parse('<script src="/js/scripts.js" crossorigin="anonymous" integrity="ABC"></script>')
<script src="/web/20131226101010js_/http://example.com/js/scripts.js" _crossorigin="anonymous" _integrity="ABC"></script>

# Unterminated script tag, handle and auto-terminate
>>> parse('<script>window.location = "http://example.com/a/b/c.html"</sc>')
<script>window.WB_wombat_location = "/web/20131226101010/http://example.com/a/b/c.html"</sc></script>

# SVG Script tag
>>> parse('<script xlink:href="/js/scripts.js"/>')
<script xlink:href="/web/20131226101010js_/http://example.com/js/scripts.js"/>

# SVG Script tag with other elements
>>> parse('<svg><defs><script xlink:href="/js/scripts.js"/><defs/><title>I\'m a title tag in svg!</title></svg>')
<svg><defs><script xlink:href="/web/20131226101010js_/http://example.com/js/scripts.js"/><defs/><title>I'm a title tag in svg!</title></svg>
*/
//>>> parse('<script>/*<![CDATA[*/window.location = "http://example.com/a/b/c.html;/*]]>*/"</script>')
//<script>/*<![CDATA[*/window.WB_wombat_location = "/web/20131226101010/http://example.com/a/b/c.html;/*]]>*/"</script>



