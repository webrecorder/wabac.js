"use strict";

import test from 'ava';

import path from 'path';

import { doRewrite } from './helpers';

import { promises as fs} from 'fs';

import { dashOutputOpts } from '../src/rewrite/rewriteVideo';

dashOutputOpts.format = true;


// ===========================================================================
test('DASH', async t => {
  const content = await fs.readFile(path.join(__dirname, "data", "sample_dash.mpd"), "utf-8");

  const result = await doRewrite({content, contentType: "application/dash+xml", url: 'http://example.com/path/manifest.mpd', isLive: true});

  const expected = `\
<?xml version='1.0' encoding='UTF-8'?>
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

  t.is(result, expected);
});


// ===========================================================================
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



test('HLS DEFAULT MAX', async t => {
  const content = await fs.readFile(path.join(__dirname, "data", "sample_hls.m3u8"), "utf-8");
  const contentType = 'application/vnd.apple.mpegurl';
  const url = 'http://example.com/path/master.m3u8';

  const result = await doRewrite({content, contentType, url});


  const expected = `\
#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="WebVTT",NAME="English",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,URI="https://example.com/subtitles/"
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=610000,RESOLUTION=640x360,CODECS="avc1.66.30, mp4a.40.2",SUBTITLES="WebVTT"
http://example.com/video_1.m3u8`;

  t.is(result, expected, result);
});


test('YT rewrite', async t => {
  const content = `
<html>
<body>
<script>
const test1 = {"player": {"args": {"some": "data"}}};
const test2 = yt.setConfig(PLAYER_CONFIG: {"args": {"other":"data"}});
const test3 = ytplayer.config = {"args": {"some": "data"}};
const test4 = ytplayer.load(); 
</script>
</body>
</html>
`;

  const expected = `\
<html>
<body>
<script>
const test1 = {"player": {"args": {"dash":"0","dashmpd":"","some": "data"}}};
const test2 = yt.setConfig(PLAYER_CONFIG: {"args": { "dash": "0", dashmpd: "", "other":"data"}});
const test3 = ytplayer.config = {"args": {"dash":"0","dashmpd":"","some": "data"}};
const test4 = ytplayer.config.args.dash = "0"; ytplayer.config.args.dashmpd = ""; ytplayer.load(); 
</script>
</body>
</html>
`;

  const result = await doRewrite({content, contentType: "text/html", url: 'https://youtube.com/example.html'});
  t.is(result, expected);
});
