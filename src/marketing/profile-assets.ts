import type { MarketingAudienceProfile } from "./profiles";

type MarketingStudyFamily = "landscape" | "portrait" | "detail" | "twilight";
type MarketingStudyFormat = "avif" | "webp";

type MarketingImageHashes = Record<MarketingStudyFamily, Record<MarketingStudyFormat, readonly [string, string, string]>>;

export const MARKETING_PROFILE_ASSET_HASHES = {
  "hollywood-filmmakers": {
    "landscape": {
      "avif": [
        "609e2da0fe3a",
        "11cc38a4a946",
        "58c8a8852fa5"
      ],
      "webp": [
        "051b6dc1fd12",
        "a29e348f3c37",
        "c0f86b61d07d"
      ]
    },
    "portrait": {
      "avif": [
        "a15ceb0b5240",
        "d452116dd85d",
        "8ba20f2d4488"
      ],
      "webp": [
        "d5a78f39ef81",
        "2d9919404035",
        "8735bf1d16c6"
      ]
    },
    "detail": {
      "avif": [
        "ad30de38cab2",
        "6a3081652549",
        "702d0fb98848"
      ],
      "webp": [
        "3160ba92c4f8",
        "3f4e3a5942be",
        "c338cd0a82cd"
      ]
    },
    "twilight": {
      "avif": [
        "4d27780857fd",
        "46dabd7ca3a2",
        "70f06622be10"
      ],
      "webp": [
        "5428e4516681",
        "50bfc4a28fed",
        "1f6f224fad4d"
      ]
    }
  },
  "marketers": {
    "landscape": {
      "avif": [
        "ec4cf300a112",
        "2223ee8d77b3",
        "c9e7342cc98a"
      ],
      "webp": [
        "8f17a19f2265",
        "149b82173040",
        "0e12ab79f12e"
      ]
    },
    "portrait": {
      "avif": [
        "f4e9004a286a",
        "2be302f02b7c",
        "3522ce0070ad"
      ],
      "webp": [
        "d0c18f0d26d1",
        "1d04e8fc48de",
        "a9baba22ee16"
      ]
    },
    "detail": {
      "avif": [
        "dd0e67aaa233",
        "583528dd0afe",
        "a981092d48e9"
      ],
      "webp": [
        "8a71deed1641",
        "309bb2389d84",
        "453d5330c271"
      ]
    },
    "twilight": {
      "avif": [
        "b33507ed5bc2",
        "5e687f400f2d",
        "0bd46367befc"
      ],
      "webp": [
        "ea5ee2d48cd8",
        "ba8a966c12e6",
        "03f316b3f584"
      ]
    }
  },
  "indie-filmmakers": {
    "landscape": {
      "avif": [
        "3a0d960161d4",
        "8af112ebdce6",
        "a4ad4e00375a"
      ],
      "webp": [
        "3191aacb59bb",
        "6ddc27719fc1",
        "e8e494c3d28c"
      ]
    },
    "portrait": {
      "avif": [
        "882ce6ea7879",
        "e37f281248ac",
        "480559a155df"
      ],
      "webp": [
        "0dec225ae9c3",
        "134540efedc3",
        "098603c62ca6"
      ]
    },
    "detail": {
      "avif": [
        "e1a8f826210e",
        "358d574b060a",
        "be13c7bd307c"
      ],
      "webp": [
        "b7f0ecf929b6",
        "590891dc39f0",
        "b53f3e10ea38"
      ]
    },
    "twilight": {
      "avif": [
        "22b650ef5391",
        "0788d8ea3bc8",
        "eccf18a21364"
      ],
      "webp": [
        "a2685b8ea77f",
        "2b7cd9682bde",
        "4aaaa8732d1a"
      ]
    }
  }
} as const satisfies Record<MarketingAudienceProfile, MarketingImageHashes>;

export const MARKETING_STUDY_WIDTHS = {
  landscape: [480, 768, 1200],
  portrait: [480, 768, 1024],
  detail: [320, 512, 768],
  twilight: [480, 768, 1200],
} as const satisfies Record<MarketingStudyFamily, readonly [number, number, number]>;

export const MARKETING_PROFILE_VIDEO_ASSETS = {
  "hollywood-filmmakers": {
    "video": "/assets/marketing/glass-meridian-scene-8s.e1e6cd002d17.mp4",
    "poster": "/assets/marketing/glass-meridian-scene-poster-960.f1b46985231e.jpg"
  },
  "marketers": {
    "video": "/assets/marketing/brighter-hour-scene-8s.5eadee7d4d8f.mp4",
    "poster": "/assets/marketing/brighter-hour-scene-poster-960.87d6d6117994.jpg"
  },
  "indie-filmmakers": {
    "video": "/assets/marketing/mercer-midnight-scene-8s.f0fe0d0eb991.mp4",
    "poster": "/assets/marketing/mercer-midnight-scene-poster-960.2295e480fb09.jpg"
  }
} as const satisfies Record<MarketingAudienceProfile, { video: string; poster: string }>;
