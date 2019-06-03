

const STYLE_REGEX = /(url\s*\(\s*[\\"']*)([^)'"]+)([\\"']*\s*\))/gi;

const IMPORT_REGEX = /(@import\s*[\\"']*)([^)'";]+)([\\"']*\s*;?)/gi;

const NO_WOMBAT_REGEX = /WB_wombat_/g;

const DOT_POST_MSG_REGEX = /(.postMessage\s*\()/;

function startsWithAny(value, iter) {
	for (let str of iter) {
		if (value.startsWith(str)) {
			return true;
		}
	}

	return false;
}

const DATA_RW_PROTOCOLS = ["http://", "https://", "//"];


class Rewriter
{
	constructor(baseUrl, prefix, headInsert) {
		this.baseUrl = baseUrl;
		this.prefix = prefix || "";
		this.headInsert = headInsert || "";
	}

	async decodeResponse(response, encoding) {
		if (!encoding) {
			return response;
		}

		const ab = await response.arrayBuffer();

		const inflator = new pako.Inflate();

        inflator.push(ab, true);

        const initOpt = {
        	"status": response.status,
			"statusText": response.statusText,
			"headers": response.headers
		}

        return new Response(inflator.result, initOpt);
	}

	async rewrite(response, requestType, csp) {
		let contentType = response.headers.get("Content-Type") || "";
		contentType = contentType.split(";", 1)[0];

		const encoding = response.headers.get("content-encoding");

		const headers = this.rewriteHeaders(response.headers);

		if (csp) {
			headers.append("Content-Security-Policy", csp);
		}

		switch (requestType) {
			case "style":
				response = await this.decodeResponse(response, encoding);
				return this.rewriteCSS(response, headers);

			case "script":
				response = await this.decodeResponse(response, encoding);
				return this.rewriteJS(response, headers);
		}

		switch (contentType) {
			case "text/html":
				response = await this.decodeResponse(response, encoding);
				return this.rewriteHtml(response, headers);

			case "text/javascript":
			case "application/javascript":
			case "application/x-javascript":
				response = await this.decodeResponse(response, encoding);
				return this.rewriteJS(response, headers);

			case "text/css":
				response = await this.decodeResponse(response, encoding);
				return this.rewriteCSS(response, headers);
		}

		return response;
	}

	// URL
	rewriteUrl(url) {
		var origUrl = url;

		url = url.trim();

		if (!url) {
			return origUrl;
		}

		if (url.startsWith("data:") ||  url.startsWith("blob:") || url.startsWith("about:")) {
			return origUrl;
		}

		if (url.startsWith("http:") || url.startsWith("https:") || url.startsWith("//")) {
			return this.prefix + url;
		}

		if (url.startsWith("/") || url.startsWith(".")) {
			url = new URL(url, this.baseUrl).href;
			return this.prefix + url;
		} else {
			return origUrl;
		}

    	//console.log(`RW ${origUrl} -> ${this.prefix + url}`);

    }

    // HTML
    rewriteMetaContent(attrs, attr) {
    	const equiv = this.getAttr(attrs, "http-equiv");

    	if (equiv === "content-security-policy") {
    		attr.name = "_" + attr.name;
    	} else if (equiv === "refresh") {
    		//todo: refresh
    	} else if (this.getAttr(attrs, "name") === "referrer") {
    		return "no-referrer-when-downgrade";
    	} else if (startsWithAny(attr.value, DATA_RW_PROTOCOLS)) {
    		return this.rewriteUrl(attr.value);
    	}

    	return attr.value;
    }

    rewriteSrcSet(value) {
    	const SRCSET_REGEX = /\s*(\S*\s+[\d\.]+[wx]),|(?:\s*,(?:\s+|(?=https?:)))/;

    	let rv = [];

    	for (let v of value.split(SRCSET_REGEX)) {
    		if (v) {
    			rv.push(this.rewriteUrl(v.trim()));
    		}
    	}

    	return rv.join(", ");
    }


    rewriteAttrs(tag, attrRules) {
    	const isUrl = (val) => { return startsWithAny(val, DATA_RW_PROTOCOLS); }

    	for (let attr of tag.attrs) {
    		const name = attr.name;
    		const value = attr.value;

    		// js attrs
    		if (name.startsWith("on") && value.startsWith("javascript:") && name.slice(2, 3) != "-") {
    			attr.value = "javascript:" + this.rewriteJSProxy(value.slice("javascript:".length));
    		}
    		// css attrs
    		else if (name === "style") {
    			attr.value = this.rewriteCSSText(attr.value);
    		}

    		// background attr
    		else if (name === "background") {
    			attr.value = this.rewriteUrl(value);
    		}

    		else if (name === "srcset") {
    			attr.value = this.rewriteSrcSet(value);
    		}

    		else if (name === "crossorigin" || name === "integrity") {
    			attr.name = "_" + attr.name;
    		}

    		else if (tag.tagName === "meta" && name === "content") {
    			attr.value = this.rewriteMetaContent(tag.attrs, attr);
    		}

    		else if (tag.tagName === "param" && isUrl(value)) {
    			attr.value = this.rewriteUrl(attr.value);
    		} 

    		else if (name.startsWith("data-") && isUrl(value)) {
    			attr.value = this.rewriteUrl(attr.value);
    		}

    		else if (name === "href" || name === "src") {
    			attr.value = this.rewriteUrl(attr.value);
    		}

    		else {
    			if (attrRules[attr.name]) {
    				attr.value = this.rewriteUrl(attr.value);
    			}
    		}
    	}
    }

    getAttr(attrs, name) {
    	for (let attr of attrs) {
    	 	if (attr.name === name) {
    			return attr.value;
    		}
    	}

    	return null;
    }

    rewriteHtml(response, headers) {
    	const defmod = "mp_";

    	const rewriteTags = {
    		'a':       {'href': defmod},
    		'base':    {'href': defmod}, 
    		'applet':  {'codebase': 'oe_',
    		'archive': 'oe_'},
    		'area':    {'href': defmod},
    		'audio':   {'src': 'oe_'},
    		'base':    {'href': defmod},
    		'blockquote': {'cite': defmod},
    		'body':    {'background': 'im_'},
    		'button':  {'formaction': defmod},
    		'command': {'icon': 'im_'},
    		'del':     {'cite': defmod},
    		'embed':   {'src': 'oe_'},
    		'iframe':  {'src': 'if_'},
    		'image':   {'src': 'im_', 'xlink:href': 'im_', 'href': 'im_'},
    		'img':     {'src': 'im_',
    		'srcset': 'im_'},
    		'ins':     {'cite': defmod},
    		'input':   {'src': 'im_',
    		'formaction': defmod},
    		'form':    {'action': defmod},
    		'frame':   {'src': 'fr_'},
    		'link':    {'href': 'oe_'},
    		'meta':    {'content': defmod},
    		'object':  {'codebase': 'oe_',
    		'data': 'oe_'},
    		'param':   {'value': 'oe_'},
    		'q':       {'cite': defmod},
    		'ref':     {'href': 'oe_'},
    		'script':  {'src': 'js_', 'xlink:href': 'js_'},
    		'source':  {'src': 'oe_', 'srcset': 'oe_'},
    		'video':   {'src': 'oe_',
    		'poster': 'im_'},
    	}

    	const rwStream = new RewritingStream();

    	let insertAdded = false;

    	let context = "";

	    // Replace divs with spans
	    rwStream.on('startTag', startTag => {

	    	const tagRules = rewriteTags[startTag.tagName];

	    	this.rewriteAttrs(startTag, tagRules || {});

	    	switch (startTag.tagName) {
	    		case "head":
	    			rwStream.emitRaw(this.headInsert);
	    			insertAdded = true;
	    			break;

	    		case "base":
	    			this.baseUrl = this.getAttr(startTag.attrs, "href");
	    			break;

	    		case "script":
	    		case "style":
	    			if (!startTag.selfClosing) {
	    				context = startTag.tagName;
	    			}
	    			break;

	    	}

	    	rwStream.emitStartTag(startTag);
	    });

	    rwStream.on('endTag', endTag => {
	    	if (endTag.tagName == context) {
	    		context = "";
	    	}
	    	rwStream.emitEndTag(endTag);
	    });

	    rwStream.on('text', (textToken, raw) => {
	    	if (context === "script") {
	    		//textToken.text = this.rewriteJSProxy(textToken.text);
	    		//console.log(raw);
	    		//console.log(textToken.text);
	    		rwStream.emitRaw(this.rewriteJSProxy(textToken.text));
	    	} else if (context === "style") {
	    		//textToken.text = this.rewriteCSSText(textToken.text);
	    		rwStream.emitRaw(this.rewriteCSSText(textToken.text));
	    	} else {
	    		rwStream.emitText(textToken);
	    	}
	    });

	    const buff = new stream.Readable({encoding: 'utf-8'});
	    buff._read = () => {};
	    buff.pipe(rwStream);

	    const reader = response.body.getReader();

	    function pump() {
	    	return reader.read().then(({ done, value }) => {
	          // When no more data needs to be consumed, close the stream

	          if (done) {
	          	//rewriter.close();
	          	buff.push(null);
	          	return;
	          }
	          //console.log(value);

	          // Enqueue the next data chunk into our target stream
	          //rewriter.write(value, 'utf-8');
	          buff.push(value);
	          return pump();
	      });
	    }

	    var encoder = new TextEncoder("utf-8");

	    var rs = new ReadableStream({
	    	start(controller) {
	    		rwStream.on("data", function (chunk) {
	    			controller.enqueue(encoder.encode(chunk));
	    		});

	    		rwStream.on("end", function () {
	    			controller.close();
	    		});

	    		pump();
	    	}
	    });

	    const initOpt = {
	    	"status": response.status,
	    	"statusText": response.statusText,
	    	"headers": headers || response.headers
		};

		return new Response(rs, initOpt);
	}

	// CSS
	cssStyleReplacer(match, n1, n2, n3, offset, string) {
		return n1 + this.rewriteUrl(n2) + n3;
	};

	rewriteCSSText(text) {
		return text
			.replace(STYLE_REGEX, this.cssStyleReplacer.bind(this))
			.replace(IMPORT_REGEX, this.cssStyleReplacer.bind(this))
			.replace(NO_WOMBAT_REGEX, '');
	}

	rewriteCSS(response, headers) {
		return response.text().then((text) => {
			return this.rewriteCSSText(text);

		}).then((text) => {

			const initOpt = {"status": response.status,
			"statusText": response.statusText,
			"headers": headers || response.headers
		}

		return new Response(text, initOpt);

	});
	}

	// JS
	rewriteJSProxy(text) {
		if (!text ||
			text.indexOf('_____WB$wombat$assign$function_____') >= 0 ||
			text.indexOf('<') === 0
			) {
			return text;
	}

	const overrideProps = [
	'window',
	'self',
	'document',
	'location',
	'top',
	'parent',
	'frames',
	'opener'
	];

	let containsProps = false;

	for (let prop of overrideProps) {
		if (text.indexOf(prop) >= 0) {
			containsProps = true;
			break;
		}
	}

	if (!containsProps) return text;


	text = text.replace(DOT_POST_MSG_REGEX, '.__WB_pmw(self.window)$1');

	return (
		'var _____WB$wombat$assign$function_____ = function(name) {return (self._wb_wombat && ' +
		'self._wb_wombat.local_init &&self._wb_wombat.local_init(name)) || self[name]; };\n' +
		'if (!self.__WB_pmw) { self.__WB_pmw = function(obj) { return obj; } }\n{\n' +
		'let window = _____WB$wombat$assign$function_____("window");\n' +
		'let self = _____WB$wombat$assign$function_____("self");\n' +
		'let document = _____WB$wombat$assign$function_____("document");\n' +
		'let location = _____WB$wombat$assign$function_____("location");\n' +
		'let top = _____WB$wombat$assign$function_____("top");\n' +
		'let parent = _____WB$wombat$assign$function_____("parent");\n' +
		'let frames = _____WB$wombat$assign$function_____("frames");\n' +
		'let opener = _____WB$wombat$assign$function_____("opener");\n' +
		text +
		'\n\n}'
		);
}

rewriteJS(response, headers) {
	return response.text().then((text) => {
		const initOpt = {
		"status": response.status,
		"statusText": response.statusText,
		"headers": headers || response.headers
	}

	return new Response(this.rewriteJSProxy(text), initOpt);
});
}

	//Headers
	rewriteHeaders(headers) {
		const headerRules = {
			'access-control-allow-origin': 'prefix-if-url-rewrite',
			'access-control-allow-credentials': 'prefix-if-url-rewrite',
			'access-control-expose-headers': 'prefix-if-url-rewrite',
			'access-control-max-age': 'prefix-if-url-rewrite',
			'access-control-allow-methods': 'prefix-if-url-rewrite',
			'access-control-allow-headers': 'prefix-if-url-rewrite',

			'accept-patch': 'keep',
			'accept-ranges': 'keep',

			'age': 'prefix',

			'allow': 'keep',

			'alt-svc': 'prefix',
			'cache-control': 'prefix',

			'connection': 'prefix',

			'content-base': 'url-rewrite',
			'content-disposition': 'keep',
			'content-encoding': 'prefix-if-content-rewrite',
			'content-language': 'keep',
			'content-length': 'content-length',
			'content-location': 'url-rewrite',
			'content-md5': 'prefix',
			'content-range': 'keep',
			'content-security-policy': 'prefix',
			'content-security-policy-report-only': 'prefix',
			'content-type': 'keep',

			'date': 'keep',

			'etag': 'prefix',
			'expires': 'prefix',

			'last-modified': 'prefix',
			'link': 'keep',
			'location': 'url-rewrite',

			'p3p': 'prefix',
			'pragma': 'prefix',

			'proxy-authenticate': 'keep',

			'public-key-pins': 'prefix',
			'retry-after': 'prefix',
			'server': 'prefix',

			'set-cookie': 'cookie',

			'status': 'prefix',

			'strict-transport-security': 'prefix',

			'trailer': 'prefix',
			'transfer-encoding': 'transfer-encoding',
			'tk': 'prefix',

			'upgrade': 'prefix',
			'upgrade-insecure-requests': 'prefix',

			'vary': 'prefix',

			'via': 'prefix',

			'warning': 'prefix',

			'www-authenticate': 'keep',

			'x-frame-options': 'prefix',
			'x-xss-protection': 'prefix',
		}

		const headerPrefix = 'X-Archive-Orig-';

		let new_headers = new Headers();

		const urlRewrite = true;
		const contentRewrite = true;

		for (let header of headers.entries()) {
			const rule = headerRules[header[0]];

			switch (rule) {
				case "keep":
					new_headers.append(header[0], header[1]);
					break;

				case "url-rewrite":
					if (urlRewrite) {
						new_headers.append(header[0], this.rewriteUrl(header[1]));
					} else {
						new_headers.append(header[0], header[1]);
					}
					break;

				case "prefix-if-content-rewrite":
					if (contentRewrite) {
						new_headers.append(headerPrefix + header[0], header[1]);
					} else {
						new_headers.append(header[0], header[1]);
					}
					break;

				case "prefix-if-url-rewrite":
					if (urlRewrite) {
						new_headers.append(headerPrefix + header[0], header[1]);
					} else {
						new_headers.append(header[0], header[1]);
					}
					break;

				case "content-length":
					if (header[1] == '0') {
						new_headers.append(header[0], header[1]);
						continue;
					}

					if (contentRewrite) {
						try {
							if (parseInt(header[1]) >=0 ) {
								new_headers.append(header[0], header[1]);
								continue;
							}
						} catch(e) {}
					}

					new_headers.append(headerPrefix + header[0], header[1]);
					break;

				case "transfer-encoding":
					//todo: mark as needing decoding?
					new_headers.append(headerPrefix + header[0], header[1]);
					break;

				case "prefix":
					new_headers.append(headerPrefix + header[0], header[1]);
					break;

				case "cookie":
					//todo
					new_headers.append(header[0], header[1]);
					break;

				default:
					new_headers.append(header[0], header[1]);
			}
		}

		return new_headers;
	}
}


module.exports = Rewriter;

