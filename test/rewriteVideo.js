"use strict";

import test from 'ava';

import path from 'path';

import { doRewrite } from './helpers';

import { promises as fs} from 'fs';


// ===========================================================================
test('DASH', async t => {
  const content = await fs.readFile(path.join(__dirname, "data", "sample_dash.mpd"), "utf-8");

  const result = await doRewrite({content, contentType: "application/dash+xml", url: 'http://example.com/path/manifest.mpd'});

  const expected = `\
<?xml version='1.0' encoding='UTF-8'?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT0H3M1.63S" minBufferTime="PT1.5S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static">
  <Period duration="PT0H3M1.63S" start="PT0S">
    <AdaptationSet>
      <ContentComponent contentType="video" id="1"/>
      <Representation bandwidth="4190760" codecs="avc1.640028" height="1080" id="1" mimeType="video/mp4" width="1920">
        <BaseURL>http://example.com/video-10.mp4</BaseURL>
        <SegmentBase indexRange="674-1149">
          <Initialization range="0-673"/>
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

  t.is(result, expected, result);
});


// ===========================================================================
test('FB DASH', async t => {
  const text = await fs.readFile(path.join(__dirname, "data", "sample_dash.mpd"), "utf-8");

  const content = JSON.stringify({"dash_manifest": text + '\n', "dash_prefetched_representation_ids":["4","5"], "other": "data"});

  const result = await doRewrite({content,
      contentType: "text/javascript", 
      url: "http://facebook.com/example/dash/manifest.js"});

  const res = JSON.parse(result);

  t.not(result, content);

  // ids replaced to 1, 7 from 4, 5
  t.deepEqual(res.dash_prefetched_representation_ids, ["1","7"]);
});

test('FB DASH 2', async t => {
  const text = await fs.readFile(path.join(__dirname, "data", "sample_dash.mpd"), "utf-8");

  const content = JSON.stringify({"dash_manifest": text + '\n', "dash_prefetched_representation_ids": null, "other": "data"});

  const result = await doRewrite({content,
      contentType: "text/javascript", 
      url: "http://facebook.com/example/dash/manifest.js"});

  const res = JSON.parse(result);

  t.not(result, content);

  // ids replaced to 1, 7 from 4, 5
  t.deepEqual(res.dash_prefetched_representation_ids, ["1","7"]);
});



test('HLS DEFAULT MAX', async t => {
  const content = await fs.readFile(path.join(__dirname, "data", "sample_hls.m3u8"), "utf-8");
  const contentType = 'application/vnd.apple.mpegurl';
  const url = 'http://example.com/path/master.m3u8';

  const result = await doRewrite({content, contentType, url});


  const expected = `\
#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="WebVTT",NAME="English",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,URI="https://example.com/subtitles/"
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=4495000,RESOLUTION=1920x1080,CODECS="avc1.640028, mp4a.40.2",SUBTITLES="WebVTT"
http://example.com/video_6.m3u8`;

  t.is(result, expected, result);
});

