import test from "ava";

import { doRewrite } from "./helpers/index.js";

import { promises as fs } from "fs";

import { xmlOpts } from "../src/rewrite/rewriteVideo.js";

xmlOpts.format = true;

// ===========================================================================
test("DASH", async (t) => {
  const content = await fs.readFile(
    new URL("./data/sample_dash.mpd", import.meta.url),
    "utf-8",
  );

  const { text: result } = await doRewrite({
    content,
    contentType: "application/dash+xml",
    url: "http://example.com/path/manifest.mpd",
    isLive: true,
  });

  const expected = `
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT0H3M1.63S" minBufferTime="PT1.5S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static">
  <Period duration="PT0H3M1.63S" start="PT0S">
    <AdaptationSet>
      <ContentComponent contentType="video" id="1"/>
      <Representation bandwidth="869460" codecs="avc1.4d401e" height="480" id="3" mimeType="video/mp4" width="854">
        <BaseURL>http://example.com/video-8.mp4</BaseURL>
        <SegmentBase indexRange="708-1183">
          <Initialization range="0-707"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
    <AdaptationSet>
      <ContentComponent contentType="audio" id="2"/>
      <Representation bandwidth="255236" codecs="mp4a.40.2" id="7" mimeType="audio/mp4" numChannels="2" sampleRate="44100">
        <BaseURL>http://example.com/audio-2.mp4</BaseURL>
        <SegmentBase indexRange="592-851">
          <Initialization range="0-591"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

  // auto-adding xml version (in-single quotes)
  t.is(result, "<?xml version='1.0' encoding='UTF-8'?>" + expected);

  // with <?xml line already added, don't add duplicate
  const { text: result_with_xml } = await doRewrite({
    content: "<?xml version='1.0' encoding='UTF-8'?>\n" + content,
    contentType: "application/dash+xml",
    url: "http://example.com/path/manifest.mpd",
    isLive: true,
  });

  // line not re-added, but not with double quotes
  t.is(result_with_xml, '<?xml version="1.0" encoding="UTF-8"?>' + expected);
});

// ===========================================================================
/*
test('FB DASH', async t => {
  const text = await fs.readFile(path.join(__dirname, "data", "sample_dash.mpd"), "utf-8");

  const content = JSON.stringify({"dash_manifest": text + '\n', "dash_prefetched_representation_ids":["4","5"], "other": "data"});

  const result = await doRewrite({content,
      contentType: "text/javascript",
      url: "http://facebook.com/example/dash/manifest.js",
      isLive: true});

  const res = JSON.parse(result);

  t.not(result, content);

  // ids replaced to 3, 7 from 4, 5
  t.deepEqual(res.dash_prefetched_representation_ids, ["3","7"]);
});

test('FB DASH 2', async t => {
  const text = await fs.readFile(path.join(__dirname, "data", "sample_dash.mpd"), "utf-8");

  const content = JSON.stringify({"dash_manifest": text + '\n', "dash_prefetched_representation_ids": null, "other": "data"});

  const result = await doRewrite({content,
      contentType: "text/javascript",
      url: "http://facebook.com/example/dash/manifest.js"});

  const res = JSON.parse(result);

  t.not(result, content);

  // keep null
  t.deepEqual(res.dash_prefetched_representation_ids, null);
});
*/

test("HLS DEFAULT MAX", async (t) => {
  const content = await fs.readFile(
    new URL("./data/sample_hls.m3u8", import.meta.url),
    "utf-8",
  );
  const contentType = "application/vnd.apple.mpegurl";
  const url = "http://example.com/path/master.m3u8";

  const { text: result } = await doRewrite({
    content,
    contentType,
    url,
    isLive: true,
    isAjax: true,
  });

  const expected = `\
#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="WebVTT",NAME="English",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,URI="https://example.com/subtitles/"
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=610000,RESOLUTION=640x360,CODECS="avc1.66.30, mp4a.40.2",SUBTITLES="WebVTT"
http://example.com/video_1.m3u8`;

  t.is(result, expected, result);
});

test("HLS DEFAULT MAX - NATIVE STREAMING", async (t) => {
  const content = await fs.readFile(
    new URL("./data/sample_hls.m3u8", import.meta.url),
    "utf-8",
  );
  const contentType = "application/vnd.apple.mpegurl";
  const url = "http://example.com/path/master.m3u8";

  const { text: result } = await doRewrite({
    content,
    contentType,
    url,
    isLive: true,
  });

  const expected = `\
#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="WebVTT",NAME="English",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,URI="https://example.com/subtitles/"
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=610000,RESOLUTION=640x360,CODECS="avc1.66.30, mp4a.40.2",SUBTITLES="WebVTT"
http://localhost:8080/prefix/20201226101010mp_/http://example.com/video_1.m3u8`;

  t.is(result, expected, result);
});

