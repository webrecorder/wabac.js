import test, { type ExecutionContext } from "ava";
import { Rewriter } from "../src/rewrite/index";

const rewriteUrl = test.macro({
  exec(
    t: ExecutionContext,
    url: string,
    baseUrl: string,
    prefix: string,
    expected: string,
  ): void {
    t.is(new Rewriter({ baseUrl, prefix }).rewriteUrl(url), expected);
  },

  title(providedTitle = "URL", url, baseUrl, prefix, expected) {
    // [TODO]
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `${providedTitle}: Rewriter(${prefix}${baseUrl}).RW(${url}) => ${expected}`.trim();
  },
});

test(
  rewriteUrl,
  "other.html",
  "http://example.com/path/page.html",
  "https://web.archive.org/web/",
  "other.html",
);

test(
  rewriteUrl,
  "/path/file.js",
  "http://example.com/path/page.html",
  "https://web.archive.org/web/20131010/",
  "/web/20131010/http://example.com/path/file.js",
);

test(
  rewriteUrl,
  "/file.js",
  "http://example.com/",
  "https://localhost/coll/20131010/",
  "/coll/20131010/http://example.com/file.js",
);

test(
  rewriteUrl,
  "file.js",
  "http://example.com",
  "https://localhost/coll/20131010/",
  "file.js",
);

test(
  rewriteUrl,
  "/other.html",
  "http://example.com/path/page.html",
  "http://somehost/coll/20130907*/",
  "/coll/20130907*/http://example.com/other.html",
);

test(
  rewriteUrl,
  "../other.html",
  "http://example.com/path/page.html",
  "http://localhost:80/coll/20131112/",
  "http://localhost:80/coll/20131112/http://example.com/other.html",
);

test(
  rewriteUrl,
  "../../other.html",
  "http://example.com/index.html",
  "localhost:8080/*/",
  "localhost:8080/*/http://example.com/other.html",
);

test(
  rewriteUrl,
  "path/../../other.html",
  "http://example.com/index.html",
  "http://localhost:8080/*/",
  "http://localhost:8080/*/http://example.com/other.html",
);

test(
  rewriteUrl,
  "http://some-other-site.com",
  "http://example.com/index.html",
  "localhost:8080/20101226101112/",
  "localhost:8080/20101226101112/http://some-other-site.com",
);

test(
  rewriteUrl,
  "http://localhost:8080/web/2014/http://some-other-site.com",
  "http://example.com/index.html",
  "http://localhost:8080/web/",
  "http://localhost:8080/web/2014/http://some-other-site.com",
);

test(
  rewriteUrl,
  "/web/http://some-other-site.com",
  "http://example.com/index.html",
  "http://localhost:8080/web/",
  "/web/http://some-other-site.com",
);

test(
  rewriteUrl,
  "http://some-other-site.com",
  "http://example.com/index.html",
  "https://localhost:8080/20101226101112/",
  "https://localhost:8080/20101226101112/http://some-other-site.com",
);

test(
  rewriteUrl,
  "http:\\/\\/some-other-site.com",
  "http://example.com/index.html",
  "https://localhost:8080/20101226101112/",
  "https://localhost:8080/20101226101112/http:\\/\\/some-other-site.com",
);

test(
  rewriteUrl,
  "//some-other-site.com",
  "http://example.com/index.html",
  "http://localhost:8080/20101226101112/",
  "//localhost:8080/20101226101112///some-other-site.com",
);

test(
  rewriteUrl,
  "//some-other-site.com",
  "http://example.com/index.html",
  "https://localhost:8080/20101226101112/",
  "//localhost:8080/20101226101112///some-other-site.com",
);

test(
  rewriteUrl,
  "\\/\\/some-other-site.com",
  "http://example.com/index.html",
  "https://localhost:8080/20101226101112/",
  "//localhost:8080/20101226101112/\\/\\/some-other-site.com",
);

test(
  rewriteUrl,
  "../../other.html",
  "http://example.com/index.html",
  "https://localhost/2020/",
  "https://localhost/2020/http://example.com/other.html",
);

test(
  rewriteUrl,
  "/../../other.html",
  "https://example.com/index.html",
  "http://localhost/2020/",
  "/2020/https://example.com/other.html",
);

test(
  rewriteUrl,
  "",
  "http://example.com/file.html",
  "https://example.com/2020/",
  "",
);

test(
  rewriteUrl,
  "#anchor",
  "http://example.com/path/page.html",
  "https://web.archive.org/web/20131010/",
  "#anchor",
);

test(
  rewriteUrl,
  "mailto:example@example.com",
  "http://example.com/path/page.html",
  "https://web.archive.org/web/2013/",
  "mailto:example@example.com",
);

test(
  rewriteUrl,
  "file:///some/path/",
  "http://example.com/path/page.html",
  "https://web.archive.org/web/",
  "file:///some/path/",
);

//>>> UrlRewriter('19960708im_/http://domain.example.com/path.txt', '/abc/').get_new_url(url='')
//'/abc/19960708im_/'

//>>> UrlRewriter('2013id_/example.com/file/path/blah.html', '/123/').get_new_url(timestamp='20131024')
//'/123/20131024id_/http://example.com/file/path/blah.html'
