// Import lit-html
//import {html, render} from 'lit-html';

import { LitElement, html, css } from 'lit-element';
import { styleMap } from 'lit-html/directives/style-map';

import { initSW, waitForReady, digestMessage } from './pageutils';

class EmbedPanel extends LitElement {
  static get properties() {
    return {
      active: { type: Boolean },
      url: { type: String },
      width: { type: String, reflect: true },
      height: { type: String, reflect: true },
      autoSize: { type: Boolean }
    }
  }

  render() {
    const dimensions = { width: this.width, height: this.height };

    return html`
      <iframe style="${styleMap(dimensions)}" class="${this.active ? '' : 'hidden'}" src="${this.url}"></iframe>
    `;
  }

  firstUpdated(props) {
    this.resizeIframe();
  }

  refresh() {
    const iframe = this.shadowRoot.querySelector("iframe");

    if (!iframe) {
      return;
    }

    iframe.contentWindow.location.reload();
  } 

  resizeIframe() {
    if (!this.autoSize) {
      return;
    }

    const iframe = this.shadowRoot.querySelector("iframe");

    if (!iframe) {
      return;
    }

    setInterval(() => {
      //this.width = Math.max(100, iframe.contentDocument.body.scrollWidth) + 'px';
      try {
        if (this.active) {
          this.height = Math.max(100, iframe.contentDocument.body.scrollHeight) + 'px';
        }
      } catch (e) {}
    }, 1000);
  }

  static get styles() {
    return css`
    iframe {
      background-color: aliceblue;
      padding-top: 6px;
      border: 0px;
    }

    .hidden {
      display: none;
    }
    `;
  }
}

class EmbedTab extends LitElement {
  static get properties() {
    return {
      label: { type: String },
      active: { type: Boolean },
    };
  }

  render()  {
    return html`<a class="${this.active ? 'active' : ''}" href="#">${this.label}</a>`;
  }

  static get styles() {
    return css`
    a {
      font-family: "Raleway", "Helvetica Neue", Helvetica, Arial, sans-serif;
      padding: 8px;
      border-top-left-radius: 6px;
      border-top-right-radius: 6px;
      color: black;
      text-decoration: none;
    }

    a.active {
      text-decoration: none;
      font-weight: bold;
      color: black;
      background-color: aliceblue;
      cursor: auto;
    }

    a:hover {
      text-decoration: underline;
    }

    a.active:hover {
      text-decoration: none;
    }
    `;   
  }
}


class EmbedTabs extends LitElement {
  static get properties() {
    return {
      width: { type: String }
    }
  }

  static get styles() {
    return css`
    .tabs {
      background-color: lightblue;
      padding: 12px 0px 6px 0px;
      display: block;
    }
    button {
      padding: 0px 6px;
      margin: 0px 12px 0px 12px;
      max-height: 24px;
      background: transparent;
      border: 0px;
    }
    g {
      fill: #777;
    }

    button:hover g {
      fill: black;
    }
    
    `;
  }

  getIcon() {
    return html`
    <svg width="13px" height="14px" viewBox="0 0 18 19" version="1.1" xmlns="http://www.w3.org/2000/svg">
      <g stroke="none" strokeWidth="1" fill="none" fillRule="evenodd">
        <g transform="translate(-649.000000, -241.000000)" fill="#000000" fillRule="nonzero">
          <g transform="translate(564.000000, 241.000000)">
            <path d="M102.001384,9.0027553 C101.830543,9.04594324 101.658852,9.04233335 101.499849,9 L95,9 C94.4477153,9 94,8.55228475 94,8 C94,7.44771525 94.4477153,7 95,7 L100.327252,7 C99.1926118,4.60747658 96.756695,3.00011926 93.9998807,3.00011926 C93.4144269,3.00011926 92.8392483,3.07177521 92.2829446,3.21198082 C89.1998664,3.98901119 86.9998807,6.7748699 86.9998807,10.0001193 C86.9998807,13.8661125 90.1338875,17.0001193 93.9998807,17.0001193 C97.1457362,17.0001193 99.8806538,14.9063834 100.731623,11.9269037 C100.883296,11.395854 101.436752,11.0883086 101.967802,11.2399816 C102.498851,11.3916547 102.806397,11.9451108 102.654724,12.4761605 C101.560076,16.3088288 98.0446093,19.0001193 93.9998807,19.0001193 C89.029318,19.0001193 84.9998807,14.970682 84.9998807,10.0001193 C84.9998807,5.85317761 87.8276909,2.27229993 91.7941677,1.27262601 C92.5099535,1.092226 93.2492895,1.00011926 93.9998807,1.00011926 C96.7967737,1.00011926 99.3362794,2.28644501 101,4.34100904 L101,1 C101,0.44771525 101.447715,0 102,0 C102.552285,0 103,0.44771525 103,1 L103,9 L102.012041,9 C102.008498,9.00093642 102.004946,9.0018549 102.001384,9.0027553 Z" />
          </g>
        </g>
      </g>
    </svg>
  `;
  }

