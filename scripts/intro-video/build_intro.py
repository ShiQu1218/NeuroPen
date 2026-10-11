"""Create a local-only, 1080p NeuroPen film and a Resolve XML timeline.

Requires Python 3.10+, Pillow, NumPy, ffmpeg/ffprobe, Windows fonts and SAPI.
No app settings, credentials, network services, or package manifests are touched.
"""

import argparse
import functools
import json
import math
import shutil
import subprocess
import wave
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
W, H, FPS, SR = 1920, 1080, 30, 48000
BG, INK, MUTED, LINE, GREEN = '#f2f1eb', '#171916', '#6c7267', '#d9ddd1', '#d5ed8b'
FONT = Path('C:/Windows/Fonts/msjh.ttc')
BOLD = Path('C:/Windows/Fonts/msjhbd.ttc')
LATIN = Path('C:/Windows/Fonts/segoeui.ttf')
OUT = ROOT / 'video-output' / 'neuropen-intro'
SCENES = json.loads((HERE / 'narration.json').read_text(encoding='utf-8'))
TOTAL = sum(s['seconds'] for s in SCENES)
LOGO = Image.open(ROOT / 'src-tauri/icons/icon.png').convert('RGBA')


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def duration(path):
    return float(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'csv=p=0', str(path)], text=True).strip())


@functools.lru_cache(maxsize=64)
def font(size, bold=False, latin=False):
    return ImageFont.truetype(str(LATIN if latin else BOLD if bold else FONT), size)


def text(im, xy, value, size=32, fill=INK, bold=False, anchor='lt', latin=False):
    ImageDraw.Draw(im).text(xy, value, font=font(size, bold, latin), fill=fill, anchor=anchor)


def box(im, bounds, fill='white', radius=24, outline=None, width=1):
    ImageDraw.Draw(im).rounded_rectangle(bounds, radius=radius, fill=fill, outline=outline, width=width)


def pill(im, xy, value, fill=GREEN, size=27):
    width = int(font(size).getlength(value)) + 44
    box(im, (xy[0], xy[1], xy[0] + width, xy[1] + 60), fill, 18)
    text(im, (xy[0] + 22, xy[1] + 12), value, size)


def icon(im, xy, size):
    im.paste(LOGO.resize((size, size), Image.Resampling.LANCZOS), xy, LOGO.resize((size, size)))


def ease(x):
    x = min(1, max(0, x))
    return 1 - (1 - x) ** 3


@functools.lru_cache(maxsize=6)
def base(index):
    im = Image.new('RGB', (W, H), BG)
    icon(im, (108, 66), 50)
    text(im, (177, 72), 'NeuroPen', 31, bold=True, latin=True)
    text(im, (1810, 83), 'WINDOWS  /  VOICE-FIRST AI', 23, MUTED, anchor='rt', latin=True)
    ImageDraw.Draw(im).line((110, 147, 1810, 147), fill=LINE, width=2)
    text(im, (1810, 1018), f'{index + 1:02} / 06', 22, MUTED, anchor='rt', latin=True)
    for n in range(6):
        box(im, (110 + n * 47, 1023, 142 + n * 47, 1028), INK if n <= index else LINE, 2)
    return im


def sidebar(im, num, lines, desc, key=None):
    text(im, (118, 218), num, 24, MUTED, latin=True)
    for n, line in enumerate(lines):
        text(im, (112, 292 + n * 94), line, 65, bold=True)
    for n, line in enumerate(desc):
        text(im, (119, 522 + n * 47), line, 29, MUTED)
    if key:
        pill(im, (118, 692), key, size=30)


def waveform(im, x, y, t, count=39, color=INK, width=8, step=15, height=45):
    d = ImageDraw.Draw(im)
    for n in range(count):
        envelope = .2 + .8 * math.sin(math.pi * n / (count - 1)) ** 2
        level = 8 + height * envelope * (.28 + .72 * abs(math.sin(n * .81 + t * 4.4)))
        d.rounded_rectangle((x + n * step, y - level, x + n * step + width, y + level), radius=width / 2, fill=color)


def type_lines(im, xy, lines, t, size=38, line_height=64, speed=16, fill=INK):
    remaining = max(0, int(t * speed))
    for i, line in enumerate(lines):
        part = line[:remaining]
        text(im, (xy[0], xy[1] + i * line_height), part, size, fill)
        remaining = max(0, remaining - len(line))


