import type { ApplyReport, FetchResult, OAuthImportResult, ReauthEvent } from "../types";

interface Props {
  emails: string[];
  running: boolean;
  /** 非 CDK 一键授权是否在跑 */
  oauthRunning: boolean;
  events: ReauthEvent[];
  result: FetchResult | null;
  report: ApplyReport | null;
  oauthReport: OAuthImportResult | null;
  onStart: () => void;
  onStartOAuth: () => void;
  onCancel: () => void;
  onClear: () => void;
  onOpenUrl: (url: string) => void;
}

type StepEvent = Extract<ReauthEvent, { event: "step" }>;

const STEP_LABEL: Record<string, string> = {
  spawn: "启动浏览器自动化",
  open: "打开门页",
  detect: "检测门页状态",
  gate: "填写 CDK 进入",
  emails: "填入邮箱",
  go: "点击获取令牌",
  "poll-done": "轮询结束",
  copy: "复制全部并读剪切板",
  cpa: "CPA 转换",
  apply: "匹配账号并写回",
  applied: "写回完成",
  // ---- 非 CDK 路径 ----
  warmup: "有机预热（同域浏览）",
  import: "导入邮箱到收码站",
  code: "等待邮箱验证码",
  exchange: "换取凭证",
  consent: "等待授权确认",
};

/** 非 CDK 路径停在哪个阶段 —— 人类可读。 */
const OAUTH_STAGE_LABEL: Record<string, string> = {
  done: "授权完成",
  need_code: "需人工填验证码",
  need_password: "账号要密码",
  blocked: "被风控拦下",
  timeout: "超时",
  cancelled: "已取消",
  error: "出错",
  exchange_failed: "换凭证失败",
};

function lineOf(e: ReauthEvent): { text: string; cls: string } | null {
  switch (e.event) {
    case "step":
      return { text: `▸ ${e.msg}`, cls: "" };
    case "poll":
      return {
        text: `  [${e.t}] stat=${e.stat || "-"}  dlAll=${e.dlAll}  copyAll=${e.copyAll}`,
        cls: "dim",
      };
    case "log":
      return { text: e.msg, cls: "dim" };
    case "error":
      return { text: `✗ ${e.msg}`, cls: "err" };
    case "done":
      return { text: "✓ 结果已就绪（含 refresh_token）", cls: "ok" };
    case "banned":
      return { text: `⚠ 检测到被封禁/停用账号：${e.emails.join(", ")}`, cls: "warn" };
    case "deleted": {
      const ok = e.deleted.filter((o) => o.ok).length;
      const bad = e.deleted.length - ok;
      const list = e.deleted.map((o) => `#${o.account_id} ${o.email}${o.ok ? "" : "(" + o.message + ")"}`).join(", ");
      return { text: `已删除 ${ok}/${e.deleted.length} 个被封禁账号${list ? "：" + list : ""}${bad > 0 ? `（${bad} 个失败）` : ""}`, cls: bad > 0 ? "warn" : "ok" };
    }
    case "exit":
      return {
        text: e.success ? "✓ 进程正常退出" : `✗ 进程退出（code=${e.code ?? "null"}）`,
        cls: e.success ? "ok" : "err",
      };
    case "raw":
      return { text: e.line, cls: "dim" };
    default:
      return null;
  }
}