  render() {
    return html`
      <span class="tabs" style="${styleMap({'max-width': this.width})}">
        <button @click="${this.refresh}">${this.getIcon()}</button>
        <slot name="tab" @click=${this.tabClicked}></slot>
      </span>
      <div class="panels">
        <slot name="panel"></slot>
      </div>
    `;
  }

  refresh() {
    const allPanels = this.querySelectorAll("[slot='panel']");
    for (let panel of allPanels) {
      if (panel.active) {
        panel.refresh();
        break;
      }
    }
  }

  tabClicked(event) {
    const allTabs = this.querySelectorAll("[slot='tab']");

    const allPanels = this.querySelectorAll("[slot='panel']");

    let count = 0;

    for (let tab of allTabs) {
      tab.active = (tab === event.target);
      const panel = allPanels[count++];
      panel.active = (tab === event.target);
    }
    event.preventDefault();
    return false;
  }

  firstUpdated() {
    this.querySelector("[slot='tab']").click();
  }
}

class ArchiveEmbed extends LitElement {
  constructor(props = {}) {
    super();
    const { url, coll, screenshot, live, width, height } = props;

    this.coll = coll;
    this.url = url;

    this.screenshot = screenshot;
    this.live = live;
    this.width = width || "100%";
    this.height = height || "100%";
    this.ready = false;

    this.replayPrefix = (self.swReplayPrefix !== undefined) ? self.swReplayPrefix : "wabac";
  }

  static get properties() {
    return {
      archive: { type: String },
      url: { type: String },
      coll: { type: String },
      ready: { type: Boolean },
      width: { type: String },
      height: { type: String },
      autoSize: { type: Boolean },
      live: { type: Boolean },
      screenshot: { type: Boolean },
    }
  }

  firstUpdated(props) {
    this._registerLoaded();
  }

  async _registerLoaded() {
    if (!navigator.serviceWorker) {
      return;
    }

    if (!this.coll) {
      const digest = await digestMessage(this.url, 'SHA-256');
      this.coll = "emb-" + digest.slice(0, 16);
    }

    this._prefixUrl = window.location.origin;

    if (this.replayPrefix) {
      this._prefixUrl += "/" + this.replayPrefix;
    }

    this._prefixUrl += "/" + this.coll;

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data.msg_type === "collAdded") {
        if (event.data.name === this.coll) {
          this.ready = true;
        }
      }
    });

    const files = [{ "name": this.archive, "url": this.archive }];

    const msg = { "msg_type": "addColl", "name": this.coll, skipExisting: true, files };

    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(msg);
    }
  }

  render() {
    if (!this.ready) {
      return html`Loading Archive, please wait...`;
    }

    const embedUrl = this.url;

    return html`
    <embed-tabs width="${this.width}">
    <embed-tab slot="tab" label="Web Archive"></embed-tab>
    <embed-panel role="webarchive" slot="panel" url="${this._prefixUrl}/mp_/${embedUrl}" width="${this.width}" height="${this.height}" ?autoSize="${this.autoSize}"></embed-panel>
    ${this.screenshot ? html`
      <embed-tab slot="tab" label="Screenshot"></embed-tab>
      <embed-panel role="screenshot" slot="panel" url="${this._prefixUrl}/id_/screenshot:${embedUrl}" width="${this.width}" height="${this.height}" ?autoSize="${this.autoSize}"></embed-panel>
      ` : ''}

    ${this.live ? html`
      <embed-tab slot="tab" label="Live"></embed-tab>
      <embed-panel role="live" slot="panel" url="${this._prefixUrl}/id_/${embedUrl}" width="${this.width}" height="${this.height}" ?autoSize="${this.autoSize}"></embed-panel>
    ` : ''}
    </embed-tabs>
    `;
  }
}

async function embedInit() {
  await waitForReady();

  await initSW(self.swUrl);

  customElements.define('embed-panel', EmbedPanel);
  customElements.define('embed-tab', EmbedTab);
  customElements.define('embed-tabs', EmbedTabs);
  customElements.define('archive-embed', ArchiveEmbed);

  return true;
};

export { ArchiveEmbed, embedInit };