def load_demo():
    gif = Image.open(ROOT / 'assets/demo/mode_B1.gif')
    frames, ends, total = [], [], 0
    for n in range(gif.n_frames):
        gif.seek(n)
        total += gif.info.get('duration', 100) / 1000
        frames.append(gif.convert('RGB').resize((1024, 576), Image.Resampling.LANCZOS))
        ends.append(total)
    return frames, ends


DEMO, DEMO_ENDS = load_demo()


def frame(index, t):
    im = base(index).copy()
    d = ImageDraw.Draw(im)
    if index == 0:
        offset = round(40 * (1 - ease(t / 1.1)))
        icon(im, (215, 304 + offset), 286)
        text(im, (588, 312 + offset), 'NeuroPen', 139, bold=True, latin=True)
        text(im, (597, 497 + offset), '讓想法，直接成為文字。', 60, bold=True)
        text(im, (604, 603 + offset), '語音輸入  /  選字改寫  /  截圖提問', 31, MUTED)
        box(im, (600, 727, 1530, 832), GREEN, 28)
        waveform(im, 650, 780, t, count=26, height=26, step=16)
        text(im, (1120, 761), '不必切換視窗', 32, bold=True)
    elif index == 1:
        sidebar(im, '01  /  VOICE INPUT', ['按住，說話。', '放開，成稿。'],
                ['把口述變成文字，', '直接留在原本的工作裡。'], 'Alt + `')
        text(im, (119, 771), '預設快捷鍵：Alt + 反引號', 23, MUTED)
        box(im, (790, 239, 1812, 856), '#dee2d4', 32)
        box(im, (782, 230, 1804, 846), 'white', 32)
        text(im, (827, 265), '工作筆記', 28, MUTED)
        text(im, (1764, 270), '功能示意', 20, MUTED, anchor='rt')
        d.line((820, 328, 1760, 328), fill=LINE, width=2)
        text(im, (826, 375), '下一個好點子，從一句話開始。', 39, bold=True)
        if t < 3.3:
            text(im, (828, 471), '「幫我記下今天的靈感……」', 35, MUTED)
            box(im, (946, 639, 1640, 758), GREEN, 28)
            waveform(im, 987, 698, t, count=37, height=32, step=16)
            text(im, (1292, 786), '按住快捷鍵，正在聆聽', 23, MUTED, anchor='mt')
        else:
            type_lines(im, (828, 472), ['今天的靈感：', '把重複的操作交給工具，', '把更多時間留給真正重要的事。'], t - 3.3, size=37)
            pill(im, (831, 732), '已轉成文字', size=24)
    elif index == 2:
        sidebar(im, '02  /  QUICK ACTION', ['選取文字，', '說出你的需求。'],
                ['翻譯、摘要、潤稿，', '從反白的那一刻開始。'])
        pill(im, (118, 696), '「幫我簡短一點」', size=28)
        box(im, (770, 236, 1816, 888), INK, 25)
        text(im, (801, 253), 'Quick Action', 23, 'white', latin=True)
        text(im, (1782, 255), '專案既有操作錄影', 19, '#c9d0c3', anchor='rt')
        sample = max(0, t - .6)
        n = next((i for i, end in enumerate(DEMO_ENDS) if end > sample), len(DEMO) - 1)
        im.paste(DEMO[n], (781, 300))
        text(im, (778, 905), '翻譯範例 · 錄製版本介面', 21, MUTED)
    elif index == 3:
        sidebar(im, '03  /  SCREENSHOT Q&A', ['框選畫面，', '把問題一起帶上。'],
                ['不只讀文字，', '也能看懂你的問題在哪裡。'], 'Alt + S')
        box(im, (796, 234, 1804, 582), 'white', 27)
        text(im, (840, 266), '專案趨勢', 27, MUTED)
        text(im, (1766, 270), '功能示意', 20, MUTED, anchor='rt')
        d.line((856, 502, 1742, 502), fill=LINE, width=2)
        for n, value in enumerate([75, 103, 87, 150, 133, 171]):
            x = 900 + n * 137
            box(im, (x, 500 - value * ease(t / 1.5), x + 62, 500), '#b9c79a' if n < 5 else '#546b31', 8)
            text(im, (x + 30, 516), str(n + 1), 19, MUTED, anchor='mt', latin=True)
        if t > 1:
            alpha = ease((t - 1) / .8)
            x2 = round(890 + 860 * alpha)
            d.rectangle((882, 322, x2, 553), outline='#729142', width=4)
            for xx, yy in [(882, 322), (x2, 322), (882, 553), (x2, 553)]:
                d.rectangle((xx - 5, yy - 5, xx + 5, yy + 5), fill='#729142')
        box(im, (796, 616, 1804, 876), INK, 27)
        text(im, (838, 650), 'NeuroPen Preview', 24, GREEN, latin=True)
        type_lines(im, (838, 713), ['「這張圖的重點是什麼？」', '整體向上，期間仍有小幅波動。'], t - 2.5, size=33, fill='white', line_height=64)
        text(im, (800, 906), '截圖提問需搭配支援圖片的模型', 22, MUTED)
    elif index == 4:
        sidebar(im, '04  /  YOUR WORKFLOW', ['你的工作方式，', '由你設定。'],
                ['模型、應用程式設定檔，', '還有貼回文字的掌控權。'])
        rows = [('01', '雲端 / 本機模型', '依需求選擇運算方式'),
                ('02', 'App Profiles', '依應用程式套用語氣與輸出規則'),
                ('03', '焦點確認 + 快捷復原', '貼回前確認視窗 · Alt + Z 單步復原')]
        for n, (number, title, desc) in enumerate(rows):
            yy = 236 + n * 214
            xx = 798 + round(26 * (1 - ease((t - .2 * n) / .8)))
            d.line((xx, yy + 178, 1800, yy + 178), fill=LINE, width=2)
            box(im, (xx, yy + 12, xx + 66, yy + 77), GREEN, 18)
            text(im, (xx + 33, yy + 26), number, 26, anchor='mt', latin=True)
            text(im, (xx + 99, yy + 9), title, 43, bold=True)
            text(im, (xx + 101, yy + 87), desc, 28, MUTED)
        text(im, (800, 906), '本機模式需另行安裝模型；雲端服務可能產生費用。', 22, MUTED)
    else:
        icon(im, (858, 205), 204)
        text(im, (960, 437), 'NeuroPen', 103, bold=True, anchor='mt', latin=True)
        text(im, (960, 585), '少一點切換，多一點創作。', 65, bold=True, anchor='mt')
        text(im, (960, 690), '語音優先的 Windows AI 助手', 31, MUTED, anchor='mt')
        box(im, (494, 788, 1426, 862), GREEN, 23)
        text(im, (960, 805), 'github.com/ShiQu1218/TalkFlow', 31, anchor='mt', latin=True)
        text(im, (960, 900), 'Windows 10 / 11  ·  開源專案', 24, MUTED, anchor='mt')
    if t < .35:
        im = Image.blend(base(index), im, ease(t / .35))
    return im


