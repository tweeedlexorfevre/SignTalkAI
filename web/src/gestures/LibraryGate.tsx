import type { ReactNode } from 'react';
import { LogIn } from 'lucide-react';
import { useLocale } from '../locale';
import { Button } from '../components/ui';
import { library, type LibrarySnapshot } from './library';

/** Shown instead of the gesture tools while signed out, loading or failed. */
export function LibraryGate({ lib, children }: { lib: LibrarySnapshot; children: ReactNode }) {
  const { t } = useLocale();
  if (lib.status === 'anon')
    return (
      <div className="rounded-xl border border-line px-4 py-4 text-sm">
        <p className="mb-3">
          {t(
            'Свои жесты хранятся в вашем аккаунте и работают на всех устройствах: в распознавании и в видеозвонках. Войдите, чтобы добавлять и распознавать их.',
            'Өз ымдарыңыз аккаунтта сақталады және барлық құрылғыда жұмыс істейді: тануда және бейнеқоңырауда. Қосу және тану үшін кіріңіз.',
          )}
        </p>
        <a className="text-link" href="#profile">
          <LogIn size={15} aria-hidden />{' '}
          {t('Войти или создать аккаунт', 'Кіру немесе аккаунт ашу')}
        </a>
      </div>
    );
  if (lib.status === 'loading')
    return <p role="status">{t('Загружаем ваши жесты…', 'Ымдарыңыз жүктелуде…')}</p>;
  if (lib.status === 'error')
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t('Не удалось загрузить жесты.', 'Ымдарды жүктеу мүмкін болмады.')}</p>
        <Button size="sm" onClick={() => void library.reload()}>
          {t('Повторить', 'Қайталау')}
        </Button>
      </div>
    );
  return <>{children}</>;
}

/** Choice of the gesture set used for recognition (remembered on this device). */
export function SetPicker({ lib, label }: { lib: LibrarySnapshot; label: string }) {
  if (lib.status !== 'ready' || !lib.sets.length) return null;
  return (
    <label className="inline-setting">
      <span>{label}</span>
      <select
        value={lib.activeSetId ?? ''}
        aria-label={label}
        onChange={(e) => {
          library.setActiveSet(e.target.value);
        }}
      >
        {lib.sets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({lib.gestures.filter((g) => g.setId === s.id).length})
          </option>
        ))}
      </select>
    </label>
  );
}
