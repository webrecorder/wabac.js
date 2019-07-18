
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
		this.relPrefix = new URL(this.prefix).pathname;
		this.headInsert = headInsert || "";
	}

	async decodeResponse(response, encoding) {
		if (!encoding) {
			return response;
		}

		const ab = await response.arrayBuffer();

		let content = ab;

		if (encoding == "br") {
			content = brotliDecode(new Uint8Array(ab));

		} else {
			const inflator = new pako.Inflate();

	        inflator.push(ab, true);

	        // if error occurs (eg. not gzip), use original arraybuffer
	        content = (inflator.result && !inflator.err) ? inflator.result : ab;
	    }

	    response.headers.set("Content-Length", content.byteLength);

		return this.makeResponse(content, response);
	}

	getRewriteMode(requestType, contentType) {
		switch (requestType) {
			case "style":
				return "css";

			case "script":
				return "js";
		}

		switch (contentType) {
			case "text/html":
				return "html";

			case "text/javascript":
			case "application/javascript":
			case "application/x-javascript":
				return "js";

			case "text/css":
				return "css";
		}

		return null;
	}

	async rewrite(response, requestType, csp) {
		let contentType = response.headers.get("Content-Type") || "";
		contentType = contentType.split(";", 1)[0];


		const rewriteMode = this.getRewriteMode(requestType, contentType);

		const encoding = response.headers.get("content-encoding");

		const headers = this.rewriteHeaders(response.headers, true, rewriteMode !== null);

		if (csp) {
			headers.append("Content-Security-Policy", csp);
		}

		if (rewriteMode || encoding) {
			response = await this.decodeResponse(response, encoding);
		}

		switch (rewriteMode) {
			case "css":
				return this.rewriteCSS(response, headers);

			case "js":
				return this.rewriteScript(response, headers);

			case "html":
				return this.rewriteHtml(response, headers);
		}

		return this.makeResponse(response.body, response, headers);
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

		if (url.startsWith("/")) {
			url = new URL(url, this.baseUrl).href;
			return this.relPrefix + url;
		} else if (url.startsWith(".")) {
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
    			attr.value = "javascript:" + this.rewriteJS(value.slice("javascript:".length), true);
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

            rwStream.emitStartTag(startTag);

	    	switch (startTag.tagName) {
	    		case "head":
	    			rwStream.emitRaw(this.headInsert);
	    			insertAdded = true;
	    			break;

	    		case "base":
	    			const newBase = this.getAttr(startTag.attrs, "href");
	    			if (newBase && newBase.startsWith(this.prefix)) {
	    				this.baseUrl = newBase.slice(this.prefix.length);
	    			}
	    			break;

                case "script":
                    if (startTag.selfClosing) {
                        break;
                    }

                    const scriptType = this.getAttr(startTag.attrs, "type");

                    if (!scriptType || scriptType.indexOf("javascript") >= 0 || scriptType.indexOf("ecmascript") >= 0) {
                        context = startTag.tagName;
                    }
                    break;

	    		case "style":
	    			if (!startTag.selfClosing) {
	    				context = startTag.tagName;
	    			}
	    			break;

	    	}
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
	    		rwStream.emitRaw(this.rewriteJS(textToken.text));
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

	    return this.makeResponse(rs, response, headers);
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

			return this.makeResponse(text, response, headers);
		});
	}

	// JS
	rewriteJS(text, inline) {
		const overrideProps = [
			'window',
			'self',
			'document',
			'location',
			'top',
			'parent',
			'frames',
			'opener',
			'this',
			'eval',
			'postMessage'
		];

		let containsProps = false;

		for (let prop of overrideProps) {
			if (text.indexOf(prop) >= 0) {
				containsProps = true;
				break;
			}
		}

		if (!containsProps) {
			return text;
		}

		return jsRules.rewrite(text, inline);
	}

	rewriteScript(response, headers) {
		return response.text().then((text) => {

			return this.makeResponse(this.rewriteJS(text), response, headers);
		});
	}

	makeResponse(content, response, headers)  {
		const initOpt = {
	    	"status": response.status,
	    	"statusText": response.statusText,
	    	"headers": headers || response.headers
		};

		const timestamp = response.timestamp;
		response = new Response(content, initOpt);
		response.timestamp = timestamp;
		return response;
	}

	//Headers
	rewriteHeaders(headers, urlRewrite, contentRewrite) {
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

					new_headers.append(header[0], header[1]);
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

class JSRewriterRules {
	constructor() {
        this.thisRw = '_____WB$wombat$check$this$function_____(this)';

        const checkLoc = '((self.__WB_check_loc && self.__WB_check_loc(location)) || {}).href = ';

        const localObjs = [
            'window',
            'self',
            'document',
            'location',
            'top',
            'parent',
            'frames',
            'opener'
        ];

        const propStr = localObjs.join('|');

        const evalStr = 'WB_wombat_runEval(function _____evalIsEvil(_______eval_arg$$) { return eval(_______eval_arg$$); }.bind(this)).';


        this.rules = [
            // rewriting 'eval(....)' - invocation
            [/\beval\s*\(/, this.addPrefix(evalStr)],

            // rewriting 'x = eval' - no invocation
            [/\beval\b/, this.addPrefix('WB_wombat_')],

            // rewriting .postMessage -> __WB_pmw(self).postMessage
            [/\.postMessage\b\(/, this.addPrefix('.__WB_pmw(self)')],

            // rewriting 'location = ' to custom expression '(...).href =' assignment
            [/\s*\blocation\b\s*[=]\s*(?![=])/, this.addSuffix(checkLoc)],

            // rewriting 'return this'
            [/\breturn\s+this\b\s*(?![.$])/, this.replaceThis()],

            // rewriting 'this.' special properties access on new line, with ; prepended
            // if prev char is '\n', or if prev is not '.' or '$', no semi
            [new RegExp(`\\s*\\bthis\\b(?=(?:\\.(?:${propStr})\\b))`), this.replaceThisProp()],

            // rewrite '= this' or ', this'
            [/[=,]\s*\bthis\b\s*(?![.$])/, this.replaceThis()],

            // rewrite '})(this)'
            [/\}(?:\s*\))?\s*\(this\)/, this.replaceThis()],

            // rewrite this in && or || expr?
            [/[^|&][|&]{2}\s*this\b\s*(?![|&.$]([^|&]|$))/, this.replaceThis()],
        ];

        this.compileRules();

        this.firstBuff = this.initLocalDecl(localObjs);
        this.lastBuff = '\n\n}';
	}

	compileRules() {
		let rxBuff = '';

		for (let rule of this.rules) {
			if (rxBuff) {
				rxBuff += "|";
			}
			rxBuff += `(${rule[0].source})`;
		}

		const rxString = `(?:${rxBuff})`;

		console.log(rxString);

		this.rx = new RegExp(rxString, 'gm');
	}

	doReplace(params) {
		const offset = params[params.length - 2];
		const string = params[params.length - 1];

		for (let i = 0; i < this.rules.length; i++) {
			const curr = params[i];
			if (!curr) {
				continue;
			}

			// if (this.rules[i].length == 3) {
			// 	const lookbehind = this.rules[i][2];
			// 	const offset = params[params.length - 2];
			// 	const string = params[params.length - 1];

			// 	const len = lookbehind.len || 1;
			// 	const behind = string.slice(offset - len, offset);

			// 	// if lookbehind check does not pass, don't replace!
			// 	if (!behind.match(lookbehind.rx) !== (lookbehind.neg || false)) {
			// 		return curr;
			// 	}
			// }

			const result = this.rules[i][1].call(this, curr, offset, string);
			if (result) {
				return result;
			}
		}
	}

	addPrefix(prefix) {
		return x => prefix + x;
	}

	addSuffix(suffix) {
		return (x, offset, string) => {
			if (offset > 0) {
				const prev = string[offset - 1];
				if (prev === '.' || prev === '$') {
					return x;
				}
			}
			return x + suffix;
		}
	}

	replaceThis() {
		return x => x.replace('this', this.thisRw);
	}

	replaceThisProp() {
		return (x, offset, string) => {
			const prev = (offset > 0 ? string[offset - 1] : "");
			if (prev === '\n') {
				return x.replace('this', ';' + this.thisRw);
			} else if (prev !== '.' && prev !== '$') {
				return x.replace('this', this.thisRw);
			} else {
				return x;
			}
		};
	}

	initLocalDecl(localDecls) {
		const checkThisFunc = '_____WB$wombat$check$this$function_____';

		const assignFunc = '_____WB$wombat$assign$function_____';

		let buffer = `\
var ${checkThisFunc} = function (thisObj) { if (thisObj && thisObj._WB_wombat_obj_proxy) return thisObj._WB_wombat_obj_proxy; return thisObj; };
var ${assignFunc} = function(name) {return (self._wb_wombat && self._wb_wombat.local_init && self._wb_wombat.local_init(name)) || self[name]; };
if (!self.__WB_pmw) { self.__WB_pmw = function(obj) { this.__WB_source = obj; return this; } }
{
`
		for (let decl of localDecls) {
			buffer += `let ${decl} = ${assignFunc}("${decl}");\n`;
		}

		return buffer + '\n';
	}


	rewrite(text, inline) {
		let newText = text.replace(this.rx, (match, ...params) => this.doReplace(params));
		newText = this.firstBuff + newText + this.lastBuff;
		return inline ? newText.replace(/\n/g, " ") : newText;
	}
}

const jsRules = new JSRewriterRules();


module.exports = Rewriter;

