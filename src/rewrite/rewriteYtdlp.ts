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
      `${this.prefix}/${this.timestamp}/https://urn:videoinfo:${parsed.toString()}`,
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
    source.setAttribute("src", this.rewrittenVideoUrl(fuzzyUrl));
    source.setAttribute("type", "video/mp4");

    const newVideo = document.createElement("video");
    newVideo.appendChild(source);

    // Finally, copy the inline style tags - YouTube primarily uses this to
    // control the size of the video.
    for (const key of videoElement.style) {
      // @ts-expect-error
      const value = videoElement.style[key];
      // @ts-expect-error
      newVideo.style[key] = value;
    }

    // Before we replace the video element, make sure to kill the error element
    const error = await waitUntilElement("div.ytp-error", 20000);
    if (error) {
      error.remove();
    }

    videoElement.replaceWith(newVideo);
    await newVideo.play();
  }

  rewrittenVideoUrl(fuzzyUrl: string): string {
    return `${this.prefix}/${this.timestamp}/${fuzzyUrl}`;
  }

  async videoSourceExists(fuzzyUrl: string): Promise<boolean> {
    const resp = await fetch(`/${this.prefix}/${this.timestamp}/${fuzzyUrl}`);
    return resp.status === 200;
  }
}

const rewriter = new RewriteYtdlp();
await rewriter.patchVideos();
