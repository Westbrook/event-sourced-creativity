# Synthetic MP3 fixtures

No user media is stored here. `mono-20.mp3` and `stereo-20.mp3` were generated locally with installed FFmpeg/libmp3lame. The commands were:

```sh
ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=997:sample_rate=48000:duration=20' -ac 1 -codec:a libmp3lame -b:a 128k -metadata title=SYNTHETIC_PRIVATE_TITLE -y mono-20.mp3
ffmpeg -hide_banner -loglevel error -f lavfi -i 'aevalsrc=0.1*sin(2*PI*997*t)|0.1*sin(2*PI*761*t):s=44100:d=20' -codec:a libmp3lame -b:a 192k -metadata title=SYNTHETIC_PRIVATE_TITLE -y stereo-20.mp3
```

`ignored-marker.mp3` and `ignored-zero.mp3` preserve the earlier independent allocation-only qualification counterexample. Marker source SHA-256: `482e1e384181e45fb26acca8063ecd8463012a7a3df80271b2f44926dd4ed581`. Zeroed source: `d23e226bf2fe85adeacb3c8e79546d7317858b62773c5b89fe17e0673fe18618`. Both decode to identical zero PCM; the marker's declared but ignored entropy bits contain `PRIVATE_PROJECT_TITLE=PAYROLL_DEMO`. Tests prepend a consistent synthetic Info/gapless envelope to exercise the new projection without changing those historical bytes. Original bare files remain refused by the mandatory-gapless envelope.

Exact fixture hashes and frozen decoder/output hashes are the regression oracles. Regenerating fixtures with another FFmpeg version may change metadata or encoder output and is not required to run the tests.
