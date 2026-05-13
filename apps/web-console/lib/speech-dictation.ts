/**
 * Browser Web Speech API（听写）— 处理前缀差异；不依赖 TS lib 中的 SpeechRecognition 全局声明。
 * 仅用于客户端；SSR 或禁用时返回 null。
 */

/** 听写所需的最小 API 面，兼容 Chromium / WebKit 前缀实现 */
export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
  stop(): void;
};

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};

export type SpeechRecognitionErrorEventLike = { error: string };

export type SpeechRecognitionResultListLike = {
  readonly length: number;
  [index: number]: {
    readonly isFinal: boolean;
    readonly 0: { readonly transcript: string };
  };
};

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
