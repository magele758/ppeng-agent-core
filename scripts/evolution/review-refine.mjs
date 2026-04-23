/**
 * Review + refine loop for evolution-run-day.
 *
 * Extracted from the monolithic `runReviewRefineLoop` to keep the orchestrator
 * thinner and to make this very-likely-to-evolve flow (review prompt shape,
 * verdict format, refine timing) easier to iterate on in isolation.
 *
 * Pure dependency injection — no global state, no `repoRoot` capture, no
 * imports from `evolution-run-day.mjs`. Caller passes a `deps` bundle with the
 * helpers that already exist in the orchestrator.
 *
 * Loop:
 *   for each round:
 *     1. clear artifacts
 *     2. ask reviewer hook → must write `.evolution/review-verdict.txt`
 *     3. APPROVE → return ok
 *        NEEDS_WORK → run refine hook → commit → optional build → test → loop
 *     4. After maxRounds without APPROVE → return failure
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{
 *   wtPath: string,
 *   targetBranch: string,
 *   title: string,
 *   link: string,
 *   excerptFile: string,
 *   constraintsFile: string,
 *   testCmd: string,
 *   buildCmd: string,
 *   skipBuild: boolean,
 *   reviewCmd: string,
 *   itemTrace: (msg: string) => void
 * }} ReviewRefineOptions
 *
 * @typedef {{
 *   sh: (cmd: string, cwd: string, opts?: object) => Promise<{ code: number, out: string, err: string }>,
 *   clampAgentCliPrompt: (s: string, label: string) => string,
 *   enrichEnvForRunDayTests: () => NodeJS.ProcessEnv,
 *   resolveAgentCmdForWorktree: (wtPath: string, cmd: string) => { run: string, note: string },
 *   envForAgentHook: (wtPath: string, title: string, link: string, excerptFile: string, constraintsFile: string, extraEnv?: object) => NodeJS.ProcessEnv,
 *   clearReviewArtifacts: (wtPath: string) => Promise<void>,
 *   getWorktreeDiffVsBase: (wtPath: string, targetBranch: string, maxChars: number) => Promise<string>,
 *   parseReviewVerdict: (wtPath: string) => 'approve' | 'needs_work' | 'invalid',
 *   commitWorktreeChangesExcludingEvolution: (wtPath: string, msg: string, itemTrace: (msg: string) => void) => Promise<{ committed: boolean }>
 * }} ReviewRefineDeps
 */

