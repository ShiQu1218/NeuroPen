"""Focused checks for the generated video and interchange timeline."""

import ast
import hashlib
import json
import re
import subprocess
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parents[1] / 'video-output/neuropen-intro'


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)], text=True))


def main():
    scenes = json.loads((HERE / 'narration.json').read_text(encoding='utf-8'))
    seconds = sum(s['seconds'] for s in scenes)
    for script in HERE.glob('*.py'):
        ast.parse(script.read_text(encoding='utf-8'), filename=str(script))
    master = OUTPUT / 'NeuroPen_Intro_zh-TW_1080p.mp4'
    metadata = probe(master)
    video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in metadata['streams'] if s['codec_type'] == 'audio')
    assert (video['codec_name'], video['width'], video['height'], video['avg_frame_rate']) == ('h264', 1920, 1080, '30/1')
    assert int(video['nb_frames']) == seconds * 30
    assert (audio['codec_name'], audio['sample_rate'], audio['channels']) == ('aac', '48000', 2)
    assert abs(float(metadata['format']['duration']) - seconds) < .034
    # Decode the entire master, both streams, and fail on media errors.
    subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(master), '-f', 'null', '-'], check=True)
    for scene in scenes:
        info = probe(OUTPUT / 'scenes' / f'{scene["id"]}.mp4')
        stream = info['streams'][0]
        assert int(stream['nb_frames']) == scene['seconds'] * 30
        assert len(info['streams']) == 1 and stream['codec_type'] == 'video'
    for name in ['narration', 'music', 'mix']:
        info = probe(OUTPUT / 'audio' / f'{name}.wav')
        assert abs(float(info['format']['duration']) - seconds) < .002
        assert info['streams'][0]['channels'] == 2
    tree = ET.parse(OUTPUT / 'NeuroPen_Resolve.xml')
    sequence = tree.getroot().find('sequence')
    assert int(sequence.findtext('duration')) == seconds * 30
    clips = sequence.findall('media/video/track/clipitem')
    assert len(clips) == len(scenes)
    previous = 0
    for clip, scene in zip(clips, scenes):
        assert int(clip.findtext('start')) == previous
        previous += scene['seconds'] * 30
        assert int(clip.findtext('end')) == previous
    assert len(sequence.findall('media/audio/track/clipitem')) == 2
    for element in sequence.findall('.//pathurl'):
        path = Path(urllib.request.url2pathname(urllib.parse.urlparse(element.text).path))
        assert path.is_file(), f'Missing XML media: {path}'
    srt = (OUTPUT / 'NeuroPen_zh-TW.srt').read_text(encoding='utf-8-sig')
    stamps = re.findall(r'(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})', srt)
    assert len(stamps) == sum(len(s['captions']) for s in scenes)
    previous = 0
    for groups in stamps:
        values = [int(v) for v in groups]
        start = values[0] * 3600 + values[1] * 60 + values[2] + values[3] / 1000
        end = values[4] * 3600 + values[5] * 60 + values[6] + values[7] / 1000
        assert previous <= start < end <= seconds
        previous = end
    meter = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(master), '-af',
                            'loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json', '-vn', '-f', 'null', '-'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, check=True)
    match = re.search(r'\{\s*"input_i".*?\}', meter.stderr, re.S)
    loudness = json.loads(match.group())
    assert -18 <= float(loudness['input_i']) <= -14
    assert float(loudness['input_tp']) <= -1
    result = {'status': 'passed', 'seconds': seconds, 'video_frames': int(video['nb_frames']),
              'resolution': '1920x1080', 'fps': 30, 'video_codec': 'H.264', 'audio_codec': 'AAC stereo 48 kHz',
              'full_decode': 'passed', 'independent_scenes': len(clips), 'separate_audio_tracks': 2,
              'subtitle_cues': len(stamps), 'xml_media_paths': 'all exist', 'source_python_syntax': 'passed',
              'loudness_lufs': loudness['input_i'], 'true_peak_dbtp': loudness['input_tp'],
              'bytes': master.stat().st_size, 'sha256': hashlib.sha256(master.read_bytes()).hexdigest(),
              'resolve_native_import': 'See resolve-import.json if generated; XML parse is not native import verification.'}
    (OUTPUT / 'verification.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
