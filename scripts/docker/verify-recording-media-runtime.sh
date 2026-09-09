#!/bin/sh
set -eu

# Run inside the exact batch-backend runtime image. The gate generates only
# synthetic media and proves the approved video paths are demux-only copies.
work_dir="$(mktemp -d /tmp/esl-recording-media-gate.XXXXXX)"
trap 'rm -rf "$work_dir"' EXIT INT TERM

ffmpeg -nostdin -v error -y \
  -f lavfi -i color=c=black:s=16x16:r=25:d=2 \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000:d=2 \
  -shortest -c:v mpeg4 -c:a aac "$work_dir/source.mp4"
ffmpeg -nostdin -v error -y \
  -f lavfi -i color=c=black:s=16x16:r=25:d=2 \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000:d=2 \
  -shortest -c:v mpeg4 -c:a aac "$work_dir/source.mov"
ffmpeg -nostdin -v error -y \
  -f lavfi -i color=c=black:s=16x16:r=25:d=2 \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000:d=2 \
  -shortest -c:v libvpx -c:a libopus "$work_dir/source.webm"

ffmpeg -nostdin -v verbose -y -i "$work_dir/source.mp4" \
  -map 0:a:0 -vn -c:a copy "$work_dir/output-mp4.m4a" 2>"$work_dir/mp4-copy.log"
ffmpeg -nostdin -v verbose -y -i "$work_dir/source.mov" \
  -map 0:a:0 -vn -c:a copy "$work_dir/output-mov.m4a" 2>"$work_dir/mov-copy.log"
ffmpeg -nostdin -v verbose -y -i "$work_dir/source.webm" \
  -map 0:a:0 -vn -c:a copy "$work_dir/output-webm.webm" 2>"$work_dir/webm-copy.log"

for family in mp4 mov webm; do
  case "$family" in
    mp4) output='output-mp4.m4a' ;;
    mov) output='output-mov.m4a' ;;
    webm) output='output-webm.webm' ;;
  esac
  ffprobe -v error \
    -show_entries format=format_name,duration:stream=codec_type,codec_name,channels \
    -of json "$work_dir/source.$family" >"$work_dir/$family-source.json"
  ffprobe -v error \
    -show_entries format=format_name,duration:stream=codec_type,codec_name,channels \
    -of json "$work_dir/$output" >"$work_dir/$family-output.json"
done

node - "$work_dir" <<'NODE'
const fs = require('fs');
const path = require('path');

const workDir = process.argv[2];
for (const family of ['mp4', 'mov', 'webm']) {
  const source = JSON.parse(fs.readFileSync(path.join(workDir, `${family}-source.json`)));
  const output = JSON.parse(fs.readFileSync(path.join(workDir, `${family}-output.json`)));
  const sourceAudio = source.streams.find((stream) => stream.codec_type === 'audio');
  const outputAudio = output.streams.find((stream) => stream.codec_type === 'audio');
  const copyLog = fs.readFileSync(path.join(workDir, `${family}-copy.log`), 'utf8');
  const result = {
    family,
    sourceContainer: source.format.format_name,
    outputContainer: output.format.format_name,
    sourceCodec: sourceAudio?.codec_name,
    outputCodec: outputAudio?.codec_name,
    sourceChannels: sourceAudio?.channels,
    outputChannels: outputAudio?.channels,
    sourceDurationSeconds: Number(source.format.duration),
    outputDurationSeconds: Number(output.format.duration),
    durationDeltaSeconds: Math.abs(Number(source.format.duration) - Number(output.format.duration)),
    outputHasVideo: output.streams.some((stream) => stream.codec_type === 'video'),
    streamCopyMapping: /Stream #0:\d+ -> #0:\d+ \(copy\)/.test(copyLog),
    videoMapped: /Stream #0:\d+\(.*Video.*\) ->/.test(copyLog),
  };
  console.log(JSON.stringify(result));
  if (
    result.sourceCodec !== result.outputCodec ||
    result.sourceChannels !== result.outputChannels ||
    result.durationDeltaSeconds > 0.1 ||
    result.outputHasVideo ||
    !result.streamCopyMapping ||
    result.videoMapped
  ) {
    process.exitCode = 1;
  }
}
NODE