test("HLS DEFAULT OLD REPLAY MAX", async (t) => {
  const content = await fs.readFile(
    new URL("./data/sample_hls.m3u8", import.meta.url),
    "utf-8",
  );
  const contentType = "application/vnd.apple.mpegurl";
  const url = "http://example.com/path/master.m3u8";

  const { text: result } = await doRewrite({
    content,
    contentType,
    url,
    isLive: false,
    isAjax: true,
  });

  const expected = `\
#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="WebVTT",NAME="English",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,URI="https://example.com/subtitles/"
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=2505000,RESOLUTION=1280x720,CODECS="avc1.77.30, mp4a.40.2",SUBTITLES="WebVTT"
http://example.com/video_5.m3u8`;

  t.is(result, expected);
});

test("YT rewrite", async (t) => {
  const content = `
<html>
<head>
<script>
const test1 = {"player": {"args": {"some": "data"}}};
const test2 = yt.setConfig(PLAYER_CONFIG: {"args": {"other":"data"}});
const test3 = ytplayer.config = {"args": {"some": "data"}};
const test4 = ytplayer.load();
</script>
</head>
</html>
`;

  const expected = `\
<html>
<head>
<script>
const test1 = {"player": {"args": {"dash":"0","dashmpd":"","some": "data"}}};
const test2 = yt.setConfig(PLAYER_CONFIG: {"args": { "dash": "0", dashmpd: "", "other":"data"}});
const test3 = ytplayer.config = {"args": {"dash":"0","dashmpd":"","some": "data"}};
const test4 = ytplayer.config.args.dash = "0"; ytplayer.config.args.dashmpd = ""; ytplayer.load();
</script>
</head>
</html>
`;

  const { text: result } = await doRewrite({
    content,
    contentType: "text/html",
    url: "https://youtube.com/example.html",
  });
  t.is(result, expected, result);
});

/*
test("FB rewrite JS", async (t) => {
  const content = `\
<script>
const test1 = {"dash_url": "foo", {"some_dash": "a", "data_dash_foo": 2}};
</script>
`;

  const expected = `\
<script>
const test1 = {"__nodash__url": "foo", {"some__nodash__": "a", "data__nodash__foo": 2}};
</script>
`;

  const { text: result } = await doRewrite({
    content,
    contentType: "text/html",
    url: "https://www.facebook.com/data/example.html",
  });
  t.is(result, expected);
});
*/

test("Twitter rewrite json", async (t) => {
  const content = {
    video_info: {
      some_data: "other",
      variants: [
        {
          content_type: "application/x-mpegURL",
          url: "https://example.com/A",
        },
        {
          bitrate: 256000,
          content_type: "video/mp4",
          url: "https://example.com/B",
        },
        {
          bitrate: 2176000,
          content_type: "video/mp4",
          url: "https://example.com/C",
        },
        {
          bitrate: 5832000,
          content_type: "video/mp4",
          url: "https://example.com/D",
        },
      ],
    },
  };

  const expected = {
    video_info: {
      some_data: "other",
      variants: [
        {
          bitrate: 2176000,
          content_type: "video/mp4",
          url: "https://example.com/C",
        },
      ],
    },
  };

  const extraOpts = { rewritten: true };

  for (const api of [
    "https://api.twitter.com/2/",
    "https://twitter.com/i/api/graphql/",
  ]) {
    const { text: result } = await doRewrite({
      content: JSON.stringify(content),
      contentType: "application/json",
      url: api + "some/endpoint",
      extraOpts,
    });
    t.deepEqual(JSON.parse(result), expected);
  }
});

test("Twitter rewrite embedded json", async (t) => {
  const content = {
    video: {
      some_data: "other",
      variants: [
        {
          type: "application/x-mpegURL",
          src: "https://example.com/100x100/A",
        },
        {
          type: "video/mp4",
          src: "https://example.com/100x100/B",
        },
        {
          type: "video/mp4",
          src: "https://example.com/200x200/B",
        },
        {
          type: "video/mp4",
          src: "https://example.com/300x300/B",
        },
      ],
      viewCount: 1234,
    },
  };

  const expected = {
    video: {
      some_data: "other",
      variants: [
        {
          type: "video/mp4",
          src: "https://example.com/300x300/B",
        },
      ],
      viewCount: 1234,
    },
  };

  const extraOpts = { rewritten: true };

  for (const api of [
    "https://cdn.syndication.twimg.com/tweet-result?some=value",
  ]) {
    const { text: result } = await doRewrite({
      content: JSON.stringify(content),
      contentType: "application/json",
      url: api + "some/endpoint",
      extraOpts,
    });
    t.deepEqual(JSON.parse(result), expected);
  }
});
