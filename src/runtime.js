export function assetRoot(moduleUrl = import.meta.url) {
  return new URL(moduleUrl.includes('/releases/') ? '../../../' : '../', moduleUrl);
}

export async function withDeadline(promise, milliseconds, reason = 'TIMEOUT') {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(reason), {code: reason})), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function runWithCancel(promise, milliseconds, reason, signal, getWorker = () => null) {
  let timer;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    if (!signal) return;
    onAbort = () => {
      try { getWorker()?.terminate(); } catch {}
      reject(Object.assign(new Error('辨識已取消'), {code: 'CANCELLED'}));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, {once: true});
  });
  try {
    return await Promise.race([
      promise,
      aborted,
      new Promise((_, reject) => { timer = setTimeout(() => { try { getWorker()?.terminate(); } catch {} reject(Object.assign(new Error(reason), {code: reason})); }, milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

export function abortError(signal) {
  if (signal?.aborted) throw Object.assign(new Error('辨識已取消'), {code: 'CANCELLED'});
}
