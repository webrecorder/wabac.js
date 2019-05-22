class Rewriter
{
	constructor(baseUrl, prefix, headInsert) {
		this.baseUrl = baseUrl;
		this.prefix = prefix || "";
		this.headInsert = headInsert || "";

		/** @type {RegExp} */
		this.STYLE_REGEX = /(url\s*\(\s*[\\"']*)([^)'"]+)([\\"']*\s*\))/gi;

		/** @type {RegExp} */
		this.IMPORT_REGEX = /(@import\s*[\\"']*)([^)'";]+)([\\"']*\s*;?)/gi;

		/** @type {RegExp} */
		this.no_wombatRe = /WB_wombat_/g;

		this.DotPostMessageRe = /(.postMessage\s*\()/;
	}

	rewrite(response, requestType) {
		let contentType = response.headers.get("Content-Type") || "";
		contentType = contentType.split(";", 1)[0];

		switch (requestType) {
			case "style":
				return this.rewriteCSS(response);

			case "script":
				return this.rewriteJS(response);
		}

		switch (contentType) {
			case "text/html":
				return this.rewriteHtml(response);
				break;
		}

		return response;
	}

	// URL
	rewriteUrl(url) {
    	var origUrl = url;

    	if (url.startsWith("/") || url.startsWith(".")) {
    		url = new URL(url, this.baseUrl).href;
    	}

    	//console.log(`RW ${origUrl} -> ${prefix + url}`);
    	return this.prefix + url;
    }

    // HTML
    rewriteAttrs(attrs, attrRules) {
		for (let attr of attrs) {
			const mod = attrRules[attr.name];

			if (mod) {
				attr.value = this.rewriteUrl(attr.value);
			}
		}
	}

	rewriteHtml(response) {
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

	    // Replace divs with spans
	    rwStream.on('startTag', startTag => {

	    	const tagRules = rewriteTags[startTag.tagName];

	        if (tagRules) {
	            this.rewriteAttrs(startTag.attrs, tagRules);
	        }

	        if (startTag.tagName == 'head') {
	        	rwStream.emitRaw(this.headInsert);
	        }

	        rwStream.emitStartTag(startTag);
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

		const initOpt = {"status": response.status,
					   	 "statusText": response.statusText,
						 "headers": response.headers
						}

		return new Response(rs, initOpt);
	}

	// CSS
	cssStyleReplacer(match, n1, n2, n3, offset, string) {
  		return n1 + this.rewriteUrl(n2) + n3;
	};

	rewriteCSS(response) {
		return response.text().then((text) => {
		 	return text
	      	.replace(this.STYLE_REGEX, this.cssStyleReplacer.bind(this))
	      	.replace(this.IMPORT_REGEX, this.cssStyleReplacer.bind(this))
	      	.replace(this.no_wombatRe, '');

	     }).then((text) => {

	     	const initOpt = {"status": response.status,
						   	 "statusText": response.statusText,
				 			 "headers": response.headers
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


		text = text.replace(this.DotPostMessageRe, '.__WB_pmw(self.window)$1');

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

	rewriteJS(response) {
		return response.text().then((text) => {
	     	const initOpt = {"status": response.status,
						   	 "statusText": response.statusText,
				 			 "headers": response.headers
			}

			return new Response(this.rewriteJSProxy(text), initOpt);
	    });
	}
}



