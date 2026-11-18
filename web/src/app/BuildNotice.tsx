import { useEffect, useState } from 'react';
import { useLocale } from '../locale';
export function BuildNotice() {
  const { t } = useLocale();
  const [update, setUpdate] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let active = true;
    const check = async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}app-version.json`, { cache: 'no-store' });
        if (!r.ok) return;
        const data = (await r.json()) as { buildId?: string };
        if (active && data.buildId && data.buildId !== __APP_BUILD_ID__) setUpdate(true);
      } catch {
        /* offline mode */
      }
    };
    void check();
    const interval = setInterval(() => {
      void check();
    }, 30000);
    const visible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return update ? (
    <div className="build-notice" role="status">
      <span>
        {t(
          'Доступна новая версия. Обновление очистит текущий разговор — сначала завершите его.',
          'Жаңа нұсқа қолжетімді. Жаңарту ағымдағы әңгімені тазартады — алдымен оны аяқтаңыз.',
        )}
      </span>
      <button
        onClick={() => {
          location.reload();
        }}
      >
        {t('Обновить приложение', 'Қолданбаны жаңарту')}
      </button>
    </div>
  ) : null;
}
