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

export function isYoutubeVideo(url: string) {
  return isYoutubeShort(url) || isYoutubeWatchPage(url);
}

export function isYoutubeShort(url: string) {
  const parsed = new URL(url);
  if (
    parsed.host.match(/(www.)?youtu.be/) &&
    parsed.pathname.startsWith("/shorts/")
  ) {
    return true;
  }
  return false;
}

export function isYoutubeWatchPage(url: string) {
  const parsed = new URL(url);
  if (parsed.host.match(/(www.)?youtu.be/)) {
    return true;
  }
  if (parsed.host.match(/(www.)?(youtube.com|youtube-nocookie.com)/)) {
    return (
      parsed.pathname === "/watch" || parsed.pathname.startsWith("/shorts")
    );
  }
  return false;
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

function rewrittenVideoUrl(
  prefix: string,
  timestamp: string,
  fuzzyUrl: string,
): string {
  return `${prefix}/${timestamp}/${fuzzyUrl}`;
}

async function videoSourceExists(
  timestamp: string,
  fuzzyUrl: string,
): Promise<boolean> {
  const resp = await fetch(`/id_/${timestamp}/${fuzzyUrl}`);
  return resp.status === 200;
}

async function patchVideo() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wbinfo = (self as any).__wbinfo as WbInfo;
  const { prefix, url, timestamp } = wbinfo;

  const response = await fetch(
    `/id_/${timestamp}/https://urn:videoInfo:${url}`,
  );
  if (!response.ok) {
    return;
  }
  const videoMetadata: VideoResponse = await response.json();

  for (const video of videoMetadata.videos) {
    const format: string = video.format;
    if (format === "youtube") {
      const videoUrl: string = video.url;
      await patchYoutube(videoUrl, prefix, timestamp);
    }
  }
}

async function patchYoutube(
  fuzzyUrl: string,
  prefix: string,
  timestamp: string,
) {
  const videoElement = await waitUntilElement("video", 20000);
  if (!videoElement) {
    return;
  }

  if (!(await videoSourceExists(timestamp, fuzzyUrl))) {
    return;
  }

  const source = document.createElement("source");
  source.setAttribute("src", rewrittenVideoUrl(prefix, timestamp, fuzzyUrl));
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

await patchVideo();
