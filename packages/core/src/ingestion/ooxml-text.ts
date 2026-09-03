/**
 * OOXML（.xlsx / .docx）→ 纯文本。**零依赖**：`zlib.inflateRawSync` + 手写 zip 中央目录解析。
 *
 * ## 为什么底座要做这件事
 *
 * 「用户在对话框传了一份 Excel，期待 AI 能读」这个期待**与宿主是谁无关**——它是通用底座该兜的能力。
 * 从前这条链的终点是 `emit.ts` 的 workspace 分支：原件落进会话工作区，再告诉模型
 * 「该类型无法直接提取为文本，请用 xlsx skill / 文件工具处理」。那句话在**通用助理**上成立
 * （它确实有 xlsx skill 与 run_shell），但在**业务宿主**的轮次上不成立：宿主的工具面是按岗位
 * 裁剪后的结论，平台 skill 走 `intersect_strict(requestIds, profileIds, allowedSkillIds)`
 * ——宿主 agent 不声明平台 skill 时那个交集是空的。于是模型收到一条「文件在路径 X」，
 * 手里却没有任何能打开 X 的东西，**只能开始猜**。
 *
 * 🔴 所以这一档补在 workspace **之前**，而不是替换它：原件照旧落盘（需要精细处理时仍可用），
 * 只是「能抽出文字就把文字也一起给模型」。抽不出来时说清是哪一种读不了，
 * 由 `emit.ts` 如实交给模型——**不许退回一句笼统的「二进制文档」**，那会让模型跟着复述、
 * 或者更坏，把读不到说成空文件。
 *
 * ## 判据来源（不要在这里另立一套）
 *
 * 本文件是 `aerp/packages/server/src/runtime/attachmentRead.ts` 那份抽取器的**同判据移植**
 * （两仓无法互相 import，所以是两份代码、一套判据）。命名空间前缀、`sharedStrings` 与
 * `inlineStr`、按 `r="C3"` 补空列、zip bomb 上界、CFB 魔数分档——逐条对齐。
 * 🔴 **改这里必须同步改那边**：两份判据漂开的表现是「同一个文件在两条路上读出来不一样」，
 * 而两边各自看都正常。
 *
 * 🔴 **pptx 刻意不做**（与 aerp 侧同）：正文分散在 `ppt/slides/slideN.xml`、顺序要另读
 * presentation.xml、备注还在另一组部件里——那是另一件事，不为凑齐而凑齐。
 * pptx 因此照旧走 workspace（`normalize.ts` 的 `ORIGINAL_DOWNLOAD_EXTENSIONS` 本来就为它下原件）。
 */

import { inflateRawSync } from 'node:zlib';

/**
 * 抽取结论。`reason` 会原样进注入文本，所以必须说得出**是哪一种**读不了。
 *
 * 🔴 判别位是**字符串** `kind`（与 aerp 侧 `AttachmentExtraction` 同形），不是 `ok: boolean`：
 * 本仓 `tsconfig` 是 `strict: false` ⇒ `strictNullChecks` 关 ⇒ **布尔字面量判别位不收窄**，
 * `if (!got.ok)` 之后 `got.reason` 直接是编译错误（仓里已有若干同形态的存量报错）。
 */
export type OoxmlExtraction =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'unreadable'; readonly reason: string };

/** 可抽取的两档。判据取扩展名——ObsFile 这条 wire 上没有可信的内容类型 */
export type OoxmlKind = 'xlsx' | 'docx';

/** 扩展名 → 档位；不在表里的（.pptx / .pdf / .xls / .doc）返回 null，照旧走 workspace */
export function ooxmlKindOf(fileName: string): OoxmlKind | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase();
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
  if (ext === 'docx') return 'docx';
  return null;
}

class OoxmlReadError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'OoxmlReadError';
  }
}

/**
 * 解压总量上界。
 *
 * 入站只保证**压缩后** ≤ `DOWNLOAD_MAX_BYTES`（10MB），而 XML 的压缩比轻松上百倍——
 * 没有这条界，一份合法上传的 xlsx 就能把进程内存打穿（zip bomb 的标准形态）。
 */
const OOXML_INFLATE_BUDGET = 64 * 1024 * 1024;

/** OLE/CFB 复合文档的魔数：97-2003 的 .xls/.doc，以及 ECMA-376 加密包都长这样 */
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

type ZipRead = (name: string) => Uint8Array | null;

interface ZipEntry {
  readonly method: number;
  readonly flags: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localOffset: number;
}

