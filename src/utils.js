
function startsWithAny(value, iter) {
  for (const str of iter) {
    if (value.startsWith(str)) {
      return true;
    }
  }

  return false;
}

function containsAny(value, iter) {
  for (const str of iter) {
    if (value.indexOf(str) >= 0) {
      return true;
    }
  }

  return false;
}

function getTS(iso) {
  return iso.replace(/[-:T]/g, '').slice(0, 14);
}

function getTSMillis(iso) {
  return iso.replace(/[-:.TZ]/g, '');
}

function tsToDate(ts) {
  if (!ts) {
    return new Date();
  }

  if (ts.length < 17) {
    ts += "00000101000000000".substr(ts.length);
  }

  const datestr = (ts.substring(0, 4) + "-" +
    ts.substring(4, 6) + "-" +
    ts.substring(6, 8) + "T" +
    ts.substring(8, 10) + ":" +
    ts.substring(10, 12) + ":" +
    ts.substring(12, 14) + "." + 
    ts.substring(14) + "Z");

  return new Date(datestr);
};

function tsToSec(ts) {
  return tsToDate(ts).getTime() / 1000;
}

function getSecondsStr(date) {
  if (!date) {
    return "";
  }

  try {
    return "" + parseInt(date.getTime() / 1000);
  } catch (e) {
    return "";
  }
}

function base16(hashBuffer) {
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function digestMessage(message, hashtype) {
  const msgUint8 = typeof(message) === "string" ? new TextEncoder().encode(message) : message;
  const hashBuffer = await crypto.subtle.digest(hashtype, msgUint8);
  return hashtype + ":" + base16(hashBuffer);

}

function makeHeaders(headers) {
  try {
    return new Headers(headers);
  } catch (e) {
    // try to sanitize the headers, if any errors
    for (let key of Object.keys(headers)) {
      const value = headers[key];
      const newValue = value.replace(/[\r\n]+/g, ', ');
      if (value != newValue) {
        headers[key] = newValue;
      }
    }
    return new Headers(headers)
  }
}

const NULL_STATUS = [101, 204, 205, 304];

function isNullBodyStatus(status) {
  return NULL_STATUS.includes(status);
}

function isAjaxRequest(request) {
  return request.headers.get('X-Pywb-Requested-With') === 'XMLHttpRequest';
}


function notFound(request, msg) {
  let content;
  let contentType;

  if (!msg) {
    msg = "Sorry, this url was not found in the archive.";
  }

  if (request.destination === "script" || request.headers.get("x-pywb-requested-with")) {
    content = JSON.stringify(msg);
    contentType = "application/json";
  } else {
    content = msg;
    contentType = "text/html";
  }

  //console.log(`Not Found ${request.destination} - ${msg}`);

  const initOpt = {
    "status": 404,
    "statusText": "Not Found",
    "headers": { "Content-Type": contentType }
  };

  return new Response(content, initOpt);
}


// ===========================================================================
class RangeError
{
  constructor(url, status) {
    this.url = url;
    this.status = status;
  }
}

class AuthNeededError extends RangeError
{

}

class AccessDeniedError extends RangeError
{
  constructor(url, resp) {
    super(url, resp.status);
    this.resp = resp;
  }
}

class Canceled
{

}

function sleep(millis) {
  return new Promise((resolve) => setTimeout(resolve, millis));
}


export { startsWithAny, containsAny, getTS, getTSMillis, tsToDate, tsToSec, getSecondsStr, digestMessage,
         isNullBodyStatus, makeHeaders, notFound, isAjaxRequest, sleep,
         RangeError, AuthNeededError, AccessDeniedError, Canceled };
