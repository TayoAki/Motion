# Third-party software and assets

This independent local implementation is inspired by the public GoMotion journey. It is not affiliated with GoMotion, and no proprietary GoMotion code is redistributed here.

## Software

Dependencies retain their own licenses. Consult the packages and distributions before redistribution:

- React, Vite, Express, Multer, Lucide: MIT.
- Sharp: Apache-2.0; its native dependency licenses also apply.
- SQLite: public domain.
- REA: MIT, [official repository](https://github.com/morluto/rea).
- FFmpeg: generally LGPL 2.1+, with GPL-covered configurations/components possible. This app invokes the system executable; libx264-enabled builds can carry GPL requirements. [FFmpeg legal information](https://ffmpeg.org/legal.html).
- Flite: permissive Carnegie Mellon license, with voice/data notices; use the notices in the FFmpeg/system distribution. [Flite](https://github.com/festvox/flite).

The UI requests DM Sans and Manrope from Google Fonts, both under the SIL Open Font License. Fallback system fonts are specified. Rendering uses the system DejaVu font family.

## Included image backgrounds

The following images were downloaded from Unsplash at 1920px on November 12, 2026. Their use is governed by the [Unsplash license](https://unsplash.com/license), which permits commercial and noncommercial download, modification, and use subject to its restrictions. No ownership of the underlying photos is claimed.

| Local asset | Original image source |
| --- | --- |
| `public/media/mountains.jpg` | https://images.unsplash.com/photo-1464822759023-fed622ff2c3b |
| `public/media/ocean.jpg` | https://images.unsplash.com/photo-1518837695005-2083093ee35b |
| `public/media/forest.jpg` | https://images.unsplash.com/photo-1441974231531-c6227db76b6e |
| `public/media/space.jpg` | https://images.unsplash.com/photo-1446776811953-b23d57bd21aa |
| `public/media/night.jpg` | https://images.unsplash.com/photo-1519608487953-e999c86e7455 |

The default ambient soundbed is synthesized locally from three sine tones; it is not downloaded music. Users remain responsible for the rights to uploaded narration/music and their scripts, as well as publication decisions.