/** @param {ReviewRefineOptions} options @param {ReviewRefineDeps} deps */
export async function runReviewRefineLoop(options, deps) {
  const {
    wtPath,
    targetBranch,
    title,
    link,
    excerptFile,
    constraintsFile,
    testCmd,
    buildCmd,
    skipBuild,
    reviewCmd,
    itemTrace
  } = options;
  const {
    sh,
    clampAgentCliPrompt,
    enrichEnvForRunDayTests,
    resolveAgentCmdForWorktree,
    envForAgentHook,
    clearReviewArtifacts,
    getWorktreeDiffVsBase,
    parseReviewVerdict,
    commitWorktreeChangesExcludingEvolution
  } = deps;

  const maxRounds = Math.max(1, Number(process.env.EVOLUTION_REVIEW_MAX_ROUNDS ?? 5) || 5);
  const diffCap = Math.max(4000, Number(process.env.EVOLUTION_REVIEW_DIFF_MAX_CHARS ?? 56_000) || 56_000);
  const refineCmd =
    process.env.EVOLUTION_REFINE_CMD?.trim() || process.env.EVOLUTION_AGENT_CMD?.trim() || '';
  const planFile = join(wtPath, '.evolution', 'dev-plan.md');
  let extraOut = '';
  let extraErr = '';
  let finalTestCode = 0;
  let hadCommits = false;

  const { run: reviewRunCmd, note: reviewNote } = resolveAgentCmdForWorktree(wtPath, reviewCmd);
  if (reviewNote) itemTrace(reviewNote);

  for (let round = 0; round < maxRounds; round++) {
    await clearReviewArtifacts(wtPath);
    const diffText = await getWorktreeDiffVsBase(wtPath, targetBranch, diffCap);
    let planExcerpt = '';
    if (existsSync(planFile)) {
      planExcerpt = readFileSync(planFile, 'utf8').slice(0, 12000);
    }
    const excerptHint = existsSync(excerptFile) ? readFileSync(excerptFile, 'utf8').slice(0, 6000) : '';
    const reviewPrompt =
      `You are a senior reviewer for a TypeScript/Node monorepo worktree at:\n${wtPath}\n\n` +
      `Source task title: ${title}\n` +
      `Source URL: ${link}\n\n` +
      `## Original excerpt (context)\n\n${excerptHint || '_(none)_'}\n\n` +
      `## Development plan (if any)\n\n${planExcerpt || '_(no .evolution/dev-plan.md)_'}\n\n` +
      `## git diff ${targetBranch}...HEAD\n\n\`\`\`diff\n${diffText}\n\`\`\`\n\n` +
      `Your job:\n` +
      `1. Judge whether the changes are correct, minimal, and safe to merge.\n` +
      `2. Write EXACTLY this file first: .evolution/review-verdict.txt\n` +
      `   - Line 1 must be either: APPROVE   OR   NEEDS_WORK\n` +
      `   - Optional following lines: brief summary.\n` +
      `3. If line 1 is NEEDS_WORK, write .evolution/review-feedback.md with concrete, actionable bullets for the implementer (files, what to fix, edge cases, tests).\n` +
      `4. Do NOT modify source code in this review step — only write those two files under .evolution/.\n` +
      `5. Prefer APPROVE only if you would be comfortable merging as-is.\n`;

    const tRev = Date.now();
    const revRes = await sh(reviewRunCmd, wtPath, {
      env: {
        ...envForAgentHook(wtPath, title, link, excerptFile, constraintsFile),
        EVOLUTION_REVIEW_ROUND: String(round + 1),
        AI_FIX_PROMPT: clampAgentCliPrompt(reviewPrompt, 'EVOLUTION_REVIEW_CMD')
      }
    });
    extraOut += revRes.out;
    extraErr += revRes.err;
    itemTrace(`审查钩子 round ${round + 1}/${maxRounds} → exit=${revRes.code} (${Date.now() - tRev}ms)`);
    if (revRes.code !== 0) {
      return {
        ok: false,
        finalTestCode,
        extraOut,
        extraErr,
        hadCommits,
        analysis: `EVOLUTION_REVIEW_CMD 非零退出（第 ${round + 1} 轮）。`,
        errTail: revRes.out + revRes.err
      };
    }

    const verdict = parseReviewVerdict(wtPath);
    if (verdict === 'approve') {
      itemTrace(`审查结论: APPROVE（第 ${round + 1} 轮）`);
      return { ok: true, finalTestCode, extraOut, extraErr, rounds: round + 1, hadCommits };
    }
    if (verdict !== 'needs_work') {
      return {
        ok: false,
        finalTestCode,
        extraOut,
        extraErr,
        hadCommits,
        analysis: `审查 verdict 无效（需 .evolution/review-verdict.txt 首行 APPROVE 或 NEEDS_WORK）。第 ${round + 1} 轮。`,
        errTail: extraOut + extraErr
      };
    }

    itemTrace(`审查结论: NEEDS_WORK → 启动精炼（第 ${round + 1} 轮）`);
    if (!refineCmd) {
      return {
        ok: false,
        finalTestCode,
        extraOut,
        extraErr,
        hadCommits,
        analysis:
          '审查要求修改但未设置 EVOLUTION_REFINE_CMD 或 EVOLUTION_AGENT_CMD，无法精炼。',
        errTail: extraOut + extraErr
      };
    }

    const fbPath = join(wtPath, '.evolution', 'review-feedback.md');
    const feedback = existsSync(fbPath)
      ? readFileSync(fbPath, 'utf8')
      : '_(review did not write review-feedback.md — fix the issues implied by the diff)_';

    const refinePrompt =
      `You are implementing follow-up fixes in a git worktree at:\n${wtPath}\n\n` +
      `Task: ${title}\n` +
      `Address the code review feedback below. Make minimal, targeted edits; do not refactor unrelated code.\n` +
      `Run: ${testCmd} before finishing and fix failures.\n` +
      `Do NOT commit — the pipeline will commit for you.\n\n` +
      `## Review feedback\n\n${feedback.slice(0, 16000)}\n\n` +
      `## Plan reference\n\n${planExcerpt ? planExcerpt.slice(0, 8000) : '_(none)_'}\n`;

    const { run: refineRunCmd, note: refineNote } = resolveAgentCmdForWorktree(wtPath, refineCmd);
    if (refineNote) itemTrace(refineNote);
    const tRef = Date.now();
    const refRes = await sh(refineRunCmd, wtPath, {
      env: {
        ...envForAgentHook(wtPath, title, link, excerptFile, constraintsFile),
        EVOLUTION_REVIEW_FEEDBACK_FILE: fbPath,
        AI_FIX_PROMPT: clampAgentCliPrompt(refinePrompt, 'EVOLUTION_REFINE_CMD')
      }
    });
    extraOut += refRes.out;
    extraErr += refRes.err;
    itemTrace(`精炼钩子 round ${round + 1} → exit=${refRes.code} (${Date.now() - tRef}ms)`);
    if (refRes.code !== 0) {
      return {
        ok: false,
        finalTestCode,
        extraOut,
        extraErr,
        hadCommits,
        analysis: `精炼命令非零退出（审查第 ${round + 1} 轮之后）。`,
        errTail: refRes.out + refRes.err
      };
    }

    const cref = await commitWorktreeChangesExcludingEvolution(
      wtPath,
      `evolution(refine): address review (round ${round + 1}) — ${title.slice(0, 45)}`,
      itemTrace
    );
    if (cref.committed) {
      hadCommits = true;
    } else if (cref.reason === 'commit_failed') {
      return {
        ok: false,
        finalTestCode,
        extraOut,
        extraErr,
        hadCommits,
        analysis: `审查要求修改，且精炼后的 git commit 失败（第 ${round + 1} 轮）。`,
        errTail: cref.out + cref.err
      };
    } else {
      return {
        ok: false,
        finalTestCode,
        extraOut,
        extraErr,
        hadCommits,
        analysis: `审查要求修改但精炼后无可提交改动（第 ${round + 1} 轮）。`,
        errTail: extraOut + extraErr
      };
    }

    if (!skipBuild && buildCmd) {
      const tB = Date.now();
      const bd = await sh(buildCmd, wtPath);
      extraOut += bd.out + bd.err;
      itemTrace(`精炼后构建「${buildCmd}」→ exit=${bd.code} (${Date.now() - tB}ms)`);
      if (bd.code !== 0) {
        return {
          ok: false,
          finalTestCode: bd.code,
          extraOut,
          extraErr,
          hadCommits,
          analysis: '精炼后构建失败。',
          errTail: bd.out + bd.err
        };
      }
    }

    const tT = Date.now();
    const runTest = await sh(testCmd, wtPath, { env: enrichEnvForRunDayTests() });
    extraOut += runTest.out;
    extraErr += runTest.err;
    finalTestCode = runTest.code;
    itemTrace(`精炼后测试「${testCmd}」→ exit=${finalTestCode} (${Date.now() - tT}ms)`);
    if (finalTestCode !== 0) {
      return {
        ok: false,
        finalTestCode,
        extraOut,
        extraErr,
        hadCommits,
        analysis: '精炼后测试未通过。',
        errTail: runTest.err || runTest.out
      };
    }
  }

  return {
    ok: false,
    finalTestCode,
    extraOut,
    extraErr,
    hadCommits,
    analysis: `审查在 ${maxRounds} 轮内未给出 APPROVE（仍 NEEDS_WORK 或反复要求修改）。`,
    errTail: extraOut + extraErr
  };
}