/**
 * 打开一个 zip，返回按部件名取字节的函数。
 *
 * 🔴 不做通用 zip 库：只支持 stored / deflate 与 32 位中央目录——那覆盖了全部
 * Excel / WPS / LibreOffice / OpenXML SDK 写出来的 xlsx。其余形态一律抛，
 * 因为「读了一半」在这条链上等价于「编内容」。
 */
function openZip(bytes: Uint8Array): ZipRead {
  if (CFB_MAGIC.every((byte, i) => bytes[i] === byte)) {
    throw new OoxmlReadError(
      '这份文件是 OLE 复合文档：要么是 97-2003 的老格式（.xls / .doc），要么是**加了打开密码**的 Office 文件。两种这条读链都打不开。',
    );
  }
  if (bytes.byteLength < 22) throw new OoxmlReadError('这份文件太小，不是一个完整的 zip 包。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number): number => view.getUint32(at, true);
  const u16 = (at: number): number => view.getUint16(at, true);

  // 中央目录尾（EOCD）在文件末尾，后面可能还挂着 ≤64KB 的注释，所以从尾部往回扫
  let eocd = -1;
  const floor = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let at = bytes.byteLength - 22; at >= floor; at -= 1) {
    if (u32(at) === 0x0605_4b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) {
    throw new OoxmlReadError('这份文件不是一个完整的 zip 包（找不到中央目录），多半在传输或保存时损坏了。');
  }

  const count = u16(eocd + 10);
  const cdOffset = u32(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffff_ffff) {
    throw new OoxmlReadError('这份文件用的是 zip64 格式，这条读链只支持常规 zip。');
  }

  const entries = new Map<string, ZipEntry>();
  let at = cdOffset;
  const utf8 = new TextDecoder('utf-8');
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > bytes.byteLength || u32(at) !== 0x0201_4b50) {
      throw new OoxmlReadError('这份文件的 zip 中央目录读不下去了，多半在传输或保存时损坏了。');
    }
    const nameLen = u16(at + 28);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    entries.set(name, {
      flags: u16(at + 8),
      method: u16(at + 10),
      compressedSize: u32(at + 20),
      size: u32(at + 24),
      localOffset: u32(at + 42),
    });
    at += 46 + nameLen + u16(at + 30) + u16(at + 32);
  }

  let inflated = 0;
  return (name: string): Uint8Array | null => {
    const entry = entries.get(name);
    if (!entry) return null;
    // bit 0 = 传统 zip 加密。与「Office 文档加密」不是一回事，但对用户是同一句话
    if ((entry.flags & 0x1) !== 0) throw new OoxmlReadError('这份文件被加密了，需要密码才能打开。');
    inflated += entry.size;
    if (inflated > OOXML_INFLATE_BUDGET) {
      throw new OoxmlReadError('这份文件解压后过大，超出了这条读链的处理上界。');
    }
    const head = entry.localOffset;
    if (head + 30 > bytes.byteLength || u32(head) !== 0x0403_4b50) {
      throw new OoxmlReadError('这份文件的 zip 条目头读不出来，多半在传输或保存时损坏了。');
    }
    // 🔴 尺寸取**中央目录**里那一份：local header 在带 data descriptor 时写的是 0
    const from = head + 30 + u16(head + 26) + u16(head + 28);
    const raw = bytes.subarray(from, from + entry.compressedSize);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return new Uint8Array(inflateRawSync(raw));
    throw new OoxmlReadError(`这份文件里用了这条读链不支持的压缩方式（method ${String(entry.method)}）。`);
  };
}

// ── OOXML：XML 取文字 ──────────────────────────────────────────────────────
//
// 🔴 **一律按「可有命名空间前缀」匹配**：同一份 xlsx，LibreOffice 写的是 `<row>`，
// 而 OpenXML SDK（officecli 等）写的是 `<x:row>`；rels 里的 `Target` 有相对（`worksheets/sheet1.xml`）
// 也有绝对（`/xl/worksheets/sheet1.xml`），`Id` 既有 `rId1` 也有 `R28cb8d76…` 这种随机串。
// 只认其中一种写法的实现，在另一种真实文件上会**安静地抽出空白**——那正是本文件
// 最不允许出现的形态。以上都是 aerp 侧实测到的差异，不是防御性猜测。

/** 元素名的可选命名空间前缀，如 `x:` / `w:` */
const NS = '(?:[A-Za-z0-9_.-]+:)?';

function decodeXmlEntities(raw: string): string {
  return raw.replace(/&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    const named: Readonly<Record<string, string>> = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    };
    return named[body] ?? whole;
  });
}

