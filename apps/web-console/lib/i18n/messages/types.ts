import { zh } from './zh/index.ts';

export type Messages = typeof zh;

type LeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? Prefix extends ''
      ? K
      : `${Prefix}.${K}`
    : LeafPaths<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>;
}[keyof T & string];

/** 叶子节点的点路径，如 `common.language` */
export type MessageKey = LeafPaths<Messages>;
