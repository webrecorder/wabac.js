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
  // observer: ResizeObserver | undefined;

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

    // Note: original video element had `video-stream` and `html5-main-video`
    // classes, but the replacement video element will not be
    // positioned correctly if we copy those.
    const newVideo = document.createElement("video");
    newVideo.controls = true;
    newVideo.appendChild(source);
    // The original YouTube player has a fixed width and height,
    // but it seems to be reliable if we instead set it to 100%
    // and let it inherit the size from the parent container.
    newVideo.style.width = "100%";
    newVideo.style.height = "100%";

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
