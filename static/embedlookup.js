document.addEventListener("DOMContentLoaded", initTemplates);

async function initTemplates() {
    let templates = document.querySelectorAll("template[data-archive-name][data-archive-file]");
    
    for (let template of templates) {
      const filename = template.getAttribute("data-archive-file");
      const name = template.getAttribute("data-archive-name");

      const width = template.getAttribute("data-width") || "auto";
      const height = template.getAttribute("data-height") || "auto";

      const text = template.innerHTML;

      const replayOrigin = template.getAttribute("data-replay-origin") || "http://localhost:9990/";

      const digest = await digestMessage(text, 'SHA-256');

      const insertHTML = `
  <span style="background-color: lightblue; padding: 8px;">
  <button class="archived">Archived</button>
  <button class="live">Live</button>
  <span style="font-style: italic" class="status"></span>
  </span>
  <div style="background-color: aliceblue; padding-top: 4px;" class="embed-archived-container">
    <iframe src="${replayOrigin}?coll_${name}=${filename}&url=/${name}/mp_/blob:${digest}" data-archive="${name}"
    style="width: ${width}; height: ${height}; border: 0px"></iframe>
  </div>
  <div style="background-color: aliceblue; padding-top: 4px;" class="embed-live-container">
  </div>
      `;

      const div = document.createElement("div");
      div.innerHTML = insertHTML;

      template.insertAdjacentElement('beforebegin', div);

      const iframe = div.querySelector("iframe");
      const status = div.querySelector("span.status");

      const live = div.querySelector("div.embed-live-container");
      const archived = div.querySelector("div.embed-archived-container");

      //const liveNode = document.importNode(template, true);
      live.appendChild(template.content);

      const btnLive = div.querySelector("button.live");
      const btnArchived = div.querySelector("button.archived");

      btnArchived.addEventListener("click", () => {
        live.style.display = "none";
        archived.style.display = "";
        status.innerText = iframe.getAttribute("data-ts");
      });

      btnLive.addEventListener("click", () => {
        live.style.display = "";
        archived.style.display = "none";
        status.innerText = "Live";
      });
    }

    window.addEventListener("message", (event) => {
      const iframes = document.querySelectorAll("iframe[data-archive]");

      for (var iframe of iframes) {
        if (iframe.src.indexOf(event.data.url) > 0) {
          iframe.setAttribute("data-ts", "Archived On: " + tsToDate(event.data.ts));
          iframe.parentElement.parentElement.querySelector("button.archived").click();
        }
      }
    });
};


async function digestMessage(message, hashtype) {
  const msgUint8 = new TextEncoder().encode(message);                           // encode as (utf-8) Uint8Array
  const hashBuffer = await crypto.subtle.digest(hashtype, msgUint8);           // hash the message
  const hashArray = Array.from(new Uint8Array(hashBuffer));                     // convert buffer to byte array
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
  return hashHex;
}

function tsToDate(ts) {
  if (!ts) {
    return "";
  }

  if (ts.length < 14) {
    ts += "00000000000000".substr(ts.length);
  }

  const datestr = (ts.substring(0, 4) + "-" +
    ts.substring(4, 6) + "-" +
    ts.substring(6, 8) + "T" +
    ts.substring(8, 10) + ":" +
    ts.substring(10, 12) + ":" +
    ts.substring(12, 14) + "-00:00");

  return new Date(datestr);
};
