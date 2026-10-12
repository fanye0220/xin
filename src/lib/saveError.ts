/**
 * 把存储层（IndexedDB）的写入失败翻译成人能看懂的话。
 *
 * 浏览器给的原因很不统一：空间写满时通常报 QuotaExceededError；但有的引擎（尤其
 * iOS WebKit）是在事务"提交阶段"才做配额检查，抛出来的只是一个光秃秃的
 * AbortError，看不出到底是不是满了；而多个标签页/窗口抢同一个数据库时，报的同样
 * 也是 AbortError。所以这里统一按 name/message 分类，再用
 * navigator.storage.estimate() 拿真实占用做佐证，而不是把浏览器英文原文甩给用户。
 */

export type SaveFailureKind = 'quota' | 'aborted' | 'blocked' | 'unknown';

/** 判断一次写入失败属于哪一类。 */
export function classifySaveFailure(err: any): SaveFailureKind {
  const name = String(err?.name || '');
  const text = `${name} ${err?.message || err || ''}`;
  // 老式 DOMException 的 code: 22 = QUOTA_EXCEEDED_ERR
  if (err?.code === 22 || /quota|exceed/i.test(text)) return 'quota';
  if (/abort/i.test(text)) return 'aborted';
  if (/blocked/i.test(text)) return 'blocked';
  return 'unknown';
}

/** 一句话版：用在"逐文件错误列表"这种一行一条的位置。 */
export function describeSaveFailureShort(err: any): string {
  const kind = classifySaveFailure(err);
  if (kind === 'quota') return '写入失败：本地存储已满，浏览器拒绝了写入';
  if (kind === 'aborted') {
    return '写入被中止：常见原因是本地存储已满，也可能是 MIU 同时开在别的标签页/窗口';
  }
  if (kind === 'blocked') return '写入被中断：可能 MIU 同时开在别的标签页/窗口里';
  return String(err?.message || err || '未知错误');
}

/** 详细版：用在弹窗，附带当前实际占用与上限。 */
export async function describeSaveFailure(err: any): Promise<string> {
  const kind = classifySaveFailure(err);
  let hint = '';
  if (kind === 'quota') {
    hint = '存储空间已满，浏览器拒绝了这次写入。';
  } else if (kind === 'aborted') {
    hint =
      '数据库写入被中止：常见原因是本地存储已满，其次可能是 MIU 同时开在别的标签页/窗口，或系统回收了页面。';
  } else if (kind === 'blocked') {
    hint = '数据库写入被中断（可能 MIU 同时开在别的标签页/窗口里）。';
  }

  try {
    const est: any = await (navigator as any)?.storage?.estimate?.();
    if (est && est.quota) {
      const usedMb = Math.round((est.usage || 0) / 1048576);
      const quotaMb = Math.round(est.quota / 1048576);
      const percent = Math.min(100, Math.round(((est.usage || 0) / est.quota) * 100));
      hint += `${hint ? ' ' : ''}当前占用约 ${usedMb}MB / 上限约 ${quotaMb}MB（${percent}%）。`;
      if (percent >= 90) {
        hint += '已经接近上限，建议先删掉一些不用的卡片或历史版本再重试。';
      }
    }
  } catch {}

  const raw = `${err?.name || ''} ${err?.message || err || ''}`.trim();
  return hint || raw || '未知错误';
}