def render_scenes(preview_only=False):
    (OUT / 'scenes').mkdir(parents=True, exist_ok=True)
    (OUT / 'previews').mkdir(exist_ok=True)
    sheet = Image.new('RGB', (1440, 1215), BG)
    for i, scene in enumerate(SCENES):
        preview = frame(i, min(5.5, scene['seconds'] - 1))
        preview.save(OUT / 'previews' / f'{scene["id"]}.jpg', quality=94)
        sheet.paste(preview.resize((720, 405), Image.Resampling.LANCZOS), ((i % 2) * 720, (i // 2) * 405))
        if preview_only:
            continue
        destination = OUT / 'scenes' / f'{scene["id"]}.mp4'
        process = subprocess.Popen([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo',
            '-vcodec', 'rawvideo', '-s', f'{W}x{H}', '-pix_fmt', 'rgb24', '-r', str(FPS),
            '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
            '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709',
            '-colorspace', 'bt709', '-movflags', '+faststart', str(destination)], stdin=subprocess.PIPE)
        try:
            for n in range(scene['seconds'] * FPS):
                process.stdin.write(frame(i, n / FPS).tobytes())
        finally:
            process.stdin.close()
            code = process.wait()
        if code:
            raise RuntimeError(f'Render failed: {destination}')
        print(f'Rendered {scene["id"]}: {scene["seconds"]} seconds', flush=True)
    sheet.save(OUT / 'storyboard.jpg', quality=93)


def write_wav(path, samples):
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SR)
        output.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())


def make_audio():
    target = OUT / 'audio'
    target.mkdir(exist_ok=True)
    run('powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HERE / 'narrate.ps1',
        '-ScriptPath', HERE / 'narration.json', '-OutputDirectory', OUT / 'voice')
    narration = np.zeros((TOTAL * SR, 2), dtype=np.float32)
    cues, start = [], 0
    for scene in SCENES:
        original = OUT / 'voice' / f'{scene["id"]}.wav'
        length = duration(original)
        tempo = max(1, length / (scene['seconds'] - .8))
        adjusted = target / f'{scene["id"]}_voice.wav'
        run('ffmpeg', '-v', 'error', '-y', '-i', original, '-af', f'atempo={tempo},loudnorm=I=-18:TP=-2:LRA=7',
            '-ar', SR, '-ac', 2, '-c:a', 'pcm_s16le', adjusted)
        with wave.open(str(adjusted), 'rb') as audio:
            samples = np.frombuffer(audio.readframes(audio.getnframes()), '<i2').reshape(-1, 2).astype(np.float32) / 32768
        begin = int((start + .4) * SR)
        assert len(samples) <= (scene['seconds'] - .4) * SR, 'Voice extends beyond scene'
        narration[begin:begin + len(samples)] = samples
        total_chars = sum(len(c) for c in scene['captions'])
        position = start + .4
        for caption in scene['captions']:
            end = position + len(samples) / SR * len(caption) / total_chars
            cues.append((position, end, caption))
            position = end
        start += scene['seconds']
    write_wav(target / 'narration.wav', narration)

    # Deterministic original ambient score; no third-party music or remote TTS.
    music = np.zeros(TOTAL * SR, dtype=np.float32)
    chords = [(48, 55, 62, 64), (45, 52, 59, 60), (41, 48, 55, 57), (43, 50, 57, 59)]
    for number, start in enumerate(np.arange(0, TOTAL, 4)):
        count = min(int(4.8 * SR), len(music) - int(start * SR))
        t = np.arange(count) / SR
        env = np.minimum(t / .5, 1) * np.minimum((count / SR - t) / 1.2, 1)
        pad = np.zeros(count)
        for note in chords[number % 4]:
            hz = 440 * 2 ** ((note - 69) / 12)
            pad += np.sin(2 * math.pi * hz * t) + .18 * np.sin(2 * math.pi * hz * 2 * t)
        music[int(start * SR):int(start * SR) + count] += pad * env * .015
    for n, start in enumerate(np.arange(.5, TOTAL - 1, .5)):
        count = min(int(.8 * SR), len(music) - int(start * SR))
        t = np.arange(count) / SR
        note = chords[int(start // 4) % 4][n % 4] + 24
        hz = 440 * 2 ** ((note - 69) / 12)
        music[int(start * SR):int(start * SR) + count] += np.sin(2 * math.pi * hz * t) * np.exp(-t * 8) * np.minimum(t / .012, 1) * .013
    t = np.arange(len(music)) / SR
    music *= np.minimum(t / 1.5, 1) * np.minimum((TOTAL - t) / 2.2, 1)
    stereo = np.column_stack((music, .96 * music))
    write_wav(target / 'music.wav', stereo)
    run('ffmpeg', '-v', 'error', '-y', '-i', target / 'narration.wav', '-i', target / 'music.wav',
        '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9[a]',
        '-map', '[a]', '-ar', SR, '-ac', 2, '-c:a', 'pcm_s16le', target / 'mix.wav')
    return cues


def timestamp(seconds, ass=False):
    units = 100 if ass else 1000
    ticks = round(seconds * units)
    whole, part = divmod(ticks, units)
    hours, rest = divmod(whole, 3600)
    minutes, secs = divmod(rest, 60)
    return f'{hours}:{minutes:02}:{secs:02}.{part:02}' if ass else f'{hours:02}:{minutes:02}:{secs:02},{part:03}'


def captions(cues):
    (OUT / 'NeuroPen_zh-TW.srt').write_text('\n\n'.join(
        f'{i + 1}\n{timestamp(a)} --> {timestamp(b)}\n{c}' for i, (a, b, c) in enumerate(cues)) + '\n', encoding='utf-8-sig')
    header = '[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\n'
    header += 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
    header += 'Style: Default,Microsoft JhengHei,33,&H00FFFFFF,&H00FFFFFF,&H00212420,&H00212420,0,0,0,0,100,100,0,0,3,10,0,2,100,100,84,1\n\n[Events]\n'
    header += 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    (OUT / 'captions.ass').write_text(header + '\n'.join(
        f'Dialogue: 0,{timestamp(a, True)},{timestamp(b, True)},Default,,0,0,0,,{c}' for a, b, c in cues) + '\n', encoding='utf-8-sig')


def node(parent, name, value=None, **attrs):
    child = ET.SubElement(parent, name, attrs)
    if value is not None:
        child.text = str(value)
    return child


def rate(parent):
    item = node(parent, 'rate')
    node(item, 'timebase', FPS)
    node(item, 'ntsc', 'FALSE')


def video_format(parent):
    node(parent, 'width', W)
    node(parent, 'height', H)
    node(parent, 'anamorphic', 'FALSE')
    node(parent, 'pixelaspectratio', 'square')
    node(parent, 'fielddominance', 'none')
    rate(parent)


def timeline_xml():
    root = ET.Element('xmeml', version='5')
    seq = node(root, 'sequence', id='neuropen-intro')
    node(seq, 'name', 'NeuroPen Intro · zh-TW')
    node(seq, 'duration', TOTAL * FPS)
    rate(seq)
    tc = node(seq, 'timecode')
    rate(tc)
    node(tc, 'string', '00:00:00:00')
    node(tc, 'frame', 0)
    node(tc, 'displayformat', 'NDF')
    media = node(seq, 'media')
    video = node(media, 'video')
    video_format(node(node(video, 'format'), 'samplecharacteristics'))
    track = node(video, 'track')
    start = 0
    for scene in SCENES:
        frames = scene['seconds'] * FPS
        clip = node(track, 'clipitem', id=scene['id'])
        node(clip, 'name', scene['title'])
        node(clip, 'enabled', 'TRUE')
        node(clip, 'duration', frames)
        rate(clip)
        for k, v in [('start', start), ('end', start + frames), ('in', 0), ('out', frames)]:
            node(clip, k, v)
        f = node(clip, 'file', id=f'file-{scene["id"]}')
        node(f, 'name', f'{scene["id"]}.mp4')
        node(f, 'pathurl', (OUT / 'scenes' / f'{scene["id"]}.mp4').as_uri())
        rate(f)
        node(f, 'duration', frames)
        video_format(node(node(node(f, 'media'), 'video'), 'samplecharacteristics'))
        start += frames
    audio = node(media, 'audio')
    for name in ['narration', 'music']:
        track = node(audio, 'track')
        clip = node(track, 'clipitem', id=f'audio-{name}')
        node(clip, 'name', name)
        node(clip, 'enabled', 'TRUE')
        rate(clip)
        for k, v in [('duration', TOTAL * FPS), ('start', 0), ('end', TOTAL * FPS), ('in', 0), ('out', TOTAL * FPS)]:
            node(clip, k, v)
        f = node(clip, 'file', id=f'file-{name}')
        node(f, 'name', f'{name}.wav')
        node(f, 'pathurl', (OUT / 'audio' / f'{name}.wav').as_uri())
        rate(f)
        node(f, 'duration', TOTAL * FPS)
        a = node(node(f, 'media'), 'audio')
        sample = node(a, 'samplecharacteristics')
        node(sample, 'depth', 16)
        node(sample, 'samplerate', SR)
        node(a, 'channelcount', 2)
        source = node(clip, 'sourcetrack')
        node(source, 'mediatype', 'audio')
        node(source, 'trackindex', 1)
    ET.indent(root)
    path = OUT / 'NeuroPen_Resolve.xml'
    path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n' + ET.tostring(root, encoding='unicode'), encoding='utf-8')
    ET.parse(path)


def assemble():
    listing = OUT / 'concat.txt'
    listing.write_text('\n'.join(f"file 'scenes/{s['id']}.mp4'" for s in SCENES), encoding='utf-8')
    # Relative filter path avoids FFmpeg's Windows drive-letter escaping ambiguity.
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
        '-i', 'concat.txt', '-i', 'audio/mix.wav', '-vf', 'ass=captions.ass', '-map', '0:v', '-map', '1:a',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-t', str(TOTAL), '-movflags', '+faststart',
        '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
        '-metadata', 'title=NeuroPen | Voice-first AI for Windows',
        'NeuroPen_Intro_zh-TW_1080p.mp4'], cwd=OUT, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview', action='store_true', help='Render storyboard only, without speech or video')
    args = parser.parse_args()
    for executable in ['ffmpeg', 'ffprobe']:
        if not shutil.which(executable):
            raise SystemExit(f'{executable} is required on PATH')
    OUT.mkdir(parents=True, exist_ok=True)
    if args.preview:
        render_scenes(True)
        return
    cues = make_audio()
    captions(cues)
    render_scenes()
    timeline_xml()
    assemble()
    shutil.copy2(HERE / 'README.md', OUT / 'README.md')
    manifest = {'width': W, 'height': H, 'fps': FPS, 'seconds': TOTAL, 'scenes': SCENES,
                'voice': (OUT / 'voice/voice.txt').read_text(encoding='utf-8-sig').strip(),
                'music': 'Original deterministic synthesis', 'ui': 'Real repository GIF in scene 3; other feature screens are labeled illustrations.'}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(OUT / 'NeuroPen_Intro_zh-TW_1080p.mp4', flush=True)


if __name__ == '__main__':
    main()