export default function ReauthRunner({
  emails,
  running,
  oauthRunning,
  events,
  result,
  report,
  oauthReport,
  onStart,
  onStartOAuth,
  onCancel,
  onClear,
  onOpenUrl,
}: Props) {
  const steps = events.filter((e): e is StepEvent => e.event === "step");
  const lastStep = steps.length > 0 ? steps[steps.length - 1].step : "";
  const hasClipboard = !!result?.clipboard;
  const hasCpaOutput = !!result?.cpaPage?.output;
  // 一键流程：fetch 结束后后端会自动 preview + apply，这里只反映状态
  const applying = running && lastStep === "apply";
  const busy = running || oauthRunning;

  return (
    <section className="runner">
      <div className="runner-head">
        <span className="title">
          一键重授权
          <span className="tiny muted" style={{ marginLeft: 8, fontWeight: 400 }}>
            {emails.length > 0 ? `已选 ${emails.length} 个邮箱` : "未勾选则处理全部 401 账号"}
          </span>
        </span>
        {(result || oauthReport) && (
          <button className="ghost" onClick={onClear} disabled={busy}>
            清空结果
          </button>
        )}
        {busy ? (
          <button className="danger" onClick={onCancel}>
            终止
          </button>
        ) : (
          <>
            <button
              className="primary"
              onClick={onStartOAuth}
              title="不消耗 CDK：sub2api 生成授权链接 → 浏览器填邮箱 → 收码站取验证码 → 换回凭证"
            >
              一键授权
            </button>
            <button
              className="ghost"
              onClick={onStart}
              title="走接码门页消耗 CDK 的原有路径"
            >
              cdk授权
            </button>
          </>
        )}
      </div>

      <div className="runner-body">
        <div className="timeline">
          {steps.length === 0 ? (
            <div className="tiny muted">
              【一键授权】sub2api 授权链接 → 有机预热 → 填邮箱 → 收码站取码 → 换凭证 ｜
              【cdk授权】门页 → 填 CDK → 填邮箱 → 获取令牌 → CPA 转换 → 写回
            </div>
          ) : (
            steps.map((s, i) => {
              const isLast = i === steps.length - 1;
              const cls = !running && isLast ? "done" : isLast ? "active" : "done";
              return (
                <div className="tl-item" key={`${s.step}-${i}`}>
                  <span className={`tl-dot ${cls}`} />
                  <span className="tl-text">
                    <b>{STEP_LABEL[s.step] ?? s.step}</b>
                    <div className="tl-sub">{s.msg}</div>
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="console">
          {events.length === 0 ? (
            <div className="ln dim">等待开始…</div>
          ) : (
            events.map((e, i) => {
              const l = lineOf(e);
              if (!l) return null;
              return (
                <div className={`ln ${l.cls}`} key={i}>
                  {l.text}
                </div>
              );
            })
          )}
          {running && lastStep !== "poll-done" && (
            <div className="ln dim">运行中…（每 5 秒轮询一次页面）</div>
          )}
        </div>
      </div>

      {result && (
        <div className="result-box">
          <div className="row-between">
            <span className="tiny">
              {result.done ? (
                <span className="badge ok">流程完成</span>
              ) : (
                <span className="badge warn">未检测到完成信号</span>
              )}{" "}
              <span className="muted" style={{ marginLeft: 6 }}>
                {result.emailsCount} 个邮箱
                {result.finalState?.stat ? ` · ${result.finalState.stat}` : ""}
                {result.finalState?.note ? ` · ${result.finalState.note}` : ""}
              </span>
            </span>
            <div className="actions">
              {result.cpaPage && (
                <button
                  className="ghost"
                  onClick={() => onOpenUrl(result.cpaPage!.url)}
                  title="可选查看；流程已自动访问 CPA 页并读取输出，无需手动操作"
                >
                  查看 CPA 页
                </button>
              )}
              <span className="tiny muted">
                {applying
                  ? "自动匹配并写回中…"
                  : !hasCpaOutput
                    ? "未拿到 CPA 输出"
                    : report
                      ? "已自动写回（含恢复调度）"
                      : ""}
              </span>
            </div>
          </div>

          <div className="hint">
            剪切板结果：{hasClipboard ? `${result.clipboard.length} 字符` : "空（可能回退到 #emails）"}
            {result.cpaPage && (
              <>
                {" "}
                · CPA 输出：{hasCpaOutput ? `${result.cpaPage.output.length} 字符` : "空"}
              </>
            )}
            {result.bannedEmails && result.bannedEmails.length > 0 && (
              <>
                {" "}
                · 检测到被封禁/停用：{result.bannedEmails.join(", ")}
              </>
            )}
          </div>

          {result.errors.length > 0 && (
            <details>
              <summary className="tiny muted" style={{ cursor: "pointer" }}>
                {result.errors.length} 条警告
              </summary>
              <div className="hint" style={{ marginTop: 6 }}>
                {result.errors.map((e, i) => (
                  <div key={i}>· {e}</div>
                ))}
              </div>
            </details>
          )}

          {report && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="row-between">
                <span className="tiny">
                  {report.dry_run ? "写回预览（自动执行中）" : "写回结果"}：匹配{" "}
                  {report.plans.length} 个账号
                  {report.skipped.length > 0 && ` · 跳过 ${report.skipped.length} 项`}
                  {!report.dry_run && ` · 成功 ${report.outcomes.filter((o) => o.ok).length}`}
                </span>
              </div>

              {report.plans.map((p) => {
                const outcome = report.outcomes.find((o) => o.account_id === p.account_id);
                return (
                  <div className="plan" key={p.account_id}>
                    <div className="plan-head">
                      <span className="mono">#{p.account_id}</span>
                      <span className="muted">{p.email}</span>
                      <span className="spacer" />
                      {outcome &&
                        (outcome.ok ? (
                          <span className="badge ok">已写回</span>
                        ) : (
                          <span className="badge err" title={outcome.message}>
                            失败
                          </span>
                        ))}
                    </div>
                    <ul>
                      {p.preview.map((f) => (
                        <li key={f.key} className={f.hidden ? "hidden" : undefined}>
                          {f.key}: {f.value}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}

              {report.skipped.length > 0 && (
                <div className="hint">跳过：{report.skipped.join("；")}</div>
              )}

              {!report.dry_run && (
                <div className="hint">
                  {report.outcomes.filter((o) => o.ok).length} 成功 /{" "}
                  {report.outcomes.filter((o) => !o.ok).length} 失败。可回列表刷新查看状态。
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {oauthReport && (
        <div className="result-box">
          <div className="row-between">
            <span className="tiny">
              <span className="badge dim">非 CDK 授权</span>{" "}
              <span className="muted" style={{ marginLeft: 6 }}>
                目标 {oauthReport.emails.length} 个账号 · 成功{" "}
                {oauthReport.outcomes.filter((o) => o.ok).length}
              </span>
            </span>
            <span className="tiny muted">
              {oauthReport.imported
                ? `邮箱导入：新增 ${oauthReport.imported.bound} · 已存在 ${oauthReport.imported.already_bound} · 未命中 ${oauthReport.imported.not_found}`
                : `邮箱导入失败：${oauthReport.import_error ?? "未配置收码站"}`}
            </span>
          </div>

          {oauthReport.imported && oauthReport.imported.missing.length > 0 && (
            <details>
              <summary className="tiny muted" style={{ cursor: "pointer" }}>
                {oauthReport.imported.missing.length} 个邮箱不在收码站总库（读不到验证码）
              </summary>
              <div className="hint" style={{ marginTop: 6 }}>
                {oauthReport.imported.missing.map((e, i) => (
                  <div key={i}>· {e}</div>
                ))}
              </div>
            </details>
          )}

          {oauthReport.outcomes.map((o) => (
            <div className="plan" key={o.account_id}>
              <div className="plan-head">
                <span className="mono">#{o.account_id}</span>
                <span className="muted">{o.email}</span>
                <span className="spacer" />
                <span className="badge dim">{OAUTH_STAGE_LABEL[o.stage] ?? o.stage}</span>
                {o.ok ? (
                  <span className="badge ok">已写回</span>
                ) : (
                  <span className="badge err" title={o.message}>
                    未完成
                  </span>
                )}
              </div>
              <ul>
                <li>{o.message}</li>
              </ul>
            </div>
          ))}

          {oauthReport.outcomes.some((o) => !o.ok) && (
            <div className="hint">
              被 Cloudflare / Sentinel 拦下的账号，可在左侧「收码站」勾选「使用有头窗口」后重试 ——
              窗口会弹出来，手动点一次「验证您是真人」即可继续。
            </div>
          )}
        </div>
      )}
    </section>
  );
}
