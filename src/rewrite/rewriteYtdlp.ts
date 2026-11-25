type WbInfo = {
  timestamp: string;
  url: string;
  prefix: string;
};

type VideoInfo = {
  format: string;
  videoId?: string;
  url: string;
};

type VideoResponse = {
  videos: VideoInfo[];
};

async function sleep(timeout: number) {
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

// Continually waits for `interval` until the passed `predicate`
// function returns true.
async function waitUntil(predicate: () => boolean, interval = 200) {
  while (!predicate()) {
    await sleep(interval);
  }
}

export async function waitUntilElement(
  selector: string,
  timeout = 1000,
  interval = 200,
): Promise<HTMLElement | null> {
  let node: HTMLElement | null = null;
  let stop = false;
  const waitP = waitUntil(() => {
    node = document.querySelector(selector);
    return stop || node !== null;
  }, interval);
  const timeoutP = new Promise((r) =>
    setTimeout(() => {
      stop = true;
      r("TIMEOUT");
    }, timeout),
  );
  await Promise.race([waitP, timeoutP]);
  return node;
}

class RewriteYtdlp {
  prefix: string;
  url: string;
  timestamp: string;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wbinfo = (self as any).__wbinfo as WbInfo;

    this.prefix = wbinfo.prefix;
    this.url = wbinfo.url;
    this.timestamp = wbinfo.timestamp;
  }

  async getVideoinfo(): Promise<VideoResponse | undefined> {
    // videoinfo URL will be missing themeRefresh=1; if we were directed
    // to that version, make sure to delete that param.
    const parsed = new URL(this.url);
    parsed.searchParams.delete("themeRefresh");
    const response = await fetch(
      this.rewriteUrl(`urn:videoinfo:${parsed.toString()}`, "id_"),
    );
    if (!response.ok) {
      return;
    }
    const videoMetadata: VideoResponse = await response.json();
    return videoMetadata;
  }

  async patchVideos() {
    const videoMetadata = await this.getVideoinfo();
    if (!videoMetadata) {
      return;
    }

    for (const video of videoMetadata.videos) {
      const format: string = video.format;
      if (format === "youtube") {
        const videoUrl: string = video.url;
        await this.patchYoutube(videoUrl);
      }
    }
  }

  getWidth(player: HTMLElement, oldVideo: HTMLElement): string {
    const styleWidth = oldVideo.style["width"];
    const elementWidth = player.clientWidth;
    const elementWidthS = `${elementWidth}px`;

    if (!styleWidth) {
      return elementWidthS;
    }

    const styleWidthInt = Number(styleWidth.replace("px", ""));
    if (styleWidthInt > elementWidth) {
      return styleWidth;
    } else {
      return elementWidthS;
    }
  }

  getHeight(player: HTMLElement, oldVideo: HTMLElement): string {
    const styleHeight = oldVideo.style["height"];
    const elementHeight = player.clientHeight;
    const elementHeightS = `${elementHeight}px`;

    if (!styleHeight) {
      return elementHeightS;
    }

    const styleHeightInt = Number(styleHeight.replace("px", ""));
    if (styleHeightInt > elementHeight) {
      return styleHeight;
    } else {
      return elementHeightS;
    }
  }

  async patchYoutube(fuzzyUrl: string) {
    const videoElement = await waitUntilElement("video", 20000);
    if (!videoElement) {
      return;
    }

    if (!(await this.videoSourceExists(fuzzyUrl))) {
      return;
    }

    const source = document.createElement("source");
    source.setAttribute("src", this.rewriteUrl(fuzzyUrl, "oe_"));
    source.setAttribute("type", "video/mp4");

    const newVideo = document.createElement("video");
    newVideo.controls = true;
    newVideo.appendChild(source);

    // Finally, copy the inline style tags - YouTube primarily uses this to
    // control the size of the video.
    for (const key of videoElement.style) {
      // @ts-expect-error
      const value = videoElement.style[key];
      // @ts-expect-error
      newVideo.style[key] = value;
    }

    // And, if necessary, override the width/height with values from the
    // main player element. (Sometimes the style element will have been
    // loaded in with temporary smaller values.)
    const player = document.querySelector("#player") as HTMLElement;
    if (player) {
      newVideo.style.width = this.getWidth(player, videoElement);
      newVideo.style.height = this.getHeight(player, videoElement);
    }

    // Before we replace the video element, make sure to kill the error element
    const error = await waitUntilElement("div.ytp-error", 20000);
    if (error) {
      error.remove();
    }

    videoElement.replaceWith(newVideo);
    await newVideo.play();
  }

  async videoSourceExists(fuzzyUrl: string): Promise<boolean> {
    const resp = await fetch(this.rewriteUrl(fuzzyUrl, "oe_"));
    return resp.ok;
  }

  rewriteUrl(url: string, modifier = ""): string {
    return `${this.prefix}${this.timestamp}${modifier}/${url}`;
  }
}

const rewriter = new RewriteYtdlp();
await rewriter.patchVideos();
