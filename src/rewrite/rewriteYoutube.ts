type WbInfo = {
  timestamp: string;
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

export function youtubeId(url: string): string | undefined {
  const parsed = new URL(url);
  if (!parsed) {
    return;
  }
  // https://youtu.be/videoid
  if (parsed.hostname.match(/(www.?)youtu.be/)) {
    return parsed.pathname.replace(/^\//, "");
  }
  if (parsed.hostname.match(/(www.)youtube.com/)) {
    // https://www.youtube.com/watch?v=videoid
    if (parsed.pathname === "/watch") {
      return parsed.searchParams.get("v") || undefined;
    }
    // https://www.youtube.com/embed/videoid
    if (parsed.pathname.startsWith("/embed")) {
      return parsed.pathname.replace(/^\/embed\//, "");
    }
  }

  return;
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
    return stop || (node !== null);
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

async function videoSourceExists(timestamp: string, videoId: string) {
  const resp = await fetch(`/id_/${timestamp}/https://fuzzy.replayweb.page/videoplayback?id=${videoId}`);
  return resp.status === 200;
}

async function patchYoutube() {
  if (!isYoutubeVideo(window.location.href)) {
    return;
  }

  const videoId = youtubeId(window.location.href);
  if (!videoId) {
    return;
  }

  const videoElement = await waitUntilElement("video", 20000);
  if (!videoElement) {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wbinfo = (self as any).__wbinfo as WbInfo;

  const timestamp = wbinfo.timestamp;
  if (!videoSourceExists(timestamp, videoId)) {
    return;
  }

  const source = document.createElement("source");
  source.setAttribute("src", "http://localhost:5471/w/id-3b6ec7faadf3/:37a8eec1ce19687d132fe29051dca629d164e2c4958ba141d5f4133a33f0688f/20261112170822oe_/https://youtube.fuzzy.replayweb.page/videoplayback?id=pqobRu9aR3M");
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
  const error = await waitUntilElement("div.ytp-error", 20000)
  if (error) {
    error.remove();
  }

  videoElement.replaceWith(newVideo);
  await newVideo.play();
}

await patchYoutube();