/** 取一段 XML 里所有 `<t>` 的文字（`<rPh>` 是日文注音，先摘掉，否则会混进正文） */
function textOfRuns(xml: string): string {
  const withoutPhonetic = xml.replace(new RegExp(`<${NS}rPh\\b[\\s\\S]*?</${NS}rPh>`, 'g'), '');
  let out = '';
  for (const hit of withoutPhonetic.matchAll(new RegExp(`<${NS}t\\b[^>]*>([\\s\\S]*?)</${NS}t>`, 'g'))) {
    out += decodeXmlEntities(hit[1] ?? '');
  }
  return out;
}

function attributeOf(tag: string, name: string): string | null {
  const hit = new RegExp(`(?:^|\\s)(?:[A-Za-z0-9_.-]+:)?${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return hit?.[1] === undefined ? null : decodeXmlEntities(hit[1]);
}

/** `AB12` → 列序号 27（0 基）。取不到就返回 null，由调用方按「接着上一格」处理 */
function columnIndexOf(cellRef: string | null): number | null {
  if (cellRef === null) return null;
  const letters = /^([A-Za-z]+)/.exec(cellRef)?.[1];
  if (letters === undefined) return null;
  let index = 0;
  for (const ch of letters.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

// ── xlsx → 制表符分隔的纯文本 ──────────────────────────────────────────────

function sharedStringsOf(read: ZipRead): readonly string[] {
  const part = read('xl/sharedStrings.xml');
  if (part === null) return [];
  const xml = new TextDecoder('utf-8').decode(part);
  const out: string[] = [];
  for (const hit of xml.matchAll(new RegExp(`<${NS}si\\b[^>]*>([\\s\\S]*?)</${NS}si>`, 'g'))) {
    out.push(textOfRuns(hit[1] ?? ''));
  }
  return out;
}

/** 工作表清单：`workbook.xml` 给顺序与名字，`workbook.xml.rels` 给到部件的落点 */
function sheetsOf(read: ZipRead): readonly { readonly name: string; readonly part: string }[] {
  const workbookPart = read('xl/workbook.xml');
  if (workbookPart === null) {
    throw new OoxmlReadError('这份文件里没有 Excel 的工作簿部件（xl/workbook.xml），它不是一份完整的 .xlsx。');
  }
  const workbook = new TextDecoder('utf-8').decode(workbookPart);

  const targets = new Map<string, string>();
  const relsPart = read('xl/_rels/workbook.xml.rels');
  if (relsPart !== null) {
    const rels = new TextDecoder('utf-8').decode(relsPart);
    for (const hit of rels.matchAll(/<Relationship\b([^>]*)>/g)) {
      const tag = hit[1] ?? '';
      const id = attributeOf(tag, 'Id');
      const target = attributeOf(tag, 'Target');
      if (id === null || target === null) continue;
      // 绝对（`/xl/worksheets/sheet1.xml`）与相对（`worksheets/sheet1.xml`）两种都见过
      targets.set(id, target.startsWith('/') ? target.replace(/^\/+/, '') : `xl/${target.replace(/^\.\//, '')}`);
    }
  }

  const sheets: { name: string; part: string }[] = [];
  for (const hit of workbook.matchAll(new RegExp(`<${NS}sheet(?=[\\s/>])([^>]*)>`, 'g'))) {
    const tag = hit[1] ?? '';
    const name = attributeOf(tag, 'name') ?? `Sheet${String(sheets.length + 1)}`;
    const relId = attributeOf(tag, 'id');
    const part = (relId === null ? null : targets.get(relId)) ?? `xl/worksheets/sheet${String(sheets.length + 1)}.xml`;
    sheets.push({ name, part });
  }
  return sheets;
}

/** 一张工作表 → 每行一条制表符分隔的文本。末尾空行去掉 */
function rowsOfSheet(xml: string, shared: readonly string[]): readonly string[] {
  const rows: string[] = [];
  for (const rowHit of xml.matchAll(new RegExp(`<${NS}row\\b[^>]*>([\\s\\S]*?)</${NS}row>`, 'g'))) {
    const cells: string[] = [];
    let cursor = 0;
    const cellPattern = new RegExp(`<${NS}c(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}c>)`, 'g');
    for (const cellHit of (rowHit[1] ?? '').matchAll(cellPattern)) {
      const tag = cellHit[1] ?? '';
      const body = cellHit[2] ?? '';
      // 🔴 按 `r="B2"` 补空格：不补的话「A 列空着」的行会整体左移一格，
      // 而错位后的表格看起来完全正常
      const at = columnIndexOf(attributeOf(tag, 'r')) ?? cursor;
      while (cells.length < at) cells.push('');
      const type = attributeOf(tag, 't');
      const value = new RegExp(`<${NS}v\\b[^>]*>([\\s\\S]*?)</${NS}v>`).exec(body)?.[1] ?? '';
      let text: string;
      if (type === 's') text = shared[Number(decodeXmlEntities(value))] ?? '';
      else if (type === 'inlineStr') text = textOfRuns(body);
      else if (type === 'b') text = decodeXmlEntities(value) === '1' ? 'TRUE' : 'FALSE';
      else text = decodeXmlEntities(value); // 数字 / 日期序列值 / str / 错误值一律原样
      cells.push(text);
      cursor = at + 1;
    }
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    rows.push(cells.join('\t'));
  }
  while (rows.length > 0 && (rows[rows.length - 1] ?? '').trim() === '') rows.pop();
  return rows;
}

/**
 * xlsx → 文本。
 *
 * 🔴 **不做样式与日期格式**：日期在 xlsx 里是一个数 + 一条 numFmt，还原它要把整套
 * 样式表与格式代码搬进来——那正是「不为读 Excel 引一个完整 Excel 库」那条判据要挡的东西。
 * 日期因此按存储值原样交出。**说清楚比猜一个像样的日期重要**（猜错了没有症状）。
 *
 * 多个 sheet 时按 `# <sheet 名>` 分段；单 sheet 不加标题（那一行对模型没有信息量）。
 */
function xlsxText(read: ZipRead): OoxmlExtraction {
  const shared = sharedStringsOf(read);
  const sheets = sheetsOf(read);
  const utf8 = new TextDecoder('utf-8');
  const sections: { readonly name: string; readonly rows: readonly string[] }[] = [];
  for (const sheet of sheets) {
    const part = read(sheet.part);
    if (part === null) continue;
    sections.push({ name: sheet.name, rows: rowsOfSheet(utf8.decode(part), shared) });
  }
  const withRows = sections.filter((section) => section.rows.length > 0);
  if (withRows.length === 0) {
    return {
      kind: 'unreadable',
      reason: '这份 Excel 里没有可抽取的文字（可能整张表都是图表 / 图片，或者数据在数据透视缓存里）。',
    };
  }
  const text =
    withRows.length === 1
      ? (withRows[0]?.rows ?? []).join('\n')
      : withRows.map((section) => `# ${section.name}\n${section.rows.join('\n')}`).join('\n\n');
  return { kind: 'text', text };
}

// ── docx → 纯文本 ──────────────────────────────────────────────────────────

/**
 * docx 与 xlsx 同为 OOXML zip，正文在 `word/document.xml`。
 * zip 那一层已经有了，所以这一档只是「段落换行、制表符还原、去标签、解实体」。
 */
function docxText(read: ZipRead): OoxmlExtraction {
  const part = read('word/document.xml');
  if (part === null) {
    throw new OoxmlReadError('这份文件里没有 Word 的正文部件（word/document.xml），它不是一份完整的 .docx。');
  }
  const xml = new TextDecoder('utf-8').decode(part);
  const text = decodeXmlEntities(
    xml
      .replace(new RegExp(`<${NS}tab\\b[^>]*/?>`, 'g'), '\t')
      .replace(new RegExp(`<${NS}(?:br|cr)\\b[^>]*/?>`, 'g'), '\n')
      .replace(new RegExp(`</${NS}p>`, 'g'), '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text === '') {
    return {
      kind: 'unreadable',
      reason: '这份 Word 文档里没有可抽取的文字（可能整篇都是图片，或正文在文本框 / 批注里）。',
    };
  }
  return { kind: 'text', text };
}

/**
 * 两档共用的入口：把 `OoxmlReadError` 收敛成**说得出是哪一种**读不了的结论。
 *
 * 🔴 未预料到的错误**不把原文交给模型**（原文里可能带着字节偏移之类的噪音），
 * 但也**绝不说成空文件**——两者都会让模型开始编。原文进日志，模型拿一句能照着说的话。
 */
export function extractOoxmlText(bytes: Uint8Array, what: OoxmlKind): OoxmlExtraction {
  try {
    const read = openZip(bytes);
    return what === 'xlsx' ? xlsxText(read) : docxText(read);
  } catch (error: unknown) {
    if (error instanceof OoxmlReadError) return { kind: 'unreadable', reason: error.reason };
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: 'unreadable',
      reason: `服务端这次没能解析这份 ${what === 'xlsx' ? 'Excel' : 'Word'} 文件（${detail}）。`,
    };
  }
}
